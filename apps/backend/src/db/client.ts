import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '../bootstrap/env-validation';

const prismaBase = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

const prismaAuthBase = new PrismaClient({
  datasourceUrl: env.DATABASE_URL_AUTH,
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

const txStorage = new AsyncLocalStorage<any>();

// Proxy agar prismaApp otomatis menggunakan transaction context dari withRlsContext
export const prismaApp = new Proxy(prismaBase, {
  get(target, prop) {
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

export async function withRlsContext<T>(context: RlsContext, fn: () => Promise<T>): Promise<T> {
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