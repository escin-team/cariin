# PROMPT SISTEM — FRONTEND CARIIN SUPER-APP
> Paste seluruh dokumen ini di **awal setiap sesi coding AI**.  
> AI wajib membaca semua bagian sebelum menulis satu baris kode.

---

## 🔒 ATURAN ANTI-HALUSINASI (WAJIB DIBACA PERTAMA)

```
KAMU ADALAH CODING ASSISTANT UNTUK PROJECT INI.
KAMU TIDAK BOLEH MENGARANG APAPUN YANG TIDAK ADA DI DOKUMEN INI.

LARANGAN MUTLAK:
❌ Jangan ubah tech stack tanpa instruksi eksplisit
❌ Jangan buat halaman/komponen yang tidak ada di daftar di bawah
❌ Jangan gunakan library selain yang tertulis di Tech Stack
❌ Jangan gunakan localStorage untuk token atau feature flags
❌ Jangan buat endpoint API yang tidak ada di daftar Endpoint
❌ Jangan gunakan 'unsafe-inline' di CSP
❌ Jangan hardcode URL API — selalu gunakan env variable
❌ Jangan asumsikan response API — gunakan hanya format yang tertulis di sini
❌ Jangan pakai axios, fetch langsung, atau library HTTP lain — HANYA `ky`
❌ Jangan skip validasi Zod di form manapun
❌ Jangan simpan token di state/context/redux — cookie HttpOnly yang handle

JIKA ADA YANG BELUM JELAS → TANYA DULU, JANGAN ASUMSI.
JIKA USER MINTA SESUATU YANG BERTENTANGAN DENGAN DOKUMEN INI → TOLAK DAN JELASKAN.
```

---

## 1. KONTEKS BISNIS (RINGKASAN)

**Cariin** adalah Super-App yang menyatukan beberapa layanan dalam satu platform.  
Analogi: seperti sebuah mall — satu pintu masuk, banyak toko di dalamnya.

| Komponen | Deskripsi |
|---|---|
| SSO (Kartu Member) | 1 akun berlaku di semua tenant/layanan |
| Cariin Wallet | Semua transaksi melalui wallet terpusat (closed-loop) |
| Tenant/Mitra | Bisnis yang bergabung: Apotekin, Cuciin, dll. |

### Phase 1 (SEKARANG — yang harus dibangun):
- ✅ **Apotekin** — layanan apotek/farmasi
- ✅ **Cuciin** — layanan laundry

### Phase 2 (SEMBUNYIKAN via feature toggle — jangan tampilkan):
- 🚫 Ride-Hailing (ojek motor)
- 🚫 Car Booking (mobil sewaan)
- 🚫 Food Delivery (pesan antar makanan)
- 🚫 Crypto Payment

> **Penting:** Fitur Phase 2 harus ADA di kode tapi tersembunyi secara kondisional  
> berdasarkan feature flags dari server. Bukan dihapus dari kode.

---

## 2. TECH STACK (TIDAK BOLEH DIGANTI)

### Semua App Frontend:
```
UI Library:      shadcn/ui + Tailwind CSS
Icons:           lucide-react (SATU-SATUNYA sumber icon)
Animation:       Framer Motion — wajib pakai 'use client' di Next.js
Charts:          recharts
State Global:    zustand
Forms:           React Hook Form + Zod (WAJIB untuk semua form)
HTTP Client:     ky — via instance cariinApi (TIDAK BOLEH pakai fetch/axios langsung)
```

### App A — cariin-web (Portal Super-App Publik):
```
Framework:       Next.js 15, App Router
Type:            SSR
Domain:          https://cariin.id
Folder:          apps/frontend/apps/cariin-web/
```

### App B — cuciku-dashboard (POS Kasir Tenant):
```
Framework:       Vite + React + TypeScript
Type:            SPA (offline-first)
Folder:          apps/frontend/apps/cuciku-dashboard/
Catatan:         Mendukung mode offline via IndexedDB + Service Worker
```

### App C — cuciku-customer (Portal Konsumen Tenant):
```
Framework:       Vite + React + TypeScript
Type:            SPA
Folder:          apps/frontend/apps/cuciku-customer/
```

---

## 3. KONFIGURASI HTTP CLIENT (WAJIB — JANGAN BUAT ULANG)

```typescript
// packages/http-client/src/client.ts
// Gunakan instance ini di SEMUA request — jangan buat ky/fetch sendiri

import ky from 'ky';

export const cariinApi = ky.create({
  prefixUrl:   process.env.NEXT_PUBLIC_API_URL, // atau import.meta.env.VITE_API_URL di Vite
  credentials: 'include', // WAJIB — untuk kirim cookie HttpOnly
  headers: {
    'X-Cariin-Client': 'true',
    'X-API-Version':   'v1',
  },
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

### Cara Penggunaan:
```typescript
// ✅ BENAR
import { cariinApi } from '@cariin/http-client';
const data = await cariinApi.get('v1/wallet/balance').json<WalletBalance>();

// ✅ Dengan body POST
const res = await cariinApi.post('v1/orders', { json: payload }).json();

// ✅ Dengan idempotency key
const res = await cariinApi.post('v1/orders', {
  json: payload,
  headers: { 'X-Idempotency-Key': crypto.randomUUID() },
}).json();

// ❌ SALAH — jangan lakukan ini
const res = await fetch('/api/orders', { body: JSON.stringify(payload) });
const res = await axios.post('/api/orders', payload);
```

---

## 4. FORMAT RESPONSE API

**Selalu** handle dua format ini:

```typescript
// Sukses
type ApiSuccess<T> = {
  success: true;
  data: T;
  idempotent?: boolean; // true jika request duplikat (sudah diproses sebelumnya)
};

// Error
type ApiError = {
  success: false;
  error: string;   // error code — lihat Seksi 8
  message: string; // pesan dalam Bahasa Indonesia
};
```

---

## 5. FEATURE FLAGS — CARA KERJA

```typescript
// packages/ui/src/hooks/useFeatureFlags.ts
// SUDAH TERSEDIA — import dari sini, JANGAN buat ulang

'use client';
import { useState, useEffect, useRef } from 'react';
import { cariinApi } from '@cariin/http-client';

const DEFAULT_FLAGS = {
  RIDE_HAILING_ENABLED:   false, // Phase 2 — sembunyikan
  CAR_BOOKING_ENABLED:    false, // Phase 2 — sembunyikan
  FOOD_DELIVERY_ENABLED:  false, // Phase 2 — sembunyikan
  CRYPTO_PAYMENT_ENABLED: false, // Phase 2 — sembunyikan
};

export function useFeatureFlags() { /* ... lihat PRD Seksi 14 */ }
```

### Cara Menggunakan Feature Flag di Komponen:
```tsx
// ✅ BENAR — tampilkan/sembunyikan berdasarkan flag
const flags = useFeatureFlags();

return (
  <div>
    {/* Selalu tampil — Phase 1 aktif */}
    <ServiceCard title="Apotekin" href="/apotek" />
    <ServiceCard title="Cuciin"   href="/laundry" />

    {/* Sembunyikan jika flag false */}
    {flags.RIDE_HAILING_ENABLED  && <ServiceCard title="Ride"  href="/ride" />}
    {flags.FOOD_DELIVERY_ENABLED && <ServiceCard title="Food"  href="/food" />}
  </div>
);

// ❌ SALAH — jangan check flag dari localStorage
const isEnabled = localStorage.getItem('RIDE_HAILING_ENABLED');
```

---

## 6. HALAMAN & ROUTE — cariin-web (Next.js App Router)

Buat HANYA halaman-halaman berikut. Jangan tambah halaman lain tanpa konfirmasi.

### Auth Pages:
| Route | File | Deskripsi |
|---|---|---|
| `/login` | `app/(auth)/login/page.tsx` | Form email → kirim OTP |
| `/login/verify` | `app/(auth)/login/verify/page.tsx` | Input 6-digit OTP |
| `/register` | `app/(auth)/register/page.tsx` | Form nama + email → OTP |
| `/register/verify` | `app/(auth)/register/verify/page.tsx` | Input OTP registrasi |
| `/forgot-password` | `app/(auth)/forgot-password/page.tsx` | Input email reset |
| `/auth/google/callback` | `app/auth/google/callback/page.tsx` | Handle redirect Google OAuth |

### Main App Pages:
| Route | File | Deskripsi |
|---|---|---|
| `/` | `app/(main)/page.tsx` | Homepage — daftar layanan aktif |
| `/profile` | `app/(main)/profile/page.tsx` | Data profil user |
| `/wallet` | `app/(main)/wallet/page.tsx` | Saldo + histori transaksi |
| `/wallet/topup` | `app/(main)/wallet/topup/page.tsx` | Pilih metode top-up |
| `/orders` | `app/(main)/orders/page.tsx` | Riwayat pesanan |

---

## 7. KOMPONEN WAJIB — cariin-web

### Layout Structure:
```
app/
├── layout.tsx               ← RootLayout: CSP nonce + font
├── (auth)/
│   └── layout.tsx           ← AuthLayout: logo + card centered
├── (main)/
│   └── layout.tsx           ← MainLayout: header + bottom nav
└── middleware.ts            ← CSP nonce generation (WAJIB ADA)
```

### Shared Components (dari packages/ui):
```
components/
├── service-card.tsx         ← Card layanan di homepage
├── wallet-balance.tsx       ← Tampilan saldo (format Rupiah)
├── otp-input.tsx            ← Input 6 kotak OTP
├── transaction-item.tsx     ← Item histori transaksi
└── feature-gate.tsx         ← Wrapper cek feature flag
```

---

## 8. MIDDLEWARE — CSP NONCE (WAJIB ADA DI cariin-web)

```typescript
// apps/cariin-web/src/middleware.ts
// File ini WAJIB ADA. Tanpa ini, app tidak memenuhi standar keamanan PRD.

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
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');

  const res = NextResponse.next({
    request: { headers: new Headers(request.headers) },
  });

  res.headers.set('Content-Security-Policy',      csp);
  res.headers.set('Strict-Transport-Security',    'max-age=31536000; includeSubDomains; preload');
  res.headers.set('X-Frame-Options',              'DENY');
  res.headers.set('X-Content-Type-Options',       'nosniff');
  res.headers.set('Referrer-Policy',              'strict-origin-when-cross-origin');
  res.headers.set('X-Nonce',                      nonce);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

---

## 9. AUTH FLOW — DETAIL IMPLEMENTASI

### Alur Login (Email + OTP):
```
Step 1: User input email
  → POST /v1/auth/login { email }
  → Response: { success: true, message: "Jika email terdaftar, OTP telah dikirim" }
  → (Anti-enumeration: selalu 200 meski email tidak ada)
  → Redirect ke /login/verify

Step 2: User input 6-digit OTP
  → POST /v1/auth/login/verify { email, otp }
  → Sukses: { success: true, data: { redirectUrl: "/..." } }
  → Cookie session_token + refresh_token di-set OTOMATIS oleh server (HttpOnly)
  → Redirect ke redirectUrl dari response

Error yang mungkin muncul di Step 2:
  - OTP_INVALID         → "Kode OTP salah."
  - OTP_EXPIRED         → "Kode OTP sudah kadaluarsa."
  - OTP_MAX_ATTEMPTS_EXCEEDED → "Terlalu banyak percobaan. Minta OTP baru."
  - ACCOUNT_SUSPENDED   → "Akun Anda dinonaktifkan."
```

### Alur Register:
```
Step 1: User input fullName + email
  → POST /v1/auth/register { fullName, email }
  → Response: { success: true, message: "Kode OTP dikirim ke email Anda" }
  → Redirect ke /register/verify

Step 2: User input OTP
  → POST /v1/auth/register/verify { email, otp }
  → Sukses: redirect ke / (homepage)

Error: EMAIL_ALREADY_REGISTERED → "Email sudah terdaftar."
```

### Google OAuth:
```
→ GET /v1/auth/google            (backend redirect ke Google)
→ callback ke /auth/google/callback?code=...
→ Frontend hanya tangani callback — tampilkan loading, tunggu redirect dari server
```

### Zod Schema untuk Form:
```typescript
// Login form
const loginSchema = z.object({
  email: z.string().email('Email tidak valid'),
});

// OTP verify
const otpSchema = z.object({
  otp: z.string().length(6, 'OTP harus 6 digit').regex(/^\d{6}$/, 'Hanya angka'),
});

// Register form
const registerSchema = z.object({
  fullName: z.string().min(2, 'Nama minimal 2 karakter').max(100),
  email:    z.string().email('Email tidak valid'),
});
```

---

## 10. WALLET — DETAIL IMPLEMENTASI

### Aturan Wallet (dari PRD):
- Saldo maksimal: **Rp 50.000.000** (50 juta)
- Closed-loop: TIDAK bisa cashout ke rekening bank pribadi
- TIDAK bisa transfer saldo antar konsumen
- Semua nilai finansial di backend = BigInt (rupiah, tanpa desimal)
- Di frontend: tampilkan sebagai number biasa dengan format Rupiah

### Format tampilan saldo:
```typescript
// Helper fungsi — buat di utils/currency.ts
export function formatRupiah(amount: number | bigint): string {
  return new Intl.NumberFormat('id-ID', {
    style:    'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(Number(amount));
}

// Contoh: formatRupiah(1500000) → "Rp 1.500.000"
```

### Metode Top-up yang tersedia:
| Metode | Label di UI | Phase |
|---|---|---|
| `BRIVA` | Transfer Bank BRI (Virtual Account) | Phase 1 |
| `QRIS` | Bayar via QRIS / Payment Gateway | Phase 1 |
| `STRIPE` | Kartu Kredit (Visa/Mastercard) | Phase 1 |
| `CRYPTO` | Aset Kripto | Phase 2 — tampilkan hanya jika `CRYPTO_PAYMENT_ENABLED` |

### API Wallet:
```typescript
// Cek saldo
GET /v1/wallet/balance
Response: { success: true, data: { balance: number, currency: "IDR" } }

// Histori transaksi
GET /v1/wallet/transactions?page=1&limit=20
Response: {
  success: true,
  data: {
    transactions: WalletTransaction[],
    total: number,
    page: number,
  }
}

// Inisiasi top-up
POST /v1/wallet/topup
Body: { amount: number, method: "BRIVA" | "QRIS" | "STRIPE" | "CRYPTO" }
Headers: { 'X-Idempotency-Key': crypto.randomUUID() }
Response: { success: true, data: { ... instruksi pembayaran } }
```

### Tipe data WalletTransaction:
```typescript
type WalletTransaction = {
  id:            string;
  type:          'TOPUP' | 'TOPUP_PENDING' | 'PAYMENT' | 'REFUND' | 'COMMISSION';
  amount:        number;
  balanceBefore: number;
  balanceAfter:  number;
  status:        string;
  referenceId?:  string;
  note?:         string;
  createdAt:     string; // ISO date string
};
```

---

## 11. ORDERS — DETAIL IMPLEMENTASI

### Tipe data Order:
```typescript
type Order = {
  id:            string;
  userId:        string;
  tenantId:      string;
  serviceId:     string;
  quantity:      number;
  totalAmount:   number;
  status:        'PENDING' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
  notes?:        string;
  idempotencyKey: string;
  items:         OrderItem[];
  createdAt:     string;
  updatedAt:     string;
};

type OrderItem = {
  id:          string;
  serviceId:   string;
  serviceName: string;
  quantity:    number;
  unitPrice:   number;
  subtotal:    number;
};
```

### Buat Order — WAJIB pakai Idempotency Key:
```typescript
// ✅ BENAR — selalu sertakan X-Idempotency-Key
const createOrder = async (payload: CreateOrderPayload) => {
  const idempotencyKey = crypto.randomUUID();
  
  const res = await cariinApi.post('v1/orders', {
    json: payload,
    headers: { 'X-Idempotency-Key': idempotencyKey },
  }).json<ApiSuccess<Order>>();
  
  // Cek apakah ini duplicate request
  if (res.idempotent) {
    console.info('Order sudah dibuat sebelumnya');
  }
  
  return res.data;
};

// Error yang mungkin:
// STOCK_INSUFFICIENT → "Stok tidak mencukupi."
// SERVICE_INACTIVE   → "Layanan tidak tersedia."
// DUPLICATE_ORDER    → (Sudah dihandle via idempotency)
```

---

## 12. ERROR HANDLING — POLA WAJIB

```typescript
// utils/api-error.ts — Buat file ini
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Coba parse response dari ky
    try {
      const body = JSON.parse(error.message) as ApiError;
      return body.message ?? 'Terjadi kesalahan. Silakan coba lagi.';
    } catch {
      return 'Terjadi kesalahan. Silakan coba lagi.';
    }
  }
  return 'Terjadi kesalahan tidak diketahui.';
}

// Pola handle error di komponen:
const handleSubmit = async (data: FormData) => {
  try {
    await cariinApi.post('v1/orders', { json: data }).json();
    toast.success('Pesanan berhasil dibuat!');
  } catch (err) {
    // Coba ambil error code dari response
    if (err instanceof HTTPError) {
      const body = await err.response.json<ApiError>();
      
      // Handle specific error codes
      switch (body.error) {
        case 'STOCK_INSUFFICIENT':
          toast.error('Stok tidak mencukupi.');
          break;
        case 'UNAUTHORIZED':
          router.push('/login');
          break;
        case 'RATE_LIMIT_EXCEEDED':
          toast.error('Terlalu banyak permintaan. Coba lagi nanti.');
          break;
        default:
          toast.error(body.message ?? 'Terjadi kesalahan.');
      }
    }
  }
};
```

---

## 13. ERROR CODES YANG HARUS DIHANDLE DI FRONTEND

```typescript
// Semua error code yang mungkin diterima dari API:

// AUTH
'UNAUTHORIZED'               // → redirect ke /login
'TOKEN_EXPIRED'              // → refresh token, kalau gagal redirect /login
'ACCOUNT_SUSPENDED'          // → tampilkan pesan akun dinonaktifkan
'OTP_INVALID'                // → "Kode OTP salah"
'OTP_EXPIRED'                // → "Kode OTP kadaluarsa, minta ulang"
'OTP_MAX_ATTEMPTS_EXCEEDED'  // → "Terlalu banyak percobaan, minta OTP baru"
'EMAIL_ALREADY_REGISTERED'   // → "Email sudah terdaftar"
'GOOGLE_AUTH_CANCELLED'      // → "Login Google dibatalkan"

// WALLET
'WALLET_MAX_BALANCE_EXCEEDED' // → "Saldo melebihi batas Rp 50 juta"
'WALLET_NOT_FOUND'           // → "Wallet tidak ditemukan"

// ORDERS
'STOCK_INSUFFICIENT'          // → "Stok tidak mencukupi"
'SERVICE_INACTIVE'            // → "Layanan sementara tidak tersedia"

// GENERAL
'RATE_LIMIT_EXCEEDED'         // → "Terlalu banyak permintaan. Coba lagi nanti."
'NOT_FOUND'                   // → Tampilkan halaman 404
'INTERNAL_SERVER_ERROR'       // → "Terjadi kesalahan server. Coba lagi."
```

---

## 14. ZUSTAND — STATE MANAGEMENT

```typescript
// stores/user.store.ts
import { create } from 'zustand';

// Jangan simpan token di state!
// Token ada di cookie HttpOnly — tidak bisa diakses JS

type User = {
  id:           string;
  email:        string;
  fullName:     string;
  phone?:       string;
  avatarUrl?:   string;
  emailVerified: boolean;
};

type UserStore = {
  user:    User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  fetchUser: () => Promise<void>;
};

export const useUserStore = create<UserStore>((set) => ({
  user:      null,
  isLoading: false,
  setUser:   (user) => set({ user }),
  fetchUser: async () => {
    set({ isLoading: true });
    try {
      const res = await cariinApi.get('v1/auth/me').json<ApiSuccess<User>>();
      set({ user: res.data });
    } catch {
      set({ user: null });
    } finally {
      set({ isLoading: false });
    }
  },
}));

// stores/wallet.store.ts
type WalletStore = {
  balance:    number | null;
  fetchBalance: () => Promise<void>;
};

export const useWalletStore = create<WalletStore>((set) => ({
  balance:      null,
  fetchBalance: async () => {
    const res = await cariinApi.get('v1/wallet/balance').json<ApiSuccess<{ balance: number }>>();
    set({ balance: res.data.balance });
  },
}));
```

---

## 15. OFFLINE SYNC — cuciku-dashboard (POS Kasir)

> Fitur ini khusus untuk app kasir (Vite SPA). Dashboard kasir harus bisa  
> terima pembayaran meski internet mati, lalu sync saat online kembali.

```typescript
// src/lib/sync-manager.ts — Sudah ada di PRD, implementasi wajib mengikuti pola ini

interface PendingTx {
  id:         string; // UUID — juga sebagai idempotency key
  payload:    { serviceId: string; quantity: number; notes?: string };
  retryCount: number;
  createdAt:  number;
}

// Simpan transaksi offline ke IndexedDB
export async function saveOfflineTransaction(payload: PendingTx['payload']) {
  const db = await openIndexedDB();
  const tx: PendingTx = {
    id:         crypto.randomUUID(),
    payload,
    retryCount: 0,
    createdAt:  Date.now(),
  };
  await db.put('pendingTransactions', tx);
  return tx.id;
}

// Sync saat online
export async function syncPendingTransactions() { /* ... lihat PRD Seksi 15 */ }

// Auto-sync saat koneksi kembali
window.addEventListener('online', syncPendingTransactions);
```

---

## 16. ENVIRONMENT VARIABLES — FRONTEND

```bash
# cariin-web (.env.local)
NEXT_PUBLIC_API_URL="https://api.cariin.id"
NEXT_PUBLIC_APP_VERSION="2.0.0"

# cuciku-dashboard & cuciku-customer (.env)
VITE_API_URL="https://api.cariin.id"
VITE_APP_VERSION="2.0.0"
```

### Cara Akses:
```typescript
// Next.js
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

// Vite
const apiUrl = import.meta.env.VITE_API_URL;

// ❌ Jangan hardcode
const apiUrl = "https://api.cariin.id"; // SALAH
```

---

## 17. STRUKTUR FOLDER — cariin-web (Next.js)

```
apps/cariin-web/src/
├── middleware.ts              ← CSP nonce (WAJIB ADA)
├── app/
│   ├── layout.tsx             ← Root layout
│   ├── (auth)/
│   │   ├── layout.tsx
│   │   ├── login/
│   │   │   ├── page.tsx
│   │   │   └── verify/page.tsx
│   │   ├── register/
│   │   │   ├── page.tsx
│   │   │   └── verify/page.tsx
│   │   └── forgot-password/page.tsx
│   ├── (main)/
│   │   ├── layout.tsx         ← Header + bottom nav
│   │   ├── page.tsx           ← Homepage
│   │   ├── profile/page.tsx
│   │   ├── wallet/
│   │   │   ├── page.tsx
│   │   │   └── topup/page.tsx
│   │   └── orders/page.tsx
│   └── auth/
│       └── google/
│           └── callback/page.tsx
├── components/
│   ├── ui/                    ← shadcn/ui components (generate via CLI)
│   ├── service-card.tsx
│   ├── otp-input.tsx
│   ├── wallet-balance.tsx
│   └── transaction-item.tsx
├── stores/
│   ├── user.store.ts
│   └── wallet.store.ts
├── utils/
│   ├── currency.ts            ← formatRupiah()
│   └── api-error.ts          ← getErrorMessage()
└── types/
    └── api.ts                 ← ApiSuccess, ApiError, User, Order, dll.
```

---

## 18. UI/UX GUIDELINES

### Bahasa:
- Semua teks UI dalam **Bahasa Indonesia**
- Pesan error dari API sudah dalam Bahasa Indonesia — tampilkan apa adanya

### Loading States:
- Setiap tombol yang trigger API harus punya loading state
- Gunakan pola: `const [isLoading, setIsLoading] = useState(false)`
- Disable tombol saat loading: `<Button disabled={isLoading}>`

### Toast Notifications:
- Sukses → `toast.success(...)`
- Error → `toast.error(...)`
- Info → `toast.info(...)`
- Gunakan library toast yang kompatibel dengan shadcn/ui

### Format Angka:
```typescript
// Rupiah
formatRupiah(1500000)  // "Rp 1.500.000"

// Tanggal
new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(createdAt)) // "12 Jan 2025, 14.30"
```

### Warna Brand (untuk Tailwind):
```
Gunakan warna yang konsisten — definisikan di tailwind.config.ts:
primary:   (tentukan satu warna brand, misal biru atau hijau)
secondary: (warna pendukung)
```

---

## 19. SECURITY CHECKLIST — FRONTEND

Sebelum commit kode apapun, pastikan:

```
TOKEN & AUTH:
[ ] Token tidak disimpan di localStorage, sessionStorage, atau state
[ ] Semua request menggunakan cariinApi (bukan fetch/axios langsung)
[ ] credentials: 'include' ada di semua request API

FEATURE FLAGS:
[ ] Feature flags tidak disimpan di localStorage
[ ] Flag selalu diambil dari server via useFeatureFlags() hook
[ ] Fitur Phase 2 tersembunyi via kondisional, bukan dihapus

CSP:
[ ] middleware.ts ada dan menghasilkan nonce setiap request
[ ] Tidak ada 'unsafe-inline' di manapun
[ ] Script/style menggunakan nonce attribute

FORM:
[ ] Semua form menggunakan React Hook Form + Zod
[ ] Validasi client-side hanya untuk UX, bukan security
[ ] Harga/total TIDAK dikirim dari form — biarkan server hitung

IDEMPOTENCY:
[ ] Semua POST yang create data pakai X-Idempotency-Key
[ ] Kunci idempotency: crypto.randomUUID() per submission
```

---

## 20. CARA MEMULAI SESI CODING

Setiap kali memulai sesi baru, katakan ke AI:

```
"Saya sedang mengerjakan [nama app — cariin-web / cuciku-dashboard / cuciku-customer].
Saya ingin [deskripsi task spesifik].
Ikuti semua aturan di PRD yang sudah saya paste di atas."
```

### Contoh request yang baik:
```
✅ "Buat halaman /login untuk cariin-web. 
    Gunakan React Hook Form + Zod dengan schema loginSchema yang ada di dokumen. 
    Tampilkan toast error jika OTP_INVALID atau OTP_EXPIRED."

✅ "Buat komponen WalletBalance yang mengambil saldo dari 
    GET /v1/wallet/balance dan menampilkan dalam format Rupiah."

✅ "Buat fungsi createOrder di cuciku-dashboard dengan idempotency key, 
    yang menyimpan ke IndexedDB jika offline."
```

### Contoh request yang TERLALU UMUM (hindari):
```
❌ "Buat frontend Cariin"
❌ "Buat halaman dashboard"
❌ "Tambahkan fitur payment"
```

---

## 21. DAFTAR API ENDPOINT (REFERENSI CEPAT)

```
BASE URL: https://api.cariin.id

AUTH:
  POST   /v1/auth/register              → Kirim OTP registrasi
  POST   /v1/auth/register/verify       → Verifikasi OTP + buat akun
  POST   /v1/auth/login                 → Kirim OTP login
  POST   /v1/auth/login/verify          → Verifikasi OTP + set cookie
  POST   /v1/auth/logout                → Hapus session
  POST   /v1/auth/refresh               → Refresh access token
  GET    /v1/auth/me                    → Data user yang login
  GET    /v1/auth/google                → Redirect ke Google OAuth
  GET    /v1/auth/google/callback       → Handle callback Google
  POST   /v1/auth/forgot-password       → Kirim OTP reset password

WALLET:
  GET    /v1/wallet/balance             → Saldo saat ini
  GET    /v1/wallet/transactions        → Histori transaksi
  POST   /v1/wallet/topup               → Inisiasi top-up

ORDERS:
  POST   /v1/orders                     → Buat pesanan baru
  GET    /v1/orders                     → Daftar pesanan user
  GET    /v1/orders/:id                 → Detail pesanan

FEATURE FLAGS:
  GET    /api/feature-flags             → Ambil semua flag
  SSE    /api/feature-flags/stream      → Real-time update via SSE

HEALTH (tidak perlu di frontend, untuk referensi):
  GET    /health                        → Status server
  GET    /health/ready                  → DB + Redis check
```

---

*Dokumen ini dibuat dari PRD Cariin Super-App v2.0 — Monolith Edition*  
*Update dokumen ini setiap ada perubahan PRD sebelum memulai sesi coding baru*
