import { sign, verify } from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { prismaAuth } from '../../db/client.js';
import { env } from '../../bootstrap/env-validation.js';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

// Helper: Hash token sebelum disimpan ke DB (Best Practice Security)
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const tokenService = {
  /**
   * Generate Access Token (JWT RS256) + Refresh Token (Opaque String)
   * @param existingFamilyId - diteruskan saat rotate agar family chain tidak putus
   */
  async generateTokenPair(
    userId: string,
    tenantId: string | null,
    role: string,
    existingFamilyId?: string
  ) {
    const familyId = existingFamilyId || randomBytes(16).toString('hex');
    const jti = randomBytes(16).toString('hex');

    // Access Token: pendek, stateless, RS256 (Aturan AUTH-2)
    const accessToken = sign(
      { sub: userId, tenantId, role, jti },
      env.JWT_PRIVATE_KEY,
      { algorithm: 'RS256', expiresIn: ACCESS_TOKEN_TTL }
    );

    // Refresh Token: opaque string, disimpan di DB sebagai hash
    const refreshTokenPlain = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prismaAuth.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshTokenPlain),
        family: familyId,
        userId,
        tenantId,
        role,
        expiresAt,
        isRevoked: false,
      },
    });

    return { accessToken, refreshToken: refreshTokenPlain };
  },

  /**
   * Refresh Token Rotation (Aturan AUTH-4)
   * Otomatis mendeteksi REUSE ATTACK dan membakar seluruh family jika token dicuri
   */
  async rotate(incomingRefreshToken: string) {
    const incomingHash = hashToken(incomingRefreshToken);

    const stored = await prismaAuth.refreshToken.findFirst({
      where: { tokenHash: incomingHash },
    });

    if (!stored) throw new Error('TOKEN_INVALID');

    if (stored.isRevoked) {
      // 🚨 REUSE DETECTED! Token ini sudah di-rotate tapi dipakai lagi.
      // Artinya token ini dicuri. Revoke seluruh family untuk paksa logout semua device.
      await prismaAuth.refreshToken.updateMany({
        where: { family: stored.family },
        data: { isRevoked: true },
      });
      throw new Error('SESSION_COMPROMISED');
    }

    if (stored.expiresAt < new Date()) throw new Error('SESSION_EXPIRED');

    // Revoke token lama
    await prismaAuth.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true },
    });

    // Generate pair baru dengan family yang sama (chain tidak terputus)
    return this.generateTokenPair(stored.userId, stored.tenantId, stored.role, stored.family);
  },

  /**
   * Logout spesifik — revoke token yang sedang aktif (dari cookie)
   */
  async revokeToken(incomingRefreshToken: string) {
    const incomingHash = hashToken(incomingRefreshToken);
    await prismaAuth.refreshToken.updateMany({
      where: { tokenHash: incomingHash },
      data: { isRevoked: true },
    });
  },

  /**
   * Logout semua device — revoke seluruh token aktif milik user
   */
  async revokeAll(userId: string) {
    await prismaAuth.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
  },

  /**
   * Cleanup job — dipanggil via BullMQ cron setiap hari
   */
  async deleteExpiredTokens() {
    const result = await prismaAuth.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { isRevoked: true, updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        ],
      },
    });
    return { deletedCount: result.count };
  },

  /**
   * Verifikasi Access Token (dipanggil di authMiddleware)
   */
  verifyAccessToken(token: string) {
    try {
      return verify(token, env.JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as {
        sub: string;
        tenantId: string | null;
        role: string;
        jti: string;
      };
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') throw new Error('TOKEN_EXPIRED');
      throw new Error('TOKEN_INVALID');
    }
  },
};