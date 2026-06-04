import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { logger } from 'hono/logger';
import { walletRouter } from '../modules/wallet/wallet.router.js';
import { env } from './env-validation.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import '../middleware/sentry.js'; // Side-effect: initializes Sentry

/**
 * Application Bootstrap
 *
 * Rule [API-1]: CORS WAJIB PERTAMA di middleware chain
 * Urutan: CORS → Security Headers → Logger → Routes → Error Handler
 *
 * Sentry diinisialisasi via side-effect import '../middleware/sentry.js'
 */

const app = new Hono();

// ===== 1. CORS — PALING AWAL (Rule API-1) =====
// ❌ DILARANG: CORS setelah middleware lain — preflight OPTIONS gagal
const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim());

app.use(
  '*',
  cors({
    origin: allowedOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key', 'X-Cariin-Client'],
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

// ===== 4. Request Size Limit =====
app.use('*', async (c, next) => {
  const contentLength = c.req.header('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > 1_048_576) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Ukuran request melebihi batas maksimal 1 MB.',
        },
      },
      413
    );
  }
  await next();
  return;
});

// ===== 5. Routes =====
app.route('/v1/wallet', walletRouter);

// ===== 6. Health Check =====
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  });
});

// ===== 7. 404 Handler =====
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint tidak ditemukan.',
      },
    },
    404
  );
});

// ===== 8. Global Error Handler (dari error-handler.ts) =====
app.onError(globalErrorHandler);

export { app };
