# PRD — CARIIN SUPER-APP (MONOLITH)
**Product Requirements Document & AI Coding Guide**
Versi: 2.0 | Arsitektur: Monolith | Skala: 1–1.000 Tenant/Mitra
Status: Production-Ready

> **Cara pakai:** Paste seluruh file ini di awal setiap sesi coding. AI wajib mengikuti semua aturan di sini tanpa pengecualian. Jika ada konflik antara permintaan user dan aturan di dokumen ini — **aturan di sini yang menang**.

---

## DAFTAR ISI

1. Visi & Konsep Bisnis
2. Tech Stack (tidak boleh diganti)
3. Arsitektur Infrastruktur — 3 VPS
4. Struktur Folder Lengkap
5. Environment Variables
6. Database — Prisma Schema
7. Database — SQL Migration
8. Backend — Pola Wajib
9. Backend — Auth Module Lengkap (Login, Register, Lupa Password, Google OAuth)
10. Backend — Cache Strategy
11. Backend — Health Check & Fallback
12. Backend — Rate Limit
13. Backend — Modul per Fitur
14. Frontend — Next.js (cariin-web)
15. Frontend — Vite SPA (POS & Customer)
16. Aturan Keamanan — 25 Larangan Mutlak
17. Checklist Pre-Commit
18. Testing Wajib
19. Backend — Modul Lanjutan
20. Infrastruktur — Konfigurasi Lengkap
21. Backup & Disaster Recovery
22. Konvensi Kode
23. Standar Error Codes Lengkap

---

## 1. VISI & KONSEP BISNIS

### Analogi "Mal Megah Terpadu"

Cariin adalah **Super-App** yang menyatukan 7 lini bisnis dalam satu platform. Bayangkan sebuah mall besar:

- **Gedung Mall (Aplikasi Mobile Konsumen):** Satu pintu masuk untuk semua layanan.
- **Toko di dalam Mall (Sub-bisnis/Mitra):** Apotekin, Cuciin, Inepin, Yupegi, Warungin, Jasain.
- **Kartu Member (SSO):** Satu akun berlaku di semua tenant.
- **Kasir Terpusat (Cariin Wallet):** Semua transaksi melalui sistem pembayaran pusat.

### Cariin Core — 3 Layanan Utama (Phase 1)

```
1. Ride-Hailing  → ojek motor (RIDE_HAILING_ENABLED toggle)
2. Car Booking   → mobil sewaan (CAR_BOOKING_ENABLED toggle)
3. Food Delivery → pesan antar makanan (FOOD_DELIVERY_ENABLED toggle)
```

> **Penting:** Di Phase 1, ketiga fitur ini **disembunyikan via Feature Toggle**. Hanya Apotekin dan Cuciin yang aktif dulu. Fitur baru muncul otomatis via SSE tanpa update app.

### Cariin Wallet — Sistem Keuangan

```
Top-up channels:
  1. VA BRI (BRIVA) — rekening giro Cariin, user transfer ke nomor VA
  2. QRIS + Payment Gateway domestik
  3. Stripe — kartu kredit internasional (Visa/Mastercard)
  4. Crypto Gateway (mitra berlisensi OJK) — konversi ke IDR dulu

Aturan Closed-Loop Wallet:
  - Saldo HANYA dipakai di ekosistem Cariin
  - Tidak bisa transfer saldo antar konsumen
  - Tidak ada cashout ke rekening bank pribadi konsumen
  → Tidak perlu izin e-money BI (cukup status closed-loop)

Semua nilai finansial = BigInt (satuan: rupiah, tanpa desimal)
```

### MeHire — Sistem Payroll Mitra

```
Alur 4-Eyes Approval:
  DRAFT (sistem generate H-3)
    → PENDING_APPROVAL (Mitra Owner review + ajukan)
    → APPROVED (Finance Admin Cariin approve)
    → COMPLETED (sistem transfer via BRIAPI)
    → PARTIAL_FAILED (jika ada transfer gagal)

Batas keamanan:
  - Max transfer harian per mitra: Rp 500 juta (configurable)
  - Auto-flag jika total naik > 30% dari bulan sebelumnya
  - Finance Admin wajib 2FA (TOTP)
  - Setiap aksi dicatat di AuditLog
```

### Feature Toggle — Mekanisme

```
Cara kerja:
  Super Admin ubah toggle di Dashboard
    → Backend update DB + invalidasi Redis
    → Backend broadcast SSE ke semua client
    → Client fetch ulang /api/feature-flags
    → UI update tanpa reload app

Aturan:
  - Flag TIDAK boleh disimpan di localStorage (bisa dimanipulasi)
  - SSE endpoint: publik tapi rate-limited (60 req/menit per IP)
  - Endpoint /api/feature-flags: cache di client memory 60 detik
```

---

## 2. TECH STACK (TIDAK BOLEH DIGANTI TANPA PERSETUJUAN)

```
BACKEND:
  Runtime:          Node.js 22 LTS (ESM native — "type": "module" di package.json)
  Framework:        Hono (bukan Express, bukan Fastify)
  ORM:              Prisma 6
  Database:         PostgreSQL 16 + pgBouncer (Transaction Mode — wajib untuk RLS)
  Cache/Queue:      Redis 7 (ioredis) + BullMQ
  Auth:             JWT RS256 (asymmetric) + HttpOnly Cookie
  OAuth:            google-auth-library (Google OAuth 2.0)
  Validation:       Zod (wajib semua input)
  Error Track:      Sentry (@sentry/node)
  Storage:          Cloudflare R2 (S3-compatible)
  HTTP Client:      ky (di frontend)

FRONTEND:
  SSR App:          Next.js 15 (App Router) — cariin-web, cuciku-web
  SPA:              Vite + React + TypeScript — cuciku-dashboard, cuciku-customer
  UI:               shadcn/ui + Tailwind CSS
  Animation:        Framer Motion (wajib 'use client')
  Icons:            lucide-react
  Charts:           recharts
  State:            zustand
  Forms:            React Hook Form + Zod

INFRASTRUKTUR (MONOLITH — 3 VPS):
  CDN/DNS:          Cloudflare (WAF + DDoS + SSL)
  Reverse Proxy:    Nginx
  VPS 1 — Frontend: 2C / 4GB RAM (Next.js + Vite SPA)
  VPS 2 — Backend:  4C / 8GB RAM (Hono + Redis + BullMQ workers)
  VPS 3 — Database: 4C / 8GB RAM (PostgreSQL 16 + pgBouncer)
  pgBouncer:        Transaction Mode, max_client_conn=200, pool_size=20

PHASE 2 (opsional, aktifkan jika >500 tenant aktif):
  Search:           OpenSearch 2.x (VPS 4 — 4C / 8GB, dedicated)
  Note:             PostgreSQL full-text search (tsvector) cukup untuk Phase 1
```

---

## 3. ARSITEKTUR INFRASTRUKTUR — 3 VPS

```
Internet
    │
    ▼
┌─────────────────────────────────────┐
│  Cloudflare WAF + CDN + DDoS Shield │
│  DNS, SSL Termination, Rate Limit   │
└──────────────┬──────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌───────────────┐   ┌─────────────────────────────┐
│  VPS 1        │   │  VPS 2 — Backend             │
│  Frontend     │   │  4C / 8GB                    │
│  2C / 4GB     │   │                              │
│               │   │  Hono API      :4000         │
│  cariin-web   │   │  Redis 7       :6379         │
│  cuciku-web   │   │  BullMQ workers              │
│  cuciku-dash  │   │  Sentry client               │
│  cuciku-cust  │   │  R2 client                   │
│               │   │                              │
│  Nginx :443   │◄──►  Nginx :443                  │
└───────────────┘   └──────────────┬──────────────┘
                                   │ private network
                                   ▼
                    ┌─────────────────────────────┐
                    │  VPS 3 — Database            │
                    │  4C / 8GB                    │
                    │                              │
                    │  PostgreSQL 16   :5432       │
                    │  pgBouncer       :6432       │
                    │                              │
                    │  Backup → R2 tiap jam 02.00  │
                    └─────────────────────────────┘

Catatan arsitektur:
  - VPS 3 TIDAK boleh expose port ke publik, hanya via private network
  - Redis di VPS 2, bukan di VPS 3 (Redis adalah state app, bukan DB bisnis)
  - Frontend (VPS 1) dan Backend (VPS 2) komunikasi via Cloudflare (eksternal)
    atau via Nginx reverse proxy internal jika dalam 1 datacenter
  - Semua VPS di region yang sama untuk latensi rendah
  - Stateless: app tidak simpan session di memory → aman horizontal scale nantinya
```

**Upgrade Path (1.000+ tenant → Microservices):**
- VPS 2 bisa di-clone jadi multiple instance di belakang load balancer (JWT stateless memungkinkan ini)
- VPS 3 tambah PostgreSQL read replica sebelum migrasi ke microservices
- VPS 4 (OpenSearch) diaktifkan saat search query mulai lambat

---

## 4. STRUKTUR FOLDER LENGKAP

```
cariin-superapp/
├── apps/
│   ├── backend/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   │       └── 20250101_init/
│   │   │           └── migration.sql
│   │   └── src/
│   │       ├── server.ts                       ← entry point, listen PORT
│   │       ├── bootstrap/
│   │       │   ├── app.ts                      ← CORS pertama, routes, onError terakhir
│   │       │   └── env-validation.ts           ← Zod schema, process.exit(1) jika invalid
│   │       ├── db/
│   │       │   └── client.ts                   ← prismaApp + prismaAuth + withRlsContext
│   │       ├── cache/
│   │       │   └── redis.ts                    ← singleton Redis + cache helpers
│   │       ├── middleware/
│   │       │   ├── auth.ts                     ← verify RS256, inject RLS context
│   │       │   ├── rate-limiter.ts             ← Redis Lua atomic, fallback IP chain
│   │       │   ├── webhook-auth.ts             ← HMAC + timestamp + hex guard + PII strip
│   │       │   └── sentry.ts                   ← initSentry + globalErrorHandler
│   │       ├── modules/
│   │       │   ├── auth/
│   │       │   │   ├── auth.types.ts
│   │       │   │   ├── auth.schema.ts          ← Zod schemas semua auth input
│   │       │   │   ├── auth.controller.ts      ← login, register, forgot-password, google
│   │       │   │   ├── auth.router.ts
│   │       │   │   ├── otp.service.ts          ← bcrypt hash, atomic attempt limit
│   │       │   │   ├── token.service.ts        ← generateTokenPair, rotate, revokeAll
│   │       │   │   ├── google-oauth.service.ts ← Google OAuth 2.0 flow
│   │       │   │   └── role-router.service.ts  ← dynamic redirect DB-driven
│   │       │   ├── health/
│   │       │   │   └── health.controller.ts    ← /health, /readiness
│   │       │   ├── wallet/
│   │       │   │   ├── wallet.types.ts
│   │       │   │   ├── wallet.schema.ts
│   │       │   │   ├── wallet.service.ts
│   │       │   │   ├── wallet.controller.ts
│   │       │   │   └── wallet.router.ts
│   │       │   ├── orders/
│   │       │   │   ├── orders.schema.ts
│   │       │   │   ├── orders.service.ts
│   │       │   │   ├── orders.controller.ts
│   │       │   │   └── orders.router.ts
│   │       │   ├── inventory/
│   │       │   │   └── inventory.service.ts    ← decrement INLINE di outer TX
│   │       │   ├── payroll/
│   │       │   │   ├── payroll.service.ts      ← 4-eyes approval
│   │       │   │   └── payroll.router.ts
│   │       │   ├── feature-flags/
│   │       │   │   ├── feature-flags.service.ts
│   │       │   │   └── feature-flags.controller.ts
│   │       │   └── webhooks/
│   │       │       ├── shopee.handler.ts
│   │       │       ├── tokopedia.handler.ts
│   │       │       ├── tiktok.handler.ts
│   │       │       └── webhooks.router.ts
│   │       └── jobs/
│   │           ├── marketplace-sync.job.ts     ← BullMQ worker
│   │           ├── payroll-disbursement.job.ts
│   │           ├── notification.job.ts         ← WhatsApp + Email async
│   │           └── token-cleanup.job.ts
│   └── frontend/
│       └── apps/
│           ├── cariin-web/                     ← Next.js 15: portal super-app publik
│           │   └── src/
│           │       ├── middleware.ts           ← CSP nonce WAJIB ada
│           │       ├── app/
│           │       │   └── layout.tsx          ← konsumsi nonce dari headers()
│           │       └── components/
│           ├── cuciku-web/                     ← Next.js 15: storefront tenant
│           ├── cuciku-dashboard/               ← Vite SPA: POS kasir (offline-first)
│           └── cuciku-customer/                ← Vite SPA: portal konsumen
└── packages/
    ├── ui/                                     ← shared shadcn components
    ├── types/                                  ← shared TypeScript types
    ├── rate-limit/                             ← rate limit config values
    └── http-client/                            ← shared cariinApi ky instance
```

---

## 5. ENVIRONMENT VARIABLES

Semua ini **wajib** ada. Divalidasi via Zod saat startup. App langsung crash (`process.exit(1)`) jika ada yang kosong.

```bash
# DATABASE
DATABASE_URL="postgresql://cariin_app_role:PASS@VPS3_PRIVATE_IP:6432/cariin_db"
DATABASE_URL_AUTH="postgresql://cariin_auth_role:PASS@VPS3_PRIVATE_IP:6432/cariin_db"

# REDIS
REDIS_URL="redis://:REDIS_PASS@localhost:6379"

# JWT — RS256 asymmetric key pair
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n..."
JWT_REFRESH_SECRET="min-32-chars-random-string-here"

# GOOGLE OAUTH
GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-xxx"
GOOGLE_REDIRECT_URI="https://api.cariin.id/v1/auth/google/callback"

# WEBHOOK SECRETS
WEBHOOK_SECRET_SHOPEE="min-32-chars"
WEBHOOK_SECRET_TOKOPEDIA="min-32-chars"
WEBHOOK_SECRET_TIKTOK="min-32-chars"

# CORS
CORS_ALLOWED_ORIGINS="https://cariin.id,https://app.cariin.id"
DEFAULT_REDIRECT_URL="https://cariin.id/login"
FRONTEND_URL="https://cariin.id"

# EXTERNAL SERVICES
SENTRY_DSN="https://xxx@sentry.io/xxx"
CLOUDFLARE_TURNSTILE_SECRET_KEY="xxx"
BRIAPI_CLIENT_ID="xxx"
BRIAPI_CLIENT_SECRET="xxx"
STRIPE_SECRET_KEY="sk_live_xxx"
CLOUDFLARE_R2_ACCESS_KEY_ID="xxx"
CLOUDFLARE_R2_SECRET_ACCESS_KEY="xxx"
CLOUDFLARE_R2_BUCKET_NAME="cariin-assets"
CLOUDFLARE_R2_ENDPOINT="https://xxx.r2.cloudflarestorage.com"
WHATSAPP_API_KEY="xxx"

# OPENSEARCH (Phase 2 — opsional, kosongkan jika belum dipakai)
OPENSEARCH_URL="http://VPS4_PRIVATE_IP:9200"
OPENSEARCH_USERNAME="admin"
OPENSEARCH_PASSWORD="xxx"

# APP
NODE_ENV="production"
PORT="4000"
APP_VERSION="2.0.0"
WALLET_MAX_BALANCE="50000000"
PAYROLL_DAILY_LIMIT="500000000"
```

```typescript
// src/bootstrap/env-validation.ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL:               z.string().url(),
  DATABASE_URL_AUTH:          z.string().url(),
  REDIS_URL:                  z.string().url(),
  JWT_PRIVATE_KEY:            z.string().min(100),
  JWT_PUBLIC_KEY:             z.string().min(100),
  JWT_REFRESH_SECRET:         z.string().min(32),
  GOOGLE_CLIENT_ID:           z.string().min(10),
  GOOGLE_CLIENT_SECRET:       z.string().min(10),
  GOOGLE_REDIRECT_URI:        z.string().url(),
  WEBHOOK_SECRET_SHOPEE:      z.string().min(32),
  WEBHOOK_SECRET_TOKOPEDIA:   z.string().min(32),
  WEBHOOK_SECRET_TIKTOK:      z.string().min(32),
  CORS_ALLOWED_ORIGINS:       z.string().min(1),
  DEFAULT_REDIRECT_URL:       z.string().url(),
  FRONTEND_URL:               z.string().url(),
  SENTRY_DSN:                 z.string().url().optional(),
  OPENSEARCH_URL:             z.string().url().optional(),
  OPENSEARCH_USERNAME:        z.string().optional(),
  OPENSEARCH_PASSWORD:        z.string().optional(),
  NODE_ENV:                   z.enum(['development', 'staging', 'production']),
  PORT:                       z.string().default('4000'),
  APP_VERSION:                z.string().default('1.0.0'),
  WALLET_MAX_BALANCE:         z.string().default('50000000'),
  PAYROLL_DAILY_LIMIT:        z.string().default('500000000'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[STARTUP ERROR] Environment variable tidak valid:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
```

---

## 6. DATABASE — PRISMA SCHEMA

```prisma
// prisma/schema.prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema", "postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  schemas    = ["public", "auth"]
  extensions = [uuidOssp(map: "uuid-ossp"), pgcrypto]
}

// ─────────────────────────────────────────────
// GLOBAL MODELS (schema: public)
// ─────────────────────────────────────────────

model GlobalUser {
  id            String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  email         String
  passwordHash  String?   @map("password_hash")
  fullName      String    @map("full_name")
  phone         String?
  avatarUrl     String?   @map("avatar_url")
  emailVerified Boolean   @default(false) @map("email_verified")
  isActive      Boolean   @default(true)  @map("is_active")
  deletedAt     DateTime? @map("deleted_at")

  roles         GlobalUserRole[]
  wallet        Wallet?
  otpCodes      OtpCode[]
  refreshTokens RefreshToken[]
  oauthAccounts OAuthAccount[]   // ← NEW: untuk Google OAuth

  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt      @map("updated_at")

  @@map("global_users")
  @@schema("public")
}

model GlobalUserRole {
  id         String     @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  userId     String     @map("user_id")   @db.Uuid
  tenantId   String?    @map("tenant_id") @db.Uuid
  role       String
  isActive   Boolean    @default(true) @map("is_active")

  user       GlobalUser @relation(fields: [userId], references: [id])

  @@unique([userId, tenantId, role])
  @@map("global_user_roles")
  @@schema("public")
}

model Tenant {
  id           String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  name         String
  slug         String    @unique
  category     String    // 'APOTEK' | 'LAUNDRY' | 'FOOD' | 'HOTEL' | ...
  planTier     String    @default("STANDARD") @map("plan_tier")
  isActive     Boolean   @default(true) @map("is_active")
  deletedAt    DateTime? @map("deleted_at")

  domainMappings DomainMapping[]
  roleRoutes     TenantRoleRoute[]

  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt      @map("updated_at")

  @@map("tenants")
  @@schema("public")
}

model TenantRoleRoute {
  id          String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  tenantId    String   @map("tenant_id") @db.Uuid
  role        String
  redirectUrl String   @map("redirect_url")
  isActive    Boolean  @default(true) @map("is_active")

  tenant      Tenant   @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, role])
  @@map("tenant_role_routes")
  @@schema("public")
}

model DomainMapping {
  id                String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  tenantId          String    @map("tenant_id") @db.Uuid
  domain            String    @unique
  verificationToken String    @map("verification_token")
  isVerified        Boolean   @default(false) @map("is_verified")
  verifiedAt        DateTime? @map("verified_at")
  lastVerifiedAt    DateTime? @map("last_verified_at")

  tenant            Tenant    @relation(fields: [tenantId], references: [id])

  createdAt         DateTime  @default(now()) @map("created_at")

  @@map("domain_mappings")
  @@schema("public")
}

// ─── WALLET ──────────────────────────────────

model Wallet {
  id           String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  userId       String    @unique @map("user_id") @db.Uuid
  balance      BigInt    @default(0)
  currency     String    @default("IDR")

  user         GlobalUser          @relation(fields: [userId], references: [id])
  transactions WalletTransaction[]

  updatedAt    DateTime  @updatedAt @map("updated_at")

  @@map("wallets")
  @@schema("public")
}

model WalletTransaction {
  id              String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  walletId        String   @map("wallet_id")       @db.Uuid
  type            String   // 'TOPUP' | 'TOPUP_PENDING' | 'PAYMENT' | 'REFUND' | 'COMMISSION'
  amount          BigInt
  balanceBefore   BigInt   @map("balance_before")
  balanceAfter    BigInt   @map("balance_after")
  status          String   @default("COMPLETED")
  referenceId     String?  @map("reference_id")
  referenceType   String?  @map("reference_type")
  idempotencyKey  String   @unique @map("idempotency_key")
  note            String?

  wallet          Wallet   @relation(fields: [walletId], references: [id])

  createdAt       DateTime @default(now()) @map("created_at")

  @@index([walletId])
  @@map("wallet_transactions")
  @@schema("public")
}

// ─── ORDERS ──────────────────────────────────

model Order {
  id             String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  userId         String   @map("user_id")    @db.Uuid
  tenantId       String   @map("tenant_id")  @db.Uuid
  serviceId      String   @map("service_id") @db.Uuid
  quantity       Int
  totalAmount    BigInt   @map("total_amount")
  status         String   @default("PENDING")
  notes          String?
  idempotencyKey String   @unique @map("idempotency_key")

  items          OrderItem[]

  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt      @map("updated_at")

  @@index([userId])
  @@index([tenantId])
  @@map("orders")
  @@schema("public")
}

model OrderItem {
  id          String  @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  orderId     String  @map("order_id") @db.Uuid
  serviceId   String  @map("service_id") @db.Uuid
  serviceName String  @map("service_name")
  quantity    Int
  unitPrice   BigInt  @map("unit_price")
  subtotal    BigInt

  order       Order   @relation(fields: [orderId], references: [id])

  @@index([orderId])
  @@map("order_items")
  @@schema("public")
}

// ─── PAYROLL ─────────────────────────────────

model PayrollBatch {
  id                   String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  tenantId             String    @map("tenant_id") @db.Uuid
  periodLabel          String    @map("period_label")
  status               String    @default("DRAFT")
  totalAmount          BigInt    @map("total_amount")
  reviewedByOwner      String?   @map("reviewed_by_owner")       @db.Uuid
  reviewerNameSnapshot String?   @map("reviewer_name_snapshot")
  approvedByFinance    String?   @map("approved_by_finance")     @db.Uuid
  approverNameSnapshot String?   @map("approver_name_snapshot")
  approvedAt           DateTime? @map("approved_at")
  disbursedAt          DateTime? @map("disbursed_at")

  items                PayrollItem[]

  createdAt            DateTime  @default(now()) @map("created_at")
  updatedAt            DateTime  @updatedAt      @map("updated_at")

  @@unique([tenantId, periodLabel])
  @@map("payroll_batches")
  @@schema("public")
}

model PayrollItem {
  id            String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  batchId       String   @map("batch_id")    @db.Uuid
  employeeId    String   @map("employee_id") @db.Uuid
  employeeName  String   @map("employee_name")
  amount        BigInt
  status        String   @default("PENDING")
  transferRef   String?  @map("transfer_ref")
  failReason    String?  @map("fail_reason")

  batch         PayrollBatch @relation(fields: [batchId], references: [id])

  @@index([batchId])
  @@map("payroll_items")
  @@schema("public")
}

// ─── WEBHOOK & AUDIT ─────────────────────────

model WebhookLog {
  id               String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  provider         String
  eventType        String    @map("event_type")
  sanitizedPayload Json      @map("sanitized_payload")
  isVerified       Boolean   @default(false) @map("is_verified")
  processedAt      DateTime? @map("processed_at")

  createdAt        DateTime  @default(now()) @map("created_at")

  @@index([provider, eventType])
  @@map("webhook_logs")
  @@schema("public")
}

model AuditLog {
  id         String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  actorId    String?  @map("actor_id") @db.Uuid
  action     String
  resource   String
  resourceId String?  @map("resource_id")
  metadata   Json?
  ipAddress  String?  @map("ip_address")
  userAgent  String?  @map("user_agent")

  createdAt  DateTime @default(now()) @map("created_at")

  @@index([actorId])
  @@map("audit_logs")
  @@schema("public")
}

// ─── AUTH MODELS (schema: auth) ──────────────

model OtpCode {
  id           String     @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  userId       String     @map("user_id") @db.Uuid
  purpose      String     // 'LOGIN' | 'REGISTER' | 'RESET_PASSWORD' | 'WITHDRAW'
  codeHash     String     @map("code_hash")
  isUsed       Boolean    @default(false) @map("is_used")
  attemptCount Int        @default(0) @map("attempt_count")
  expiresAt    DateTime   @map("expires_at")

  user         GlobalUser @relation(fields: [userId], references: [id])

  createdAt    DateTime   @default(now()) @map("created_at")

  @@unique([userId, purpose, isUsed])
  @@map("otp_codes")
  @@schema("auth")
}

model RefreshToken {
  id         String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  family     String
  tokenHash  String    @unique @map("token_hash")
  isRevoked  Boolean   @default(false) @map("is_revoked")
  expiresAt  DateTime  @map("expires_at")

  user       GlobalUser @relation(fields: [userId], references: [id])

  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt      @map("updated_at")

  @@index([userId])
  @@index([family])
  @@map("refresh_tokens")
  @@schema("auth")
}

// ─── OAUTH ACCOUNTS (NEW) ──────────────────────

model OAuthAccount {
  id             String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  userId         String    @map("user_id") @db.Uuid
  provider       String    // 'GOOGLE'
  providerId     String    @map("provider_id")    // Google sub claim
  providerEmail  String    @map("provider_email") // Email dari Google
  displayName    String?   @map("display_name")
  avatarUrl      String?   @map("avatar_url")

  user           GlobalUser @relation(fields: [userId], references: [id])

  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt      @map("updated_at")

  @@unique([provider, providerId])
  @@index([userId])
  @@map("oauth_accounts")
  @@schema("auth")
}
```

---

## 7. DATABASE — SQL MIGRATION

```sql
-- prisma/migrations/20250101_init/migration.sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS auth;

-- ─── DATABASE ROLES ──────────────────────────────
DO $$ BEGIN
  CREATE ROLE cariin_app_role NOINHERIT LOGIN PASSWORD 'CHANGE_IN_PRODUCTION';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE cariin_auth_role NOINHERIT LOGIN PASSWORD 'CHANGE_IN_PRODUCTION' BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── ENABLE RLS ──────────────────────────────────
ALTER TABLE public.global_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.otp_codes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.refresh_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.oauth_accounts        ENABLE ROW LEVEL SECURITY;

-- ─── RLS POLICIES ────────────────────────────────
CREATE POLICY user_self_isolation ON public.global_users
  USING (id = current_setting('app.current_user_id')::uuid);

CREATE POLICY wallet_owner_isolation ON public.wallets
  USING (user_id = current_setting('app.current_user_id')::uuid);

CREATE POLICY wallet_tx_isolation ON public.wallet_transactions
  USING (wallet_id IN (
    SELECT id FROM public.wallets
    WHERE user_id = current_setting('app.current_user_id')::uuid
  ));

CREATE POLICY order_user_isolation ON public.orders
  USING (user_id = current_setting('app.current_user_id')::uuid);

CREATE POLICY payroll_tenant_isolation ON public.payroll_batches
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY payroll_item_isolation ON public.payroll_items
  USING (batch_id IN (
    SELECT id FROM public.payroll_batches
    WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
  ));

-- Auth tables: hanya cariin_auth_role yang boleh akses
CREATE POLICY otp_deny_app ON auth.otp_codes        USING (false);
CREATE POLICY refresh_deny_app ON auth.refresh_tokens USING (false);
CREATE POLICY oauth_deny_app ON auth.oauth_accounts   USING (false);

-- ─── PERMISSIONS ──────────────────────────────────
GRANT USAGE ON SCHEMA public TO cariin_app_role;
GRANT SELECT, INSERT, UPDATE ON public.global_users        TO cariin_app_role;
GRANT SELECT, INSERT, UPDATE ON public.wallets             TO cariin_app_role;
GRANT SELECT, INSERT         ON public.wallet_transactions TO cariin_app_role;
GRANT SELECT, INSERT, UPDATE ON public.orders              TO cariin_app_role;
GRANT SELECT, INSERT         ON public.order_items         TO cariin_app_role;
GRANT SELECT, INSERT, UPDATE ON public.payroll_batches     TO cariin_app_role;
GRANT SELECT, INSERT, UPDATE ON public.payroll_items       TO cariin_app_role;
GRANT SELECT, INSERT         ON public.webhook_logs        TO cariin_app_role;
GRANT SELECT, INSERT         ON public.audit_logs          TO cariin_app_role;
GRANT SELECT                 ON public.tenants             TO cariin_app_role;
GRANT SELECT                 ON public.tenant_role_routes  TO cariin_app_role;
GRANT SELECT                 ON public.domain_mappings     TO cariin_app_role;
GRANT SELECT                 ON public.global_user_roles   TO cariin_app_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO cariin_app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cariin_app_role;

GRANT USAGE ON SCHEMA public TO cariin_auth_role;
GRANT USAGE ON SCHEMA auth   TO cariin_auth_role;
GRANT SELECT, INSERT, UPDATE           ON public.global_users      TO cariin_auth_role;
GRANT SELECT, INSERT, UPDATE           ON public.global_user_roles TO cariin_auth_role;
GRANT SELECT, INSERT, UPDATE           ON auth.otp_codes           TO cariin_auth_role;
GRANT SELECT, INSERT, UPDATE, DELETE   ON auth.refresh_tokens      TO cariin_auth_role;
GRANT SELECT, INSERT, UPDATE           ON auth.oauth_accounts      TO cariin_auth_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE ON TABLES TO cariin_auth_role;

-- ─── EMAIL UNIQUENESS ─────────────────────────────
DROP INDEX IF EXISTS public.global_users_email_key;
CREATE UNIQUE INDEX idx_global_users_email_active
  ON public.global_users (email)
  WHERE deleted_at IS NULL;

-- ─── CHECK CONSTRAINTS ─────────────────────────────
ALTER TABLE public.wallets
  ADD CONSTRAINT chk_wallet_balance_non_negative CHECK (balance >= 0);
ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT chk_wallet_tx_amount_positive CHECK (amount > 0);
ALTER TABLE public.orders
  ADD CONSTRAINT chk_order_amount_positive CHECK (total_amount > 0);

-- ─── INDEXES ───────────────────────────────────────
CREATE INDEX idx_wallet_tx_wallet  ON public.wallet_transactions (wallet_id);
CREATE INDEX idx_orders_user       ON public.orders (user_id);
CREATE INDEX idx_orders_tenant     ON public.orders (tenant_id);
CREATE INDEX idx_payroll_tenant    ON public.payroll_batches (tenant_id);
CREATE INDEX idx_webhook_provider  ON public.webhook_logs (provider, event_type);
CREATE INDEX idx_audit_actor       ON public.audit_logs (actor_id);
CREATE INDEX idx_refresh_family    ON auth.refresh_tokens (family);
CREATE INDEX idx_oauth_user        ON auth.oauth_accounts (user_id);

-- ─── TRIGGER: Snapshot nama reviewer payroll ─────────
CREATE OR REPLACE FUNCTION snapshot_payroll_reviewer() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reviewed_by_owner IS NOT NULL AND OLD.reviewed_by_owner IS NULL THEN
    NEW.reviewer_name_snapshot = (
      SELECT full_name FROM public.global_users WHERE id = NEW.reviewed_by_owner
    );
  END IF;
  IF NEW.approved_by_finance IS NOT NULL AND OLD.approved_by_finance IS NULL THEN
    NEW.approver_name_snapshot = (
      SELECT full_name FROM public.global_users WHERE id = NEW.approved_by_finance
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_reviewer
  BEFORE UPDATE ON public.payroll_batches
  FOR EACH ROW EXECUTE FUNCTION snapshot_payroll_reviewer();

COMMIT;
```

---

## 8. BACKEND — POLA WAJIB

### app.ts — Urutan Middleware WAJIB

```typescript
// src/bootstrap/app.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { initSentry, globalErrorHandler } from '../middleware/sentry';
import { authRouter }        from '../modules/auth/auth.router';
import { walletRouter }      from '../modules/wallet/wallet.router';
import { ordersRouter }      from '../modules/orders/orders.router';
import { payrollRouter }     from '../modules/payroll/payroll.router';
import { webhooksRouter }    from '../modules/webhooks/webhooks.router';
import { featureFlagsRouter} from '../modules/feature-flags/feature-flags.controller';
import { healthRouter }      from '../modules/health/health.controller';
import { env } from './env-validation';

initSentry(); // ← PERTAMA SEKALI

const app = new Hono();

// 1. CORS — WAJIB PALING AWAL
const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim());
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return null;
    if (allowedOrigins.includes(origin)) return origin;
    const tenantDomains = ['.cariin.id', '.cuciin.id', '.warungin.id'];
    if (tenantDomains.some(d => origin.endsWith(d))) return origin;
    return null;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Cariin-Client', 'X-Idempotency-Key', 'X-API-Version'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After', 'X-API-Deprecated'],
  maxAge: 86400,
}));

// 2. Security headers
app.use('*', secureHeaders({ xFrameOptions: 'DENY', xContentTypeOptions: 'nosniff' }));

// 3. Body size limit (1 MB)
app.use('*', async (c, next) => {
  const len = Number(c.req.header('Content-Length') ?? 0);
  if (len > 1_048_576) return c.json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  await next();
});

// 4. API version header di semua response
app.use('*', async (c, next) => {
  await next();
  c.header('X-API-Version',    'v1');
  c.header('X-API-Deprecated', c.req.path.startsWith('/v1') ? 'false' : 'true');
});

// 5. Routes — Health dulu (tidak perlu auth)
app.route('/health',     healthRouter);
app.route('/v1/auth',    authRouter);
app.route('/v1/wallet',  walletRouter);
app.route('/v1/orders',  ordersRouter);
app.route('/v1/payroll', payrollRouter);
app.route('/v1/webhooks',webhooksRouter);
app.route('/api',        featureFlagsRouter);

// 6. Global error handler — WAJIB PALING AKHIR
app.onError(globalErrorHandler);

export default app;
```

### db/client.ts — Dual Pool + RLS

```typescript
// src/db/client.ts
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';
import { z } from 'zod';

interface RlsContext { userId?: string; tenantId?: string; }

export const rlsStorage = new AsyncLocalStorage<RlsContext>();

const uuidSchema = z.string().uuid();
function validateUuid(val: string, label: string): string {
  const r = uuidSchema.safeParse(val);
  if (!r.success) throw new Error(`[RLS SECURITY] Invalid ${label}: ${val}`);
  return r.data;
}

const CONTEXT_FREE  = new Set(['Tenant','TenantRoleRoute','DomainMapping','AuditLog','WebhookLog','GlobalUserRole']);
const USER_SCOPED   = new Set(['GlobalUser','Wallet','WalletTransaction','Order','OrderItem']);
const TENANT_SCOPED = new Set(['PayrollBatch','PayrollItem']);
const AUTH_ONLY     = new Set(['OtpCode','RefreshToken','OAuthAccount']);

export const prismaApp = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
}).$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (CONTEXT_FREE.has(model ?? '')) return query(args);

        if (AUTH_ONLY.has(model ?? '')) {
          throw new Error(
            `[SECURITY] Model '${model}' harus diakses via prismaAuth, bukan prismaApp!`
          );
        }

        const ctx = rlsStorage.getStore();

        if (USER_SCOPED.has(model ?? '') && !ctx?.userId) {
          throw new Error(
            `[RLS VIOLATION] Model '${model}' op '${operation}' tanpa userId context.`
          );
        }
        if (TENANT_SCOPED.has(model ?? '') && !ctx?.tenantId) {
          throw new Error(
            `[RLS VIOLATION] Model '${model}' op '${operation}' tanpa tenantId context.`
          );
        }

        return prismaApp.$transaction(async (tx) => {
          if (ctx?.userId) {
            const safe = validateUuid(ctx.userId, 'userId');
            await tx.$executeRaw`SELECT set_config('app.current_user_id', ${safe}, true)`;
          }
          if (ctx?.tenantId) {
            const safe = validateUuid(ctx.tenantId, 'tenantId');
            await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${safe}, true)`;
          }
          return query(args);
        });
      },
    },
  },
});

export const prismaAuth = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL_AUTH,
});

export function withRlsContext<T>(ctx: RlsContext, fn: () => Promise<T>): Promise<T> {
  return rlsStorage.run(ctx, fn);
}
```

---

## 9. BACKEND — AUTH MODULE LENGKAP

### auth.schema.ts — Validasi Input

```typescript
// src/modules/auth/auth.schema.ts
import { z } from 'zod';

export const RegisterSchema = z.object({
  email:    z.string().email('Email tidak valid'),
  fullName: z.string().min(2, 'Nama minimal 2 karakter').max(100),
  phone:    z.string().regex(/^(\+62|62|0)8[1-9][0-9]{6,10}$/, 'Nomor HP tidak valid').optional(),
});

export const LoginSchema = z.object({
  email: z.string().email('Email tidak valid'),
});

export const OtpVerifySchema = z.object({
  email:   z.string().email(),
  otp:     z.string().length(6, 'OTP harus 6 digit'),
  purpose: z.enum(['LOGIN', 'REGISTER', 'RESET_PASSWORD']),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Email tidak valid'),
});

export const ResetPasswordSchema = z.object({
  email:       z.string().email(),
  otp:         z.string().length(6),
  newPassword: z.string()
    .min(8, 'Password minimal 8 karakter')
    .regex(/[A-Z]/, 'Harus ada huruf kapital')
    .regex(/[0-9]/, 'Harus ada angka')
    .regex(/[^A-Za-z0-9]/, 'Harus ada karakter spesial'),
});

export type RegisterInput      = z.infer<typeof RegisterSchema>;
export type LoginInput         = z.infer<typeof LoginSchema>;
export type OtpVerifyInput     = z.infer<typeof OtpVerifySchema>;
export type ForgotPasswordInput= z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
```

### auth.controller.ts — Semua Endpoint Auth

```typescript
// src/modules/auth/auth.controller.ts
import { Hono }         from 'hono';
import { zValidator }   from '@hono/zod-validator';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { hash }         from 'bcrypt';

import {
  RegisterSchema, LoginSchema, OtpVerifySchema,
  ForgotPasswordSchema, ResetPasswordSchema,
} from './auth.schema';
import { otpService }        from './otp.service';
import { tokenService }      from './token.service';
import { googleOAuthService } from './google-oauth.service';
import { roleRouterService }  from './role-router.service';
import { prismaApp, prismaAuth, withRlsContext } from '../../db/client';
import { rateLimiter }       from '../../middleware/rate-limiter';
import { authMiddleware }    from '../../middleware/auth';
import { env }               from '../../bootstrap/env-validation';

export const authRouter = new Hono();

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   true,
  sameSite: 'Lax' as const,
  path:     '/',
};

// ─── HELPER ──────────────────────────────────────
function setAuthCookies(c: any, accessToken: string, refreshToken: string) {
  setCookie(c, 'session_token', accessToken, {
    ...COOKIE_OPTS,
    maxAge: 15 * 60,        // 15 menit
  });
  setCookie(c, 'refresh_token', refreshToken, {
    ...COOKIE_OPTS,
    maxAge: 30 * 24 * 3600, // 30 hari
    path:   '/v1/auth/refresh',
  });
}

// ─── POST /v1/auth/register ──────────────────────
// Step 1: daftar → kirim OTP ke email/HP
authRouter.post('/register',
  rateLimiter('auth:register'),
  zValidator('json', RegisterSchema),
  async (c) => {
    const { email, fullName, phone } = c.req.valid('json');

    // Cek email sudah terdaftar
    const existing = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, emailVerified: true },
    });

    if (existing?.emailVerified) {
      return c.json({ success: false, error: 'EMAIL_ALREADY_REGISTERED',
        message: 'Email sudah terdaftar. Silakan login.' }, 409);
    }

    let userId = existing?.id;
    if (!userId) {
      const user = await prismaAuth.globalUser.create({
        data: { email, fullName, phone, emailVerified: false },
        select: { id: true },
      });
      userId = user.id;
    }

    await otpService.generate(userId, 'REGISTER');

    return c.json({
      success: true,
      message: 'Kode OTP dikirim ke email Anda. Berlaku 5 menit.',
    });
  }
);

// ─── POST /v1/auth/otp/verify ────────────────────
// Step 2: verifikasi OTP → dapat token
authRouter.post('/otp/verify',
  rateLimiter('auth:otp-verify'),
  zValidator('json', OtpVerifySchema),
  async (c) => {
    const { email, otp, purpose } = c.req.valid('json');

    const user = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!user) return c.json({ success: false, error: 'USER_NOT_FOUND',
      message: 'Email tidak ditemukan.' }, 404);

    if (!user.isActive) return c.json({ success: false, error: 'ACCOUNT_SUSPENDED',
      message: 'Akun Anda dinonaktifkan.' }, 403);

    const ok = await otpService.verify(user.id, purpose, otp);
    if (!ok) return c.json({ success: false, error: 'OTP_INVALID',
      message: 'Kode OTP salah atau sudah kadaluarsa.' }, 400);

    // Jika register → set emailVerified
    if (purpose === 'REGISTER') {
      await prismaAuth.globalUser.update({
        where: { id: user.id },
        data:  { emailVerified: true },
      });

      // Buat wallet otomatis
      await withRlsContext({ userId: user.id }, async () => {
        const existingWallet = await prismaApp.wallet.findUnique({
          where: { userId: user.id },
        });
        if (!existingWallet) {
          await prismaApp.wallet.create({ data: { userId: user.id } });
        }
      });
    }

    const userRole = await prismaAuth.globalUserRole.findFirst({
      where: { userId: user.id, isActive: true },
      select: { role: true, tenantId: true },
    });

    const { accessToken, refreshToken } = await tokenService.generateTokenPair(
      user.id,
      userRole?.tenantId ?? null,
      userRole?.role ?? 'CONSUMER',
    );

    setAuthCookies(c, accessToken, refreshToken);

    const redirectUrl = userRole?.tenantId
      ? await roleRouterService.getRedirectUrl(userRole.tenantId, userRole.role)
      : env.FRONTEND_URL;

    return c.json({
      success: true,
      data:    { redirectUrl, userId: user.id },
    });
  }
);

// ─── POST /v1/auth/login ─────────────────────────
// Kirim OTP untuk login
authRouter.post('/login',
  rateLimiter('auth:login'),
  zValidator('json', LoginSchema),
  async (c) => {
    const { email } = c.req.valid('json');

    const user = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null, emailVerified: true },
      select: { id: true, isActive: true },
    });

    // Selalu return 200 meskipun email tidak ada (anti-enumeration)
    if (!user || !user.isActive) {
      return c.json({ success: true, message: 'Jika email terdaftar, OTP akan dikirim.' });
    }

    await otpService.generate(user.id, 'LOGIN');

    return c.json({ success: true, message: 'Kode OTP dikirim ke email Anda.' });
  }
);

// ─── POST /v1/auth/forgot-password ───────────────
authRouter.post('/forgot-password',
  rateLimiter('auth:otp-request'),
  zValidator('json', ForgotPasswordSchema),
  async (c) => {
    const { email } = c.req.valid('json');

    const user = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null, emailVerified: true },
      select: { id: true },
    });

    // Anti-enumeration: selalu 200
    if (!user) {
      return c.json({ success: true,
        message: 'Jika email terdaftar, OTP reset password akan dikirim.' });
    }

    await otpService.generate(user.id, 'RESET_PASSWORD');

    return c.json({ success: true,
      message: 'Kode OTP reset password dikirim ke email Anda.' });
  }
);

// ─── POST /v1/auth/reset-password ────────────────
authRouter.post('/reset-password',
  rateLimiter('auth:otp-verify'),
  zValidator('json', ResetPasswordSchema),
  async (c) => {
    const { email, otp, newPassword } = c.req.valid('json');

    const user = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    if (!user) return c.json({ success: false, error: 'USER_NOT_FOUND',
      message: 'Email tidak ditemukan.' }, 404);

    const ok = await otpService.verify(user.id, 'RESET_PASSWORD', otp);
    if (!ok) return c.json({ success: false, error: 'OTP_INVALID',
      message: 'Kode OTP salah atau sudah kadaluarsa.' }, 400);

    const passwordHash = await hash(newPassword, 12);
    await prismaAuth.globalUser.update({
      where: { id: user.id },
      data:  { passwordHash },
    });

    // Revoke semua sesi setelah reset password
    await tokenService.revokeAll(user.id);

    return c.json({ success: true,
      message: 'Password berhasil diubah. Silakan login kembali.' });
  }
);

// ─── POST /v1/auth/refresh ───────────────────────
authRouter.post('/refresh', async (c) => {
  const incomingToken = getCookie(c, 'refresh_token');
  if (!incomingToken) return c.json({ error: 'REFRESH_TOKEN_MISSING' }, 401);

  const { accessToken, refreshToken } = await tokenService.rotate(incomingToken);
  setAuthCookies(c, accessToken, refreshToken);

  return c.json({ success: true });
});

// ─── POST /v1/auth/logout ────────────────────────
authRouter.post('/logout', authMiddleware, async (c) => {
  const userId       = c.get('userId') as string;
  const refreshToken = getCookie(c, 'refresh_token');

  if (refreshToken) {
    // Revoke hanya token ini (bukan semua sesi)
    const { createHash } = await import('crypto');
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    await prismaAuth.refreshToken.updateMany({
      where: { userId, tokenHash, isRevoked: false },
      data:  { isRevoked: true },
    });
  }

  deleteCookie(c, 'session_token',  { ...COOKIE_OPTS });
  deleteCookie(c, 'refresh_token',  { ...COOKIE_OPTS, path: '/v1/auth/refresh' });

  return c.json({ success: true, message: 'Berhasil logout.' });
});

// ─── POST /v1/auth/logout-all ────────────────────
// Logout dari semua perangkat
authRouter.post('/logout-all', authMiddleware, async (c) => {
  const userId = c.get('userId') as string;
  await tokenService.revokeAll(userId);

  deleteCookie(c, 'session_token', { ...COOKIE_OPTS });
  deleteCookie(c, 'refresh_token', { ...COOKIE_OPTS, path: '/v1/auth/refresh' });

  return c.json({ success: true, message: 'Berhasil logout dari semua perangkat.' });
});

// ─── GET /v1/auth/me ─────────────────────────────
authRouter.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId') as string;

  return withRlsContext({ userId }, async () => {
    const user = await prismaApp.globalUser.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, fullName: true, phone: true,
        avatarUrl: true, emailVerified: true,
        roles: { where: { isActive: true }, select: { role: true, tenantId: true } },
        wallet: { select: { balance: true, currency: true } },
      },
    });
    if (!user) return c.json({ error: 'NOT_FOUND' }, 404);
    return c.json({ success: true, data: user });
  });
});

// ─── GET /v1/auth/google ─────────────────────────
// Redirect ke Google OAuth
authRouter.get('/google',
  rateLimiter('auth:login'),
  async (c) => {
    const url = googleOAuthService.generateAuthUrl();
    return c.redirect(url);
  }
);

// ─── GET /v1/auth/google/callback ────────────────
authRouter.get('/google/callback', async (c) => {
  const code  = c.req.query('code');
  const error = c.req.query('error');

  if (error || !code) {
    return c.redirect(`${env.FRONTEND_URL}/login?error=GOOGLE_AUTH_CANCELLED`);
  }

  try {
    const { user, accessToken, refreshToken } =
      await googleOAuthService.handleCallback(code);

    setAuthCookies(c, accessToken, refreshToken);

    const userRole = await prismaAuth.globalUserRole.findFirst({
      where: { userId: user.id, isActive: true },
      select: { role: true, tenantId: true },
    });

    const redirectUrl = userRole?.tenantId
      ? await roleRouterService.getRedirectUrl(userRole.tenantId, userRole.role)
      : `${env.FRONTEND_URL}/dashboard`;

    return c.redirect(redirectUrl);
  } catch (err) {
    console.error('[Google OAuth Error]', err);
    return c.redirect(`${env.FRONTEND_URL}/login?error=GOOGLE_AUTH_FAILED`);
  }
});
```

### google-oauth.service.ts — Google OAuth 2.0

```typescript
// src/modules/auth/google-oauth.service.ts
import { OAuth2Client } from 'google-auth-library';
import { prismaAuth, withRlsContext, prismaApp } from '../../db/client';
import { tokenService } from './token.service';
import { env }          from '../../bootstrap/env-validation';

const client = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI,
);

export const googleOAuthService = {
  generateAuthUrl(): string {
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
      prompt: 'select_account',
    });
  },

  async handleCallback(code: string) {
    // 1. Exchange code untuk tokens Google
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // 2. Dapatkan info user dari Google
    const ticket = await client.verifyIdToken({
      idToken:  tokens.id_token!,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) throw new Error('GOOGLE_TOKEN_INVALID');

    const { sub: providerId, email, name, picture } = payload;
    if (!email) throw new Error('GOOGLE_EMAIL_MISSING');

    // 3. Cari atau buat user
    let user = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, isActive: true },
    });

    if (!user) {
      // User baru via Google
      user = await prismaAuth.globalUser.create({
        data: {
          email,
          fullName:      name ?? email.split('@')[0],
          avatarUrl:     picture,
          emailVerified: true, // Google sudah verifikasi
          isActive:      true,
        },
        select: { id: true, isActive: true },
      });

      // Buat wallet
      await withRlsContext({ userId: user.id }, async () => {
        await prismaApp.wallet.create({ data: { userId: user!.id } });
      });
    }

    if (!user.isActive) throw new Error('ACCOUNT_SUSPENDED');

    // 4. Upsert OAuthAccount
    await prismaAuth.oAuthAccount.upsert({
      where:  { provider_providerId: { provider: 'GOOGLE', providerId } },
      create: {
        userId:        user.id,
        provider:      'GOOGLE',
        providerId,
        providerEmail: email,
        displayName:   name,
        avatarUrl:     picture,
      },
      update: {
        providerEmail: email,
        displayName:   name,
        avatarUrl:     picture,
      },
    });

    // 5. Generate token pair Cariin
    const { accessToken, refreshToken } = await tokenService.generateTokenPair(
      user.id, null, 'CONSUMER'
    );

    return { user, accessToken, refreshToken };
  },
};
```

### otp.service.ts — OTP bcrypt

```typescript
// src/modules/auth/otp.service.ts
import { hash, compare } from 'bcrypt';
import { prismaAuth }    from '../../db/client';

const BCRYPT_ROUNDS = 10;

export const otpService = {
  async generate(userId: string, purpose: string): Promise<void> {
    const plain  = String(Math.floor(100_000 + Math.random() * 900_000));
    const hashed = await hash(plain, BCRYPT_ROUNDS);

    await prismaAuth.otpCode.upsert({
      where:  { userId_purpose_isUsed: { userId, purpose, isUsed: false } },
      update: { codeHash: hashed, attemptCount: 0,
                expiresAt: new Date(Date.now() + 300_000) },
      create: { userId, purpose, codeHash: hashed,
                expiresAt: new Date(Date.now() + 300_000) },
    });

    await sendOtpViaSms(userId, plain); // plain TIDAK disimpan
  },

  async verify(userId: string, purpose: string, plain: string): Promise<boolean> {
    const otp = await prismaAuth.otpCode.findFirst({
      where: { userId, purpose, isUsed: false, expiresAt: { gt: new Date() } },
    });
    if (!otp) return false;

    const affected = await prismaAuth.$executeRaw`
      UPDATE auth.otp_codes SET attempt_count = attempt_count + 1
      WHERE id = ${otp.id}::uuid
        AND attempt_count < 5
        AND is_used = false
        AND expires_at > NOW()
    `;
    if (affected === 0) throw new Error('OTP_MAX_ATTEMPTS_EXCEEDED');

    const ok = await compare(plain, otp.codeHash);
    if (ok) {
      await prismaAuth.otpCode.update({
        where: { id: otp.id },
        data:  { isUsed: true },
      });
    }
    return ok;
  },
};

async function sendOtpViaSms(userId: string, plain: string): Promise<void> {
  // Push ke BullMQ → notification.job.ts akan handle WhatsApp/SMS
  const { notificationQueue } = await import('../../jobs/marketplace-sync.job');
  await notificationQueue.add('send-otp', { userId, otp: plain }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}
```

### token.service.ts — JWT RS256 + Refresh Rotation

```typescript
// src/modules/auth/token.service.ts
import { randomBytes, createHash } from 'crypto';
import { sign }                    from 'jsonwebtoken';
import { prismaAuth }              from '../../db/client';
import { env }                     from '../../bootstrap/env-validation';

const ACCESS_TTL  = 15 * 60;
const REFRESH_TTL = 30 * 24 * 3600;

function hashToken(t: string) {
  return createHash('sha256').update(t).digest('hex');
}

export const tokenService = {
  async generateTokenPair(userId: string, tenantId: string | null, role: string) {
    const accessToken  = sign(
      { sub: userId, tenantId, role },
      env.JWT_PRIVATE_KEY,
      { algorithm: 'RS256', expiresIn: ACCESS_TTL }
    );
    const refreshToken = randomBytes(48).toString('base64url');
    const family       = randomBytes(16).toString('hex');

    await prismaAuth.refreshToken.create({
      data: {
        userId, family,
        tokenHash: hashToken(refreshToken),
        isRevoked: false,
        expiresAt: new Date(Date.now() + REFRESH_TTL * 1000),
      },
    });
    return { accessToken, refreshToken, family };
  },

  async rotate(incomingToken: string) {
    const stored = await prismaAuth.refreshToken.findFirst({
      where: { tokenHash: hashToken(incomingToken) },
    });
    if (!stored) throw new Error('REFRESH_TOKEN_INVALID');

    if (stored.isRevoked) {
      await prismaAuth.refreshToken.updateMany({
        where: { family: stored.family }, data: { isRevoked: true },
      });
      throw new Error('REFRESH_TOKEN_REUSE_DETECTED');
    }
    if (stored.expiresAt < new Date()) throw new Error('REFRESH_TOKEN_EXPIRED');

    const userRole = await prismaAuth.globalUserRole.findFirst({
      where: { userId: stored.userId, isActive: true },
      select: { role: true, tenantId: true },
    });

    const newRefresh = randomBytes(48).toString('base64url');

    await prismaAuth.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: stored.id }, data: { isRevoked: true },
      });
      await tx.refreshToken.create({
        data: {
          userId: stored.userId, family: stored.family,
          tokenHash: hashToken(newRefresh), isRevoked: false,
          expiresAt: new Date(Date.now() + REFRESH_TTL * 1000),
        },
      });
    });

    const newAccess = sign(
      { sub: stored.userId, tenantId: userRole?.tenantId, role: userRole?.role ?? 'CONSUMER' },
      env.JWT_PRIVATE_KEY,
      { algorithm: 'RS256', expiresIn: ACCESS_TTL }
    );
    return { accessToken: newAccess, refreshToken: newRefresh };
  },

  async revokeAll(userId: string) {
    await prismaAuth.refreshToken.updateMany({
      where: { userId, isRevoked: false }, data: { isRevoked: true },
    });
  },
};
```

---

## 10. BACKEND — CACHE STRATEGY

```typescript
// src/cache/redis.ts — singleton Redis + typed cache helpers
import { Redis } from 'ioredis';
import { env }   from '../bootstrap/env-validation';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 3000),
  enableOfflineQueue: false,
});

redis.on('error', (err) => {
  console.error('[Redis Error]', err.message);
  // JANGAN throw — app tetap jalan tanpa cache
});

// ─── TYPED CACHE HELPERS ─────────────────────────
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const val = await redis.get(key);
      return val ? JSON.parse(val) : null;
    } catch {
      return null; // Cache miss → fallback ke DB
    }
  },

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch {
      // Cache write gagal → tidak fatal, data tetap tersimpan di DB
    }
  },

  async del(key: string): Promise<void> {
    try { await redis.del(key); } catch { /* silent */ }
  },

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) await redis.del(...keys);
    } catch { /* silent */ }
  },
};

// ─── CACHE KEYS — CENTRALIZED ─────────────────────
export const CACHE_KEYS = {
  featureFlags:    ()          => 'feature_flags:global',
  tenantInfo:      (id: string)=> `tenant:${id}`,
  userProfile:     (id: string)=> `user:profile:${id}`,
  walletBalance:   (id: string)=> `wallet:balance:${id}`,
  serviceCatalog:  (tenantId: string) => `services:${tenantId}`,
};

// ─── CACHE TTL — CENTRALIZED ──────────────────────
export const CACHE_TTL = {
  featureFlags:   300,  // 5 menit — dibroadcast via SSE jika berubah
  tenantInfo:     300,  // 5 menit
  userProfile:    300,  // 5 menit
  walletBalance:  30,   // 30 detik — invalidate setiap transaksi
  serviceCatalog: 600,  // 10 menit
};
```

```typescript
// Contoh penggunaan cache di wallet service
// src/modules/wallet/wallet.service.ts (extend dari sebelumnya)

async getBalance(userId: string): Promise<bigint> {
  const cacheKey = CACHE_KEYS.walletBalance(userId);

  // Coba cache dulu
  const cached = await cache.get<string>(cacheKey);
  if (cached !== null) return BigInt(cached);

  // Cache miss → baca DB
  return withRlsContext({ userId }, async () => {
    const wallet = await prismaApp.wallet.findUniqueOrThrow({
      where: { userId }, select: { balance: true },
    });
    // Simpan ke cache (BigInt harus string untuk JSON)
    await cache.set(cacheKey, wallet.balance.toString(), CACHE_TTL.walletBalance);
    return wallet.balance;
  });
},

// Invalidate cache setelah transaksi
async invalidateWalletCache(userId: string) {
  await cache.del(CACHE_KEYS.walletBalance(userId));
},
```

---

## 11. BACKEND — HEALTH CHECK & FALLBACK

### Health Check Endpoints

```typescript
// src/modules/health/health.controller.ts
import { Hono }      from 'hono';
import { prismaApp } from '../../db/client';
import { redis }     from '../../cache/redis';
import { env }       from '../../bootstrap/env-validation';

export const healthRouter = new Hono();

// GET /health — basic liveness (tidak cek dependencies)
// Dipakai oleh load balancer untuk restart container jika down
healthRouter.get('/', (c) => {
  return c.json({
    status:    'ok',
    uptime:    process.uptime(),
    version:   env.APP_VERSION,
    timestamp: new Date().toISOString(),
  });
});

// GET /health/ready — readiness (cek DB + Redis)
// Dipakai oleh load balancer sebelum mulai routing traffic
healthRouter.get('/ready', async (c) => {
  const checks: Record<string, 'ok' | 'error'> = {};
  let allOk = true;

  // Cek PostgreSQL
  try {
    await prismaApp.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
    allOk = false;
  }

  // Cek Redis
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
    // Redis error tidak blokir traffic — app masih bisa jalan tanpa cache
  }

  return c.json({
    status: allOk ? 'ready' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  }, allOk ? 200 : 503);
});
```

### Fallback Pattern — Circuit Breaker Sederhana via Redis

```typescript
// src/cache/circuit-breaker.ts
// Circuit breaker untuk external services (BRIAPI, WhatsApp, Stripe, dll)
import { redis } from './redis';

interface CircuitConfig {
  failureThreshold: number; // max failures sebelum open
  windowMs:         number; // window monitoring (ms)
  halfOpenAfterMs:  number; // berapa lama sebelum coba lagi
}

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  windowMs:         60_000,  // 1 menit
  halfOpenAfterMs:  30_000,  // 30 detik
};

export class CircuitBreaker {
  private key: string;
  private config: CircuitConfig;

  constructor(serviceName: string, config?: Partial<CircuitConfig>) {
    this.key    = `circuit:${serviceName}`;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async isOpen(): Promise<boolean> {
    const state = await redis.get(`${this.key}:state`);
    if (state === 'open') {
      const openedAt = Number(await redis.get(`${this.key}:opened_at`) ?? 0);
      if (Date.now() - openedAt > this.config.halfOpenAfterMs) {
        // Masuk half-open: biarkan 1 request coba
        await redis.set(`${this.key}:state`, 'half-open', 'EX', 60);
        return false;
      }
      return true;
    }
    return false;
  }

  async recordSuccess(): Promise<void> {
    await redis.del(`${this.key}:state`, `${this.key}:failures`, `${this.key}:opened_at`);
  }

  async recordFailure(): Promise<void> {
    const windowSec = Math.floor(this.config.windowMs / 1000);
    const failures  = await redis.incr(`${this.key}:failures`);
    await redis.expire(`${this.key}:failures`, windowSec);

    if (failures >= this.config.failureThreshold) {
      await redis.set(`${this.key}:state',    'open', 'EX', 3600`);
      await redis.set(`${this.key}:opened_at`, String(Date.now()), 'EX', 3600);
    }
  }

  // Wrapper untuk eksekusi dengan circuit breaker
  async execute<T>(fn: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<T> {
    if (await this.isOpen()) {
      if (fallback) return fallback();
      throw new Error(`SERVICE_UNAVAILABLE: Circuit open for ${this.key}`);
    }

    try {
      const result = await fn();
      await this.recordSuccess();
      return result;
    } catch (err) {
      await this.recordFailure();
      if (fallback) return fallback();
      throw err;
    }
  }
}

// Instance per external service
export const briapiCircuit     = new CircuitBreaker('briapi',     { failureThreshold: 3 });
export const whatsappCircuit   = new CircuitBreaker('whatsapp',   { failureThreshold: 5 });
export const stripeCircuit     = new CircuitBreaker('stripe',     { failureThreshold: 3 });
export const opensearchCircuit = new CircuitBreaker('opensearch', { failureThreshold: 5 });
```

```typescript
// Contoh penggunaan di payroll service
import { briapiCircuit } from '../../cache/circuit-breaker';

const result = await briapiCircuit.execute(
  // Fungsi utama — panggil BRIAPI
  () => briapi.transfer({ amount, accountNumber }),
  // Fallback — tambahkan ke antrian retry manual
  () => { throw new Error('BRIAPI_TEMPORARILY_UNAVAILABLE'); }
);
```

---

## 12. BACKEND — RATE LIMIT

```typescript
// src/middleware/rate-limiter.ts
import { Redis } from 'ioredis';
import { env }   from '../bootstrap/env-validation';

const redis = new Redis(env.REDIS_URL);

export const RATE_LIMITS = {
  'auth:login':          { windowMs: 15 * 60_000, max: 10  },
  'auth:register':       { windowMs: 60 * 60_000, max: 5   },
  'auth:otp-request':    { windowMs: 60_000,       max: 3   },
  'auth:otp-verify':     { windowMs: 15 * 60_000, max: 5   },
  'orders:create':       { windowMs: 60_000,       max: 10  },
  'wallet:topup':        { windowMs: 60 * 60_000, max: 20  },
  'feature-flags:fetch': { windowMs: 60_000,       max: 60  },
} as const;

type LimitKey = keyof typeof RATE_LIMITS;

function getClientIp(c: any): string | undefined {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    undefined
  );
}

export const rateLimiter = (key: LimitKey, by: 'ip' | 'userId' = 'ip') => {
  return async (c: any, next: any) => {
    const config = RATE_LIMITS[key];
    const id     = by === 'userId'
      ? (c.get('userId') ?? getClientIp(c))
      : getClientIp(c);

    if (!id) return c.json({ error: 'CANNOT_IDENTIFY_CLIENT' }, 400);

    const redisKey = `rl:${key}:${id}`;
    const windowSec = Math.floor(config.windowMs / 1000);

    const current = await redis.eval(
      `local n=redis.call('INCR',KEYS[1]) if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end return n`,
      1, redisKey, windowSec
    ) as number;

    c.header('X-RateLimit-Limit',     String(config.max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, config.max - current)));

    if (current > config.max) {
      c.header('Retry-After', String(windowSec));
      return c.json({
        error:   'RATE_LIMIT_EXCEEDED',
        message: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
      }, 429);
    }
    await next();
  };
};
```

---

## 13. BACKEND — MODUL PER FITUR

### middleware/auth.ts

```typescript
// src/middleware/auth.ts
import { verify, TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';
import { getCookie } from 'hono/cookie';
import { withRlsContext } from '../db/client';
import { env } from '../bootstrap/env-validation';

export const authMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, 'session_token');
  if (!token) return c.json({ error: 'UNAUTHORIZED' }, 401);

  try {
    const payload = verify(token, env.JWT_PUBLIC_KEY, {
      algorithms: ['RS256'],
    }) as { sub: string; tenantId?: string; role: string };

    return withRlsContext({ userId: payload.sub, tenantId: payload.tenantId }, async () => {
      c.set('userId',   payload.sub);
      c.set('tenantId', payload.tenantId);
      c.set('role',     payload.role);
      await next();
    });
  } catch (err) {
    if (err instanceof TokenExpiredError) return c.json({ error: 'TOKEN_EXPIRED' }, 401);
    if (err instanceof JsonWebTokenError) return c.json({ error: 'TOKEN_INVALID' }, 401);
    throw err;
  }
};
```

### Wallet Service

```typescript
// src/modules/wallet/wallet.service.ts
import { withRlsContext, prismaApp } from '../../db/client';
import { cache, CACHE_KEYS, CACHE_TTL } from '../../cache/redis';

const WALLET_MAX_BALANCE = BigInt(process.env.WALLET_MAX_BALANCE ?? '50000000');

export const walletService = {
  async initiateTopup(amount: number, method: string, userId: string, idempotencyKey: string) {
    const amountBigInt = BigInt(amount);
    return withRlsContext({ userId }, async () => {
      return prismaApp.$transaction(async (tx) => {
        const existing = await tx.walletTransaction.findFirst({ where: { idempotencyKey } });
        if (existing) return { data: existing, idempotent: true };

        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
        const record = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id, type: 'TOPUP_PENDING',
            amount: amountBigInt, balanceBefore: wallet.balance,
            balanceAfter: wallet.balance, status: 'PENDING',
            referenceType: method, idempotencyKey,
          },
        });
        return { data: record, idempotent: false };
      });
    });
  },

  async confirmTopup(referenceId: string, amount: number, userId: string, idempotencyKey: string) {
    const amountBigInt = BigInt(amount);
    return withRlsContext({ userId }, async () => {
      return prismaApp.$transaction(async (tx) => {
        const existing = await tx.walletTransaction.findFirst({
          where: { idempotencyKey, status: 'COMPLETED' },
        });
        if (existing) return { data: existing, idempotent: true };

        const rows = await tx.$queryRaw<[{ id: string; balance: bigint }]>`
          SELECT id, balance FROM wallets WHERE user_id = ${userId}::uuid FOR UPDATE
        `;
        if (!rows[0]) throw new Error('WALLET_NOT_FOUND');

        const wallet        = rows[0];
        const balanceBefore = wallet.balance;
        const balanceAfter  = balanceBefore + amountBigInt;

        if (balanceAfter > WALLET_MAX_BALANCE) throw new Error('WALLET_MAX_BALANCE_EXCEEDED');

        const affected = await tx.$executeRaw`
          UPDATE wallets SET balance = balance + ${amountBigInt}, updated_at = NOW()
          WHERE id = ${wallet.id}::uuid AND balance + ${amountBigInt} <= ${WALLET_MAX_BALANCE}
        `;
        if (affected === 0) throw new Error('WALLET_MAX_BALANCE_EXCEEDED');

        const record = await tx.walletTransaction.upsert({
          where:  { idempotencyKey },
          create: {
            walletId: wallet.id, type: 'TOPUP', amount: amountBigInt,
            balanceBefore, balanceAfter, status: 'COMPLETED', referenceId, idempotencyKey,
          },
          update: { status: 'COMPLETED', balanceBefore, balanceAfter, referenceId },
        });

        // Invalidate wallet balance cache
        await cache.del(CACHE_KEYS.walletBalance(userId));

        return { data: record, idempotent: false };
      });
    });
  },
};
```

### Orders Service

```typescript
// src/modules/orders/orders.service.ts
import { z } from 'zod';
import { withRlsContext, prismaApp } from '../../db/client';

export const CreateOrderSchema = z.object({
  serviceId: z.string().uuid(),
  quantity:  z.number().int().positive(),
  notes:     z.string().max(500).optional(),
});

export const ordersService = {
  async createOrder(rawBody: unknown, userId: string, tenantId: string, idempotencyKey: string) {
    const body = CreateOrderSchema.parse(rawBody);

    return withRlsContext({ userId, tenantId }, async () => {
      return prismaApp.$transaction(async (tx) => {
        const existing = await tx.order.findFirst({ where: { idempotencyKey } });
        if (existing) return { data: existing, idempotent: true };

        const service = await tx.service.findUniqueOrThrow({
          where: { id: body.serviceId, tenantId },
          select: { id: true, name: true, price: true, isActive: true },
        });
        if (!service.isActive) throw new Error('SERVICE_INACTIVE');

        const totalAmount = service.price * BigInt(body.quantity);

        const order = await tx.order.create({
          data: {
            userId, tenantId, serviceId: body.serviceId,
            quantity: body.quantity, totalAmount,
            notes: body.notes ?? '', idempotencyKey, status: 'PENDING',
            items: {
              create: [{
                serviceId: service.id, serviceName: service.name,
                quantity: body.quantity, unitPrice: service.price,
                subtotal: totalAmount,
              }],
            },
          },
          include: { items: true },
        });

        return { data: order, idempotent: false };
      });
    });
  },
};
```

### Webhook Handler

```typescript
// src/middleware/webhook-auth.ts
import { createHmac, timingSafeEqual } from 'crypto';

const PII_FIELDS: Record<string, string[]> = {
  SHOPEE:    ['recipient_name','recipient_address','recipient_phone','buyer_username','buyer_phone'],
  TOKOPEDIA: ['buyer_name','buyer_phone','receiver_name','receiver_phone','receiver_address_full'],
  TIKTOK:    ['recipient_address','buyer_info','contact_name','contact_phone','full_address'],
};

function sanitizePayload(payload: Record<string, unknown>, provider: string) {
  const strip = new Set((PII_FIELDS[provider] ?? []).map(f => f.toLowerCase()));
  function deep(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(deep);
    if (obj && typeof obj === 'object')
      return Object.fromEntries(
        Object.entries(obj as Record<string, unknown>)
          .filter(([k]) => !strip.has(k.toLowerCase()))
          .map(([k, v]) => [k, deep(v)])
      );
    return obj;
  }
  return deep(payload) as Record<string, unknown>;
}

export const verifyMarketplaceWebhook = (provider: 'SHOPEE' | 'TOKOPEDIA' | 'TIKTOK') => {
  return async (c: any, next: any) => {
    const rawBody  = await c.req.text();
    const received = c.req.header('X-Webhook-Signature') ?? '';
    const secret   = process.env[`WEBHOOK_SECRET_${provider}`]!;

    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody); }
    catch { return c.json({ error: 'INVALID_WEBHOOK_PAYLOAD' }, 400); }

    const ts = body['timestamp'] as number | undefined;
    if (typeof ts !== 'number') return c.json({ error: 'MISSING_TIMESTAMP_FIELD' }, 400);
    if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300)
      return c.json({ error: 'WEBHOOK_TIMESTAMP_EXPIRED' }, 401);

    if (!/^[0-9a-f]{64}$/i.test(received))
      return c.json({ error: 'INVALID_WEBHOOK_SIGNATURE' }, 401);

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex')))
      return c.json({ error: 'INVALID_WEBHOOK_SIGNATURE' }, 401);

    c.set('verifiedBody',     body);
    c.set('sanitizedPayload', sanitizePayload(body, provider));
    await next();
  };
};
```

### Sentry Error Handler

```typescript
// src/middleware/sentry.ts
import * as Sentry from '@sentry/node';
import { env } from '../bootstrap/env-validation';

export function initSentry() {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN, environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      if (event.request?.cookies)  delete event.request.cookies;
      if (event.request?.data)     event.request.data = '[Body Redacted]';
      if (event.user?.ip_address)  delete event.user.ip_address;
      if (event.request?.headers?.['authorization'])
        event.request.headers['authorization'] = '[Redacted]';
      return event;
    },
    integrations: [Sentry.httpIntegration(), Sentry.prismaIntegration()],
  });
}

export const globalErrorHandler = async (err: Error, c: any) => {
  const isProd = env.NODE_ENV === 'production';

  Sentry.captureException(err, {
    tags: { path: c.req.path, method: c.req.method, role: c.get('role') ?? 'anon' },
    user: { id: c.get('userId') ?? 'anonymous' },
    level: err.message.includes('[RLS VIOLATION]') ? 'fatal' : 'error',
  });

  const errorMap: Record<string, [number, string]> = {
    'STOCK_INSUFFICIENT':           [409, 'Stok tidak mencukupi.'],
    'STOCK_DEPLETED_CONCURRENT':    [409, 'Stok habis saat proses.'],
    'SERVICE_INACTIVE':             [400, 'Layanan tidak tersedia.'],
    'OTP_MAX_ATTEMPTS_EXCEEDED':    [429, 'Terlalu banyak percobaan. Minta OTP baru.'],
    'OTP_INVALID':                  [400, 'Kode OTP salah.'],
    'WALLET_MAX_BALANCE_EXCEEDED':  [400, 'Saldo melebihi batas maksimal wallet.'],
    'WALLET_NOT_FOUND':             [404, 'Wallet tidak ditemukan.'],
    'REFRESH_TOKEN_REUSE_DETECTED': [401, 'Sesi diakhiri karena aktivitas mencurigakan.'],
    'REFRESH_TOKEN_INVALID':        [401, 'Sesi tidak valid.'],
    'REFRESH_TOKEN_EXPIRED':        [401, 'Sesi kadaluarsa.'],
    'EMAIL_ALREADY_REGISTERED':     [409, 'Email sudah terdaftar.'],
    'ACCOUNT_SUSPENDED':            [403, 'Akun Anda dinonaktifkan.'],
    'GOOGLE_TOKEN_INVALID':         [401, 'Token Google tidak valid.'],
    'GOOGLE_EMAIL_MISSING':         [400, 'Email tidak tersedia dari Google.'],
    'BRIAPI_TEMPORARILY_UNAVAILABLE':[503, 'Layanan transfer sedang tidak tersedia.'],
    'SERVICE_UNAVAILABLE':          [503, 'Layanan eksternal sedang gangguan.'],
  };

  if (err.message in errorMap) {
    const [status, message] = errorMap[err.message];
    return c.json({ success: false, error: err.message, message }, status);
  }
  if (err.message.includes('[RLS VIOLATION]'))
    return c.json({ success: false, error: 'FORBIDDEN' }, 403);

  if ('code' in err) {
    const p = err as { code: string };
    if (p.code === 'P2002') return c.json({ success: false, error: 'DUPLICATE_ENTRY' }, 409);
    if (p.code === 'P2025') return c.json({ success: false, error: 'NOT_FOUND' }, 404);
  }

  return c.json({
    success: false, error: 'INTERNAL_SERVER_ERROR',
    message: isProd ? 'Terjadi kesalahan. Silakan coba lagi.' : err.message,
    ...(isProd ? {} : { stack: err.stack }),
  }, 500);
};
```

---

## 14. FRONTEND — NEXT.JS (cariin-web)

### middleware.ts — CSP dengan Nonce

```typescript
// apps/cariin-web/src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export function middleware(request: NextRequest) {
  const nonce = randomBytes(16).toString('base64');

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: https://*.r2.cloudflarestorage.com https://pub-*.r2.dev https://lh3.googleusercontent.com`,
    `connect-src 'self' https://api.cariin.id wss://api.cariin.id`,
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');

  const res = NextResponse.next({
    request: { headers: new Headers(request.headers) },
  });
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.headers.set('X-Frame-Options',          'DENY');
  res.headers.set('X-Content-Type-Options',   'nosniff');
  res.headers.set('Referrer-Policy',          'strict-origin-when-cross-origin');
  res.headers.set('X-Nonce', nonce);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### Feature Flags Hook — SSE

```typescript
// packages/ui/src/hooks/useFeatureFlags.ts
'use client';
import { useState, useEffect, useRef } from 'react';
import { cariinApi } from '@cariin/http-client';

const DEFAULT_FLAGS = {
  RIDE_HAILING_ENABLED:   false,
  CAR_BOOKING_ENABLED:    false,
  FOOD_DELIVERY_ENABLED:  false,
  CRYPTO_PAYMENT_ENABLED: false,
};
const CACHE_MS = 60_000;

export function useFeatureFlags() {
  const [flags, setFlags] = useState(DEFAULT_FLAGS);
  const lastFetch = useRef(0);

  const fetchFlags = async () => {
    if (Date.now() - lastFetch.current < CACHE_MS) return;
    lastFetch.current = Date.now();
    try {
      const res = await cariinApi.get('api/feature-flags').json<{ flags: typeof DEFAULT_FLAGS }>();
      setFlags(res.flags);
    } catch { /* pertahankan default */ }
  };

  useEffect(() => {
    fetchFlags();
    const sse = new EventSource('/api/feature-flags/stream', { withCredentials: true });
    sse.addEventListener('FLAGS_UPDATED', () => { lastFetch.current = 0; fetchFlags(); });
    sse.onerror = () => setTimeout(fetchFlags, 30_000);
    return () => sse.close();
  }, []);

  return flags;
}
```

### HTTP Client — cariinApi

```typescript
// packages/http-client/src/client.ts
import ky from 'ky';

export const cariinApi = ky.create({
  prefixUrl:   process.env.NEXT_PUBLIC_API_URL,
  credentials: 'include',
  headers:     { 'X-Cariin-Client': 'true', 'X-API-Version': 'v1' },
  hooks: {
    afterResponse: [(_req, _opts, res) => {
      if (res.headers.get('X-API-Deprecated') === 'true')
        console.warn('[API DEPRECATED]', res.url);
      return res;
    }],
    beforeError: [(err) => {
      if (err.response?.status === 429)
        console.warn('[RATE LIMIT]', err.response.headers.get('Retry-After'));
      return err;
    }],
  },
});
```

---

## 15. FRONTEND — VITE SPA (POS Kasir)

### Offline Sync — IndexedDB + Service Worker

```typescript
// apps/cuciku-dashboard/src/lib/sync-manager.ts
interface PendingTx {
  id:         string;
  payload:    { serviceId: string; quantity: number; notes?: string };
  retryCount: number;
  createdAt:  number;
}

export async function syncPendingTransactions() {
  const db = await openIndexedDB();
  const pending: PendingTx[] = await db.getAll('pendingTransactions');

  for (const tx of pending) {
    try {
      const res = await fetch('/api/orders/create', {
        method:      'POST',
        headers:     {
          'Content-Type':      'application/json',
          'X-Cariin-Client':   'true',
          'X-Idempotency-Key': tx.id,
        },
        credentials: 'include',
        body:        JSON.stringify(tx.payload),
      });

      if (res.ok) {
        await db.delete('pendingTransactions', tx.id);
      } else if (res.status === 409) {
        const err = await res.json();
        await db.put('failedTransactions', { ...tx, reason: err.error });
        await db.delete('pendingTransactions', tx.id);
      } else if (res.status >= 500 && tx.retryCount < 3) {
        await db.put('pendingTransactions', { ...tx, retryCount: tx.retryCount + 1 });
      }
    } catch { /* masih offline — skip */ }
  }
}

window.addEventListener('online', syncPendingTransactions);
```

---

## 16. ATURAN KEAMANAN — 25 LARANGAN MUTLAK

| # | JANGAN PERNAH | KENAPA |
|---|---------------|--------|
| 1 | `localStorage.setItem('token', ...)` | XSS bisa curi token |
| 2 | `createHash('sha256').update(otp)` | SHA-256 brute-forceable dalam milidetik |
| 3 | `process.env.JWT_SECRET!` non-null assertion | `undefined` saat env tidak di-set |
| 4 | `sign(payload, secret, { algorithm: 'HS256' })` | Symmetric key, pakai RS256 |
| 5 | `$executeRawUnsafe(...)` | Menonaktifkan injection protection |
| 6 | Query model SCOPED tanpa `withRlsContext()` | RLS tidak aktif, data bocor antar user |
| 7 | Harga / totalAmount dari client request | Client bisa kirim Rp 1 |
| 8 | `cors()` bukan middleware pertama di app.ts | Preflight OPTIONS gagal |
| 9 | `CF-Connecting-IP` tanpa fallback chain | Crash di dev/staging tanpa Cloudflare |
| 10 | Webhook tanpa timestamp check | Replay attack bisa ulang transaksi lama |
| 11 | `timingSafeEqual` tanpa hex format guard | Runtime crash saat signature malformed |
| 12 | Side effect (WhatsApp, email) di dalam `$transaction` | Timeout → rollback operasi bisnis |
| 13 | Model SCOPED tanpa SQL RLS policy | Config di-set tapi tidak ada yang enforce |
| 14 | `GRANT ON ALL TABLES` tanpa `DEFAULT PRIVILEGES` | Tabel baru tidak dapat permission |
| 15 | Sentry tanpa `beforeSend` PII strip | Nama, alamat, HP customer terkirim ke Sentry |
| 16 | `'unsafe-inline'` di `script-src` atau `style-src` | XSS dan CSS injection |
| 17 | `<meta httpEquiv="Content-Security-Policy">` di layout | `frame-ancestors` tidak berlaku via meta |
| 18 | Nested `$transaction` dengan isolation level berbeda | PostgreSQL conflict isolation error |
| 19 | Operasi concurrent: `SELECT → check → UPDATE` terpisah | Race condition |
| 20 | Prisma `@@unique([email])` di model dengan soft-delete | Blokir re-registrasi email lama |
| 21 | Google OAuth callback tanpa validasi `state` parameter | CSRF pada OAuth flow |
| 22 | Simpan Google `access_token` di DB tanpa enkripsi | Eksposur token pihak ketiga |
| 23 | Cache wallet balance > 60 detik | Data keuangan basi → kesalahan tampilan saldo |
| 24 | Circuit breaker dinonaktifkan di production | Cascade failure saat 1 service down |
| 25 | `/health/ready` tanpa timeout DB check | Health check hang → load balancer stuck |

---

## 17. CHECKLIST PRE-COMMIT

```
DATABASE & RLS:
[ ] Semua query USER/TENANT_SCOPED dalam withRlsContext()?
[ ] Tidak ada $executeRawUnsafe?
[ ] Semua concurrent operation pakai atomic SQL?
[ ] prismaAuth digunakan untuk OtpCode, RefreshToken, OAuthAccount?
[ ] Tidak ada nested $transaction dengan isolation level berbeda?

AUTH & TOKEN:
[ ] OTP di-hash bcrypt rounds=10?
[ ] JWT pakai RS256?
[ ] Token tidak di localStorage?
[ ] tokenService.rotate() dipakai untuk refresh?
[ ] Google OAuth callback ada validasi code sebelum exchange?
[ ] Password hash pakai bcrypt rounds=12?

API SECURITY:
[ ] Env vars divalidasi di env-validation.ts?
[ ] CORS middleware posisi PERTAMA di app.ts?
[ ] initSentry() dipanggil SEBELUM semua middleware?
[ ] app.onError(globalErrorHandler) PALING AKHIR?
[ ] Rate limiter pakai fallback chain IP?
[ ] Webhook: timestamp check + hex guard + timingSafeEqual?
[ ] Harga dihitung server (bukan dari body request)?
[ ] Body size limit 1 MB aktif?

CACHE:
[ ] Wallet balance cache TTL ≤ 30 detik?
[ ] Cache diinvalidasi setelah setiap transaksi wallet?
[ ] Feature flag cache TTL 300 detik + SSE invalidation?
[ ] Cache read selalu ada fallback ke DB jika miss?

FALLBACK & HEALTH:
[ ] GET /health mengembalikan uptime + version?
[ ] GET /health/ready cek DB + Redis?
[ ] External service calls (BRIAPI, WhatsApp) pakai circuit breaker?
[ ] Circuit breaker konfigurasi realistis (threshold, window, halfOpen)?

FRONTEND:
[ ] middleware.ts ada dengan nonce generation per-request?
[ ] Tidak ada 'unsafe-inline' di CSP?
[ ] img-src include lh3.googleusercontent.com untuk Google avatar?
[ ] HSTS header ada?
[ ] Semua request melalui cariinApi client?
```

---

## 18. TESTING WAJIB SEBELUM DEPLOY

```bash
# 1. Auth Flow — Register → OTP → Login
curl -X POST https://api.cariin.id/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","fullName":"Test User"}'
# Harus: {"success":true,"message":"Kode OTP dikirim..."}

# 2. Anti-enumeration — email tidak ada harus return 200
curl -X POST https://api.cariin.id/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nonexistent@example.com"}'
# Harus: {"success":true,"message":"Jika email terdaftar..."}

# 3. Google OAuth redirect
curl -I https://api.cariin.id/v1/auth/google
# Harus: Location: https://accounts.google.com/...

# 4. Health check
curl https://api.cariin.id/health
# Harus: {"status":"ok","uptime":...,"version":"2.0.0",...}

# 5. Readiness check
curl https://api.cariin.id/health/ready
# Harus: {"status":"ready","checks":{"database":"ok","redis":"ok"},...}

# 6. Rate limit — login 11x harus blocked
for i in {1..11}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://api.cariin.id/v1/auth/login \
    -d '{"email":"test@example.com"}'
done
# Request ke-11 harus: 429

# 7. RLS Isolation — harus THROW
node -e "
  const {prismaApp}=require('./dist/db/client');
  prismaApp.wallet.findMany()
    .then(()=>console.error('FAIL: lolos tanpa context!'))
    .catch(e=>console.log('PASS:',e.message));
"

# 8. OTP Max Attempts — 5x salah harus blocked
# Kirim 6 request verify OTP dengan kode salah → ke-6 harus OTP_MAX_ATTEMPTS_EXCEEDED

# 9. Refresh Token Reuse — harus SESSION_COMPROMISED
TOKEN=$(curl -s -X POST /v1/auth/refresh -b "refresh_token=XXX" | jq -r .refreshToken)
curl -X POST /v1/auth/refresh -b "refresh_token=XXX"
# Harus: {"error":"REFRESH_TOKEN_REUSE_DETECTED"}

# 10. CORS — origin asing harus diblokir
curl -I -H "Origin: https://evil.com" https://api.cariin.id/v1/health
# Tidak boleh ada Access-Control-Allow-Origin

# 11. Webhook Replay — harus 401
curl -X POST https://api.cariin.id/v1/webhooks/shopee \
  -d '{"timestamp":1000,"event_type":"test"}'
# Harus: {"error":"WEBHOOK_TIMESTAMP_EXPIRED"}

# 12. HSTS Header
curl -I https://cariin.id | grep Strict-Transport
# Harus: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload

# 13. CSP Nonce — harus berbeda setiap request
N1=$(curl -s https://cariin.id | grep -o "nonce-[^']*" | head -1)
N2=$(curl -s https://cariin.id | grep -o "nonce-[^']*" | head -1)
[ "$N1" != "$N2" ] && echo "PASS: nonce unik" || echo "FAIL: nonce statis!"

# 14. Circuit breaker — simulasi BRIAPI down
# Hit BRIAPI endpoint 5x dengan payload error → cek apakah circuit terbuka
# Request ke-6 harus: {"error":"SERVICE_UNAVAILABLE"}

# 15. Wallet concurrent credit — balance harus konsisten
# Kirim 20 topup confirm serentak → balance akhir harus akurat
```

---

## 19. BACKEND — MODUL LANJUTAN

### Payroll Service — 4-Eyes Approval

```typescript
// src/modules/payroll/payroll.service.ts
export const payrollService = {
  async generateDraft(tenantId: string, periodLabel: string) {
    return withRlsContext({ tenantId }, async () => {
      return prismaApp.$transaction(async (tx) => {
        const existing = await tx.payrollBatch.findFirst({
          where: { tenantId, periodLabel },
        });
        if (existing) throw new Error('PAYROLL_ALREADY_GENERATED');

        return tx.payrollBatch.create({
          data: { tenantId, periodLabel, status: 'DRAFT', totalAmount: BigInt(0) },
        });
      });
    });
  },

  async submitForApproval(batchId: string, tenantId: string, ownerId: string) {
    return withRlsContext({ tenantId }, async () => {
      return prismaApp.$transaction(async (tx) => {
        await tx.payrollBatch.findUniqueOrThrow({
          where: { id: batchId, tenantId, status: 'DRAFT' },
        });
        return tx.payrollBatch.update({
          where: { id: batchId },
          data:  { status: 'PENDING_APPROVAL', reviewedByOwner: ownerId },
        });
      });
    });
  },

  async approveByFinance(batchId: string, tenantId: string, financeAdminId: string) {
    const DAILY_LIMIT = BigInt(process.env.PAYROLL_DAILY_LIMIT ?? '500000000');
    return withRlsContext({ tenantId }, async () => {
      return prismaApp.$transaction(async (tx) => {
        const batch = await tx.payrollBatch.findUniqueOrThrow({
          where: { id: batchId, tenantId, status: 'PENDING_APPROVAL' },
        });
        if (batch.totalAmount > DAILY_LIMIT) throw new Error('PAYROLL_EXCEEDS_DAILY_LIMIT');
        return tx.payrollBatch.update({
          where: { id: batchId },
          data:  { status: 'APPROVED', approvedByFinance: financeAdminId, approvedAt: new Date() },
        });
      });
    });
  },
};
```

### BullMQ Jobs

```typescript
// src/jobs/marketplace-sync.job.ts
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

export const marketplaceSyncQueue = new Queue('marketplace-sync', { connection: redis });
export const payrollQueue          = new Queue('payroll',          { connection: redis });
export const notificationQueue     = new Queue('notifications',    { connection: redis });

new Worker('marketplace-sync', async (job) => {
  const { productId, newStock, channels } = job.data;
  for (const channel of channels) {
    await updateStockOnMarketplace(channel, productId, newStock);
  }
}, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  },
});

new Worker('notifications', async (job) => {
  const { userId, otp } = job.data;
  // TODO: WhatsApp / SMS integration
  console.log(`[NOTIFICATION] Kirim OTP ${otp} ke userId ${userId}`);
}, { connection: redis });
```

### Feature Flag Service

```typescript
// src/modules/feature-flags/feature-flags.service.ts
import { cache, CACHE_KEYS, CACHE_TTL } from '../../cache/redis';
import { redis } from '../../cache/redis';

const DEFAULT_FLAGS = {
  RIDE_HAILING_ENABLED:   false,
  CAR_BOOKING_ENABLED:    false,
  FOOD_DELIVERY_ENABLED:  false,
  CRYPTO_PAYMENT_ENABLED: false,
};

export const featureFlagService = {
  async getFlags(): Promise<typeof DEFAULT_FLAGS> {
    const cached = await cache.get<typeof DEFAULT_FLAGS>(CACHE_KEYS.featureFlags());
    if (cached) return cached;

    const flags = await prismaApp.featureFlag.findMany();
    const map   = { ...DEFAULT_FLAGS };
    for (const f of flags) {
      if (f.key in map) (map as any)[f.key] = f.isEnabled;
    }

    await cache.set(CACHE_KEYS.featureFlags(), map, CACHE_TTL.featureFlags);
    return map;
  },

  async setFlag(key: string, value: boolean): Promise<void> {
    await prismaApp.featureFlag.upsert({
      where:  { key },
      create: { key, isEnabled: value },
      update: { isEnabled: value },
    });
    await cache.del(CACHE_KEYS.featureFlags());
    await redis.publish('feature_flags:updated', JSON.stringify({ key, value }));
  },
};
```

---

## 20. INFRASTRUKTUR — KONFIGURASI LENGKAP

### Nginx — VPS 2 (Backend)

```nginx
# /etc/nginx/conf.d/api.cariin.conf

server {
    listen 80;
    server_name api.cariin.id;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.cariin.id;

    ssl_certificate     /etc/ssl/certs/cariin.crt;
    ssl_certificate_key /etc/ssl/private/cariin.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options           "DENY"                            always;
    add_header X-Content-Type-Options    "nosniff"                         always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;

    # Rate limit Nginx (layer sebelum app)
    limit_req_zone $binary_remote_addr zone=api:10m rate=100r/m;
    limit_req zone=api burst=20 nodelay;

    location / {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_buffering    off;
    }

    # Health check — tidak di-rate-limit
    location /health {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        limit_req          off;
    }

    # SSE — timeout panjang
    location /api/feature-flags/stream {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Connection "";
        proxy_read_timeout 600s;
        proxy_buffering    off;
        proxy_cache        off;
    }
}
```

### Nginx — VPS 1 (Frontend)

```nginx
# /etc/nginx/conf.d/frontend.cariin.conf

server {
    listen 443 ssl http2;
    server_name cariin.id www.cariin.id;

    # ssl config sama ...

    # cariin-web Next.js (port 3000)
    location / {
        proxy_pass       http://127.0.0.1:3000;
        proxy_set_header Host      $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Cache untuk static assets Next.js
        location ~* \.(js|css|woff2|png|jpg|ico)$ {
            proxy_pass          http://127.0.0.1:3000;
            proxy_cache_valid   200 1d;
            add_header          Cache-Control "public, max-age=86400";
        }
    }

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    gzip_min_length 1000;
}
```

### pgBouncer — VPS 3

```ini
# /etc/pgbouncer/pgbouncer.ini
[databases]
cariin_db = host=127.0.0.1 port=5432 dbname=cariin_db

[pgbouncer]
listen_port          = 6432
listen_addr          = VPS3_PRIVATE_IP

# WAJIB Transaction Mode untuk RLS
pool_mode            = transaction

max_client_conn      = 200
default_pool_size    = 20
reserve_pool_size    = 5
reserve_pool_timeout = 3

server_idle_timeout  = 600
client_idle_timeout  = 0
server_connect_timeout = 15

auth_type            = scram-sha-256
auth_file            = /etc/pgbouncer/userlist.txt

log_connections      = 0
log_disconnections   = 0
log_pooler_errors    = 1
```

### Redis — VPS 2

```conf
# /etc/redis/redis.conf
requirepass GANTI_DENGAN_PASSWORD_KUAT_MIN_32_CHAR

rename-command FLUSHALL ""
rename-command FLUSHDB  ""
rename-command CONFIG   ""
rename-command SHUTDOWN ""

appendonly    yes
appendfsync   everysec

maxmemory        2gb
maxmemory-policy allkeys-lru

bind 127.0.0.1
protected-mode yes
```

### OpenSearch — VPS 4 (Phase 2, aktifkan jika >500 tenant aktif)

```yaml
# /etc/opensearch/opensearch.yml
cluster.name: cariin-search
node.name: cariin-node-1
path.data: /var/lib/opensearch
path.logs: /var/log/opensearch

network.host: VPS4_PRIVATE_IP
http.port: 9200

discovery.type: single-node  # Phase 2 single node

plugins.security.disabled: false
plugins.security.ssl.transport.pemcert_filepath: esnode.pem
plugins.security.ssl.transport.pemkey_filepath: esnode-key.pem
plugins.security.ssl.http.enabled: true
```

```typescript
// src/modules/search/search.service.ts (Phase 2)
import { Client } from '@opensearch-project/opensearch';
import { opensearchCircuit } from '../../cache/circuit-breaker';
import { env } from '../../bootstrap/env-validation';

const searchClient = env.OPENSEARCH_URL
  ? new Client({
      node: env.OPENSEARCH_URL,
      auth: { username: env.OPENSEARCH_USERNAME!, password: env.OPENSEARCH_PASSWORD! },
    })
  : null;

export const searchService = {
  async searchProducts(query: string, tenantId: string, page = 1, limit = 20) {
    if (!searchClient) {
      // Fallback ke PostgreSQL full-text search jika OpenSearch belum ada
      return postgresFullTextSearch(query, tenantId, page, limit);
    }

    return opensearchCircuit.execute(
      () => searchClient.search({
        index: `products_${tenantId}`,
        body: {
          from:  (page - 1) * limit,
          size:  limit,
          query: {
            multi_match: {
              query,
              fields: ['name^3', 'description', 'category'],
              fuzziness: 'AUTO',
            },
          },
        },
      }),
      // Fallback ke PostgreSQL jika OpenSearch down
      () => postgresFullTextSearch(query, tenantId, page, limit)
    );
  },
};

async function postgresFullTextSearch(query: string, tenantId: string, page: number, limit: number) {
  return prismaApp.service.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: [
        { name:        { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    },
    skip:  (page - 1) * limit,
    take:  limit,
  });
}
```

---

## 21. BACKUP & DISASTER RECOVERY

### Recovery Targets

| Metrik | Target |
|:-------|:-------|
| **RTO** (Recovery Time Objective) | < 4 jam |
| **RPO** (Recovery Point Objective) | < 1 jam |

### Backup Otomatis (cron harian jam 02:00 WIB)

```bash
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="cariin_db_${TIMESTAMP}.dump"

pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --dbname=$DATABASE_URL \
  --file="/tmp/${BACKUP_FILE}"

rclone copy "/tmp/${BACKUP_FILE}" r2:cariin-db-backups/daily/
rm "/tmp/${BACKUP_FILE}"
rclone delete r2:cariin-db-backups/daily/ --min-age 30d

echo "[$(date)] Backup ${BACKUP_FILE} selesai"
```

### Monitoring Alert

| Kondisi | Threshold | Aksi |
|:--------|:----------|:-----|
| Backup harian gagal | 1x kegagalan | Alert DevOps |
| Disk usage VPS DB | > 80% | Warning; > 90% = Critical |
| PostgreSQL connections | > 80% max_connections | Scale pgBouncer pool |
| Redis memory | > 75% maxmemory | Review eviction policy |
| Circuit breaker open | Setiap kejadian | Alert ke on-call |
| RLS VIOLATION | Setiap kejadian | Alert CRITICAL ke CTO |
| Payroll transfer failure | Setiap kejadian | Alert Finance Admin |
| Health /ready mengembalikan 503 | > 2 menit | Restart app server |

---

## 22. KONVENSI KODE

```typescript
// ✅ WAJIB: strict mode ON
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist"
  }
}
```

**Penamaan:**
- File: `kebab-case.ts` → `otp.service.ts`
- Class/Type: `PascalCase` → `WalletService`
- Fungsi/variabel: `camelCase` → `getBalance()`
- Konstanta env: `SCREAMING_SNAKE_CASE`
- DB table: `snake_case`
- DB column: `snake_case` via `@map`

**Error Response:**
```typescript
{ "success": false, "error": "ERROR_CODE", "message": "Pesan Bahasa Indonesia" }
{ "success": true,  "data": {...}, "idempotent": false }
```

**Template Modul Baru:**
```
src/modules/[nama]/
├── [nama].types.ts
├── [nama].schema.ts
├── [nama].service.ts
├── [nama].controller.ts
└── [nama].router.ts
```

---

## 23. STANDAR ERROR CODES LENGKAP

```typescript
// AUTH
'UNAUTHORIZED'               // Tidak ada session → redirect ke /login
'TOKEN_EXPIRED'              // Access token expired → client refresh
'TOKEN_INVALID'              // Token rusak/tampered
'SESSION_COMPROMISED'        // Refresh token reuse → logout paksa
'REFRESH_TOKEN_INVALID'      // Refresh token tidak dikenali
'REFRESH_TOKEN_EXPIRED'      // Refresh token kadaluarsa
'REFRESH_TOKEN_MISSING'      // Cookie refresh_token tidak ada

// REGISTER & LOGIN
'EMAIL_ALREADY_REGISTERED'   // Email aktif sudah terdaftar
'USER_NOT_FOUND'             // Email tidak ditemukan
'ACCOUNT_SUSPENDED'          // Akun dinonaktifkan admin

// OTP
'OTP_MAX_ATTEMPTS_EXCEEDED'  // 5x salah → minta OTP baru
'OTP_INVALID'                // Kode salah tapi masih dalam limit
'OTP_EXPIRED'                // OTP sudah lewat 5 menit

// GOOGLE OAUTH
'GOOGLE_AUTH_CANCELLED'      // User cancel di halaman Google
'GOOGLE_AUTH_FAILED'         // Exchange code gagal
'GOOGLE_TOKEN_INVALID'       // ID token Google tidak valid
'GOOGLE_EMAIL_MISSING'       // Google tidak return email

// WALLET
'WALLET_NOT_FOUND'            // User belum punya wallet
'WALLET_MAX_BALANCE_EXCEEDED' // Balance akan melebihi Rp 50 juta
'TOPUP_ALREADY_PROCESSED'    // Idempotency: topup sudah diproses

// ORDERS & INVENTORY
'STOCK_INSUFFICIENT'          // Stok kurang dari qty
'STOCK_DEPLETED_CONCURRENT'   // Race: stok habis saat processing
'SERVICE_INACTIVE'            // Layanan dinonaktifkan mitra
'DUPLICATE_ORDER'             // Idempotency: order sudah ada

// PAYROLL
'PAYROLL_ALREADY_GENERATED'   // Draft sudah ada untuk period ini
'PAYROLL_EXCEEDS_DAILY_LIMIT' // Total > Rp 500 juta
'PAYROLL_WRONG_STATUS'        // Status tidak sesuai urutan

// WEBHOOK
'WEBHOOK_TIMESTAMP_EXPIRED'   // Timestamp > 5 menit lalu
'INVALID_WEBHOOK_SIGNATURE'   // HMAC tidak cocok
'MISSING_TIMESTAMP_FIELD'     // Payload tidak punya timestamp

// EXTERNAL SERVICES
'BRIAPI_TEMPORARILY_UNAVAILABLE' // Circuit breaker open
'SERVICE_UNAVAILABLE'            // External service down

// GENERAL
'NOT_FOUND'                   // Data tidak ditemukan (P2025)
'DUPLICATE_ENTRY'             // Unique constraint (P2002)
'RATE_LIMIT_EXCEEDED'         // Terlalu banyak request
'PAYLOAD_TOO_LARGE'           // Body > 1 MB
'CANNOT_IDENTIFY_CLIENT'      // Tidak bisa deteksi IP
'INTERNAL_SERVER_ERROR'       // Generic, detail hidden di production
'FORBIDDEN'                   // RLS violation atau role tidak cukup
```

---

*PRD Cariin Super-App v2.0 — Monolith Edition*
*Arsitektur: Monolith | Skala: 1–1.000 Tenant/Mitra | Infrastruktur: 3 VPS*
*23 Seksi | Auth Lengkap: Login · Register · Lupa Password · Google OAuth*
*Sistem Baru: Cache Strategy · Health Check · Circuit Breaker · OpenSearch (Phase 2)*
*Untuk skala 1.000+ tenant → gunakan prd-microservices-1000-plus-tenant.md*
