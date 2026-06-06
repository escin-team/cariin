// utils/api-error.ts — Helper fungsi untuk handle error dari API

import { HTTPError } from 'ky';
import type { ApiError, ErrorCode } from '@/types/api';

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Coba parse response dari ky
    try {
      const body = JSON.parse(error.message) as ApiError;
      return body.message ?? 'Terjadi kesalahan. Silakan coba lagi.';
    } catch {
      return 'Terjadi kesalahan. Silakan coba lagi.';
    }
  }
  return 'Terjadi kesalahan tidak diketahui.';
}

export function getErrorCode(error: unknown): ErrorCode | null {
  if (error instanceof HTTPError) {
    try {
      const body = JSON.parse(error.message) as ApiError;
      return body.error as ErrorCode;
    } catch {
      return null;
    }
  }
  return null;
}

// Pola handle error di komponen:
/*
const handleSubmit = async (data: FormData) => {
  try {
    await cariinApi.post('v1/orders', { json: data }).json();
    toast.success('Pesanan berhasil dibuat!');
  } catch (err) {
    if (err instanceof HTTPError) {
      const body = await err.response.json<ApiError>();
      
      switch (body.error) {
        case 'STOCK_INSUFFICIENT':
          toast.error('Stok tidak mencukupi.');
          break;
        case 'UNAUTHORIZED':
          router.push('/login');
          break;
        case 'RATE_LIMIT_EXCEEDED':
          toast.error('Terlalu banyak permintaan. Coba lagi nanti.');
          break;
        default:
          toast.error(body.message ?? 'Terjadi kesalahan.');
      }
    }
  }
};
*/
