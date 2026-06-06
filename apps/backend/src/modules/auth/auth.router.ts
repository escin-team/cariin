import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { setCookie, getCookie } from 'hono/cookie';
import { randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../bootstrap/env-validation.js';
import { LoginSchema, GoogleLoginSchema, RegisterSchema, RequestOtpSchema, VerifyOtpSchema, ForgotPasswordSchema, ResetPasswordSchema } from './auth.schema.js';
import { authService } from './auth.service.js';
import { tokenService } from './token.service.js';
import { otpService } from './otp.service.js';
import { authMiddleware } from '../../middleware/auth.js'; // ✅ Import authMiddleware
import { rateLimiter } from '../../middleware/rate-limiter.js';
import { prismaAuth } from '../../db/client.js';

// Import fungsi helper dari auth.service (harus di-export)
import { executeEcosystemRoleRouting } from './auth.service.js';

// Initialize Google OAuth client
const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export const authRouter = new Hono();

/**
 * Helper: Inject HttpOnly Cookies (Aturan AUTH-3)
 * Token TIDAK BOLEH di localStorage agar aman dari XSS
 */
function injectSecureCookies(c: any, accessToken: string, refreshToken: string) {
  const isProd = env.NODE_ENV === 'production';

  // Access Token Cookie — path '/' (bisa diakses semua endpoint)
  setCookie(c, 'session_token', accessToken, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 15 * 60, // 15 menit
    path: '/',
  });

  // Refresh Token Cookie — path SCOPING (hanya untuk /v1/auth/refresh)
  // Ini mencegah CSRF dan membatasi exposure jika ada XSS di endpoint lain
  setCookie(c, 'refresh_token', refreshToken, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 30 * 24 * 60 * 60, // 30 hari
    path: '/v1/auth/refresh',
  });
}

/**
 * Helper: Ambil IP Address dengan Fallback Chain (Aturan API-3)
 */
function getClientIp(c: any): string | undefined {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    undefined
  );
}

// =====================================================================
// ENDPOINT 1: REGISTER
// =====================================================================
authRouter.post(
  '/register',
  rateLimiter('auth:register', 'ip'),
  zValidator('json', RegisterSchema),
  async (c) => {
    const { fullName, phone, password, email } = c.req.valid('json');
    const result = await authService.register(fullName, phone, password, email);

    return c.json(
      {
        success: true,
        message: 'Registrasi berhasil. Silakan login.',
        data: result,
      },
      201
    );
  }
);

// =====================================================================
// ENDPOINT 2: TRADITIONAL LOGIN
// =====================================================================
authRouter.post(
  '/login',
  rateLimiter('auth:login', 'ip'),
  zValidator('json', LoginSchema),
  async (c) => {
    const { identifier, password } = c.req.valid('json');
    const userAgent = c.req.header('user-agent');
    const ipAddress = getClientIp(c);

    const result = await authService.loginTraditional(
      identifier,
      password,
      userAgent,
      ipAddress
    );

    // Inject cookies (Aturan AUTH-3: token tidak boleh di localStorage)
    injectSecureCookies(c, result.tokens.accessToken, result.tokens.refreshToken);

    return c.json({
      success: true,
      data: {
        user: result.user,
        // accessToken juga dikirim di body untuk SSR/Server Component Next.js
        accessToken: result.tokens.accessToken,
      },
    });
  }
);

// =====================================================================
// ENDPOINT 3: GOOGLE LOGIN - Redirect ke Google OAuth
// =====================================================================
authRouter.get(
  '/google',
  async (c) => {
    // Redirect ke Google OAuth consent screen
    const googleAuthUrl = googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      redirect_uri: env.GOOGLE_REDIRECT_URI,
    });
    
    return c.redirect(googleAuthUrl);
  }
);

// =====================================================================
// ENDPOINT 4: GOOGLE CALLBACK - Handle redirect dari Google
// =====================================================================
authRouter.get(
  '/google/callback',
  async (c) => {
    const code = c.req.query('code');
    const error = c.req.query('error');
    
    if (error) {
      // User cancelled atau error dari Google
      const redirectUrl = env.FRONTEND_URL + '/login?error=google_auth_cancelled';
      return c.redirect(redirectUrl);
    }
    
    if (!code) {
      const redirectUrl = env.FRONTEND_URL + '/login?error=invalid_callback';
      return c.redirect(redirectUrl);
    }
    
    try {
      // Exchange code untuk ID token
      const { tokens } = await googleClient.getToken(code);
      
      if (!tokens.id_token) {
        throw new Error('ID token tidak ditemukan');
      }
      
      const userAgent = c.req.header('user-agent');
      const ipAddress = getClientIp(c);
      
      const result = await authService.loginWithGoogle(tokens.id_token, userAgent, ipAddress);
      
      // Inject cookies
      injectSecureCookies(c, result.tokens.accessToken, result.tokens.refreshToken);
      
      // Redirect ke dashboard sesuai role
      return c.redirect(result.user.redirectTarget);
    } catch (err: any) {
      console.error('Google OAuth callback error:', err);
      const redirectUrl = env.FRONTEND_URL + '/login?error=google_auth_failed';
      return c.redirect(redirectUrl);
    }
  }
);

// =====================================================================
// ENDPOINT 5: GOOGLE LOGIN (POST dengan ID Token - untuk mobile app)
// =====================================================================
authRouter.post(
  '/google',
  rateLimiter('auth:login', 'ip'),
  zValidator('json', GoogleLoginSchema),
  async (c) => {
    const { idToken } = c.req.valid('json');
    const userAgent = c.req.header('user-agent');
    const ipAddress = getClientIp(c);

    const result = await authService.loginWithGoogle(idToken, userAgent, ipAddress);

    injectSecureCookies(c, result.tokens.accessToken, result.tokens.refreshToken);

    return c.json({
      success: true,
      data: {
        user: result.user,
        accessToken: result.tokens.accessToken,
      },
    });
  }
);

// =====================================================================
// ENDPOINT 6: REFRESH TOKEN (Aturan AUTH-4: Token Rotation)
// =====================================================================
authRouter.post(
  '/refresh',
  rateLimiter('auth:refresh', 'ip'),
  async (c) => {
    const refreshToken = getCookie(c, 'refresh_token');

    if (!refreshToken) {
      return c.json({ success: false, error: { code: 'TOKEN_INVALID', message: 'Refresh token tidak ditemukan.' } }, 401);
    }

    try {
      // rotate() otomatis mendeteksi reuse attack dan membakar family jika dicuri
      const result = await tokenService.rotate(refreshToken);

      // Timpa cookie dengan token baru
      injectSecureCookies(c, result.accessToken, result.refreshToken);

      return c.json({
        success: true,
        message: 'Token refreshed',
        data: { accessToken: result.accessToken },
      });
    } catch (err: any) {
      // Jika SESSION_COMPROMISED atau SESSION_EXPIRED, hapus cookie paksa
      setCookie(c, 'session_token', '', { maxAge: 0, path: '/' });
      setCookie(c, 'refresh_token', '', { maxAge: 0, path: '/v1/auth/refresh' });

      throw err; // Lempar ke globalErrorHandler
    }
  }
);

// =====================================================================
// ENDPOINT 7: LOGOUT (Revoke All Tokens & Clear Cookies)
// ✅ FIX: authMiddleware + revokeAll(userId) untuk logout semua device
// =====================================================================
authRouter.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId');

  // Revoke SEMUA token aktif milik user (logout dari semua device)
  if (userId) {
    await tokenService.revokeAll(userId);
  }

  // Hapus cookie dari browser user
  const isProd = env.NODE_ENV === 'production';
  setCookie(c, 'session_token', '', {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 0,
    path: '/',
  });
  setCookie(c, 'refresh_token', '', {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 0,
    path: '/v1/auth/refresh',
  });

  return c.json({ success: true, message: 'Logged out successfully' });
});

// =====================================================================
// ENDPOINT 8: GET CURRENT USER (/me)
// =====================================================================
authRouter.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');
  
  const user = await prismaAuth.globalUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      isEmailVerified: true,
    },
  });

  if (!user) {
    return c.json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User tidak ditemukan.' } }, 404);
  }

  return c.json({
    success: true,
    data: user,
  });
});

// =====================================================================
// ENDPOINT 6: REQUEST OTP FOR LOGIN (Anti-Enumeration)
// =====================================================================
authRouter.post(
  '/login/request-otp',
  rateLimiter('auth:login', 'ip'),
  zValidator('json', RequestOtpSchema),
  async (c) => {
    const { email } = c.req.valid('json');

    // Cek apakah user terdaftar (tapi jangan bocorkan info ini ke client)
    const user = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null },
    });

    // Selalu response sama untuk mencegah enumeration
    const result = await otpService.createOrUpdateOtp(email, 'LOGIN');

    return c.json({
      success: true,
      message: 'Jika email terdaftar, OTP telah dikirim ke email Anda.',
    });
  }
);

// =====================================================================
// ENDPOINT 7: VERIFY OTP FOR LOGIN
// =====================================================================
authRouter.post(
  '/login/verify',
  rateLimiter('auth:login', 'ip'),
  zValidator('json', VerifyOtpSchema),
  async (c) => {
    const { email, otp } = c.req.valid('json');
    const userAgent = c.req.header('user-agent');
    const ipAddress = getClientIp(c);

    // Verifikasi OTP
    const verification = await otpService.verifyOtp(email, otp, 'LOGIN');

    if (!verification.valid) {
      // Decrement attempts untuk rate limiting
      await otpService.incrementAttempts(email, 'LOGIN');
      
      // Map error messages to error codes
      let errorCode = 'OTP_INVALID';
      if (verification.message?.includes('kadaluarsa')) errorCode = 'OTP_EXPIRED';
      if (verification.message?.includes('Terlalu banyak')) errorCode = 'OTP_MAX_ATTEMPTS_EXCEEDED';
      
      throw new Error(errorCode);
    }

    // Cari user
    const user = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null },
    });

    if (!user) {
      // User tidak terdaftar - buat akun baru secara otomatis (auto-register via OTP)
      // Ini adalah pattern yang umum untuk UX yang lebih baik
      return c.json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Email belum terdaftar. Silakan daftar terlebih dahulu.' },
      }, 404);
    }

    // Generate tokens
    const tokens = await tokenService.generateTokenPair(user.id, null, user.role);
    const redirectTarget = executeEcosystemRoleRouting(user.role);

    // Inject cookies
    injectSecureCookies(c, tokens.accessToken, tokens.refreshToken);

    // Audit trail
    await prismaAuth.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_LOGIN_OTP_SUCCESS',
        payload: { userAgent: userAgent ?? 'unknown', ipAddress: ipAddress ?? 'unknown' },
        ipAddress: ipAddress ?? 'unknown',
        userAgent: userAgent ?? 'unknown',
      },
    });

    return c.json({
      success: true,
      data: {
        user: {
          id: user.id,
          fullName: user.fullName,
          role: user.role,
        },
        redirectUrl: redirectTarget,
      },
    });
  }
);

// =====================================================================
// ENDPOINT 8: REQUEST OTP FOR REGISTER
// =====================================================================
authRouter.post(
  '/register/request-otp',
  rateLimiter('auth:register', 'ip'),
  zValidator('json', RequestOtpSchema),
  async (c) => {
    const { email } = c.req.valid('json');

    // Cek apakah email sudah terdaftar
    const existingUser = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null },
    });

    if (existingUser) {
      return c.json({
        success: false,
        error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'Email sudah terdaftar. Silakan login.' },
      }, 409);
    }

    const result = await otpService.createOrUpdateOtp(email, 'REGISTER');

    return c.json({
      success: true,
      message: 'Kode OTP telah dikirim ke email Anda.',
    });
  }
);

// =====================================================================
// ENDPOINT 9: VERIFY OTP FOR REGISTER & COMPLETE REGISTRATION
// =====================================================================
authRouter.post(
  '/register/verify',
  rateLimiter('auth:register', 'ip'),
  zValidator('json', VerifyOtpSchema.and(z.object({
    fullName: z.string().min(2, 'Nama minimal 2 karakter').max(100),
    phone: z.string().regex(/^08\d{8,13}$/, 'Format nomor HP Indonesia tidak valid'),
  }))),
  async (c) => {
    const { email, otp, fullName, phone } = c.req.valid('json');

    // Verifikasi OTP
    const verification = await otpService.verifyOtp(email, otp, 'REGISTER');

    if (!verification.valid) {
      await otpService.incrementAttempts(email, 'REGISTER');
      throw new Error(verification.message?.includes('kadaluarsa') ? 'OTP_EXPIRED' : 'OTP_INVALID');
    }

    // Cek lagi apakah email sudah terdaftar (race condition prevention)
    const existingUser = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null },
    });

    if (existingUser) {
      return c.json({
        success: false,
        error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'Email sudah terdaftar.' },
      }, 409);
    }

    // Buat user baru dengan password random (user login via OTP selanjutnya)
    const randomPassword = randomBytes(16).toString('hex');
    const result = await authService.register(fullName, phone, randomPassword, email);

    // Auto-login setelah register
    const user = await prismaAuth.globalUser.findFirst({
      where: { email },
    });

    if (user) {
      const tokens = await tokenService.generateTokenPair(user.id, null, user.role);
      injectSecureCookies(c, tokens.accessToken, tokens.refreshToken);

      return c.json({
        success: true,
        message: 'Registrasi berhasil.',
        data: {
          user: {
            id: user.id,
            fullName: user.fullName,
            role: user.role,
          },
          redirectUrl: executeEcosystemRoleRouting(user.role),
        },
      });
    }

    return c.json({
      success: true,
      message: 'Registrasi berhasil. Silakan login.',
      data: result,
    }, 201);
  }
);

// =====================================================================
// ENDPOINT 10: FORGOT PASSWORD - REQUEST OTP
// =====================================================================
authRouter.post(
  '/forgot-password',
  rateLimiter('auth:forgot-password', 'ip'),
  zValidator('json', ForgotPasswordSchema),
  async (c) => {
    const { email } = c.req.valid('json');

    // Cek apakah user ada
    const user = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null, isOauth: false },
    });

    // Jika user OAuth, tolak dengan pesan yang aman
    if (user?.isOauth) {
      return c.json({
        success: false,
        error: { code: 'OAUTH_ACCOUNT', message: 'Akun ini terhubung dengan Google. Silakan login dengan Google.' },
      }, 400);
    }

    // Selalu response sama untuk mencegah enumeration
    await otpService.createOrUpdateOtp(email, 'RESET_PASSWORD');

    return c.json({
      success: true,
      message: 'Jika email terdaftar, kode reset password telah dikirim.',
    });
  }
);

// =====================================================================
// ENDPOINT 11: RESET PASSWORD
// =====================================================================
authRouter.post(
  '/reset-password',
  rateLimiter('auth:reset-password', 'ip'),
  zValidator('json', ResetPasswordSchema),
  async (c) => {
    const { email, otp, newPassword } = c.req.valid('json');

    // Verifikasi OTP
    const verification = await otpService.verifyOtp(email, otp, 'RESET_PASSWORD');

    if (!verification.valid) {
      await otpService.incrementAttempts(email, 'RESET_PASSWORD');
      throw new Error(verification.message?.includes('kadaluarsa') ? 'OTP_EXPIRED' : 'OTP_INVALID');
    }

    // Cari user
    const user = await prismaAuth.globalUser.findFirst({
      where: { email, deletedAt: null, isOauth: false },
    });

    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    // Hash password baru
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await prismaAuth.globalUser.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Revoke semua refresh token lama (security)
    await tokenService.revokeAll(user.id);

    return c.json({
      success: true,
      message: 'Password berhasil direset. Silakan login dengan password baru.',
    });
  }
);