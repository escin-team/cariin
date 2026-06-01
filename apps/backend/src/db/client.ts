import { PrismaClient } from '@prisma/client';

/**
 * Dual Pool Prisma Client — Rule [DB-1]
 *
 * prismaApp  → operasi bisnis (Wallet, Order, dll) — terkena RLS
 * prismaAuth → operasi auth (OTP, RefreshToken) — BYPASSRLS
 *
 * JANGAN pakai prismaApp untuk query OTP/RefreshToken
 * JANGAN pakai prismaAuth untuk query bisnis
 */

// Pool bisnis — terkena RLS enforcement
export const prismaApp = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
});

// Pool auth — BYPASSRLS untuk OTP dan RefreshToken
export const prismaAuth = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL_AUTH,
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * RLS Context wrapper — Rule [DB-2]
 *
 * Wajib dipakai sebelum query model USER_SCOPED atau TENANT_SCOPED:
 * - USER_SCOPED:   GlobalUser, Wallet, WalletTransaction, GlobalUserRole
 * - TENANT_SCOPED: PayrollBatch, PayrollItem
 *
 * CONTEXT_FREE (tidak perlu wrapper): Tenant, TenantRoleRoute, DomainMapping, AuditLog, WebhookLog
 */
interface RlsContext {
  userId?: string;
  tenantId?: string;
}

export async function withRlsContext<T>(
  context: RlsContext,
  callback: () => Promise<T>
): Promise<T> {
  // Set RLS variables via parameterized query — Rule [DB-3]: TIDAK BOLEH $executeRawUnsafe
  if (context.userId) {
    await prismaApp.$executeRaw`SELECT set_config('app.current_user_id', ${context.userId}, true)`;
  }
  if (context.tenantId) {
    await prismaApp.$executeRaw`SELECT set_config('app.current_tenant_id', ${context.tenantId}, true)`;
  }

  return callback();
}

/**
 * Graceful shutdown — cleanup connections
 */
export async function disconnectAll(): Promise<void> {
  await Promise.all([
    prismaApp.$disconnect(),
    prismaAuth.$disconnect(),
  ]);
}
