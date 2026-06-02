import type { Context, Next } from 'hono';
import { env } from '../bootstrap/env-validation.js';
import { timingSafeEqual } from 'crypto';

/**
 * Internal Auth Middleware
 * Digunakan untuk endpoint internal seperti webhook handler
 * yang dipanggil secara programatik tanpa user session.
 */
export async function internalAuthMiddleware(c: Context, next: Next): Promise<Response | void> {
  const secretHeader = c.req.header('X-Internal-Secret');

  // Gunakan timingSafeEqual untuk mencegah Timing Attack
  if (!secretHeader || secretHeader.length !== env.INTERNAL_SECRET_KEY.length) {
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

  const isValid = timingSafeEqual(
    Buffer.from(secretHeader),
    Buffer.from(env.INTERNAL_SECRET_KEY)
  );

  if (!isValid) {
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
