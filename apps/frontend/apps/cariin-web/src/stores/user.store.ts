// stores/user.store.ts
import { create } from 'zustand';
import { cariinApi } from '@cariin/http-client';
import type { ApiSuccess, User } from '@/types/api';

// Jangan simpan token di state!
// Token ada di cookie HttpOnly — tidak bisa diakses JS

type UserStore = {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  fetchUser: () => Promise<void>;
};

export const useUserStore = create<UserStore>((set) => ({
  user: null,
  isLoading: false,
  setUser: (user) => set({ user }),
  fetchUser: async () => {
    set({ isLoading: true });
    try {
      const res = await cariinApi.get('v1/auth/me').json<ApiSuccess<User>>();
      set({ user: res.data });
    } catch {
      set({ user: null });
    } finally {
      set({ isLoading: false });
    }
  },
}));
