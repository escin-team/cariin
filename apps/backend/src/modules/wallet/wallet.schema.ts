import { z } from 'zod';

/**
 * Wallet Topup Schema — Zod Validation
 *
 * Rules diterapkan:
 * - [API-5] Anti-price tampering: amount adalah nominal topup terverifikasi
 * - Financial: BigInt-compatible (integer, dalam Rupiah)
 * - Error messages dalam Bahasa Indonesia (rule Zod)
 * - Schema di file terpisah, bukan inline di handler (rule konvensi)
 */

/** Batas topup (dalam Rupiah) */
const TOPUP_MIN_AMOUNT = 10_000;
const TOPUP_MAX_AMOUNT = 10_000_000;

export const InitiateTopupSchema = z.object({
  amount: z
    .number({
      required_error: 'Nominal topup wajib diisi.',
      invalid_type_error: 'Nominal topup harus berupa angka.',
    })
    .int('Nominal topup harus bilangan bulat (tanpa desimal).')
    .min(TOPUP_MIN_AMOUNT, `Minimal topup adalah Rp ${TOPUP_MIN_AMOUNT.toLocaleString('id-ID')}.`)
    .max(TOPUP_MAX_AMOUNT, `Maksimal topup adalah Rp ${TOPUP_MAX_AMOUNT.toLocaleString('id-ID')}.`),

  paymentMethod: z
    .string()
    .min(1, 'Metode pembayaran wajib diisi.')
    .max(50, 'Metode pembayaran tidak valid.'),

  description: z
    .string()
    .max(500, 'Deskripsi maksimal 500 karakter.')
    .optional(),
});

export const ConfirmTopupSchema = z.object({
  transactionId: z.string().uuid('Transaction ID tidak valid.'),
  referenceId: z.string().max(255, 'Reference ID maksimal 255 karakter.').optional(),
});
