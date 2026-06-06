# PROMPT PERBAIKAN — CARIIN BACKEND

Paste prompt ini ke AI atau berikan ke junior developer.
Kerjakan semua poin secara BERURUTAN. Jangan skip.

---

## KONTEKS

Kamu sedang mengerjakan backend Node.js dengan stack berikut:

- **Framework:** Hono (bukan Express)
- **ORM:** Prisma 6 + PostgreSQL
- **Auth:** JWT RS256 + HttpOnly Cookie
- **Runtime:** Node.js 22 ESM (`"type": "module"`)
- **Lokasi project:** `apps/backend/`

Terdapat **19 masalah** yang harus diperbaiki. Kerjakan dari atas ke bawah.
Setelah selesai semua, jalankan test: `bun test`.

---

## TUGAS 1 — Tambah Redis + BullMQ ke project

**File:** `apps/backend/package.json`

Install dependency baru:

```bash
cd apps/backend
npm install ioredis bullmq
npm install --save-dev @types/ioredis
```

Buat file baru `apps/backend/src/cache/redis.ts`:

```typescript
import { Redis } from "ioredis";
import { env } from "../bootstrap/env-validation.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 3000),
  enableOfflineQueue: false,
  lazyConnect: false,
});

redis.on("error", (err) => {
  console.error("[Redis Error]", err.message);
  // Jangan throw — app tetap jalan tanpa cache
});
```

---

## TUGAS 2 — Ganti Rate Limiter in-memory ke Redis Lua Atomic

**File:** `apps/backend/src/middleware/rate-limiter.ts`

Ganti SELURUH isi file dengan ini:

```typescript
import type { Context, Next } from "hono";
import { redis } from "../cache/redis.js";

const RATE_LIMITS: Record<string, { windowMs: number; max: number }> = {
  "auth:login": { windowMs: 15 * 60_000, max: 10 },
  "auth:register": { windowMs: 60 * 60_000, max: 5 },
  "auth:otp-request": { windowMs: 60_000, max: 3 },
  "auth:otp-verify": { windowMs: 15 * 60_000, max: 5 },
  "auth:refresh": { windowMs: 60_000, max: 30 },
  "orders:create": { windowMs: 60_000, max: 10 },
  "wallet:topup": { windowMs: 60 * 60_000, max: 20 },
  "wallet:balance": { windowMs: 60_000, max: 60 },
  "feature-flags:fetch": { windowMs: 60_000, max: 60 },
};

// Lua script: atomic increment + set expiry hanya pada counter baru
const LUA_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;

function getClientIp(c: Context): string {
  return (
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    c.req.header("X-Real-IP") ||
    "unknown"
  );
}

export function rateLimiter(
  limitKey: string,
  identifierType: "ip" | "userId" = "ip",
): (c: Context, next: Next) => Promise<Response | void> {
  const config = RATE_LIMITS[limitKey];
  if (!config) throw new Error(`Rate limit config not found: ${limitKey}`);

  return async (c: Context, next: Next): Promise<Response | void> => {
    const identifier =
      identifierType === "userId"
        ? ((c.get("userId") as string | undefined) ?? getClientIp(c))
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
      console.warn("[RateLimit] Redis unavailable, skipping rate limit");
      return next();
    }

    c.header("X-RateLimit-Limit", String(config.max));
    c.header(
      "X-RateLimit-Remaining",
      String(Math.max(0, config.max - current)),
    );

    if (current > config.max) {
      c.header("Retry-After", String(windowSec));
      return c.json(
        {
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Terlalu banyak permintaan. Silakan coba lagi nanti.",
            retryAfterSeconds: windowSec,
          },
        },
        429,
      );
    }

    return next();
  };
}
```

---

## TUGAS 3 — Pasang rateLimiter di semua auth endpoints

**File:** `apps/backend/src/modules/auth/auth.router.ts`

Tambahkan `rateLimiter` middleware ke setiap endpoint. Cari baris import paling atas, tambahkan:

```typescript
import { rateLimiter } from "../../middleware/rate-limiter.js";
```

Lalu tambahkan middleware ke tiap route:

```typescript
// POST /register
authRouter.post(
  '/register',
  rateLimiter('auth:register', 'ip'),   // ← TAMBAHKAN BARIS INI
  zValidator('json', RegisterSchema),
  async (c) => { ... }
);

// POST /login
authRouter.post(
  '/login',
  rateLimiter('auth:login', 'ip'),      // ← TAMBAHKAN BARIS INI
  zValidator('json', LoginSchema),
  async (c) => { ... }
);

// POST /google
authRouter.post(
  '/google',
  rateLimiter('auth:login', 'ip'),      // ← TAMBAHKAN BARIS INI
  zValidator('json', GoogleLoginSchema),
  async (c) => { ... }
);

// POST /refresh — sudah ada, tambahkan:
authRouter.post(
  '/refresh',
  rateLimiter('auth:refresh', 'ip'),    // ← TAMBAHKAN BARIS INI
  async (c) => { ... }
);
```

---

## TUGAS 4 — Google OAuth: buat wallet untuk user baru

**File:** `apps/backend/src/modules/auth/auth.service.ts`

Cari bagian `loginWithGoogle()` → bagian auto-register user baru (sekitar baris 90-105).

Ganti blok `user = await prismaAuth.globalUser.create(...)` dengan ini:

```typescript
// Auto-Register: buat user + wallet dalam 1 transaksi
user = await prismaAuth.$transaction(async (tx) => {
  const newUser = await tx.globalUser.create({
    data: {
      email,
      phone: null, // nullable setelah migration TUGAS 9
      fullName: name || "User Cariin",
      role: "CUSTOMER",
      isEmailVerified: true,
      isOauth: true,
      oauthProvider: "GOOGLE",
      oauthProviderId: googleId,
    },
  });

  // Buat wallet otomatis dengan saldo 0
  await tx.wallet.create({
    data: { userId: newUser.id, balance: BigInt(0) },
  });

  return newUser;
});
```

---

## TUGAS 5 — Perbaiki confirmTopup: jangan pakai prismaAuth untuk data bisnis

**File:** `apps/backend/src/modules/wallet/wallet.service.ts`

Pada fungsi `confirmTopup`, baris pertama menggunakan `prismaAuth.walletTransaction.findUniqueOrThrow`.
Ganti agar menggunakan `prismaApp` di dalam `withRlsContext`.

Ganti seluruh fungsi `confirmTopup` dengan ini:

```typescript
async confirmTopup(body: z.infer<typeof ConfirmTopupSchema>) {
  // 1. Cari transaksi via prismaApp + RLS bypass sementara untuk webhook internal
  //    (webhook sudah terverifikasi HMAC di middleware sebelum sampai sini)
  const transaction = await prismaApp.$queryRaw<
    Array<{ id: string; wallet_id: string; user_id: string; amount: bigint; status: string }>
  >`SELECT id, wallet_id, user_id, amount, status FROM wallet_transactions
    WHERE id = ${body.transactionId}::uuid LIMIT 1`;

  if (!transaction[0]) throw new Error('WALLET_NOT_FOUND');
  const tx = transaction[0];

  if (BigInt(body.amountPaid) !== tx.amount) {
    throw new Error('PAYMENT_AMOUNT_MISMATCH');
  }

  const result = await withRlsContext({ userId: tx.user_id }, async () => {
    // 2. Update status → COMPLETED (atomic, hanya jika masih PENDING)
    const affected = await prismaApp.$executeRaw`
      UPDATE wallet_transactions
      SET status = 'COMPLETED'
      WHERE id = ${tx.id}::uuid AND status = 'PENDING'
    `;

    if (affected === 0) {
      // Sudah diproses sebelumnya (idempotent)
      return prismaApp.walletTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    }

    // 3. Tambah saldo — satu atomic statement (lebih aman dari SELECT + UPDATE terpisah)
    const maxBalance = BigInt(env.WALLET_MAX_BALANCE ?? '50000000');
    const updated = await prismaApp.$executeRaw`
      UPDATE wallets
      SET balance    = balance + ${tx.amount},
          updated_at = NOW()
      WHERE id = ${tx.wallet_id}::uuid
        AND balance + ${tx.amount} <= ${maxBalance}
    `;

    if (updated === 0) throw new Error('WALLET_MAX_BALANCE_EXCEEDED');

    // 4. Catat balance_before dan balance_after
    const wallet = await prismaApp.$queryRaw<Array<{ balance: bigint }>>`
      SELECT balance FROM wallets WHERE id = ${tx.wallet_id}::uuid
    `;
    const balanceAfter  = wallet[0]?.balance ?? BigInt(0);
    const balanceBefore = balanceAfter - tx.amount;

    await prismaApp.$executeRaw`
      UPDATE wallet_transactions
      SET balance_before = ${balanceBefore}, balance_after = ${balanceAfter}
      WHERE id = ${tx.id}::uuid
    `;

    return prismaApp.walletTransaction.findUniqueOrThrow({ where: { id: tx.id } });
  });

  return serializeBigInt(result);
},
```

---

## TUGAS 6 — Perbaiki dynamic import di wallet.controller.ts

**File:** `apps/backend/src/modules/wallet/wallet.controller.ts`

Cari baris di dalam fungsi `getBalance`:

```typescript
const { prismaApp, withRlsContext } = await import("../../db/client.js");
```

Hapus baris itu. Tambahkan import biasa di **paling atas file** (bersama import lain):

```typescript
import { prismaApp, withRlsContext } from "../../db/client.js";
```

---

## TUGAS 7 — Tambah UUID validation di withRlsContext

**File:** `apps/backend/src/db/client.ts`

Cari fungsi `withRlsContext`. Tambahkan validasi UUID **sebelum** `set_config`:

```typescript
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withRlsContext<T>(
  context: RlsContext,
  fn: () => Promise<T>,
): Promise<T> {
  // Validasi UUID sebelum inject ke PostgreSQL session
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
```

---

## TUGAS 8 — Perbaiki tracesSampleRate Sentry di production

**File:** `apps/backend/src/middleware/sentry.ts`

Cari baris:

```typescript
tracesSampleRate: 1.0,
```

Ganti dengan:

```typescript
tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
```

Juga hapus komentar `@ts-expect-error` dan cek apakah Sentry sudah punya types dengan benar:

```typescript
// Hapus ini:
// @ts-expect-error - missing types
import * as Sentry from "@sentry/node";

// Ganti dengan:
import * as Sentry from "@sentry/node";
```

Jika TypeScript error, jalankan: `npm install --save-dev @sentry/types`

---

## TUGAS 9 — AuditLog selalu ditulis, tidak bersyarat

**File:** `apps/backend/src/modules/auth/auth.service.ts`

Cari dua blok berikut (ada di `loginTraditional` dan `loginWithGoogle`):

```typescript
if (userAgent && ipAddress) {
  await prismaAuth.auditLog.create({ ... });
}
```

Ganti KEDUANYA dengan versi tanpa kondisi:

```typescript
// Untuk loginTraditional:
await prismaAuth.auditLog.create({
  data: {
    userId: user.id,
    action: "USER_LOGIN_TRADITIONAL_SUCCESS",
    ipAddress: ipAddress ?? "unknown",
    userAgent: userAgent ?? "unknown",
    payload: { identifier },
  },
});

// Untuk loginWithGoogle:
await prismaAuth.auditLog.create({
  data: {
    userId: user.id,
    action: "USER_LOGIN_GOOGLE_SUCCESS",
    ipAddress: ipAddress ?? "unknown",
    userAgent: userAgent ?? "unknown",
    payload: { provider: "GOOGLE" },
  },
});
```

---

## TUGAS 10 — Jadikan phone nullable di schema (Google OAuth)

**File:** `apps/backend/prisma/schema.prisma`

Cari field `phone` di model `GlobalUser`:

```prisma
phone String @unique @map("phone")
```

Ganti menjadi nullable:

```prisma
phone String? @map("phone")
```

Lalu buat migration baru:

```bash
cd apps/backend
npx prisma migrate dev --name make_phone_nullable
```

Setelah migration, tambahkan partial unique index via SQL (buat file `prisma/migrations/02_phone_partial_unique.sql`):

```sql
-- Hapus unique index lama jika masih ada
DROP INDEX IF EXISTS global_users_phone_key;

-- Buat partial unique index: unik hanya jika phone IS NOT NULL
CREATE UNIQUE INDEX idx_global_users_phone_unique
  ON global_users (phone)
  WHERE phone IS NOT NULL;
```

Jalankan: `psql $DATABASE_URL -f prisma/migrations/02_phone_partial_unique.sql`

---

## TUGAS 11 — Hapus accessToken dari response body

**File:** `apps/backend/src/modules/auth/auth.router.ts`

Cari DUA tempat yang return `accessToken` di body (di endpoint `/login` dan `/google`):

```typescript
return c.json({
  success: true,
  data: {
    user: result.user,
    accessToken: result.tokens.accessToken, // ← HAPUS baris ini
  },
});
```

Setelah dihapus, response hanya berisi:

```typescript
return c.json({
  success: true,
  data: { user: result.user },
});
```

Token sudah tersedia via HttpOnly cookie — frontend tidak perlu baca dari body.

---

## TUGAS 12 — Hapus role-router.ts (dead code)

**File:** `apps/backend/src/modules/auth/role-router.ts`

File ini tidak pernah diimport di manapun. Hapus saja:

```bash
rm apps/backend/src/modules/auth/role-router.ts
```

Pastikan tidak ada import ke file ini di manapun:

```bash
grep -r "role-router" apps/backend/src/
```

Jika ditemukan → hapus import tersebut.

---

## TUGAS 13 — Tambah GET /health/ready

**File:** `apps/backend/src/bootstrap/app.ts`

Cari blok health check yang ada:

```typescript
app.get('/health', (c) => c.json({ status: 'ok', ... }));
```

Tambahkan endpoint readiness SETELAH health check:

```typescript
// Readiness check — cek DB + Redis
app.get("/health/ready", async (c) => {
  const checks: Record<string, "ok" | "error"> = {};
  let allOk = true;

  // Cek PostgreSQL
  try {
    await prismaApp.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
    allOk = false;
  }

  // Cek Redis (tidak fatal jika down)
  try {
    const { redis } = await import("../cache/redis.js");
    await redis.ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "error";
    // Redis tidak blokir traffic
  }

  return c.json(
    {
      status: allOk ? "ready" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    },
    allOk ? 200 : 503,
  );
});
```

Tambahkan juga import di atas file `app.ts`:

```typescript
import { prismaApp } from "../db/client.js";
```

---

## TUGAS 14 — Buat token cleanup job (BullMQ)

Buat file baru `apps/backend/src/jobs/token-cleanup.job.ts`:

```typescript
import { Queue, Worker } from "bullmq";
import { redis } from "../cache/redis.js";
import { tokenService } from "../modules/auth/token.service.js";

// Queue untuk token cleanup
export const tokenCleanupQueue = new Queue("token-cleanup", {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
  },
});

// Worker yang proses cleanup
new Worker(
  "token-cleanup",
  async (job) => {
    const result = await tokenService.deleteExpiredTokens();
    console.log(`[TokenCleanup] Deleted ${result.deletedCount} expired tokens`);
    return result;
  },
  { connection: redis },
);

// Jadwalkan cleanup setiap hari jam 03:00
export async function scheduleTokenCleanup() {
  // Hapus jadwal lama jika ada
  await tokenCleanupQueue.removeRepeatable("daily-cleanup", {
    pattern: "0 3 * * *",
  });

  await tokenCleanupQueue.add(
    "daily-cleanup",
    {},
    { repeat: { pattern: "0 3 * * *" } },
  );

  console.log("[TokenCleanup] Scheduled: daily at 03:00");
}
```

Lalu panggil di `apps/backend/src/server.ts` setelah server start:

```typescript
import { scheduleTokenCleanup } from "./jobs/token-cleanup.job.js";

// Di dalam callback serve():
const server = serve({ fetch: app.fetch, port }, async (info) => {
  console.log(`🚀 Server running at http://localhost:${info.port}`);

  // Start background jobs
  await scheduleTokenCleanup();
  console.log("⚙️  Background jobs started");
});
```

---

## TUGAS 15 — Rename internalAuthMiddleware agar tidak misleading

**File:** `apps/backend/src/middleware/internal-auth.ts`

Tambahkan export dengan nama yang lebih jelas di akhir file:

```typescript
// Alias yang lebih deskriptif
export const verifyWebhookSignature = verifyWebhook;

// Pertahankan alias lama untuk backward compatibility sementara
// TODO: Hapus setelah semua router dipindahkan ke verifyWebhookSignature
export const internalAuthMiddleware = verifyWebhook;
```

Lalu di `apps/backend/src/modules/wallet/wallet.router.ts`, ganti:

```typescript
// Dari:
import { internalAuthMiddleware } from "../../middleware/internal-auth.js";

// Menjadi:
import { verifyWebhookSignature } from "../../middleware/internal-auth.js";
```

Dan di route:

```typescript
// Dari:
walletRouter.post('/topup/confirm', internalAuthMiddleware('INTERNAL'), ...);

// Menjadi:
walletRouter.post('/topup/confirm', verifyWebhookSignature('INTERNAL'), ...);
```

---

## TUGAS 16 — Pilih satu runtime (hapus inkonsistensi bun/node)

**File:** `apps/backend/package.json`

Saat ini dev pakai bun, production pakai node. Pilih Node.js untuk konsistensi:

```json
"scripts": {
  "dev":          "node --watch --import tsx/esm src/server.ts",
  "build":        "tsc",
  "start":        "node dist/server.js",
  "db:generate":  "prisma generate",
  "db:migrate":   "prisma migrate dev",
  "db:push":      "prisma db push",
  "typecheck":    "tsc --noEmit",
  "test":         "node --experimental-vm-modules node_modules/.bin/jest"
},
```

Jika ingin tetap pakai bun untuk dev saja (lebih cepat), pastikan production juga pakai bun:

```json
"start": "bun src/server.ts"
```

Pilih salah satu, jangan campur.

---

## VERIFIKASI AKHIR

Setelah semua tugas selesai, jalankan checklist ini:

```bash
# 1. TypeScript — tidak boleh ada error
cd apps/backend && npx tsc --noEmit

# 2. Pastikan ioredis dan bullmq terinstall
ls node_modules/ioredis && ls node_modules/bullmq

# 3. Pastikan rate-limiter tidak lagi pakai Map
grep -n "new Map" src/middleware/rate-limiter.ts
# Harus: no output

# 4. Pastikan semua auth route punya rateLimiter
grep -A3 "authRouter.post" src/modules/auth/auth.router.ts | grep "rateLimiter"
# Harus: muncul untuk setiap route

# 5. Pastikan tidak ada dynamic import di controller
grep "await import" src/modules/wallet/wallet.controller.ts
# Harus: no output

# 6. Pastikan accessToken tidak di response body
grep "accessToken" src/modules/auth/auth.router.ts
# Harus: no output (atau hanya di injectSecureCookies)

# 7. Pastikan role-router.ts sudah dihapus
ls src/modules/auth/role-router.ts 2>/dev/null && echo "MASIH ADA!" || echo "OK — sudah dihapus"

# 8. Jalankan tests
bun test
# Semua harus PASS
```

---

## URUTAN PRIORITAS JIKA WAKTU TERBATAS

Kerjakan minimal ini sebelum deploy ke production:

| #   | Tugas                              | Waktu estimasi |
| --- | ---------------------------------- | -------------- |
| 1   | Tugas 1 + 2 (Redis)                | 30 menit       |
| 2   | Tugas 3 (Rate limiter di auth)     | 10 menit       |
| 3   | Tugas 4 (Google OAuth buat wallet) | 15 menit       |
| 4   | Tugas 5 (confirmTopup perbaikan)   | 20 menit       |
| 5   | Tugas 6 (dynamic import)           | 5 menit        |
| 6   | Tugas 7 (UUID validation)          | 10 menit       |
| 7   | Tugas 13 (health/ready)            | 15 menit       |

Sisanya (Tugas 8-16) bisa dikerjakan sprint berikutnya.

---

_Generated dari code review cariin/apps/backend — 19 issues, 5 Critical, 5 High, 6 Medium, 3 Low_
