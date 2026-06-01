import type { z } from 'zod';
import type { InitiateTopupSchema, ConfirmTopupSchema } from './wallet.schema.js';

export type InitiateTopupDto = z.infer<typeof InitiateTopupSchema>;
export type ConfirmTopupDto = z.infer<typeof ConfirmTopupSchema>;

export type WalletTransactionType =
  | 'TOPUP'
  | 'PAYMENT'
  | 'REFUND'
  | 'WITHDRAWAL'
  | 'ADJUSTMENT';

export type WalletTransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface InitiateTopupResult {
  transactionId: string;
  amount: string;
  status: WalletTransactionStatus;
  paymentMethod: string;
  vaNumber: string; // mock
  expiresAt: Date;
  idempotent: boolean;
}

export interface ConfirmTopupResult {
  transaction: {
    id: string;
    type: WalletTransactionType;
    status: WalletTransactionStatus;
    amount: string;
    balanceBefore: string | null;
    balanceAfter: string | null;
    referenceId: string | null;
    createdAt: Date;
  };
  wallet: {
    id: string;
    balance: string;
  };
}

/** Response envelope standar */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
