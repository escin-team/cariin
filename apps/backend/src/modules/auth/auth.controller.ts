import { Hono, Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie } from 'hono/cookie';
import { env } from '../../bootstrap/env-validation.js';
import { LoginSchema, GoogleLoginSchema } from './auth.schema.js';
import { authService } from './auth.service.js';
import { rateLimiter } from '../../middleware/rate-limiter.js';

export const authRouter = new Hono();

// Fallback Chain Guard: Melacak IP Asli Kustomer untuk Audit Trail
function getClientIp(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') || 
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 
    c.req.header('X-Real-IP') || 
    '127.0.0.1'
  );
}

function injectSecureCookies(c: Context, accessToken: string, refreshToken: string) {
  const isProd = env.NODE_ENV === 'production';
  
  setCookie(c, 'session_token', accessToken, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 15 * 60, 
    path: '/', 
  });

  setCookie(c, 'refresh_token', refreshToken, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 30 * 24 * 3600,
    path: '/v1/auth/refresh', 
  });
}

// =====================================================================
// ENDPOINT 1: TRADISIONAL LOGIN
// =====================================================================
authRouter.post(
  '/login',
  rateLimiter('auth:login', 'ip'), 
  zValidator('json', LoginSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: 'VALIDATION_FAILED', details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const body = c.req.valid('json');
    const userAgent = c.req.header('User-Agent');
    const ipAddress = getClientIp(c);

    const result = await authService.login(body, userAgent, ipAddress);
    
    injectSecureCookies(c, result.tokens.accessToken, result.tokens.refreshToken);

    return c.json({ success: true, data: result.user }, 200);
  }
);

// =====================================================================
// ENDPOINT 2: GOOGLE LOGIN
// =====================================================================
authRouter.post(
  '/login/google',
  rateLimiter('auth:login', 'ip'), 
  zValidator('json', GoogleLoginSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: 'VALIDATION_FAILED', details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const { idToken } = c.req.valid('json');
    const userAgent = c.req.header('User-Agent');
    const ipAddress = getClientIp(c);

    const result = await authService.loginWithGoogle(idToken, userAgent, ipAddress);

    injectSecureCookies(c, result.tokens.accessToken, result.tokens.refreshToken);

    return c.json({ success: true, data: result.user }, 200);
  }
);