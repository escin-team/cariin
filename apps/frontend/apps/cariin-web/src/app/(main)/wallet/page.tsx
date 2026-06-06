'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWalletStore } from '@/stores/wallet.store';
import { cariinApi } from '@cariin/http-client';
import { formatRupiah, formatDate } from '@/utils/currency';
import type { WalletTransaction } from '@/types/api';

export default function WalletPage() {
  const { balance, fetchBalance } = useWalletStore();
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    fetchBalance();
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    setIsLoading(true);
    try {
      const res = await cariinApi
        .get(`v1/wallet/transactions?page=${page}&limit=20`)
        .json<{ success: true; data: { transactions: WalletTransaction[]; total: number } }>();
      
      if (res.data.transactions.length === 0) {
        setHasMore(false);
      } else {
        setTransactions((prev) => [...prev, ...res.data.transactions]);
        setHasMore(prev.length + res.data.transactions.length < res.data.total);
      }
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = () => {
    setPage((prev) => prev + 1);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Wallet Saya</h1>

      {/* Balance Card */}
      <div className="bg-primary text-white rounded-lg p-6">
        <p className="text-sm text-primary-100 mb-2">Saldo Saat Ini</p>
        <p className="text-3xl font-bold">{balance !== null ? formatRupiah(balance) : 'Memuat...'}</p>
        
        <div className="mt-4 flex gap-3">
          <Link
            href="/wallet/topup"
            className="flex-1 bg-white text-primary py-2 px-4 rounded-md text-center font-medium hover:bg-primary-50 transition-colors"
          >
            Top Up
          </Link>
          <button
            onClick={() => fetchBalance()}
            className="bg-primary-700 text-white py-2 px-4 rounded-md font-medium hover:bg-primary-600 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Transactions */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Riwayat Transaksi</h2>
        
        {transactions.length === 0 && !isLoading ? (
          <div className="text-center py-8 text-gray-500">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>Belum ada transaksi</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="bg-white rounded-lg p-4 shadow-sm border border-gray-100 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        tx.type === 'TOPUP' || tx.type === 'REFUND' || tx.type === 'COMMISSION'
                          ? 'bg-green-100 text-green-600'
                          : 'bg-red-100 text-red-600'
                      }`}
                    >
                      {tx.type === 'TOPUP' || tx.type === 'REFUND' || tx.type === 'COMMISSION' ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {tx.type === 'TOPUP' && 'Top Up Wallet'}
                        {tx.type === 'TOPUP_PENDING' && 'Top Up Pending'}
                        {tx.type === 'PAYMENT' && 'Pembayaran Order'}
                        {tx.type === 'REFUND' && 'Pengembalian Dana'}
                        {tx.type === 'COMMISSION' && 'Komisi'}
                      </p>
                      <p className="text-sm text-gray-500">{formatDate(tx.createdAt)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-semibold ${
                        tx.type === 'TOPUP' || tx.type === 'REFUND' || tx.type === 'COMMISSION'
                          ? 'text-green-600'
                          : 'text-red-600'
                      }`}
                    >
                      {tx.type === 'TOPUP' || tx.type === 'REFUND' || tx.type === 'COMMISSION' ? '+' : '-'}
                      {formatRupiah(tx.amount)}
                    </p>
                    <p className="text-xs text-gray-500 capitalize">{tx.status.toLowerCase()}</p>
                  </div>
                </div>
              ))}
            </div>

            {isLoading && (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
              </div>
            )}

            {hasMore && !isLoading && (
              <button
                onClick={loadMore}
                className="w-full mt-4 bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors"
              >
                Muat Lebih Banyak
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
