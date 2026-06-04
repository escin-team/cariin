import { prismaApp, prismaAuth, withRlsContext } from '../../db/client.js';
import { ConfirmTopupSchema } from './wallet.schema.js';
import { z } from 'zod';

export const walletService = {
  async confirmTopup(body: z.infer<typeof ConfirmTopupSchema>) {
    // 1. Fetch transaction menggunakan prismaAuth (BYPASSRLS) karena belum ada context userId
    const transaction = await prismaAuth.walletTransaction.findUniqueOrThrow({
      where: { id: body.transactionId }
    });

    // 2. Validasi Nominal (Cegah Price Tampering / Webhook Spoof)
    if (BigInt(body.amountPaid) !== transaction.amount) {
      throw new Error('PAYMENT_AMOUNT_MISMATCH');
    }

    // 3. Eksekusi bisnis dengan RLS Context
    return withRlsContext({ userId: transaction.userId }, async () => {
      // Catatan: withRlsContext sudah membungkus ini dalam $transaction, 
      // jadi kita TIDAK perlu memanggil prismaApp.$transaction() lagi di sini.
      
      // A. Atomic Status Update (Mencegah Double Topup / Race Condition)
      const affected = await prismaApp.$executeRaw`
        UPDATE wallet_transactions
        SET status = 'COMPLETED', updated_at = NOW()
        WHERE id = ${transaction.id}::uuid AND status = 'PENDING'
      `;

      if (affected === 0) {
        // Idempotent: Sudah diproses oleh request lain
        return prismaApp.walletTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
      }

      // B. Pessimistic Lock pada Wallet
      const walletLocked = await prismaApp.$queryRaw`
        SELECT balance FROM wallets WHERE id = ${transaction.walletId}::uuid FOR UPDATE
      `;
      
      const balanceBefore = (walletLocked as any)[0].balance;
      const balanceAfter = balanceBefore + transaction.amount;

      // C. Update Saldo Wallet
      await prismaApp.$executeRaw`
        UPDATE wallets 
        SET balance = ${balanceAfter}, updated_at = NOW() 
        WHERE id = ${transaction.walletId}::uuid
      `;

      // D. Catat History Before/After di Transaksi
      await prismaApp.$executeRaw`
        UPDATE wallet_transactions 
        SET balance_before = ${balanceBefore}, balance_after = ${balanceAfter}
        WHERE id = ${transaction.id}::uuid
      `;

      return prismaApp.walletTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    });
  }
};