// stores/wallet.store.ts
import { create } from 'zustand';
import { cariinApi } from '@cariin/http-client';
import type { ApiSuccess } from '@/types/api';

type WalletStore = {
  balance: number | null;
  fetchBalance: () => Promise<void>;
};

export const useWalletStore = create<WalletStore>((set) => ({
  balance: null,
  fetchBalance: async () => {
    const res = await cariinApi.get('v1/wallet/balance').json<ApiSuccess<{ balance: number }>>();
    set({ balance: res.data.balance });
  },
}));
