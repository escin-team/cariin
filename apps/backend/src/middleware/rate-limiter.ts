import type { Context, Next } from 'hono';

/**
 * Rate Limiter Middleware — Rule [API-3] Fallback Chain IP
 * Production: Redis Lua atomic counter
 * Stub: In-memory Map (untuk development)
 * 
 * IP detection fallback chain:
 * CF-Connecting-IP → X-Forwarded-For → X-Real-IP → 'unknown'
 * ❌ DILARANG: hanya CF header tanpa fallback — crash di dev/staging
 */

// Rate limit config — dari blueprint + tambahan wallet:balance
const RATE_LIMITS: Record<string, { windowMs: number; max: number }> = {
  'auth:login':          { windowMs: 15 * 60_000, max: 10 },
  'auth:register':       { windowMs: 60 * 60_000, max: 5 },
  'auth:otp-request':    { windowMs: 60_000,       max: 3 },
  'auth:otp-verify':     { windowMs: 15 * 60_000, max: 5 },
  'auth:refresh':        { windowMs: 60_000,       max: 30 }, // ✅ Tambahan untuk refresh token
  'orders:create':       { windowMs: 60_000,       max: 10 },
  'wallet:topup':        { windowMs: 60 * 60_000, max: 20 },
  'wallet:balance':      { windowMs: 60_000,       max: 60 }, // ✅ FIX: 60x per menit (cukup longgar untuk cek saldo)
  'feature-flags:fetch': { windowMs: 60_000,       max: 60 },
};

// In-memory store (stub — production pakai Redis Lua)
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const store = new Map<string, RateLimitEntry>();

/**
 * Get client IP with fallback chain — Rule [API-3]
 */
function getClientIp(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') ||                          // Production via Cloudflare
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||    // Staging/LB
    c.req.header('X-Real-IP') ||                                 // Nginx
    'unknown'
  );
}

/**
 * Rate limiter factory
 * @param limitKey - Key dari RATE_LIMITS config (e.g., 'wallet:topup')
 * @param identifierType - 'ip' atau 'userId' — menentukan basis rate limit
 */
export function rateLimiter(
  limitKey: string,
  identifierType: 'ip' | 'userId' = 'userId'
): (c: Context, next: Next) => Promise<Response | void> {
  const config = RATE_LIMITS[limitKey];

  if (!config) {
    throw new Error(`Rate limit config not found for key: ${limitKey}`);
  }

  return async (c: Context, next: Next): Promise<Response | void> => {
    const identifier = identifierType === 'userId'
      ? (c.get('userId') as string | undefined) ?? getClientIp(c)
      : getClientIp(c);

    const storeKey = `${limitKey}:${identifier}`;
    const now = Date.now();

    // Cleanup expired entry
    const entry = store.get(storeKey);
    if (entry && entry.resetAt <= now) {
      store.delete(storeKey);
    }

    const current = store.get(storeKey);

    if (current) {
      if (current.count >= config.max) {
        const retryAfterSec = Math.ceil((current.resetAt - now) / 1000);
        c.header('Retry-After', String(retryAfterSec));
        c.header('X-RateLimit-Limit', String(config.max));
        c.header('X-RateLimit-Remaining', '0');
        c.header('X-RateLimit-Reset', String(Math.ceil(current.resetAt / 1000)));

        return c.json(
          {
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
              retryAfterSeconds: retryAfterSec,
            },
          },
          429
        );
      }
      current.count++;
    } else {
      store.set(storeKey, {
        count: 1,
        resetAt: now + config.windowMs,
      });
    }

    const updated = store.get(storeKey)!;
    c.header('X-RateLimit-Limit', String(config.max));
    c.header('X-RateLimit-Remaining', String(config.max - updated.count));
    c.header('X-RateLimit-Reset', String(Math.ceil(updated.resetAt / 1000)));

    await next();
  };
}