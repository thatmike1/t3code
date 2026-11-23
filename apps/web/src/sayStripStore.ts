/**
 * Whether the spoken summary strip is folded away; one choice for every
 * thread, remembered across restarts.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const SAY_STRIP_STORAGE_KEY = "t3code:say-strip:v1";

interface SayStripStoreState {
  collapsed: boolean;
  toggleCollapsed: () => void;
}

export const useSayStripStore = create<SayStripStoreState>()(
  persist(
    (set) => ({
      collapsed: false,
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    {
      name: SAY_STRIP_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ collapsed: state.collapsed }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SayStripStoreState>;
        return { ...current, collapsed: saved.collapsed === true };
      },
    },
  ),
);
