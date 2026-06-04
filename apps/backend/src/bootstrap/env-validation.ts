import { z } from 'zod';

/**
 * Environment variable validation — dijalankan saat startup.
 * Jika ada env yang missing/invalid, proses langsung exit.
 * Rule: [API-2] ENV VARIABLE WAJIB DIVALIDASI SAAT STARTUP
 */
const envSchema = z.object({
  // Database — dual pool
  DATABASE_URL: z.string().url('DATABASE_URL harus berupa URL yang valid'),
  DATABASE_URL_AUTH: z.string().url('DATABASE_URL_AUTH harus berupa URL yang valid'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL harus berupa URL yang valid'),

  // JWT RS256 keypair
  JWT_PRIVATE_KEY: z.string().min(100, 'JWT_PRIVATE_KEY terlalu pendek — pastikan ini RSA private key'),
  JWT_PUBLIC_KEY: z.string().min(100, 'JWT_PUBLIC_KEY terlalu pendek — pastikan ini RSA public key'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET minimal 32 karakter'),

  // CORS
  CORS_ALLOWED_ORIGINS: z.string().min(1, 'CORS_ALLOWED_ORIGINS tidak boleh kosong'),

  // Internal Secret
  INTERNAL_SECRET_KEY: z.string().min(32, 'INTERNAL_SECRET_KEY minimal 32 karakter'),

  // Config
  WALLET_MAX_BALANCE: z.string().default('50000000'),

  // Optional
  SENTRY_DSN: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('4000'),

  //Google
  // Pastikan ini ada di dalam skema env kamu
  GOOGLE_CLIENT_ID: z.string().min(1, 'Google Client ID wajib diisi'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
