import { randomBytes } from 'crypto';
import { prismaAuth } from '../../db/client.js';

const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 menit
const MAX_ATTEMPTS = 3;

/**
 * Generate OTP 6 digit
 */
function generateOtp(): string {
  return Array.from({ length: OTP_LENGTH }, () => 
    Math.floor(Math.random() * 10)
  ).join('');
}

/**
 * Hash OTP untuk disimpan di database (security best practice)
 */
async function hashOtp(otp: string): Promise<string> {
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(otp).digest('hex');
}

export const otpService = {
  /**
   * Create atau update OTP code untuk user berdasarkan email
   * - Jika sudah ada OTP yang belum expired, reuse OTP tersebut (rate limiting)
   * - Jika belum ada user, buat user placeholder untuk REGISTER
   */
  async createOrUpdateOtp(email: string, purpose: 'LOGIN' | 'REGISTER' | 'RESET_PASSWORD') {
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    // Cari userId berdasarkan email
    const user = await prismaAuth.globalUser.findFirst({
      where: { email: email },
    });

    // Untuk LOGIN dan RESET_PASSWORD, user harus sudah ada
    if (!user && purpose !== 'REGISTER') {
      // Untuk anti-enumeration, tetap return sukses palsu
      return { otp: null, message: 'Jika email terdaftar, OTP telah dikirim.' };
    }

    // Cek apakah sudah ada OTP untuk user ini yang belum digunakan dan belum expired
    if (user) {
      const existingOtp = await prismaAuth.otpCode.findFirst({
        where: {
          userId: user.id,
          purpose: purpose,
          isUsed: false,
          expiresAt: { gt: new Date() },
        },
      });

      if (existingOtp) {
        // Reuse OTP yang sudah ada (untuk mencegah spam)
        return { otp: null, message: 'OTP sudah dikirim sebelumnya dan masih berlaku.' };
      }
    }

    // Buat OTP baru
    await prismaAuth.otpCode.create({
      data: {
        userId: user?.id ?? '00000000-0000-0000-0000-000000000000', // Placeholder untuk REGISTER
        purpose: purpose,
        codeHash: otpHash,
        expiresAt: expiresAt,
        attemptCount: 0,
        isUsed: false,
      },
    });

    // TODO: Kirim OTP via email/WhatsApp di sini
    // Untuk development, log OTP ke console
    console.log(`[OTP ${purpose}] Email: ${email}, OTP: ${otp}`);

    return { otp, message: 'OTP telah dikirim ke email Anda.' };
  },

  /**
   * Verifikasi OTP yang dimasukkan user
   * Returns: { valid: boolean, message?: string }
   */
  async verifyOtp(email: string, otp: string, purpose: 'LOGIN' | 'REGISTER' | 'RESET_PASSWORD') {
    const otpHash = await hashOtp(otp);
    const now = new Date();

    // Cari userId berdasarkan email
    const user = await prismaAuth.globalUser.findFirst({
      where: { email: email },
    });

    if (!user) {
      return { valid: false, message: 'Kode OTP tidak valid.' };
    }

    // Cari OTP yang valid berdasarkan userId
    const otpRecord = await prismaAuth.otpCode.findFirst({
      where: {
        userId: user.id,
        purpose: purpose,
        codeHash: otpHash,
        isUsed: false,
        expiresAt: { gt: now },
        attemptCount: { lt: MAX_ATTEMPTS },
      },
    });

    if (!otpRecord) {
      // Cek apakah ada OTP yang expired atau sudah digunakan
      const expiredOtp = await prismaAuth.otpCode.findFirst({
        where: {
          userId: user.id,
          purpose: purpose,
          isUsed: false,
          OR: [
            { expiresAt: { lte: now } },
            { attemptCount: { gte: MAX_ATTEMPTS } },
          ],
        },
      });

      if (expiredOtp) {
        if (expiredOtp.attemptCount >= MAX_ATTEMPTS) {
          return { valid: false, message: 'Terlalu banyak percobaan. Minta OTP baru.' };
        }
        return { valid: false, message: 'Kode OTP sudah kadaluarsa.' };
      }

      return { valid: false, message: 'Kode OTP tidak valid.' };
    }

    // Mark OTP sebagai used
    await prismaAuth.otpCode.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    return { valid: true, message: 'OTP terverifikasi.' };
  },

  /**
   * Increment attempt count untuk rate limiting
   */
  async incrementAttempts(email: string, purpose: 'LOGIN' | 'REGISTER' | 'RESET_PASSWORD') {
    // Cari userId berdasarkan email
    const user = await prismaAuth.globalUser.findFirst({
      where: { email: email },
    });

    if (!user) {
      return;
    }

    await prismaAuth.otpCode.updateMany({
      where: {
        userId: user.id,
        purpose: purpose,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      data: {
        attemptCount: { increment: 1 },
      },
    });
  },
};
