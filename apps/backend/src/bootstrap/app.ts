import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { logger } from 'hono/logger';

// Import Routers
import { walletRouter } from '../modules/wallet/wallet.router.js';
import { authRouter } from '../modules/auth/auth.router.js';

// Import Bootstrap
import { env } from './env-validation.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { prismaApp } from '../db/client.js';

// ✅ Side-effect import: Inisialisasi Sentry + PII Strip (Rule SENTRY-1)
import '../middleware/sentry.js';

const app = new Hono();

// ===== 1. CORS — PALING AWAL (Rule API-1) =====
const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim());
app.use(
  '*',
  cors({
    origin: allowedOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key', 'X-Cariin-Client', 'X-Webhook-Timestamp', 'X-Webhook-Signature'],
    credentials: true,
    maxAge: 86400,
  })
);

// ===== 2. Security Headers =====
app.use('*', secureHeaders());

// ===== 3. Request Logger (development) =====
if (env.NODE_ENV === 'development') {
  app.use('*', logger());
}

// ===== 4. Request Size Limit (Max 1MB) =====
app.use('*', async (c, next) => {
  const contentLength = c.req.header('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > 1_048_576) {
    return c.json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Ukuran request melebihi batas maksimal 1 MB.' } }, 413);
  }
  return await next();
});

// ===== 5. Routes =====
app.route('/v1/auth', authRouter);
app.route('/v1/wallet', walletRouter);

// ===== 6. Health Check =====
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), version: '0.1.0' }));

// ===== 6b. Readiness Check — cek DB + Redis =====
app.get('/health/ready', async (c) => {
  const checks: Record<string, 'ok' | 'error'> = {};
  let allOk = true;

  // Cek PostgreSQL
  try {
    await prismaApp.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
    allOk = false;
  }

  // Cek Redis (tidak fatal jika down)
  try {
    const { redis } = await import('../cache/redis.js');
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
    // Redis tidak blokir traffic
  }

  return c.json(
    {
      status: allOk ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    },
    allOk ? 200 : 503,
  );
});

// ===== 7. 404 Handler =====
app.notFound((c) => c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } }, 404));

// ===== 8. Global Error Handler (Delegasi ke middleware) =====
app.onError(globalErrorHandler);

export { app };