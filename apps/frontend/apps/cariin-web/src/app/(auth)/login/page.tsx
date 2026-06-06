'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cariinApi } from '@cariin/http-client';
import { HTTPError } from 'ky';
import type { ApiError } from '@/types/api';

const loginSchema = z.object({
  email: z.string().email('Email tidak valid'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    setMessage(null);

    try {
      await cariinApi.post('v1/auth/login', { json: data }).json();
      // Selalu tampilkan pesan sukses meski email tidak terdaftar (anti-enumeration)
      setMessage('Jika email terdaftar, OTP telah dikirim ke email Anda.');
      // Simpan email di sessionStorage untuk step verifikasi
      sessionStorage.setItem('login_email', data.email);
      router.push('/login/verify');
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

  return (
    <div>
      <h2 className="text-2xl font-bold text-center mb-6">Masuk</h2>

      {message && (
        <div className={`mb-4 p-3 rounded ${message.includes('OTP') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
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
          {isLoading ? 'Mengirim...' : 'Kirim OTP'}
        </button>
      </form>

      <div className="mt-6 text-center text-sm">
        <p className="text-gray-600">
          Belum punya akun?{' '}
          <Link href="/register" className="text-primary hover:underline">
            Daftar
          </Link>
        </p>
      </div>

      <div className="mt-4 text-center">
        <Link href="/forgot-password" className="text-sm text-gray-600 hover:underline">
          Lupa password?
        </Link>
      </div>
    </div>
  );
}

import Link from 'next/link';
