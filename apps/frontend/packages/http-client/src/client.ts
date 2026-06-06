// packages/http-client/src/client.ts
// Gunakan instance ini di SEMUA request — jangan buat ky/fetch sendiri

import ky from 'ky';

export const cariinApi = ky.create({
  prefixUrl:   process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL || 'http://localhost:3001',
  credentials: 'include', // WAJIB — untuk kirim cookie HttpOnly
  headers: {
    'X-Cariin-Client': 'true',
    'X-API-Version':   'v1',
  },
  hooks: {
    afterResponse: [(_req, _opts, res) => {
      if (res.headers.get('X-API-Deprecated') === 'true')
        console.warn('[API DEPRECATED]', res.url);
      return res;
    }],
    beforeError: [(err) => {
      if (err.response?.status === 429)
        console.warn('[RATE LIMIT]', err.response.headers.get('Retry-After'));
      return err;
    }],
  },
});
