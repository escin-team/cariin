import { Context } from 'hono';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { env } from '../bootstrap/env-validation.js';
import { Sentry } from './sentry.js';

export function globalErrorHandler(err: Error, c: Context) {
  // 1. Log ke Sentry (Otomatis di-strip PII-nya oleh beforeSend di sentry.ts)
  if (env.NODE_ENV === 'production' && !(err instanceof ZodError)) {
    Sentry.captureException(err);
  }

  // 2. Zod Validation Error (400)
  if (err instanceof ZodError) {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Data yang Anda kirim tidak valid.',
        details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
      },
    }, 400);
  }

  // 3. Prisma Known Errors (P2025, P2002)
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Data tidak ditemukan.' } }, 404);
    }
    if (err.code === 'P2002') {
      return c.json({ success: false, error: { code: 'DUPLICATE_ENTRY', message: 'Data duplikat terdeteksi.', field: (err.meta?.target as string[])?.join(',') } }, 409);
    }
  }

  // 4. PostgreSQL Check Constraint Violation
  if (err.message?.includes('chk_wallet_balance_positive')) {
    return c.json({ success: false, error: { code: 'INSUFFICIENT_FUNDS', message: 'Saldo tidak mencukupi.' } }, 400);
  }

  // 5. Standardized Business Error Codes Map
  const errorMap: Record<string, { status: number; message: string }> = {
    // Auth & Session
    UNAUTHORIZED: { status: 401, message: 'Anda harus login terlebih dahulu.' },
    TOKEN_EXPIRED: { status: 401, message: 'Sesi berakhir. Silakan refresh.' },
    TOKEN_INVALID: { status: 401, message: 'Token tidak valid.' },
    SESSION_COMPROMISED: { status: 401, message: 'Sesi berakhir karena aktivitas mencurigakan. Login ulang.' },
    SESSION_EXPIRED: { status: 401, message: 'Sesi berakhir. Silakan login ulang.' },
    UNAUTHORIZED_CREDENTIALS: { status: 401, message: 'Email/HP atau password salah.' },
    EMAIL_ALREADY_REGISTERED_TRADITIONAL: { status: 409, message: 'Email sudah terdaftar dengan password.' },
    OAUTH_ACCOUNT_USE_PASSWORD_LOGIN: { status: 400, message: 'Akun ini terdaftar via Google.' },
    UNAUTHORIZED_GOOGLE_TOKEN: { status: 401, message: 'Token Google tidak valid.' },
    
    // OTP
    OTP_MAX_ATTEMPTS_EXCEEDED: { status: 429, message: 'Terlalu banyak percobaan salah.' },
    OTP_INVALID: { status: 400, message: 'Kode OTP salah.' },

    // Wallet & Financial
    WALLET_NOT_FOUND: { status: 404, message: 'Wallet tidak ditemukan.' },
    WALLET_MAX_BALANCE_EXCEEDED: { status: 400, message: 'Saldo melebihi batas maksimal.' },
    PAYMENT_AMOUNT_MISMATCH: { status: 400, message: 'Nominal pembayaran tidak sesuai.' },
    INSUFFICIENT_FUNDS: { status: 400, message: 'Saldo tidak mencukupi.' },

    // Webhook
    WEBHOOK_TIMESTAMP_EXPIRED: { status: 401, message: 'Webhook timestamp kadaluarsa.' },
    INVALID_WEBHOOK_SIGNATURE: { status: 401, message: 'Signature webhook tidak valid.' },

    // General
    RATE_LIMIT_EXCEEDED: { status: 429, message: 'Terlalu banyak permintaan.' },
    PAYLOAD_TOO_LARGE: { status: 413, message: 'Ukuran request terlalu besar.' },
  };

  const mapped = errorMap[err.message];
  if (mapped) {
    return c.json({ success: false, error: { code: err.message, message: mapped.message } }, mapped.status as any);
  }

  // 6. Fallback: Internal Server Error (Hide Stack Trace in Prod)
  console.error('[UNHANDLED ERROR]', err);
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: env.NODE_ENV === 'development' ? err.message : 'Terjadi kesalahan internal server.',
      ...(env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  }, 500);
}