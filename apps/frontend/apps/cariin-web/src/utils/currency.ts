// utils/currency.ts — Helper fungsi untuk format mata uang

export function formatRupiah(amount: number | bigint): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(Number(amount));
}

// Contoh penggunaan:
// formatRupiah(1500000) → "Rp 1.500.000"

export function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(dateString));
}

// Contoh penggunaan:
// formatDate("2025-01-12T14:30:00Z") → "12 Jan 2025, 14.30"
