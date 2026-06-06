import type { Context, Next } from 'hono';
import { redis } from '../cache/redis.js';

/**
 * Rate Limiter Middleware — Rule [API-3] Fallback Chain IP
 * Production: Redis Lua atomic counter
 * 
 * IP detection fallback chain:
 * CF-Connecting-IP → X-Forwarded-For → X-Real-IP → 'unknown'
 */

// Rate limit config
const RATE_LIMITS: Record<string, { windowMs: number; max: number }> = {
  'auth:login':          { windowMs: 15 * 60_000, max: 10 },
  'auth:register':       { windowMs: 60 * 60_000, max: 5 },
  'auth:otp-request':    { windowMs: 60_000,       max: 3 },
  'auth:otp-verify':     { windowMs: 15 * 60_000, max: 5 },
  'auth:refresh':        { windowMs: 60_000,       max: 30 },
  'orders:create':       { windowMs: 60_000,       max: 10 },
  'wallet:topup':        { windowMs: 60 * 60_000, max: 20 },
  'wallet:balance':      { windowMs: 60_000,       max: 60 },
  'feature-flags:fetch': { windowMs: 60_000,       max: 60 },
};

// Lua script: atomic increment + set expiry hanya pada counter baru
const LUA_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;

/**
 * Get client IP with fallback chain — Rule [API-3]
 */
function getClientIp(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
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
  identifierType: 'ip' | 'userId' = 'ip'
): (c: Context, next: Next) => Promise<Response | void> {
  const config = RATE_LIMITS[limitKey];

  if (!config) {
    throw new Error(`Rate limit config not found for key: ${limitKey}`);
  }

  return async (c: Context, next: Next): Promise<Response | void> => {
    const identifier = identifierType === 'userId'
      ? (c.get('userId') as string | undefined) ?? getClientIp(c)
      : getClientIp(c);

    const redisKey = `rl:${limitKey}:${identifier}`;
    const windowSec = Math.ceil(config.windowMs / 1000);

    let current = config.max + 1; // fallback: lewatkan jika Redis down
    try {
      current = (await redis.eval(
        LUA_SCRIPT,
        1,
        redisKey,
        windowSec,
      )) as number;
    } catch {
      // Redis down → jangan blokir user, log saja
      console.warn('[RateLimit] Redis unavailable, skipping rate limit');
      return next();
    }

    c.header('X-RateLimit-Limit', String(config.max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, config.max - current)));

    if (current > config.max) {
      c.header('Retry-After', String(windowSec));
      return c.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
            retryAfterSeconds: windowSec,
          },
        },
        429
      );
    }

    await next();
  };
}