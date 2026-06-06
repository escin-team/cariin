'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cariinApi } from '@cariin/http-client';
import { HTTPError } from 'ky';
import type { ApiError } from '@/types/api';
import Link from 'next/link';

const otpSchema = z.object({
  otp: z.string().length(6, 'OTP harus 6 digit').regex(/^\d{6}$/, 'Hanya angka'),
});

type OtpForm = z.infer<typeof otpSchema>;

export default function RegisterVerifyPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState<string>('');

  useEffect(() => {
    const storedEmail = sessionStorage.getItem('register_email');
    if (!storedEmail) {
      router.push('/register');
      return;
    }
    setEmail(storedEmail);
  }, [router]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OtpForm>({
    resolver: zodResolver(otpSchema),
  });

  const onSubmit = async (data: OtpForm) => {
    setIsLoading(true);
    setMessage(null);

    try {
      await cariinApi
        .post('v1/auth/register/verify', { json: { email, otp: data.otp } })
        .json();

      // Clear stored email after successful registration
      sessionStorage.removeItem('register_email');
      
      // Redirect ke homepage setelah registrasi berhasil
      router.push('/');
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = await err.response.json<ApiError>();
        setMessage(body.message || 'Terjadi kesalahan. Silakan coba lagi.');
      } else {
        setMessage('Terjadi kesalahan. Silakan coba lagi.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      // Re-send registration OTP
      const storedFullName = sessionStorage.getItem('register_fullName') || 'User';
      await cariinApi.post('v1/auth/register', { json: { fullName: storedFullName, email } }).json();
      setMessage('Kode OTP baru telah dikirim ke email Anda.');
    } catch (err) {
      setMessage('Gagal mengirim ulang OTP. Silakan coba lagi.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!email) {
    return <div className="text-center py-8">Memuat...</div>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-center mb-2">Verifikasi Registrasi</h2>
      <p className="text-center text-gray-600 mb-6">
        Masukkan kode 6 digit yang dikirim ke <strong>{email}</strong>
      </p>

      {message && (
        <div
          className={`mb-4 p-3 rounded ${
            message.includes('OTP') || message.includes('baru')
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-1">
            Kode OTP
          </label>
          <input
            id="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            {...register('otp')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="000000"
            maxLength={6}
            disabled={isLoading}
          />
          {errors.otp && (
            <p className="mt-1 text-sm text-red-600">{errors.otp.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? 'Memverifikasi...' : 'Verifikasi & Daftar'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button
          onClick={handleResendOtp}
          disabled={isLoading}
          className="text-sm text-primary hover:underline disabled:opacity-50"
        >
          Kirim ulang OTP
        </button>
      </div>

      <div className="mt-4 text-center text-sm">
        <Link href="/register" className="text-gray-600 hover:underline">
          ← Kembali ke registrasi
        </Link>
      </div>
    </div>
  );
}
