// packages/ui/src/hooks/useFeatureFlags.ts
// SUDAH TERSEDIA — import dari sini, JANGAN buat ulang

'use client';
import { useState, useEffect, useRef } from 'react';
import { cariinApi } from '@cariin/http-client';

const DEFAULT_FLAGS = {
  RIDE_HAILING_ENABLED:   false, // Phase 2 — sembunyikan
  CAR_BOOKING_ENABLED:    false, // Phase 2 — sembunyikan
  FOOD_DELIVERY_ENABLED:  false, // Phase 2 — sembunyikan
  CRYPTO_PAYMENT_ENABLED: false, // Phase 2 — sembunyikan
};

export type FeatureFlags = typeof DEFAULT_FLAGS;

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [isLoading, setIsLoading] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Fetch initial flags
    async function fetchFlags() {
      try {
        const res = await cariinApi.get('api/feature-flags').json<{ success: boolean; data: Partial<FeatureFlags> }>();
        if (res.success) {
          setFlags((prev) => ({ ...prev, ...res.data }));
        }
      } catch (err) {
        console.error('[FEATURE FLAGS] Failed to fetch initial flags:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchFlags();

    // Setup SSE for real-time updates
    eventSourceRef.current = new EventSource(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/feature-flags/stream`);

    eventSourceRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { flag: keyof FeatureFlags; value: boolean };
        setFlags((prev) => ({ ...prev, [data.flag]: data.value }));
      } catch (err) {
        console.error('[FEATURE FLAGS] SSE parse error:', err);
      }
    };

    eventSourceRef.current.onerror = () => {
      console.warn('[FEATURE FLAGS] SSE connection error');
      eventSourceRef.current?.close();
      // Reconnect after 5 seconds
      setTimeout(() => {
        eventSourceRef.current = new EventSource(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/feature-flags/stream`);
      }, 5000);
    };

    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  return { flags, isLoading };
}
