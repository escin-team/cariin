import { sign, verify } from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { prismaAuth } from '../../db/client.js';
import { env } from '../../bootstrap/env-validation.js';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

// Helper untuk hash token sebelum disimpan ke DB (Best Practice Security)
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const tokenService = {
  async generateTokenPair(userId: string, tenantId: string | null, role: string, existingFamilyId?: string) {
    const familyId = existingFamilyId || randomBytes(16).toString('hex');
    const jti = randomBytes(16).toString('hex');

    const accessToken = sign(
      { sub: userId, tenantId, role, jti },
      env.JWT_PRIVATE_KEY,
      { algorithm: 'RS256', expiresIn: ACCESS_TOKEN_TTL }
    );

    const refreshTokenPlain = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prismaAuth.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshTokenPlain), // ✅ Disimpan sebagai SHA-256 Hash
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

  async rotate(incomingRefreshToken: string) {
    const incomingHash = hashToken(incomingRefreshToken);
    
    const stored = await prismaAuth.refreshToken.findFirst({
      where: { tokenHash: incomingHash },
    });

    if (!stored) throw new Error('TOKEN_INVALID');

    if (stored.isRevoked) {
      // 🚨 REUSE DETECTED! Bakar seluruh family
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

    // Teruskan familyId agar token baru masih dalam 1 family yang sama
    return this.generateTokenPair(stored.userId, stored.tenantId, stored.role, stored.family);
  },

  async revokeAll(userId: string) {
    await prismaAuth.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
  },

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