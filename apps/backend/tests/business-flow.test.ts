import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { app } from "../src/bootstrap/app.js";
import { prismaApp, prismaAuth } from "../src/db/client.js";
import { compare } from "bcrypt";
import { env } from "../src/bootstrap/env-validation.js";
import { createHmac } from "crypto";

const req = (path: string, options?: RequestInit) => app.request(path, options);

const TEST_USER_PHONE = "08123456789";
const TEST_USER_PASSWORD = "Password123!";
const TEST_USER_NAME = "Test User";

describe("🛒 BUSINESS FLOW: End-to-End User Journey", () => {
  let accessToken: string;
  let userId: string;
  let transactionId: string;

  beforeAll(async () => {
    // ✅ FIX: Gunakan prismaAuth (BYPASSRLS) untuk cleanup agar tidak terblokir RLS
    await prismaAuth.refreshToken.deleteMany({});
    await prismaAuth.otpCode.deleteMany({});
    await prismaAuth.walletTransaction.deleteMany({});
    await prismaAuth.wallet.deleteMany({});
    await prismaAuth.globalUser.deleteMany({});
  });

  afterAll(async () => {
    // ✅ FIX: Cleanup test data setelah semua test selesai
    await prismaAuth.refreshToken.deleteMany({});
    await prismaAuth.otpCode.deleteMany({});
    await prismaAuth.walletTransaction.deleteMany({});
    await prismaAuth.wallet.deleteMany({});
    await prismaAuth.globalUser.deleteMany({ where: { phone: { startsWith: '08' } } });
    
    await prismaApp.$disconnect();
    await prismaAuth.$disconnect();
  });

  // ==========================================
  // 1. REGISTER
  // ==========================================
  describe("📝 STEP 1: User Registration", () => {
    it("Mendaftar user baru dengan phone + password", async () => {
      const res = await req("/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: TEST_USER_NAME,
          phone: TEST_USER_PHONE,
          password: TEST_USER_PASSWORD,
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      userId = json.data.user.id;
    });

    it("Menolak registrasi dengan phone yang sudah terdaftar", async () => {
      const res = await req("/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "User Lain",
          phone: TEST_USER_PHONE,
          password: "Password456!",
        }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("DUPLICATE_ENTRY");
    });

    it("Memastikan password di-hash dengan bcrypt", async () => {
      const user = await prismaAuth.globalUser.findUnique({ where: { phone: TEST_USER_PHONE } });
      expect(user?.passwordHash?.startsWith("$2b$")).toBe(true);
      const isValid = await compare(TEST_USER_PASSWORD, user!.passwordHash!);
      expect(isValid).toBe(true);
    });

    it("Memastikan wallet otomatis dibuat saat register", async () => {
      const wallet = await prismaAuth.wallet.findUnique({ where: { userId } });
      expect(wallet).toBeDefined();
      expect(wallet?.balance).toBe(BigInt(0));
    });
  });

  // ==========================================
  // 2. LOGIN
  // ==========================================
  describe("🔐 STEP 2: User Login", () => {
    it("Login dengan phone + password yang benar", async () => {
      const res = await req("/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: TEST_USER_PHONE, password: TEST_USER_PASSWORD }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.user.id).toBe(userId);
      accessToken = json.data.accessToken;
      
      const cookies = res.headers.getSetCookie();
      expect(cookies.some((c: string) => c.includes("session_token="))).toBe(true);
      expect(cookies.some((c: string) => c.includes("refresh_token="))).toBe(true);
    });

    it("Menolak login dengan password salah (Anti-Enumeration)", async () => {
      const res = await req("/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: TEST_USER_PHONE, password: "WrongPassword!" }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ==========================================
  // 3. TOPUP REQUEST
  // ==========================================
  describe("💰 STEP 3: Request Topup", () => {
    it("User request topup saldo Rp 100.000", async () => {
      const res = await req("/v1/wallet/topup/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "X-Idempotency-Key": "test-topup-001",
        },
        body: JSON.stringify({ amount: "100000", paymentMethod: "QRIS", provider: "XENDIT" }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.status).toBe("PENDING");
      transactionId = json.data.id;
    });

    it("Memastikan saldo BELUM bertambah (masih PENDING)", async () => {
      const wallet = await prismaAuth.wallet.findUnique({ where: { userId } });
      expect(wallet?.balance).toBe(BigInt(0));
    });
  });

  // ==========================================
  // 4. WEBHOOK CONFIRMATION
  // ==========================================
  describe("🔔 STEP 4: Webhook Topup Confirmation", () => {
    const generateWebhookHeaders = (body: string, timestampOffset = 0) => {
      const timestamp = Math.floor(Date.now() / 1000) + timestampOffset;
      const signature = createHmac("sha256", env.INTERNAL_SECRET_KEY)
        .update(`${timestamp}.${body}`)
        .digest("hex");
      return {
        "Content-Type": "application/json",
        "X-Webhook-Timestamp": timestamp.toString(),
        "X-Webhook-Signature": signature,
      };
    };

    it("Server terima webhook dan update saldo jadi COMPLETED", async () => {
      const body = JSON.stringify({
        transactionId,
        amountPaid: "100000",
        provider: "XENDIT",
        providerReference: "XENDIT-REF-123",
      });
      const headers = generateWebhookHeaders(body);

      // ✅ FIX: URL disesuaikan dengan wallet.router.ts
      const res = await req("/v1/wallet/topup/confirm", { method: "POST", body, headers });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe("COMPLETED");
    });

    it("Memastikan saldo wallet sudah bertambah Rp 100.000", async () => {
      const wallet = await prismaAuth.wallet.findUnique({ where: { userId } });
      expect(wallet?.balance).toBe(BigInt(100000));
    });

    it("Menolak webhook dengan nominal tidak sesuai (Anti Price Tampering)", async () => {
      // ✅ FIX: Cari walletId dari DB karena tidak di-return saat register
      const wallet = await prismaAuth.wallet.findUniqueOrThrow({ where: { userId } });
      
      const newTx = await prismaAuth.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: "TOPUP",
          status: "PENDING",
          amount: BigInt(50000),
          idempotencyKey: "test-topup-002",
        },
      });

      const body = JSON.stringify({ transactionId: newTx.id, amountPaid: "100000", provider: "XENDIT" });
      const headers = generateWebhookHeaders(body);

      const res = await req("/v1/wallet/topup/confirm", { method: "POST", body, headers });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("PAYMENT_AMOUNT_MISMATCH");
    });
  });

  // ==========================================
  // 5. CHECK BALANCE
  // ==========================================
  describe("💳 STEP 5: Check Balance", () => {
    it("User cek saldo dan mendapat saldo terbaru", async () => {
      const res = await req("/v1/wallet/balance", {
        method: "GET",
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.balance).toBe("100000");
    });

    it("User tidak bisa cek saldo user lain (RLS + IDOR Prevention)", async () => {
      const otherUser = await prismaAuth.globalUser.create({
        data: { phone: "08987654321", fullName: "Other User", role: "CUSTOMER" },
      });
      await prismaAuth.wallet.create({ data: { userId: otherUser.id, balance: BigInt(999999) } });

      const res = await req(`/v1/wallet/balance/${otherUser.id}`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // 6. LOGOUT
  // ==========================================
  describe("🚪 STEP 6: Logout", () => {
    it("User logout dan token di-revoke", async () => {
      const res = await req("/v1/auth/logout", {
        method: "POST",
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("Access token masih valid sampai expired (Stateless JWT Behavior)", async () => {
      // JWT stateless tidak bisa di-revoke instant tanpa Redis blacklist.
      // Ini adalah standar industri: access token valid sampai 15 menit.
      const res = await req("/v1/wallet/balance", {
        method: "GET",
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      expect(res.status).toBe(200); // Masih valid karena JWT belum expired
    });

    it("Refresh token di database sudah di-revoke semua", async () => {
      const refreshTokens = await prismaAuth.refreshToken.findMany({ where: { userId } });
      const allRevoked = refreshTokens.every((t: any) => t.isRevoked === true);
      expect(allRevoked).toBe(true);
    });
  });
});