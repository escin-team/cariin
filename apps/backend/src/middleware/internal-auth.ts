import type { Context, Next } from 'hono';
import { env } from '../bootstrap/env-validation.js';

/**
 * Internal Auth Middleware
 * Digunakan untuk endpoint internal seperti webhook handler
 * yang dipanggil secara programatik tanpa user session.
 */
export async function internalAuthMiddleware(c: Context, next: Next): Promise<Response | void> {
  const secretHeader = c.req.header('X-Internal-Secret');

  // Simple string comparison for stub
  // Di production bisa menggunakan signature HMAC
  if (!secretHeader || secretHeader !== env.INTERNAL_SECRET_KEY) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED_INTERNAL',
          message: 'Akses internal ditolak.',
        },
      },
      401
    );
  }

  await next();
}
