import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie, getCookie } from 'hono/cookie';
import { env } from '../../bootstrap/env-validation.js';
import { LoginSchema, GoogleLoginSchema, RegisterSchema } from './auth.schema.js';
import { authService } from './auth.service.js';
import { tokenService } from './token.service.js';
import { authMiddleware } from '../../middleware/auth.js'; // ✅ Import authMiddleware

export const authRouter = new Hono();

/**
 * Helper: Inject HttpOnly Cookies (Aturan AUTH-3)
 * Token TIDAK BOLEH di localStorage agar aman dari XSS
 */
function injectSecureCookies(c: any, accessToken: string, refreshToken: string) {
  const isProd = env.NODE_ENV === 'production';

  // Access Token Cookie — path '/' (bisa diakses semua endpoint)
  setCookie(c, 'session_token', accessToken, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 15 * 60, // 15 menit
    path: '/',
  });

  // Refresh Token Cookie — path SCOPING (hanya untuk /v1/auth/refresh)
  // Ini mencegah CSRF dan membatasi exposure jika ada XSS di endpoint lain
  setCookie(c, 'refresh_token', refreshToken, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 30 * 24 * 60 * 60, // 30 hari
    path: '/v1/auth/refresh',
  });
}

/**
 * Helper: Ambil IP Address dengan Fallback Chain (Aturan API-3)
 */
function getClientIp(c: any): string | undefined {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    undefined
  );
}

// =====================================================================
// ENDPOINT 1: REGISTER
// =====================================================================
authRouter.post(
  '/register',
  zValidator('json', RegisterSchema),
  async (c) => {
    const { fullName, phone, password, email } = c.req.valid('json');
    const result = await authService.register(fullName, phone, password, email);

    return c.json(
      {
        success: true,
        message: 'Registrasi berhasil. Silakan login.',
        data: result,
      },
      201
    );
  }
);

// =====================================================================
// ENDPOINT 2: TRADITIONAL LOGIN
// =====================================================================
authRouter.post(
  '/login',
  zValidator('json', LoginSchema),
  async (c) => {
    const { identifier, password } = c.req.valid('json');
    const userAgent = c.req.header('user-agent');
    const ipAddress = getClientIp(c);

    const result = await authService.loginTraditional(
      identifier,
      password,
      userAgent,
      ipAddress
    );

    // Inject cookies (Aturan AUTH-3: token tidak boleh di localStorage)
    injectSecureCookies(c, result.tokens.accessToken, result.tokens.refreshToken);

    return c.json({
      success: true,
      data: {
        user: result.user,
        // accessToken juga dikirim di body untuk SSR/Server Component Next.js
        accessToken: result.tokens.accessToken,
      },
    });
  }
);

// =====================================================================
// ENDPOINT 3: GOOGLE LOGIN
// =====================================================================
authRouter.post(
  '/google',
  zValidator('json', GoogleLoginSchema),
  async (c) => {
    const { idToken } = c.req.valid('json');
    const userAgent = c.req.header('user-agent');
    const ipAddress = getClientIp(c);

    const result = await authService.loginWithGoogle(idToken, userAgent, ipAddress);

    injectSecureCookies(c, result.tokens.accessToken, result.tokens.refreshToken);

    return c.json({
      success: true,
      data: {
        user: result.user,
        accessToken: result.tokens.accessToken,
      },
    });
  }
);

// =====================================================================
// ENDPOINT 4: REFRESH TOKEN (Aturan AUTH-4: Token Rotation)
// =====================================================================
authRouter.post('/refresh', async (c) => {
  const refreshToken = getCookie(c, 'refresh_token');

  if (!refreshToken) {
    return c.json({ success: false, error: { code: 'TOKEN_INVALID', message: 'Refresh token tidak ditemukan.' } }, 401);
  }

  try {
    // rotate() otomatis mendeteksi reuse attack dan membakar family jika dicuri
    const result = await tokenService.rotate(refreshToken);

    // Timpa cookie dengan token baru
    injectSecureCookies(c, result.accessToken, result.refreshToken);

    return c.json({
      success: true,
      message: 'Token refreshed',
      data: { accessToken: result.accessToken },
    });
  } catch (err: any) {
    // Jika SESSION_COMPROMISED atau SESSION_EXPIRED, hapus cookie paksa
    setCookie(c, 'session_token', '', { maxAge: 0, path: '/' });
    setCookie(c, 'refresh_token', '', { maxAge: 0, path: '/v1/auth/refresh' });

    throw err; // Lempar ke globalErrorHandler
  }
});

// =====================================================================
// ENDPOINT 5: LOGOUT (Revoke All Tokens & Clear Cookies)
// ✅ FIX: authMiddleware + revokeAll(userId) untuk logout semua device
// =====================================================================
authRouter.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId');

  // Revoke SEMUA token aktif milik user (logout dari semua device)
  if (userId) {
    await tokenService.revokeAll(userId);
  }

  // Hapus cookie dari browser user
  const isProd = env.NODE_ENV === 'production';
  setCookie(c, 'session_token', '', {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 0,
    path: '/',
  });
  setCookie(c, 'refresh_token', '', {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 0,
    path: '/v1/auth/refresh',
  });

  return c.json({ success: true, message: 'Logged out successfully' });
});