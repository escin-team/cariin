import { z } from 'zod';

export const ConfirmTopupSchema = z.object({
  transactionId: z.string().uuid(),
  amountPaid: z.string().regex(/^\d+$/, 'Nominal harus berupa angka'), // String karena BigInt dari JSON
  provider: z.string().min(1),
  providerReference: z.string().optional(),
});