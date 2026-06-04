import { Context, Next } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../bootstrap/env-validation.js';

export const verifyWebhook = (provider: 'XENDIT' | 'MIDTRANS' | 'INTERNAL') => {
  return async (c: Context, next: Next) => {
    const timestampStr = c.req.header('X-Webhook-Timestamp');
    const signature = c.req.header('X-Webhook-Signature');
    
    if (!timestampStr || !signature) {
      return c.json({ error: 'MISSING_WEBHOOK_HEADERS' }, 401);
    }

    // Lapisan 1: Timestamp check (max 5 menit)
    const webhookTimestamp = parseInt(timestampStr, 10);
    const timeDiff = Math.abs(Math.floor(Date.now() / 1000) - webhookTimestamp);
    if (timeDiff > 300) {
      return c.json({ error: 'WEBHOOK_TIMESTAMP_EXPIRED' }, 401);
    }

    // Lapisan 2: Hex format guard (Mencegah crash di timingSafeEqual)
    const isValidHex = /^[0-9a-f]{64}$/i.test(signature);
    if (!isValidHex) {
      return c.json({ error: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
    }

    const rawBody = await c.req.text();
    
    // Pilih secret berdasarkan provider (Disesuaikan dengan env-validation.ts Anda)
    let secretKey = '';
    if (provider === 'XENDIT') secretKey = env.WEBHOOK_SECRET_XENDIT;
    else if (provider === 'MIDTRANS') secretKey = env.WEBHOOK_SECRET_MIDTRANS;
    else secretKey = env.INTERNAL_SECRET_KEY; // ✅ FIX: Sesuai env-validation.ts
    
    // Lapisan 3: HMAC constant-time compare
    const expected = createHmac('sha256', secretKey)
      .update(`${webhookTimestamp}.${rawBody}`)
      .digest('hex');
      
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
      return c.json({ error: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
    }

    c.set('verifiedBody', JSON.parse(rawBody));
    await next();
  };
};

// 👇 TAMBAHAN: Alias backward-compatibility 
// Agar router yang mengimport `internalAuthMiddleware` tidak error
export const internalAuthMiddleware = verifyWebhook;