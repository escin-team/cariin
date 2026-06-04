import { prismaApp, prismaAuth, withRlsContext } from '../../db/client.js';
import { InitiateTopupSchema, ConfirmTopupSchema } from './wallet.schema.js';
import { env } from '../../bootstrap/env-validation.js';
import { z } from 'zod';
import type { InitiateTopupResult } from './wallet.types.js';

// Helper untuk konversi BigInt ke string agar bisa di-serialize ke JSON
function serializeBigInt<T extends Record<string, any>>(obj: T): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, serializeBigInt(value)])
    );
  }
  return obj;
}

export const walletService = {
  /**
   * Inisiasi topup — membuat transaksi PENDING dan mengembalikan detail pembayaran.
   * Mendukung idempotency: jika idempotencyKey sudah ada, kembalikan data sebelumnya.
   */
  async initiateTopup(
    body: z.infer<typeof InitiateTopupSchema>,
    userId: string,
    idempotencyKey: string
  ): Promise<InitiateTopupResult> {
    // Cek idempotency: apakah transaksi dengan key ini sudah ada?
    const existing = await prismaApp.walletTransaction.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      return {
        transactionId: existing.id,
        amount: existing.amount.toString(),
        status: existing.status as 'PENDING' | 'COMPLETED' | 'FAILED',
        paymentMethod: existing.paymentMethod ?? body.paymentMethod,
        vaNumber: `VA-${existing.id.slice(0, 8).toUpperCase()}`,
        expiresAt: new Date(existing.createdAt.getTime() + 24 * 60 * 60 * 1000),
        idempotent: true,
      };
    }

    // Cari wallet user
    const wallet = await prismaApp.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw new Error('WALLET_NOT_FOUND');
    }

    // Buat transaksi PENDING dalam RLS context
    const transaction = await withRlsContext({ userId }, async () => {
      return prismaApp.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: 'TOPUP',
          status: 'PENDING',
          amount: BigInt(body.amount),
          idempotencyKey,
          paymentMethod: body.paymentMethod,
          description: `Topup via ${body.provider}`,
        },
      });
    });

    return {
      transactionId: transaction.id,
      amount: transaction.amount.toString(),
      status: 'PENDING',
      paymentMethod: body.paymentMethod,
      vaNumber: `VA-${transaction.id.slice(0, 8).toUpperCase()}`,
      expiresAt: new Date(transaction.createdAt.getTime() + 24 * 60 * 60 * 1000),
      idempotent: false,
    };
  },

  async confirmTopup(body: z.infer<typeof ConfirmTopupSchema>) {
    // 1. Fetch transaction menggunakan prismaAuth (BYPASSRLS) karena belum ada context userId
    const transaction = await prismaAuth.walletTransaction.findUniqueOrThrow({
      where: { id: body.transactionId }
    });

    // 2. Validasi Nominal (Cegah Price Tampering / Webhook Spoof) — ATURAN API-5
    if (BigInt(body.amountPaid) !== transaction.amount) {
      throw new Error('PAYMENT_AMOUNT_MISMATCH');
    }

    // 3. Eksekusi bisnis dengan RLS Context
    const result = await withRlsContext({ userId: transaction.userId }, async () => {
      // A. Atomic Status Update (Mencegah Double Topup / Race Condition) — ATURAN DB-4
      const affected = await prismaApp.$executeRaw`
        UPDATE wallet_transactions
        SET status = 'COMPLETED'
        WHERE id = ${transaction.id}::uuid AND status = 'PENDING'
      `;

      if (affected === 0) {
        // Idempotent: Sudah diproses oleh request lain
        const existingTx = await prismaApp.walletTransaction.findUniqueOrThrow({ 
          where: { id: transaction.id } 
        });
        return existingTx;
      }

      // B. Pessimistic Lock pada Wallet
      const walletLocked = await prismaApp.$queryRawUnsafe(
        `SELECT balance FROM wallets WHERE id = $1::uuid FOR UPDATE`,
        transaction.walletId
      ) as Array<{ balance: bigint }>;
      
      if (!walletLocked || walletLocked.length === 0) {
        throw new Error('WALLET_NOT_FOUND');
      }
      
      const balanceBefore = walletLocked[0].balance;
      const balanceAfter = balanceBefore + transaction.amount;

      // C. Validasi batas maksimal saldo wallet (Cegah overflow / abuse)
      const maxBalance = BigInt(env.WALLET_MAX_BALANCE || '1000000000');
      if (balanceAfter > maxBalance) {
        throw new Error('WALLET_MAX_BALANCE_EXCEEDED');
      }

      // D. Update Saldo Wallet (Atomic dengan CHECK constraint)
      await prismaApp.$executeRaw`
        UPDATE wallets 
        SET balance = ${balanceAfter}, updated_at = NOW() 
        WHERE id = ${transaction.walletId}::uuid
      `;

      // E. Catat History Before/After di Transaksi
      await prismaApp.$executeRaw`
        UPDATE wallet_transactions 
        SET balance_before = ${balanceBefore}, balance_after = ${balanceAfter}
        WHERE id = ${transaction.id}::uuid
      `;

      return prismaApp.walletTransaction.findUniqueOrThrow({ 
        where: { id: transaction.id } 
      });
    });

    // F. Serialize BigInt sebelum dikembalikan ke controller
    return serializeBigInt(result);
  },
};