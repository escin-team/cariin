import type { Context } from 'hono';
import { walletService } from './wallet.service.js';
import type { ApiResponse, InitiateTopupResult, ConfirmTopupResult } from './wallet.types.js';

export const walletController = {
  /**
   * Handle POST /v1/wallet/topup/initiate
   */
  async initiate(c: Context): Promise<Response> {
    const body = c.req.valid('json' as never);
    const userId = c.get('userId');

    const idempotencyKey = c.req.header('X-Idempotency-Key') ?? crypto.randomUUID();

    const result = await walletService.initiateTopup(body, userId, idempotencyKey);

    const response: ApiResponse<InitiateTopupResult> = {
      success: true,
      data: result,
    };

    const statusCode = result.idempotent ? 200 : 201;

    return c.json(response, statusCode);
  },

  /**
   * Handle POST /v1/wallet/topup/confirm
   */
  async confirm(c: Context): Promise<Response> {
    const body = c.req.valid('json' as never);

    const result = await walletService.confirmTopup(body);

    const response: ApiResponse<ConfirmTopupResult> = {
      success: true,
      data: result,
    };

    return c.json(response, 200);
  },
};
