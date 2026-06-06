'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cariinApi } from '@cariin/http-client';
import { HTTPError } from 'ky';
import type { ApiError } from '@/types/api';
import Link from 'next/link';

const forgotPasswordSchema = z.object({
  email: z.string().email('Email tidak valid'),
});

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isSent, setIsSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordForm) => {
    setIsLoading(true);
    setMessage(null);

    try {
      await cariinApi.post('v1/auth/forgot-password', { json: data }).json();
      // Selalu tampilkan pesan sukses (anti-enumeration)
      setMessage('Jika email terdaftar, link reset password telah dikirim.');
      setIsSent(true);
      sessionStorage.setItem('reset_email', data.email);
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

  if (isSent) {
    return (
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">Cek Email Anda</h2>
        <p className="text-gray-600 mb-6">
          Kami telah mengirim link reset password ke email Anda.
        </p>
        <div className="space-y-4">
          <Link
            href="/login"
            className="block w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90 transition-colors"
          >
            Kembali ke Login
          </Link>
          <button
            onClick={() => {
              setIsSent(false);
              setMessage(null);
            }}
            className="text-sm text-primary hover:underline"
          >
            Kirim ulang email reset
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-center mb-2">Lupa Password</h2>
      <p className="text-center text-gray-600 mb-6">
        Masukkan email Anda untuk menerima link reset password
      </p>

      {message && (
        <div
          className={`mb-4 p-3 rounded ${
            message.includes('sukses') || message.includes('link')
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            {...register('email')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="nama@email.com"
            disabled={isLoading}
          />
          {errors.email && (
            <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? 'Mengirim...' : 'Kirim Link Reset'}
        </button>
      </form>

      <div className="mt-6 text-center text-sm">
        <Link href="/login" className="text-gray-600 hover:underline">
          ← Kembali ke login
        </Link>
      </div>
    </div>
  );
}
