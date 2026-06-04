import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../../middleware/auth.js';
import { internalAuthMiddleware } from '../../middleware/internal-auth.js';
import { rateLimiter } from '../../middleware/rate-limiter.js';
import { InitiateTopupSchema, ConfirmTopupSchema } from './wallet.schema.js';
import { walletController } from './wallet.controller.js';

export const walletRouter = new Hono();

// Helper untuk custom error response zod
const zodErrorFormatter = (result: any, c: any) => {
  if (!result.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Data yang dikirim tidak valid.',
          details: result.error.issues.map((issue: any) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      400
    );
  }
  return;
};

// 1. Endpoint User-Facing: Initiate Topup
walletRouter.post(
  '/topup/initiate',
  authMiddleware,
  rateLimiter('wallet:topup', 'userId'),
  zValidator('json', InitiateTopupSchema, zodErrorFormatter),
  walletController.initiate
);

// 2. Endpoint Internal Webhook: Confirm Topup
walletRouter.post(
  '/topup/confirm',
  internalAuthMiddleware('INTERNAL'),
  // Rate limit untuk internal auth bisa menggunakan IP fallback
  rateLimiter('wallet:topup', 'ip'),
  zValidator('json', ConfirmTopupSchema, zodErrorFormatter),
  walletController.confirm
);
