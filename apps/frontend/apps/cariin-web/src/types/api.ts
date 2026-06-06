// types/api.ts — Tipe data API yang digunakan di seluruh aplikasi

export type ApiSuccess<T> = {
  success: true;
  data: T;
  idempotent?: boolean; // true jika request duplikat (sudah diproses sebelumnya)
};

export type ApiError = {
  success: false;
  error: string;   // error code
  message: string; // pesan dalam Bahasa Indonesia
};

export type User = {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  avatarUrl?: string;
  emailVerified: boolean;
};

export type WalletBalance = {
  balance: number;
  currency: 'IDR';
};

export type WalletTransaction = {
  id: string;
  type: 'TOPUP' | 'TOPUP_PENDING' | 'PAYMENT' | 'REFUND' | 'COMMISSION';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  status: string;
  referenceId?: string;
  note?: string;
  createdAt: string; // ISO date string
};

export type OrderItem = {
  id: string;
  serviceId: string;
  serviceName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

export type Order = {
  id: string;
  userId: string;
  tenantId: string;
  serviceId: string;
  quantity: number;
  totalAmount: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
  notes?: string;
  idempotencyKey: string;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
};

// Error codes yang mungkin diterima
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'ACCOUNT_SUSPENDED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_MAX_ATTEMPTS_EXCEEDED'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'GOOGLE_AUTH_CANCELLED'
  | 'WALLET_MAX_BALANCE_EXCEEDED'
  | 'WALLET_NOT_FOUND'
  | 'STOCK_INSUFFICIENT'
  | 'SERVICE_INACTIVE'
  | 'RATE_LIMIT_EXCEEDED'
  | 'NOT_FOUND'
  | 'INTERNAL_SERVER_ERROR';
