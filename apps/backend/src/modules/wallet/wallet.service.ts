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
    const transaction = await prismaAuth.walletTransaction.findUniqueOrThrow({
      where: { id: body.transactionId }
    });

    if (BigInt(body.amountPaid) !== transaction.amount) {
      throw new Error('PAYMENT_AMOUNT_MISMATCH');
    }

    const result = await withRlsContext({ userId: transaction.userId }, async () => {
      const affected = await prismaApp.$executeRaw`
        UPDATE wallet_transactions
        SET status = 'COMPLETED'
        WHERE id = ${transaction.id}::uuid AND status = 'PENDING'
      `;

      if (affected === 0) {
        const existingTx = await prismaApp.walletTransaction.findUniqueOrThrow({ 
          where: { id: transaction.id } 
        });
        return existingTx;
      }

      // ✅ FIX: Ganti $queryRawUnsafe ke $queryRaw untuk menghindari SQL injection risk
      const walletLocked = await prismaApp.$queryRaw<
        Array<{ balance: bigint }>
      >`SELECT balance FROM wallets WHERE id = ${transaction.walletId}::uuid FOR UPDATE`;
      
      if (!walletLocked || walletLocked.length === 0) {
        throw new Error('WALLET_NOT_FOUND');
      }
      
      const balanceBefore = walletLocked[0].balance;
      const balanceAfter = balanceBefore + transaction.amount;

      const maxBalance = BigInt(env.WALLET_MAX_BALANCE || '50000000');
      if (balanceAfter > maxBalance) {
        throw new Error('WALLET_MAX_BALANCE_EXCEEDED');
      }

      await prismaApp.$executeRaw`
        UPDATE wallets 
        SET balance = ${balanceAfter}, updated_at = NOW() 
        WHERE id = ${transaction.walletId}::uuid
      `;

      await prismaApp.$executeRaw`
        UPDATE wallet_transactions 
        SET balance_before = ${balanceBefore}, balance_after = ${balanceAfter}
        WHERE id = ${transaction.id}::uuid
      `;

      return prismaApp.walletTransaction.findUniqueOrThrow({ 
        where: { id: transaction.id } 
      });
    });

    return serializeBigInt(result);
  },
};