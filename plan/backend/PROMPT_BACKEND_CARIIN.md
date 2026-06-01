# PROMPT BACKEND — CARIIN SUPER-APP
> Gunakan bersama PROMPT_MASTER_CARIIN.md · Blueprint: Phase-3 v4.1-SECURED

---

## KONTEKS SESI INI

Kamu sedang membangun **backend API Cariin** menggunakan Hono + Prisma + PostgreSQL.
Semua kode yang kamu tulis harus siap production — tidak ada "TODO security later".
Referensi utama: `Phase_3_v4.1_SECURED_Backend.md`

---

## ARSITEKTUR BACKEND — RINGKASAN CEPAT

```
apps/backend/src/
├── bootstrap/
│   ├── app.ts              ← CORS pertama, lalu security headers, lalu routes
│   └── env-validation.ts   ← Zod schema, process.exit(1) jika invalid
├── db/
│   └── client.ts           ← prismaApp (RLS) + prismaAuth (BYPASSRLS) + withRlsContext()
├── middleware/
│   ├── auth.ts             ← verify RS256, inject withRlsContext
│   ├── rate-limiter.ts     ← Redis Lua atomic, fallback chain IP
│   ├── webhook-auth.ts     ← HMAC + timestamp + hex guard + PII sanitize
│   └── sentry.ts           ← init + globalErrorHandler + beforeSend PII strip
└── modules/
    ├── auth/
    │   ├── otp.service.ts      ← bcrypt hash, atomic attempt limit
    │   └── token.service.ts    ← generateTokenPair, rotate, revokeAll
    ├── orders/
    ├── wallet/
    ├── inventory/
    ├── payroll/
    └── webhooks/
```

---

## DATABASE — DUAL POOL RULES

### Kapan pakai `prismaApp` vs `prismaAuth`

| Operasi | Pool yang digunakan | Alasan |
|:--------|:--------------------|:-------|
| Baca/tulis `Wallet`, `Order`, `Tenant`, `PayrollBatch` | `prismaApp` | Kena RLS, role app |
| Baca/tulis `OtpCode`, `RefreshToken` | `prismaAuth` | BYPASSRLS, RLS policy deny app role |
| Baca `GlobalUser` untuk auth flow | `prismaAuth` | Butuh akses tanpa RLS |
| Baca `GlobalUser` untuk operasi bisnis | `prismaApp` | Kena RLS user_self_isolation |

```typescript
// Contoh penggunaan yang BENAR
import { prismaApp, prismaAuth, withRlsContext } from '../db/client';

// Bisnis — pakai prismaApp + withRlsContext
export async function getWalletBalance(userId: string) {
  return withRlsContext({ userId }, () =>
    prismaApp.wallet.findUniqueOrThrow({ where: { userId } })
  );
}

// Auth — pakai prismaAuth langsung
export async function findOtpForVerify(userId: string, purpose: string) {
  return prismaAuth.otpCode.findFirst({
    where: { userId, purpose, isUsed: false, expiresAt: { gt: new Date() } },
  });
}
```

### RLS Context — Model Classification

```typescript
// CONTEXT_FREE — query langsung tanpa withRlsContext
const models_free = ['Tenant', 'TenantRoleRoute', 'DomainMapping', 'AuditLog', 'WebhookLog'];

// USER_SCOPED — wajib { userId } di context
const models_user = ['GlobalUser', 'Wallet', 'WalletTransaction', 'GlobalUserRole'];

// TENANT_SCOPED — wajib { tenantId } di context
const models_tenant = ['PayrollBatch', 'PayrollItem'];

// AUTH — hanya via prismaAuth (BYPASSRLS)
const models_auth = ['OtpCode', 'RefreshToken'];
```

---

## POLA LENGKAP PER MODUL

### Auth Module — OTP Flow

```typescript
// modules/auth/otp.service.ts
import { hash, compare } from 'bcrypt';

const BCRYPT_ROUNDS = 10;

export const otpService = {
  async generate(userId: string, purpose: OtpPurpose) {
    const plain  = String(Math.floor(100000 + Math.random() * 900000));
    const hashed = await hash(plain, BCRYPT_ROUNDS);

    // Upsert — satu OTP aktif per userId+purpose
    await prismaAuth.otpCode.upsert({
      where:  { userId_purpose_isUsed: { userId, purpose, isUsed: false } },
      update: { codeHash: hashed, attemptCount: 0, expiresAt: new Date(Date.now() + 5 * 60_000) },
      create: { userId, purpose, codeHash: hashed, expiresAt: new Date(Date.now() + 5 * 60_000) },
    });

    await sendOtpViaSms(userId, plain); // plain TIDAK disimpan
  },

  async verify(userId: string, purpose: OtpPurpose, plain: string): Promise<boolean> {
    const otp = await prismaAuth.otpCode.findFirst({
      where: { userId, purpose, isUsed: false, expiresAt: { gt: new Date() } },
    });
    if (!otp) return false;

    // Atomic increment — cegah race condition concurrent verify
    const affected = await prismaAuth.$executeRaw`
      UPDATE auth.otp_codes SET attempt_count = attempt_count + 1
      WHERE id = ${otp.id}::uuid AND attempt_count < 5
        AND is_used = false AND expires_at > NOW()
    `;
    if (affected === 0) throw new Error('OTP_MAX_ATTEMPTS_EXCEEDED');

    const ok = await compare(plain, otp.codeHash);
    if (ok) await prismaAuth.otpCode.update({ where: { id: otp.id }, data: { isUsed: true } });
    return ok;
  },
};
```

### Auth Module — Token Rotation

```typescript
// modules/auth/token.service.ts — RINGKASAN (implementasi lengkap di Phase 3 blueprint)
export const tokenService = {
  generateTokenPair: async (userId, tenantId, role) => { /* generate + simpan ke DB */ },
  rotate:            async (incomingRefreshToken) => {
    // Jika token sudah di-revoke tapi masih dipakai → REUSE DETECTED → revoke seluruh family
    if (stored.isRevoked) {
      await prismaAuth.refreshToken.updateMany({ where: { family: stored.family }, data: { isRevoked: true } });
      throw new Error('REFRESH_TOKEN_REUSE_DETECTED');
    }
    // ... generate pair baru, revoke yang lama, return yang baru
  },
  revokeAll:         async (userId) => { /* revoke semua token aktif saat logout */ },
  deleteExpiredTokens: async () => { /* cleanup job — jalankan via BullMQ cron */ },
};
```

### Inventory — Atomic Decrement (INLINE di outer transaction)

```typescript
// WAJIB: Decrement stok harus inline dalam outer $transaction
// JANGAN buat fungsi decrementStock() yang membuat $transaction sendiri
// (nested TX dengan Serializable bisa conflict isolation level)

await prismaApp.$transaction(async (tx) => {
  // Pessimistic lock
  const row = await tx.$queryRaw<[{ stock: number }]>`
    SELECT stock FROM products WHERE id = ${productId}::uuid FOR UPDATE
  `;
  if (!row[0] || row[0].stock < qty) throw new Error('STOCK_INSUFFICIENT');

  // Atomic update dengan double-check
  const affected = await tx.$executeRaw`
    UPDATE products SET stock = stock - ${qty}
    WHERE id = ${productId}::uuid AND stock >= ${qty}
  `;
  if (affected === 0) throw new Error('STOCK_DEPLETED_CONCURRENT');

  // Buat order dalam TX yang sama
  await tx.order.create({ data: { ...orderData } });
});
```

### Webhook Handler — Template Lengkap

```typescript
// modules/webhooks/shopee.handler.ts
import { verifyMarketplaceWebhook, sanitizeWebhookPayload } from '../../middleware/webhook-auth';

webhooksRouter.post(
  '/shopee',
  verifyMarketplaceWebhook('SHOPEE'), // middleware: timestamp + HMAC + hex guard
  async (c) => {
    const verified  = c.get('verifiedBody');    // full payload untuk business logic
    const sanitized = c.get('sanitizedPayload'); // tanpa PII untuk logging

    // Log dulu (sanitized — tanpa PII)
    await prismaApp.webhookLog.create({
      data: {
        provider: 'SHOPEE',
        eventType: verified.event_type as string,
        sanitizedPayload: sanitized,
        isVerified: true,
      },
    });

    // Process event
    switch (verified.event_type) {
      case 'ORDER_STATUS_UPDATE': await handleShopeeOrderUpdate(verified); break;
      case 'STOCK_UPDATE':        await handleShopeeStockUpdate(verified);  break;
    }

    return c.json({ success: true });
  }
);
```

### Payroll — 4-Eyes Approval Template

```typescript
// modules/payroll/payroll.service.ts
export const payrollService = {
  async approveByFinance(batchId: string, financeAdminId: string) {
    return withRlsContext({ tenantId: /* from batch */ }, async () => {
      return prismaApp.$transaction(async (tx) => {
        const batch = await tx.payrollBatch.findUniqueOrThrow({
          where: { id: batchId, status: 'PENDING_APPROVAL' },
        });

        // Snapshot nama approver saat ini (trigger DB akan handle juga)
        const approver = await tx.globalUser.findUniqueOrThrow({
          where: { id: financeAdminId },
          select: { fullName: true },
        });

        return tx.payrollBatch.update({
          where: { id: batchId },
          data: {
            status:              'APPROVED',
            approvedByFinance:   financeAdminId,
            approverNameSnapshot: approver.fullName, // snapshot manual + trigger DB
            approvedAt:          new Date(),
          },
        });
      });
    });
  },
};
```

---

## SQL MIGRATION — CHECKLIST SETIAP MIGRATION BARU

Setiap file migration baru WAJIB berisi:

```sql
-- 1. Enable RLS jika tabel baru kena data multi-tenant/multi-user
ALTER TABLE nama_tabel ENABLE ROW LEVEL SECURITY;

-- 2. Buat RLS policy yang sesuai
CREATE POLICY isolasi_xxx ON nama_tabel
  USING (user_id = current_setting('app.current_user_id')::uuid);

-- 3. Grant permission ke role yang tepat
GRANT SELECT, INSERT, UPDATE ON nama_tabel TO cariin_app_role;

-- 4. DEFAULT PRIVILEGES untuk tabel ini dan tabel sejenis di masa depan
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO cariin_app_role;

-- 5. Check constraint jika ada nilai yang tidak boleh negatif/invalid
ALTER TABLE nama_tabel ADD CONSTRAINT chk_xxx CHECK (kolom >= 0);

-- 6. Index untuk kolom yang sering difilter
CREATE INDEX idx_xxx_kolom ON nama_tabel (kolom);
```

---

## ERROR CODES STANDAR

Gunakan error code ini secara konsisten — globalErrorHandler sudah tahu cara handle-nya:

```typescript
// Auth
'UNAUTHORIZED'             // Tidak ada session
'TOKEN_EXPIRED'            // Session kadaluarsa → client harus refresh
'TOKEN_INVALID'            // Session rusak
'SESSION_COMPROMISED'      // Token reuse detected → minta login ulang
'SESSION_EXPIRED'          // Refresh token expired

// OTP
'OTP_MAX_ATTEMPTS_EXCEEDED' // 5x salah → minta OTP baru
'OTP_INVALID'               // Kode salah tapi masih dalam limit

// Order/Inventory
'STOCK_INSUFFICIENT'        // Stok kurang dari quantity diminta
'STOCK_DEPLETED_CONCURRENT' // Race condition: stok habis saat proses
'SERVICE_INACTIVE'          // Layanan dinonaktifkan mitra
'DUPLICATE_ORDER'           // Idempotency key sudah ada (return order lama)

// Webhook
'WEBHOOK_TIMESTAMP_EXPIRED'  // Timestamp > 5 menit
'INVALID_WEBHOOK_SIGNATURE'  // HMAC tidak cocok / format invalid
'MISSING_TIMESTAMP_FIELD'    // Payload tidak punya field timestamp

// General
'RATE_LIMIT_EXCEEDED'       // Terlalu banyak request
'PAYLOAD_TOO_LARGE'         // Request body > 1 MB
'NOT_FOUND'                 // Data tidak ditemukan (dari P2025 Prisma)
'DUPLICATE_ENTRY'           // Unique constraint violation (dari P2002 Prisma)
'INTERNAL_SERVER_ERROR'     // Generic error — detail disembunyikan di production
```

---

## ENVIRONMENT VARIABLES WAJIB (BACKEND)

```bash
# .env — semua ini wajib ada, divalidasi di startup
DATABASE_URL="postgresql://cariin_app_role:PASS@localhost:6432/cariin_db"
DATABASE_URL_AUTH="postgresql://cariin_auth_role:PASS@localhost:6432/cariin_db"
REDIS_URL="redis://:REDIS_PASS@localhost:6379"

JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."   # RS256 private key
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n..."     # RS256 public key
JWT_REFRESH_SECRET="minimum-32-chars-random-string"

WEBHOOK_SECRET_SHOPEE="minimum-32-chars"
WEBHOOK_SECRET_TOKOPEDIA="minimum-32-chars"
WEBHOOK_SECRET_TIKTOK="minimum-32-chars"

CORS_ALLOWED_ORIGINS="https://cariin.id,https://app.cariin.id"
DEFAULT_REDIRECT_URL="https://cariin.id/login"

SENTRY_DSN="https://xxx@sentry.io/xxx"  # Optional di dev
NODE_ENV="development"
PORT="4000"
```

---

## QUICK REFERENCE — RATE LIMIT CONFIG

```typescript
// packages/rate-limit/src/limits.ts — nilai yang sudah disepakati
'auth:login':          { windowMs: 15 * 60_000, max: 10  }  // 10x per 15 menit
'auth:register':       { windowMs: 60 * 60_000, max: 5   }  // 5x per jam
'auth:otp-request':    { windowMs: 60_000,       max: 3   }  // 3x per menit
'auth:otp-verify':     { windowMs: 15 * 60_000, max: 5   }  // 5x per 15 menit
'orders:create':       { windowMs: 60_000,       max: 10  }  // 10x per menit
'wallet:topup':        { windowMs: 60 * 60_000, max: 20  }  // 20x per jam
'feature-flags:fetch': { windowMs: 60_000,       max: 60  }  // 60x per menit
```

---

## POLA YANG SERING SALAH — CONTOH KONKRET

### ❌ Salah: Forget withRlsContext

```typescript
// Bug: wallet langsung diquery tanpa context
export async function getBalance(userId: string) {
  return prismaApp.wallet.findFirst({ where: { userId } }); // ← RLS VIOLATION!
}

// Benar
export async function getBalance(userId: string) {
  return withRlsContext({ userId }, () =>
    prismaApp.wallet.findFirst({ where: { userId } })
  );
}
```

### ❌ Salah: Side effect dalam $transaction

```typescript
// Bug: notifikasi di dalam TX → timeout eksternal service = rollback DB
await prismaApp.$transaction(async (tx) => {
  await tx.cashShift.update({ where: { id }, data: { status: 'CLOSED' } });
  await sendWhatsApp(phone, message); // ← jika timeout, shift tidak jadi CLOSED!
});

// Benar: close dulu, notify setelah TX commit
const shift = await prismaApp.$transaction(async (tx) => {
  return tx.cashShift.update({ ... });
});
try {
  await sendWhatsApp(phone, buildMessage(shift)); // di luar TX
} catch {
  await notificationQueue.add('retry-whatsapp', { shiftId: shift.id });
}
```

### ❌ Salah: BigInt operation tanpa type awareness

```typescript
// Bug: JS tidak bisa operasi Number * BigInt langsung
const total = product.price * quantity; // TypeError! price=BigInt, quantity=number

// Benar
const total = product.price * BigInt(quantity);
```

### ❌ Salah: Prisma findFirst untuk data yang seharusnya ada

```typescript
// Bug: findFirst return null → null.property crash
const user = await prismaApp.globalUser.findFirst({ where: { id: userId } });
return user.email; // TypeError jika user tidak ada

// Benar: gunakan findUniqueOrThrow atau findFirstOrThrow
const user = await prismaApp.globalUser.findUniqueOrThrow({ where: { id: userId } });
return user.email; // Prisma throw P2025 jika tidak ada → globalErrorHandler tangkap
```
