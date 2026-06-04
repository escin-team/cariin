// apps/backend/src/modules/auth/auth.service.ts
import { compare } from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { prismaAuth } from '../../db/client.js';
import { tokenService } from './token.service.js'; // Asumsi layanan pembuat JWT (RS256)
import { env } from '../../bootstrap/env-validation.js';
import { LoginDto } from './auth.schema.js';
import { executeEcosystemRoleRouting } from './role-router.js';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export const authService = {
  
  // =====================================================================
  // 1. LOGIN TRADISIONAL (EMAIL & PASSWORD)
  // =====================================================================
  async login(data: LoginDto, userAgent?: string, ipAddress?: string) {
    const user = await prismaAuth.globalUser.findFirst({
      where: { email: data.email, deletedAt: null },
    });

    // Proteksi Anti-Enumeration: Pesan error dibuat samar
    if (!user || !user.passwordHash) {
      throw new Error('UNAUTHORIZED_CREDENTIALS'); 
    }

    const isValidPassword = await compare(data.password, user.passwordHash);
    if (!isValidPassword) {
      throw new Error('UNAUTHORIZED_CREDENTIALS');
    }

    // Audit Trail Keamanan
    if (userAgent && ipAddress) {
       await prismaAuth.auditLog.create({
         data: {
           userId: user.id,
           action: 'USER_LOGIN_SUCCESS',
           payload: { userAgent, ipAddress, method: 'CREDENTIALS' },
           ipAddress,
           userAgent
         }
       });
    }

    const tokens = await tokenService.generateTokenPair(user.id, null, user.role);
    const redirectTarget = executeEcosystemRoleRouting(user.role);

    return { 
      user: { id: user.id, fullName: user.fullName, role: user.role, redirectTarget }, 
      tokens 
    };
  },

  // =====================================================================
  // 2. LOGIN WITH GOOGLE (OAUTH2 ID TOKEN)
  // =====================================================================
  async loginWithGoogle(idToken: string, userAgent?: string, ipAddress?: string) {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.sub) {
      throw new Error('UNAUTHORIZED_GOOGLE_TOKEN');
    }

    const { email, sub: googleId, name } = payload;

    let user = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null }
    });

    if (user) {
      // Tolak jika email sama tapi terdaftar via jalur tradisional
      if (!user.isOauth || user.oauthProvider !== 'GOOGLE') {
        throw new Error('EMAIL_ALREADY_REGISTERED_TRADITIONAL'); 
      }
      if (user.oauthProviderId !== googleId) {
        throw new Error('UNAUTHORIZED_GOOGLE_ID_MISMATCH');
      }
    } else {
      // Auto-Register kustomer baru
      user = await prismaAuth.globalUser.create({
        data: {
          email,
          fullName: name || 'User Cariin',
          role: 'CUSTOMER',
          isEmailVerified: true, 
          isOauth: true,
          oauthProvider: 'GOOGLE',
          oauthProviderId: googleId,
        }
      });
    }

    // Audit Trail Keamanan
    if (userAgent && ipAddress) {
       await prismaAuth.auditLog.create({
         data: {
           userId: user.id,
           action: 'USER_LOGIN_GOOGLE_SUCCESS',
           payload: { userAgent, ipAddress, provider: 'GOOGLE' },
           ipAddress,
           userAgent
         }
       });
    }

    const tokens = await tokenService.generateTokenPair(user.id, null, user.role);
    const redirectTarget = executeEcosystemRoleRouting(user.role);

    return { 
      user: { id: user.id, fullName: user.fullName, role: user.role, redirectTarget }, 
      tokens 
    };
  }
};