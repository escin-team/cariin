import { formatRupiah } from '@/utils/currency';

interface WalletBalanceProps {
  balance: number | null;
  isLoading?: boolean;
}

export function WalletBalance({ balance, isLoading = false }: WalletBalanceProps) {
  if (isLoading) {
    return (
      <div className="bg-primary text-white rounded-lg p-6">
        <p className="text-sm text-primary-100 mb-2">Saldo Saat Ini</p>
        <div className="h-8 w-32 bg-primary-200 rounded animate-pulse"></div>
      </div>
    );
  }

  return (
    <div className="bg-primary text-white rounded-lg p-6">
      <p className="text-sm text-primary-100 mb-2">Saldo Saat Ini</p>
      <p className="text-3xl font-bold">{balance !== null ? formatRupiah(balance) : '-'}</p>
    </div>
  );
}
