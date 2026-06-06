'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cariinApi } from '@cariin/http-client';
import { HTTPError } from 'ky';
import type { ApiError } from '@/types/api';
import { formatRupiah } from '@/utils/currency';
import { useFeatureFlags } from '@cariin/ui';

const topupSchema = z.object({
  amount: z.number().min(10000, 'Minimum top-up Rp 10.000').max(50000000, 'Maksimal top-up Rp 50.000.000'),
  method: z.enum(['BRIVA', 'QRIS', 'STRIPE', 'CRYPTO']),
});

type TopupForm = z.infer<typeof topupSchema>;

const PRESET_AMOUNTS = [10000, 25000, 50000, 100000, 250000, 500000];

export default function WalletTopupPage() {
  const router = useRouter();
  const flags = useFeatureFlags();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<TopupForm>({
    resolver: zodResolver(topupSchema),
    defaultValues: {
      method: 'BRIVA',
    },
  });

  const watchedAmount = watch('amount');

  const handlePresetClick = (amount: number) => {
    setSelectedAmount(amount);
    setValue('amount', amount);
  };

  const onSubmit = async (data: TopupForm) => {
    setIsLoading(true);
    setMessage(null);

    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await cariinApi
        .post('v1/wallet/topup', {
          json: data,
          headers: { 'X-Idempotency-Key': idempotencyKey },
        })
        .json<{ success: true; data: { paymentUrl?: string; instructions?: string } }>();

      // Redirect ke payment gateway jika ada URL
      if (res.data.paymentUrl) {
        window.open(res.data.paymentUrl, '_blank');
      }

      setMessage('Top-up berhasil diinisiasi. Silakan selesaikan pembayaran.');
      
      // Redirect ke halaman wallet setelah beberapa detik
      setTimeout(() => {
        router.push('/wallet');
      }, 3000);
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = await err.response.json<ApiError>();
        setMessage(body.message || 'Gagal memproses top-up.');
      } else {
        setMessage('Gagal memproses top-up.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Top Up Wallet</h1>

      {message && (
        <div className={`p-3 rounded ${message.includes('berhasil') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
        {/* Amount Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Pilih Nominal
          </label>
          <div className="grid grid-cols-3 gap-3">
            {PRESET_AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => handlePresetClick(amount)}
                className={`py-3 px-4 rounded-md border-2 transition-colors ${
                  selectedAmount === amount
                    ? 'border-primary bg-primary-50 text-primary'
                    : 'border-gray-200 hover:border-primary'
                }`}
              >
                {formatRupiah(amount)}
              </button>
            ))}
          </div>
          
          <div className="mt-4">
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
              Atau Masukkan Nominal Lainnya
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">Rp</span>
              <input
                id="amount"
                type="number"
                {...register('amount', { valueAsNumber: true })}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="50000"
                min={10000}
                max={50000000}
                disabled={isLoading}
              />
            </div>
            {errors.amount && (
              <p className="mt-1 text-sm text-red-600">{errors.amount.message}</p>
            )}
          </div>
        </div>

        {/* Payment Method */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Metode Pembayaran
          </label>
          <div className="space-y-3">
            {/* BRIVA */}
            <label className="flex items-center gap-3 p-4 border-2 rounded-md cursor-pointer hover:border-primary transition-colors">
              <input
                type="radio"
                value="BRIVA"
                {...register('method')}
                className="w-4 h-4 text-primary"
              />
              <div className="flex-1">
                <p className="font-medium text-gray-900">Transfer Bank BRI (Virtual Account)</p>
                <p className="text-sm text-gray-500">Proses otomatis via Virtual Account BRI</p>
              </div>
            </label>

            {/* QRIS */}
            <label className="flex items-center gap-3 p-4 border-2 rounded-md cursor-pointer hover:border-primary transition-colors">
              <input
                type="radio"
                value="QRIS"
                {...register('method')}
                className="w-4 h-4 text-primary"
              />
              <div className="flex-1">
                <p className="font-medium text-gray-900">QRIS / Payment Gateway</p>
                <p className="text-sm text-gray-500">Scan QR code untuk membayar</p>
              </div>
            </label>

            {/* STRIPE */}
            <label className="flex items-center gap-3 p-4 border-2 rounded-md cursor-pointer hover:border-primary transition-colors">
              <input
                type="radio"
                value="STRIPE"
                {...register('method')}
                className="w-4 h-4 text-primary"
              />
              <div className="flex-1">
                <p className="font-medium text-gray-900">Kartu Kredit (Visa/Mastercard)</p>
                <p className="text-sm text-gray-500">Diproses oleh Stripe</p>
              </div>
            </label>

            {/* CRYPTO - Feature flagged */}
            {flags.CRYPTO_PAYMENT_ENABLED && (
              <label className="flex items-center gap-3 p-4 border-2 rounded-md cursor-pointer hover:border-primary transition-colors">
                <input
                  type="radio"
                  value="CRYPTO"
                  {...register('method')}
                  className="w-4 h-4 text-primary"
                />
                <div className="flex-1">
                  <p className="font-medium text-gray-900">Aset Kripto</p>
                  <p className="text-sm text-gray-500">Bayar dengan Bitcoin, Ethereum, dll.</p>
                </div>
              </label>
            )}
          </div>
          {errors.method && (
            <p className="mt-1 text-sm text-red-600">{errors.method.message}</p>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading || !watchedAmount}
          className="w-full bg-primary text-white py-3 px-4 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
        >
          {isLoading ? 'Memproses...' : `Top Up ${watchedAmount ? formatRupiah(watchedAmount) : ''}`}
        </button>
      </form>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          <strong>Catatan:</strong> Saldo akan otomatis bertambah setelah pembayaran terkonfirmasi. 
          Untuk pertanyaan, hubungi customer support kami.
        </p>
      </div>
    </div>
  );
}
