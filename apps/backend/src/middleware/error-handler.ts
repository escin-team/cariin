// apps/backend/src/middleware/error-handler.ts
import { Context } from 'hono';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

export const globalErrorHandler = (err: Error, c: Context) => {
  c.header('Content-Type', 'application/json');

  // 1. Tangkap error otentikasi kustom kita
  if (err.message.includes('UNAUTHORIZED')) {
    return c.json({ 
      success: false, 
      error: 'UNAUTHORIZED', 
      message: 'Kredensial tidak valid atau akses ditolak.' 
    }, 401);
  }

  // 2. SWITCH FUNCTION PATTERN 2 (Blueprint v12.5)
  switch (err.constructor) {
    case ZodError:
      return c.json({
        success: false,
        error: 'VALIDATION_FAILED',
        details: (err as ZodError).issues.map(i => ({ field: i.path.join('.'), message: i.message }))
      }, 400);

    case Prisma.PrismaClientKnownRequestError: {
      const prismaErr = err as Prisma.PrismaClientKnownRequestError;
      switch (prismaErr.code) {
        case 'P2002':
          return c.json({ success: false, error: 'DATA_COLLISION', message: 'Data sudah terdaftar di sistem.' }, 409);
        case 'P2003':
          return c.json({ success: false, error: 'RELATIONAL_ORPHAN', message: 'Referensi ID tidak ditemukan.' }, 422);
        case 'P2025':
          return c.json({ success: false, error: 'RECORD_NOT_FOUND', message: 'Target data tidak ditemukan.' }, 404);
        default:
          return c.json({ success: false, error: 'DATABASE_TRANSACTION_ERROR', code: prismaErr.code }, 500);
      }
    }

    default:
      if (err.message.includes('wallet_balance_non_negative')) {
        return c.json({ success: false, error: 'INSUFFICIENT_FUNDS', message: 'Transaksi dibatalkan. Saldo tidak mencukupi.' }, 400);
      }
      return c.json({ success: false, error: 'INTERNAL_SERVER_ERROR', message: 'Terjadi kesalahan pada server.' }, 500);
  }
};