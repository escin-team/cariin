import { Context } from 'hono';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { env } from '../bootstrap/env-validation.js';
import { Sentry } from './sentry.js';

export function globalErrorHandler(err: Error, c: Context) {
  // Log ke Sentry untuk semua error kritis
  if (env.NODE_ENV === 'production' && !(err instanceof ZodError)) {
    Sentry.captureException(err);
  }

  // 1. Zod Validation Error (400)
  if (err instanceof ZodError) {
    return c.json({
      error: 'VALIDATION_ERROR',
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    }, 400);
  }

  // 2. Prisma Errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2025: Record not found
    if (err.code === 'P2025') {
      return c.json({ error: 'NOT_FOUND' }, 404);
    }
    // P2002: Unique constraint violation
    if (err.code === 'P2002') {
      return c.json({ error: 'DUPLICATE_ENTRY', field: (err.meta?.target as string[])?.join(',') }, 409);
    }
  }

  // 3. PostgreSQL Check Constraint Violation
  if (err.message.includes('chk_wallet_balance_positive')) {
    return c.json({ error: 'INSUFFICIENT_FUNDS' }, 400);
  }

  // 4. Business Logic Errors (Sesuai ERROR CODES STANDAR)
  const businessErrors = [
    'OTP_MAX_ATTEMPTS_EXCEEDED',
    'OTP_INVALID',
    'STOCK_INSUFFICIENT',
    'STOCK_DEPLETED_CONCURRENT',
    'SERVICE_INACTIVE',
    'DUPLICATE_ORDER',
    'WEBHOOK_TIMESTAMP_EXPIRED',
    'INVALID_WEBHOOK_SIGNATURE',
    'RATE_LIMIT_EXCEEDED',
    'PAYLOAD_TOO_LARGE',
    'TOKEN_EXPIRED',
    'TOKEN_INVALID',
    'SESSION_COMPROMISED',
    'SESSION_EXPIRED',
    'UNAUTHORIZED',
    'PAYMENT_AMOUNT_MISMATCH',
    'WALLET_MAX_BALANCE_EXCEEDED',
    'WALLET_NOT_FOUND',
  ];

  if (businessErrors.includes(err.message)) {
    const statusMap: Record<string, number> = {
      UNAUTHORIZED: 401,
      TOKEN_EXPIRED: 401,
      TOKEN_INVALID: 401,
      SESSION_COMPROMISED: 401,
      SESSION_EXPIRED: 401,
      RATE_LIMIT_EXCEEDED: 429,
      PAYLOAD_TOO_LARGE: 413,
      NOT_FOUND: 404,
      WALLET_NOT_FOUND: 404,
    };
    return c.json({ error: err.message }, (statusMap[err.message] || 400) as any);
  }

  // 5. Fallback: Internal Server Error
  console.error('Unhandled Error:', err);
  
  return c.json({
    error: 'INTERNAL_SERVER_ERROR',
    // Di development, tampilkan stack trace untuk debugging
    ...(env.NODE_ENV === 'development' && { 
      message: err.message, 
      stack: err.stack 
    }),
  }, 500);
}