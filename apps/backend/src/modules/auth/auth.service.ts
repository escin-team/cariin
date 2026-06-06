import { compare, hash } from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { prismaAuth } from '../../db/client.js';
import { env } from '../../bootstrap/env-validation.js';
import { tokenService } from './token.service.js';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);
const BCRYPT_ROUNDS = 10;

// ✅ FIX: Pindahkan hardcoded URLs ke environment variables dengan fallback
function executeEcosystemRoleRouting(role: string): string {
  const roleUrls: Record<string, string> = {
    'SUPERADMIN': env.SUPERADMIN_URL || 'https://admin.cariin.id',
    'MITRA_OWNER': env.MITRA_OWNER_URL || 'https://mitra.cariin.id',
    'MITRA_STAFF': env.MITRA_STAFF_URL || 'https://pos.cariin.id',
    'CUSTOMER': env.CUSTOMER_URL || 'https://cariin.id',
  };
  return roleUrls[role] || roleUrls['CUSTOMER'];
}

export const authService = {
  // ✅ TAMBAHAN BARU: REGISTER
  async register(fullName: string, phone: string, password: string, email?: string) {
    // 1. Hash password dengan bcrypt (Aturan AUTH-1)
    const passwordHash = await hash(password, BCRYPT_ROUNDS);

    // 2. Buat user + wallet dalam 1 transaksi atomic
    // Menggunakan prismaAuth karena ini operasi auth/seeding (BYPASSRLS)
    const user = await prismaAuth.$transaction(async (tx) => {
      const newUser = await tx.globalUser.create({
        data: {
          fullName,
          phone,
          email,
          passwordHash,
          role: 'CUSTOMER',
          isEmailVerified: false,
          isOauth: false,
        },
      });

      // Auto-create wallet dengan saldo 0 (BigInt)
      await tx.wallet.create({
        data: {
          userId: newUser.id,
          balance: BigInt(0),
        },
      });

      return newUser;
    });

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        role: user.role,
      },
    };
  },

  // =====================================================================
  // 1. TRADITIONAL LOGIN (Phone/Email + Password)
  // =====================================================================
  async loginTraditional(
    identifier: string, // phone atau email
    password: string,
    userAgent?: string,
    ipAddress?: string
  ) {
    // Cari user by phone ATAU email (Anti-Enumeration: pesan error sama)
    const user = await prismaAuth.globalUser.findFirst({
      where: {
        OR: [
          { phone: identifier, deletedAt: null },
          { email: identifier, deletedAt: null },
        ],
      },
    });

    // ❌ JANGAN bedakan antara "user tidak ada" dan "password salah"
    if (!user || !user.passwordHash) {
      throw new Error('UNAUTHORIZED_CREDENTIALS');
    }

    // Tolak jika user ini terdaftar via OAuth (mencegah bypass password)
    if (user.isOauth) {
      throw new Error('OAUTH_ACCOUNT_USE_PASSWORD_LOGIN');
    }

    const isValidPassword = await compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new Error('UNAUTHORIZED_CREDENTIALS');
    }

    // Audit Trail Keamanan - selalu ditulis (tidak bersyarat)
    await prismaAuth.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_LOGIN_TRADITIONAL_SUCCESS',
        payload: { userAgent: userAgent ?? 'unknown', ipAddress: ipAddress ?? 'unknown', identifier },
        ipAddress: ipAddress ?? 'unknown',
        userAgent: userAgent ?? 'unknown',
      },
    });

    const tokens = await tokenService.generateTokenPair(user.id, null, user.role);
    const redirectTarget = executeEcosystemRoleRouting(user.role);

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        redirectTarget,
      },
      tokens,
    };
  },

  // =====================================================================
  // 2. LOGIN WITH GOOGLE (OAuth2 ID Token)
  // =====================================================================
  async loginWithGoogle(idToken: string, userAgent?: string, ipAddress?: string) {
    // Verifikasi signature token Google
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    // ✅ Defense in Depth: Pastikan email sudah diverifikasi Google
    if (!payload || !payload.email || !payload.sub || !payload.email_verified) {
      throw new Error('UNAUTHORIZED_GOOGLE_TOKEN');
    }

    const { email, sub: googleId, name } = payload;

    let user = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null },
    });

    if (user) {
      // 🛡️ Anti Account Takeover:
      // Tolak jika email sama tapi terdaftar via jalur tradisional
      if (!user.isOauth || user.oauthProvider !== 'GOOGLE') {
        throw new Error('EMAIL_ALREADY_REGISTERED_TRADITIONAL');
      }
      // Tolak jika googleId tidak cocok (mencegah spoofing)
      if (user.oauthProviderId !== googleId) {
        throw new Error('UNAUTHORIZED_GOOGLE_ID_MISMATCH');
      }
    } else {
      // Auto-Register: buat user + wallet dalam 1 transaksi
      user = await prismaAuth.$transaction(async (tx) => {
        const newUser = await tx.globalUser.create({
          data: {
            email,
            phone: null, // nullable setelah migration TUGAS 9
            fullName: name || 'User Cariin',
            role: 'CUSTOMER',
            isEmailVerified: true,
            isOauth: true,
            oauthProvider: 'GOOGLE',
            oauthProviderId: googleId,
          },
        });

        // Buat wallet otomatis dengan saldo 0
        await tx.wallet.create({
          data: { userId: newUser.id, balance: BigInt(0) },
        });

        return newUser;
      });
    }

    // Audit Trail Keamanan - selalu ditulis (tidak bersyarat)
    await prismaAuth.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_LOGIN_GOOGLE_SUCCESS',
        payload: { userAgent: userAgent ?? 'unknown', ipAddress: ipAddress ?? 'unknown', provider: 'GOOGLE' },
        ipAddress: ipAddress ?? 'unknown',
        userAgent: userAgent ?? 'unknown',
      },
    });

    const tokens = await tokenService.generateTokenPair(user.id, null, user.role);
    const redirectTarget = executeEcosystemRoleRouting(user.role);

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        redirectTarget,
      },
      tokens,
    };
  },
};