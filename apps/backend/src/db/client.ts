import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '../bootstrap/env-validation.js';

const prismaBase = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

const prismaAuthBase = new PrismaClient({
  datasourceUrl: env.DATABASE_URL_AUTH,
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

const txStorage = new AsyncLocalStorage<any>();

/**
 * Proxy untuk prismaApp
 * Jika sedang dalam withRlsContext, otomatis redirect ke transaction client.
 * MEMBLOKIR akses $transaction untuk mencegah nested transaction yang keluar dari RLS context.
 */
export const prismaApp = new Proxy(prismaBase, {
  get(target, prop) {
    // 🚨 BLOKIR: Jangan izinkan nested $transaction di dalam withRlsContext
    if (prop === '$transaction') {
      const tx = txStorage.getStore();
      if (tx) {
        throw new Error(
          'DILARANG memanggil prismaApp.$transaction() di dalam withRlsContext. ' +
          'Anda sudah berada dalam transaksi. Gunakan prismaApp langsung.'
        );
      }
      return target.$transaction.bind(target);
    }

    const tx = txStorage.getStore();
    if (tx && prop in tx) {
      return tx[prop];
    }
    return target[prop as keyof PrismaClient];
  },
}) as PrismaClient;

export const prismaAuth = prismaAuthBase;

interface RlsContext {
  userId?: string;
  tenantId?: string;
}

/**
 * Membungkus eksekusi dengan RLS Context.
 * Otomatis memulai transaksi dan meng-inject userId/tenantId ke PostgreSQL session.
 */
export async function withRlsContext<T>(context: RlsContext, fn: () => Promise<T>): Promise<T> {
  // Validasi UUID sebelum inject ke PostgreSQL session
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (context.userId && !UUID_REGEX.test(context.userId)) {
    throw new Error(
      "[RLS SECURITY] userId bukan UUID valid: " + context.userId,
    );
  }
  if (context.tenantId && !UUID_REGEX.test(context.tenantId)) {
    throw new Error(
      "[RLS SECURITY] tenantId bukan UUID valid: " + context.tenantId,
    );
  }

  return prismaBase.$transaction(async (tx) => {
    if (context.userId) {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${context.userId}, true)`;
    }
    if (context.tenantId) {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${context.tenantId}, true)`;
    }
    return txStorage.run(tx, fn);
  });
}

/**
 * Disconnect semua Prisma client — dipanggil saat graceful shutdown.
 */
export async function disconnectAll(): Promise<void> {
  await Promise.all([
    prismaBase.$disconnect(),
    prismaAuthBase.$disconnect(),
  ]);
}