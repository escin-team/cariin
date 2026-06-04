import { z } from 'zod';

/**
 * Schema untuk inisiasi topup (User request topup ke server)
 */
export const InitiateTopupSchema = z.object({
  amount: z
    .string()
    .regex(/^[1-9]\d*$/, 'Nominal harus berupa angka bulat lebih dari 0'),
  paymentMethod: z.string().min(1, 'Metode pembayaran wajib diisi'),
  provider: z.string().min(1, 'Provider pembayaran wajib diisi'),
});

/**
 * Schema untuk konfirmasi topup (Webhook dari Payment Gateway / Internal)
 */
export const ConfirmTopupSchema = z.object({
  transactionId: z.string().uuid('ID transaksi tidak valid'),
  amountPaid: z.string().regex(/^\d+$/, 'Nominal harus berupa angka'), 
  provider: z.string().min(1),
  providerReference: z.string().optional(),
});

export const TransactionParamsSchema = z.object({
  transactionId: z.string().uuid(),
});