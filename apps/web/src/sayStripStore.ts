/**
 * Where the spoken summary strip sits and whether it is folded away; one
 * choice for every thread, remembered across restarts.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import {
  nextSayStripPlacement,
  SAY_STRIP_PLACEMENTS,
  type SayStripPlacement,
} from "./lib/sayStrip.logic";

const SAY_STRIP_STORAGE_KEY = "t3code:say-strip:v1";

interface SayStripStoreState {
  placement: SayStripPlacement;
  collapsed: boolean;
  cyclePlacement: () => void;
  toggleCollapsed: () => void;
}

export const useSayStripStore = create<SayStripStoreState>()(
  persist(
    (set) => ({
      placement: "left-composer",
      collapsed: false,
      cyclePlacement: () => set((state) => ({ placement: nextSayStripPlacement(state.placement) })),
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    {
      name: SAY_STRIP_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ placement: state.placement, collapsed: state.collapsed }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SayStripStoreState>;
        return {
          ...current,
          placement: SAY_STRIP_PLACEMENTS.includes(saved.placement as SayStripPlacement)
            ? (saved.placement as SayStripPlacement)
            : current.placement,
          collapsed: saved.collapsed === true,
        };
      },
    },
  ),
);
