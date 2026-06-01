import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { logger } from 'hono/logger';
import { walletRouter } from '../modules/wallet/wallet.router.js';
import { env } from './env-validation.js';

/**
 * Application Bootstrap
 *
 * Rule [API-1]: CORS WAJIB PERTAMA di middleware chain
 * Urutan: CORS → Security Headers → Logger → Routes → Error Handler
 */

/**
 * Stub Sentry Init
 * Inisialisasi Sentry pertama kali sebelum apapun (Rule C2)
 */
export function initSentry() {
  if (env.SENTRY_DSN) {
    // Sentry.init({ dsn: env.SENTRY_DSN, ... })
    // console.log('Sentry initialized');
  }
}

initSentry(); // ← PERTAMA, sebelum apapun

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

// ===== 8. Global Error Handler =====
// ❌ DILARANG: expose stack trace di production
app.onError((err, c) => {
  // Standardized error codes mapping
  const errorMap: Record<string, { status: number; message: string }> = {
    WALLET_NOT_FOUND: {
      status: 404,
      message: 'Wallet tidak ditemukan. Pastikan akun Anda sudah memiliki wallet.',
    },
    WALLET_UPDATE_FAILED: {
      status: 500,
      message: 'Gagal memperbarui saldo wallet. Silakan coba lagi.',
    },
    WALLET_MAX_BALANCE_EXCEEDED: {
      status: 400,
      message: 'Saldo melebihi batas maksimal wallet.',
    },
    STOCK_INSUFFICIENT: {
      status: 400,
      message: 'Stok tidak mencukupi.',
    },
    DUPLICATE_ORDER: {
      status: 409,
      message: 'Pesanan sudah pernah dibuat.',
    },
    RATE_LIMIT_EXCEEDED: {
      status: 429,
      message: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
    },
  };

  const errorCode = err.message;
  const mapped = errorMap[errorCode];

  if (mapped) {
    return c.json(
      {
        success: false,
        error: {
          code: errorCode,
          message: mapped.message,
        },
      },
      mapped.status as 400 | 404 | 409 | 429 | 500
    );
  }

  // Prisma known errors
  if (err.message.includes('P2002')) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DUPLICATE_ENTRY',
          message: 'Data duplikat terdeteksi.',
        },
      },
      409
    );
  }

  if (err.message.includes('P2025')) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Data tidak ditemukan.',
        },
      },
      404
    );
  }

  // Generic error — hide details in production
  console.error('[UNHANDLED ERROR]', err);

  return c.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          env.NODE_ENV === 'development'
            ? err.message
            : 'Terjadi kesalahan internal. Silakan coba lagi.',
        ...(env.NODE_ENV === 'development' && { stack: err.stack }),
      },
    },
    500
  );
});

export { app };
