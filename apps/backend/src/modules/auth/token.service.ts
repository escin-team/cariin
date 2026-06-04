// apps/backend/src/modules/auth/token.service.ts
import { sign } from 'hono/jwt';
import crypto from 'node:crypto';
import { prismaAuth } from '../../db/client.js';
import { env } from '../../bootstrap/env-validation.js';

export const tokenService = {
  /**
   * Menghasilkan pasangan Access Token & Refresh Token baru
   * Menggunakan RS256 untuk Access Token dan Opaque Hash untuk Refresh Token
   */
  async generateTokenPair(userId: string, deviceUuid: string | null, role: string) {
    // 1. Generate Access Token (JWT RS256 - Berlaku 15 Menit)
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 15 * 60; // 15 menit
    
    const accessTokenPayload = {
      sub: userId,
      role: role,
      exp: exp,
      iat: iat,
      jti: crypto.randomUUID(), // JWT ID mencegah Replay Attack
    };

    // Wajib: env.JWT_PRIVATE_KEY harus berupa string kunci Private RSA
    const accessToken = await sign(accessTokenPayload, env.JWT_PRIVATE_KEY, 'RS256');

    // 2. Generate Refresh Token (Opaque Token - Berlaku 30 Hari)
    // Opaque token adalah string acak yang tidak menyimpan payload (lebih aman dari JWT untuk jangka panjang)
    const plainRefreshToken = crypto.randomBytes(32).toString('hex');
    
    // Hash token sebelum disimpan ke DB (Jika DB bocor, plaintext token aman)
    const tokenHash = crypto.createHash('sha256').update(plainRefreshToken).digest('hex');
    
    // Token Family digunakan untuk deteksi pemakaian ulang token curian (RTR - Refresh Token Rotation)
    const tokenFamily = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 Hari

    // 3. Simpan Refresh Token ke Database (Menggunakan prismaAuth / BYPASSRLS)
    await prismaAuth.refreshToken.create({
      data: {
        userId,
        tokenFamily,
        tokenHash,
        deviceUuid,
        expiresAt,
        isRevoked: false,
      },
    });

    return {
      accessToken,
      refreshToken: plainRefreshToken, // Plain token yang dikirim ke kuki browser
    };
  }
};