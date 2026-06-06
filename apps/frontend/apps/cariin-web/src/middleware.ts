import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export function middleware(request: NextRequest) {
  // Gunakan Web Crypto API bawaan (tidak perlu di-import)
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self'  https://*.r2.cloudflarestorage.com https://pub-*.r2.dev https://lh3.googleusercontent.com`,
    `connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'} wss://${new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').host}`,
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');

  const res = NextResponse.next({
    request: { headers: new Headers(request.headers) },
  });

  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-Nonce', nonce);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};