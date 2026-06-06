'use client';

import { useEffect, useState } from 'react';
import { useUserStore } from '@/stores/user.store';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cariinApi } from '@cariin/http-client';
import { HTTPError } from 'ky';
import type { ApiError, User } from '@/types/api';

const profileSchema = z.object({
  fullName: z.string().min(2, 'Nama minimal 2 karakter').max(100),
  phone: z.string().optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const { user, fetchUser, setUser } = useUserStore();
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (user) {
      reset({
        fullName: user.fullName,
        phone: user.phone || '',
      });
    }
  }, [user, reset]);

  const onSubmit = async (data: ProfileForm) => {
    setIsLoading(true);
    setMessage(null);

    try {
      const res = await cariinApi
        .put('v1/user/profile', { json: data })
        .json<{ success: true; data: User }>();
      
      setUser(res.data);
      setMessage('Profil berhasil diperbarui!');
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = await err.response.json<ApiError>();
        setMessage(body.message || 'Gagal memperbarui profil.');
      } else {
        setMessage('Gagal memperbarui profil.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Profil Saya</h1>

      {message && (
        <div className={`p-3 rounded ${message.includes('berhasil') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {message}
        </div>
      )}

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 bg-primary text-white rounded-full flex items-center justify-center text-2xl font-bold">
          {user.fullName.charAt(0).toUpperCase()}
        </div>
        <div>
          <h2 className="text-lg font-semibold">{user.fullName}</h2>
          <p className="text-gray-500">{user.email}</p>
          {user.emailVerified && (
            <span className="inline-flex items-center text-xs text-green-600 mt-1">
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Email terverifikasi
            </span>
          )}
        </div>
      </div>

      {/* Edit Profile Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 bg-white p-6 rounded-lg shadow-sm">
        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1">
            Nama Lengkap
          </label>
          <input
            id="fullName"
            type="text"
            {...register('fullName')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            disabled={isLoading}
          />
          {errors.fullName && (
            <p className="mt-1 text-sm text-red-600">{errors.fullName.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={user.email}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500"
          />
          <p className="mt-1 text-xs text-gray-500">Email tidak dapat diubah</p>
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            Nomor Telepon (Opsional)
          </label>
          <input
            id="phone"
            type="tel"
            {...register('phone')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="081234567890"
            disabled={isLoading}
          />
          {errors.phone && (
            <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? 'Menyimpan...' : 'Simpan Perubahan'}
        </button>
      </form>

      {/* Logout Button */}
      <button
        onClick={async () => {
          try {
            await cariinApi.post('v1/auth/logout').json();
            window.location.href = '/login';
          } catch (err) {
            console.error('Logout failed:', err);
          }
        }}
        className="w-full bg-red-50 text-red-600 py-2 px-4 rounded-md hover:bg-red-100 transition-colors"
      >
        Keluar
      </button>
    </div>
  );
}
