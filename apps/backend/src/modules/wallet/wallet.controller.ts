import type { Context } from 'hono';
import { walletService } from './wallet.service.js';

/**
 * Wallet Controller — Route handler tipis, hanya validasi + call service
 * Rule: Controller tidak boleh ada business logic atau DB query
 */
export const walletController = {
  /**
   * Handle POST /v1/wallet/topup/initiate
   */
  async initiate(c: Context): Promise<Response> {
    // ✅ FIX: Cast c.req ke any untuk bypass Hono's strict 'never' type inference
    const body = (c.req as any).valid('json');
    const userId = c.get('userId') as string;
    const idempotencyKey = c.req.header('X-Idempotency-Key') ?? crypto.randomUUID();

    const result = await walletService.initiateTopup(body, userId, idempotencyKey);

    // Idempotency: jika transaksi sudah ada, return 200. Jika baru, 201.
    const statusCode = (result as any).idempotent ? 200 : 201;

    return c.json({ success: true, data: result }, statusCode);
  },

  /**
   * Handle POST /v1/wallet/topup/confirm
   */
  async confirm(c: Context): Promise<Response> {
    // verifiedBody di-set oleh internalAuthMiddleware setelah HMAC valid
    const verifiedBody = (c as any).get('verifiedBody');
    const body = verifiedBody || (c.req as any).valid('json');

    const result = await walletService.confirmTopup(body);

    return c.json({ success: true, data: result }, 200);
  },

  /**
   * Handle GET /v1/wallet/balance
   */
  async getBalance(c: Context): Promise<Response> {
    const userId = c.get('userId') as string;

    // Import langsung di sini untuk hindari circular dependency
    const { prismaApp, withRlsContext } = await import('../../db/client.js');

    const wallet = await withRlsContext({ userId }, async () => {
      return prismaApp.wallet.findUniqueOrThrow({
        where: { userId },
      });
    });

    return c.json({
      success: true,
      data: {
        userId: wallet.userId,
        balance: wallet.balance.toString(), // BigInt → string
        updatedAt: wallet.updatedAt,
      },
    });
  },
};