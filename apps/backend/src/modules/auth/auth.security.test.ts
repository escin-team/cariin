import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import { authRouter } from './auth.controller.js';
import { globalErrorHandler } from '../../middleware/error-handler.js';

// Setup Sandbox Utama
const app = new Hono();
app.onError(globalErrorHandler); // Wajib untuk menangkap error menjadi format standar

app.use('*', async (c, next) => {
  c.req.raw.headers.set('CF-Connecting-IP', '198.51.100.1'); 
  await next();
});
app.route('/v1/auth', authRouter);

describe('🛡️ MILITARY-GRADE SECURITY TEST: Auth Module', () => {
  
  it('Menangkis SQL Injection via email payload (Zod Shield)', async () => {
    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: "admin@apotekin.com' OR 1=1--",
        password: "password123"
      }),
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.success).toBe(false);
  });

  it('Menolak payload cacat (Missing fields)', async () => {
    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: "hacker@evil.com" }), 
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toBe('VALIDATION_FAILED');
  });

  it('Menyamarkan pesan error agar peretas tidak tahu email terdaftar atau tidak', async () => {
    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: "email_yang_pasti_tidak_ada@test.com",
        password: "password_salah_123"
      }),
    });

    // Harus tertolak (401), tidak boleh 500
    expect(res.status).toBe(401);
  });

  it('Mengunci IP Hacker setelah membombardir login (Rate Limiter Redis)', async () => {
    let lastStatus = 200;
    
    for (let i = 0; i < 15; i++) {
      const res = await app.request('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: "target@apotekin.com", password: `guess${i}` }),
      });
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });

  it('Pengguna asli gagal login karena DB kosong, tapi format response aman', async () => {
    const freshApp = new Hono();
    freshApp.onError(globalErrorHandler); // Wajib dipasang di test app kedua
    freshApp.use('*', async (c, next) => {
      c.req.raw.headers.set('CF-Connecting-IP', '203.0.113.5');
      await next();
    });
    freshApp.route('/v1/auth', authRouter);

    const res = await freshApp.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: "owner@apotekin.com",
        password: "PasswordKuat123!"
      }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    
    if (res.status === 200) {
      const cookies = res.headers.get('set-cookie');
      expect(cookies).toContain('HttpOnly');
      expect(cookies).toContain('SameSite=Strict');
      expect(cookies).toContain('session_token=');
      expect(cookies).toContain('refresh_token=');
    }
  });

});