import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';

/**
 * Auth Middleware — Rule [AUTH-2] JWT RS256
 *
 * Verifikasi JWT dari HttpOnly cookie (bukan localStorage — Rule [AUTH-3])
 * Extract userId, tenantId, role ke Hono context
 *
 * TODO: Replace stub verification dengan real RS256 verify menggunakan
 *       jsonwebtoken + env.JWT_PUBLIC_KEY saat JWT infrastructure siap
 */

// Extend Hono context variables
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    tenantId: string;
    role: string;
  }
}

/**
 * Note: Stub authMiddleware saat ini belum meng-inject session user ke database.
 * Ketika diupgrade ke JWT real, middleware tidak meng-inject context ke global connection,
 * melainkan RLS akan diaplikasikan di layer service/repository per transaksi menggunakan setRlsContext(tx, { userId }).
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const sessionToken = getCookie(c, 'session_token');

  // Juga support Authorization header untuk development/testing
  const authHeader = c.req.header('Authorization');
  const token = sessionToken || authHeader?.replace('Bearer ', '');

  if (!token) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Sesi tidak ditemukan. Silakan login terlebih dahulu.',
        },
      },
      401
    );
  }

  try {
    // ----- STUB: decode JWT tanpa verification -----
    // Di production, gunakan:
    //   import { verify } from 'jsonwebtoken';
    //   const payload = verify(token, env.JWT_PUBLIC_KEY, { algorithms: ['RS256'] });
    //
    // ❌ DILARANG: HS256 atau symmetric key
    // ❌ DILARANG: sign(payload, 'my-secret-string', { algorithm: 'HS256' })

    const payload = decodeJwtPayload(token);

    if (!payload || !payload.sub) {
      return c.json(
        {
          success: false,
          error: {
            code: 'TOKEN_INVALID',
            message: 'Token tidak valid.',
          },
        },
        401
      );
    }

    // Check expiry
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Sesi telah berakhir. Silakan refresh token.',
          },
        },
        401
      );
    }

    // Inject ke Hono context
    c.set('userId', payload.sub as string);
    c.set('tenantId', (payload.tenantId as string) ?? '');
    c.set('role', (payload.role as string) ?? 'user');

    await next();
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'TOKEN_INVALID',
          message: 'Token tidak dapat diproses.',
        },
      },
      401
    );
  }
}

/**
 * Decode JWT payload tanpa verification (STUB ONLY)
 * Di production, ini WAJIB diganti dengan proper RS256 verify
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}
