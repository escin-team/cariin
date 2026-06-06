'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useFeatureFlags } from '@cariin/ui';
import { useUserStore } from '@/stores/user.store';
import { useWalletStore } from '@/stores/wallet.store';
import { formatRupiah } from '@/utils/currency';

export default function HomePage() {
  const flags = useFeatureFlags();
  const { user, fetchUser } = useUserStore();
  const { balance, fetchBalance } = useWalletStore();

  useEffect(() => {
    fetchUser();
    fetchBalance();
  }, [fetchUser, fetchBalance]);

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-primary text-white rounded-lg p-6">
        <h1 className="text-2xl font-bold mb-2">
          Selamat datang{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}!
        </h1>
        <p className="text-primary-100">
          Satu aplikasi untuk semua kebutuhan Anda
        </p>
        
        {balance !== null && (
          <div className="mt-4 pt-4 border-t border-primary-200">
            <p className="text-sm text-primary-100">Saldo Wallet</p>
            <p className="text-xl font-bold">{formatRupiah(balance)}</p>
          </div>
        )}
      </div>

      {/* Services Grid */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Layanan Tersedia</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {/* Phase 1 - Always visible */}
          <Link
            href="/apotek"
            className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100"
          >
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900">Apotekin</h3>
            <p className="text-sm text-gray-500">Beli obat & produk kesehatan</p>
          </Link>

          <Link
            href="/laundry"
            className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100"
          >
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900">Cuciin</h3>
            <p className="text-sm text-gray-500">Laundry bersih & wangi</p>
          </Link>

          {/* Phase 2 - Feature flagged */}
          {flags.RIDE_HAILING_ENABLED && (
            <Link
              href="/ride"
              className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100"
            >
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900">Ride</h3>
              <p className="text-sm text-gray-500">Ojek motor online</p>
            </Link>
          )}

          {flags.FOOD_DELIVERY_ENABLED && (
            <Link
              href="/food"
              className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100"
            >
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900">Food</h3>
              <p className="text-sm text-gray-500">Pesan makanan</p>
            </Link>
          )}

          {flags.CAR_BOOKING_ENABLED && (
            <Link
              href="/car"
              className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100"
            >
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900">Car</h3>
              <p className="text-sm text-gray-500">Sewa mobil</p>
            </Link>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Aksi Cepat</h2>
        <div className="grid grid-cols-2 gap-4">
          <Link
            href="/wallet/topup"
            className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100 flex items-center gap-3"
          >
            <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <span className="font-medium text-gray-900">Top Up Wallet</span>
          </Link>

          <Link
            href="/orders"
            className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100 flex items-center gap-3"
          >
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="font-medium text-gray-900">Riwayat Order</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
