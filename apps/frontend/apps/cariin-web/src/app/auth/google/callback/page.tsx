'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cariinApi } from '@cariin/http-client';

export default function GoogleCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      // User cancelled Google auth or error occurred
      router.push('/login?error=google_auth_cancelled');
      return;
    }

    if (!code) {
      router.push('/login?error=invalid_callback');
      return;
    }

    // Exchange code for session
    async function exchangeCode() {
      try {
        await cariinApi.post('v1/auth/google/callback', { json: { code } }).json();
        // Success - redirect to homepage (server will set cookies)
        router.push('/');
      } catch (err) {
        console.error('Google OAuth callback failed:', err);
        router.push('/login?error=google_auth_failed');
      }
    }

    exchangeCode();
  }, [searchParams, router]);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
      <p className="text-gray-600">Memproses login dengan Google...</p>
    </div>
  );
}
