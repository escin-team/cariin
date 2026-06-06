import { prismaApp, prismaAuth, withRlsContext } from '../../db/client.js';
import { ConfirmTopupSchema, InitiateTopupSchema } from './wallet.schema.js';
import { env } from '../../bootstrap/env-validation.js';
import { z } from 'zod';

function serializeBigInt(obj: any): any {
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
  async initiateTopup(body: z.infer<typeof InitiateTopupSchema>, userId: string, idempotencyKey: string) {
    return withRlsContext({ userId }, async () => {
      // 1. Idempotency check
      const existing = await prismaApp.walletTransaction.findFirst({
        where: { idempotencyKey, userId }
      });
      if (existing) {
        // ✅ FIX: Tambahkan flag idempotent
        return { ...serializeBigInt(existing), idempotent: true };
      }

      // 2. Pastikan user punya wallet
      const wallet = await prismaApp.wallet.findUniqueOrThrow({
        where: { userId }
      });

      // 3. Buat transaksi PENDING
      const amount = BigInt(body.amount);
      const transaction = await prismaApp.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: 'TOPUP',
          status: 'PENDING',
          amount,
          idempotencyKey,
          paymentMethod: body.paymentMethod,
          description: `Topup via ${body.provider}`,
        }
      });

      // ✅ FIX: Tambahkan flag idempotent
      return { ...serializeBigInt(transaction), idempotent: false };
    });
  },

  async confirmTopup(body: z.infer<typeof ConfirmTopupSchema>) {
    // 1. Cari transaksi via prismaApp + RLS bypass sementara untuk webhook internal
    //    (webhook sudah terverifikasi HMAC di middleware sebelum sampai sini)
    const transaction = await prismaApp.$queryRaw<
      Array<{ id: string; wallet_id: string; user_id: string; amount: bigint; status: string }>
    >`SELECT id, wallet_id, user_id, amount, status FROM wallet_transactions
      WHERE id = ${body.transactionId}::uuid LIMIT 1`;

    if (!transaction[0]) throw new Error('WALLET_NOT_FOUND');
    const tx = transaction[0];

    if (BigInt(body.amountPaid) !== tx.amount) {
      throw new Error('PAYMENT_AMOUNT_MISMATCH');
    }

    const result = await withRlsContext({ userId: tx.user_id }, async () => {
      // 2. Update status → COMPLETED (atomic, hanya jika masih PENDING)
      const affected = await prismaApp.$executeRaw`
        UPDATE wallet_transactions
        SET status = 'COMPLETED'
        WHERE id = ${tx.id}::uuid AND status = 'PENDING'
      `;

      if (affected === 0) {
        // Sudah diproses sebelumnya (idempotent)
        return prismaApp.walletTransaction.findUniqueOrThrow({ where: { id: tx.id } });
      }

      // 3. Tambah saldo — satu atomic statement (lebih aman dari SELECT + UPDATE terpisah)
      const maxBalance = BigInt(env.WALLET_MAX_BALANCE ?? '50000000');
      const updated = await prismaApp.$executeRaw`
        UPDATE wallets
        SET balance    = balance + ${tx.amount},
            updated_at = NOW()
        WHERE id = ${tx.wallet_id}::uuid
          AND balance + ${tx.amount} <= ${maxBalance}
      `;

      if (updated === 0) throw new Error('WALLET_MAX_BALANCE_EXCEEDED');

      // 4. Catat balance_before dan balance_after
      const wallet = await prismaApp.$queryRaw<Array<{ balance: bigint }>>`
        SELECT balance FROM wallets WHERE id = ${tx.wallet_id}::uuid
      `;
      const balanceAfter  = wallet[0]?.balance ?? BigInt(0);
      const balanceBefore = balanceAfter - tx.amount;

      await prismaApp.$executeRaw`
        UPDATE wallet_transactions
        SET balance_before = ${balanceBefore}, balance_after = ${balanceAfter}
        WHERE id = ${tx.id}::uuid
      `;

      return prismaApp.walletTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    });

    return serializeBigInt(result);
  },
};