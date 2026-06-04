// apps/backend/src/modules/auth/auth.schema.ts
import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Format email tidak valid.').max(255),
  password: z.string().min(8, 'Password minimal 8 karakter.'),
});

export const GoogleLoginSchema = z.object({
  idToken: z.string().min(1, 'Token Google tidak boleh kosong.'),
});

export type LoginDto = z.infer<typeof LoginSchema>;
export type GoogleLoginDto = z.infer<typeof GoogleLoginSchema>;