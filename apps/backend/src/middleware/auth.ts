import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { tokenService } from '../modules/auth/token.service.js';

/**
 * Extend Hono ContextVariableMap untuk type safety
 * Rule: Semua context variable harus di-declare di sini
 */
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    tenantId: string | null;
    role: string;
  }
}

/**
 * Auth Middleware — Rule [AUTH-2] JWT RS256
 * Verifikasi JWT dari HttpOnly cookie ATAU Authorization header
 * Extract userId, tenantId, role ke Hono context
 * 
 * Note: RLS context di-set di layer service via withRlsContext(),
 * bukan di middleware. Ini untuk hindari connection pool issue dengan pgBouncer.
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  // 1. Ambil token dari Header Authorization ATAU Cookie
  let token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    token = getCookie(c, 'session_token');
  }

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
    // 2. Verifikasi JWT menggunakan tokenService (konsisten dengan generateTokenPair)
    const payload = tokenService.verifyAccessToken(token);

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

    // 3. Inject ke Hono context
    c.set('userId', payload.sub);
    c.set('tenantId', payload.tenantId ?? null);
    c.set('role', payload.role);

    await next();
  } catch (error: any) {
    // Error dari tokenService.verifyAccessToken sudah dalam format standar:
    // - 'TOKEN_EXPIRED'
    // - 'TOKEN_INVALID'
    const errorCode = error.message || 'TOKEN_INVALID';

    return c.json(
      {
        success: false,
        error: {
          code: errorCode,
          message:
            errorCode === 'TOKEN_EXPIRED'
              ? 'Sesi telah berakhir. Silakan refresh token.'
              : 'Token tidak valid atau tidak dapat diproses.',
        },
      },
      401
    );
  }
}