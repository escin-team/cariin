import { prismaApp, setRlsContext } from '../../db/client.js';
import { env } from '../../bootstrap/env-validation.js';
import type {
  InitiateTopupDto,
  InitiateTopupResult,
  ConfirmTopupDto,
  ConfirmTopupResult,
} from './wallet.types.js';

/**
 * Serialize BigInt fields untuk JSON response.
 * JSON.stringify tidak bisa handle BigInt natively.
 */
function serializeBigInt(value: bigint | null): string | null {
  if (value === null) return null;
  return value.toString();
}

export const walletService = {
  /**
   * INITIATE TOPUP (User Facing)
   *
   * Flow:
   * 1. Check idempotency.
   * 2. Buat WalletTransaction dengan status PENDING.
   * 3. Saldo belum berubah.
   * 4. Return dummy VA/QRIS.
   */
  async initiateTopup(
    body: InitiateTopupDto,
    userId: string,
    idempotencyKey: string
  ): Promise<InitiateTopupResult> {
    const amountBigInt = BigInt(body.amount);

    return prismaApp.$transaction(async (tx) => {
      // Set RLS Context inside the transaction
      await setRlsContext(tx, { userId });

      // Idempotency check
      const existingTx = await tx.walletTransaction.findUnique({
        where: { idempotencyKey },
      });

      if (existingTx) {
        // Prevent IDOR: pastikan transaksi ini benar milik user yang request
        if (existingTx.userId !== userId) {
          throw new Error('UNAUTHORIZED');
        }

        return {
          transactionId: existingTx.id,
          amount: serializeBigInt(existingTx.amount)!,
          status: existingTx.status as InitiateTopupResult['status'],
          paymentMethod: existingTx.paymentMethod ?? 'UNKNOWN',
          vaNumber: '8888' + existingTx.id.substring(0, 8),
          expiresAt: new Date(existingTx.createdAt.getTime() + 24 * 60 * 60 * 1000),
          idempotent: true,
        };
      }

      // Pastikan wallet ada
      const wallet = await tx.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        throw new Error('WALLET_NOT_FOUND');
      }

        // Create pending transaction
        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            userId,
            type: 'TOPUP',
            status: 'PENDING',
            amount: amountBigInt,
            idempotencyKey,
            paymentMethod: body.paymentMethod,
            description: body.description ?? null,
          },
        });

        return {
          transactionId: transaction.id,
          amount: serializeBigInt(transaction.amount)!,
          status: 'PENDING',
          paymentMethod: body.paymentMethod,
          vaNumber: '8888' + transaction.id.substring(0, 8),
          expiresAt: new Date(transaction.createdAt.getTime() + 24 * 60 * 60 * 1000),
          idempotent: false,
        };
      });
  },

  /**
   * CONFIRM TOPUP (Internal Webhook)
   *
   * Flow:
   * 1. Cari transaksi pending
   * 2. Pessimistic lock wallet (FOR UPDATE)
   * 3. Check WALLET_MAX_BALANCE
   * 4. Atomic balance update
   * 5. Update transaksi ke COMPLETED
   */
  async confirmTopup(body: ConfirmTopupDto): Promise<ConfirmTopupResult> {
    const maxBalance = BigInt(env.WALLET_MAX_BALANCE);

    // Ini webhook internal, tidak ada user session, tapi kita bisa pakai
    // withRlsContext jika kita fetch userId dari transaksi terlebih dahulu.
    // Atau karena ini proses internal, kita bisa fetch transaksinya dulu tanpa RLS,
    // lalu pakai RLS context saat update wallet.

    return prismaApp.$transaction(async (tx) => {
      // 1. Ambil transaksi
      const transaction = await tx.walletTransaction.findUnique({
        where: { id: body.transactionId },
        include: { wallet: true },
      });

      if (!transaction) {
        throw new Error('NOT_FOUND');
      }

      if (transaction.status === 'COMPLETED') {
        // Idempotent webhook hit
        return {
          transaction: {
            id: transaction.id,
            type: transaction.type as ConfirmTopupResult['transaction']['type'],
            status: 'COMPLETED',
            amount: serializeBigInt(transaction.amount)!,
            balanceBefore: serializeBigInt(transaction.balanceBefore),
            balanceAfter: serializeBigInt(transaction.balanceAfter),
            referenceId: transaction.referenceId,
            createdAt: transaction.createdAt,
          },
          wallet: {
            id: transaction.wallet.id,
            balance: serializeBigInt(transaction.wallet.balance)!,
          },
        };
      }

      if (transaction.status === 'FAILED') {
        throw new Error('TRANSACTION_FAILED');
      }

      // Set RLS Context untuk memastikan update balance dilakukan dengan userId yang sesuai
      await setRlsContext(tx, { userId: transaction.userId });

      // 2. Pessimistic Lock
      const lockedWallet = await tx.$queryRaw<[{ id: string; balance: bigint; user_id: string }]>`
        SELECT id, balance, user_id
        FROM wallets
        WHERE id = ${transaction.walletId}::uuid
        FOR UPDATE
      `;

      if (!lockedWallet[0]) {
        throw new Error('WALLET_NOT_FOUND');
      }

      const wallet = lockedWallet[0];
      const balanceBefore = wallet.balance;

      // 3. Pengecekan limit sebelum di-update (bisa dari raw sql update affected rows juga)
      if (balanceBefore + transaction.amount > maxBalance) {
        throw new Error('WALLET_MAX_BALANCE_EXCEEDED');
      }

      // 4. Atomic balance update
      const affected = await tx.$executeRaw`
        UPDATE wallets
        SET balance = balance + ${transaction.amount},
            updated_at = NOW()
        WHERE id = ${wallet.id}::uuid
          AND balance + ${transaction.amount} <= ${maxBalance}
      `;

      if (affected === 0) {
        // Karena kita sudah mengecek sebelumnya, jika 0 berarti race condition
        throw new Error('WALLET_MAX_BALANCE_EXCEEDED');
      }

      const balanceAfter = balanceBefore + transaction.amount;

      // 5. Update Transaction
      const updatedTx = await tx.walletTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'COMPLETED',
          balanceBefore,
          balanceAfter,
          referenceId: body.referenceId ?? null,
        },
      });

      return {
        transaction: {
          id: updatedTx.id,
          type: updatedTx.type as ConfirmTopupResult['transaction']['type'],
          status: 'COMPLETED',
          amount: serializeBigInt(updatedTx.amount)!,
          balanceBefore: serializeBigInt(updatedTx.balanceBefore),
          balanceAfter: serializeBigInt(updatedTx.balanceAfter),
          referenceId: updatedTx.referenceId,
          createdAt: updatedTx.createdAt,
        },
        wallet: {
          id: wallet.id,
          balance: serializeBigInt(balanceAfter)!,
        },
      };
    });
  },
};
