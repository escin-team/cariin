import { z } from 'zod';

export const LoginSchema = z.object({
  identifier: z.string().min(1, 'Email atau nomor telepon wajib diisi').max(100),
  password: z.string().min(8, 'Password minimal 8 karakter').max(100),
});

export const GoogleLoginSchema = z.object({
  idToken: z.string().min(1, 'Google ID Token wajib diisi'),
});

// ✅ TAMBAHAN BARU: Schema untuk Registrasi
export const RegisterSchema = z.object({
  fullName: z.string().min(2, 'Nama lengkap minimal 2 karakter').max(100),
  phone: z
    .string()
    .regex(/^08\d{8,13}$/, 'Format nomor HP Indonesia tidak valid (contoh: 08123456789)'),
  email: z.string().email('Format email tidak valid').optional(),
  password: z
    .string()
    .min(8, 'Password minimal 8 karakter')
    .max(100)
    .regex(/[A-Z]/, 'Password harus mengandung minimal 1 huruf kapital')
    .regex(/[0-9]/, 'Password harus mengandung minimal 1 angka'),
});