/**
 * Per-thread "live voice" toggle: while on, each assistant message that
 * finishes in that thread is queued for the speech service.
 */

import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { stopSpeaking } from "./lib/claudeVoicePlayer";

const LIVE_VOICE_STORAGE_KEY = "t3code:live-voice:v1";

interface LiveVoiceStoreState {
  /** Only threads with live voice on are stored. */
  byThreadKey: Record<string, true>;
  setLiveVoice: (ref: ScopedThreadRef, enabled: boolean) => void;
}

export const useLiveVoiceStore = create<LiveVoiceStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      setLiveVoice: (ref, enabled) => {
        const threadKey = scopedThreadKey(ref);
        // switching it off silences whatever live mode had queued
        if (!enabled) stopSpeaking();
        set((state) => {
          if ((state.byThreadKey[threadKey] === true) === enabled) return state;
          const byThreadKey = { ...state.byThreadKey };
          if (enabled) byThreadKey[threadKey] = true;
          else delete byThreadKey[threadKey];
          return { byThreadKey };
        });
      },
    }),
    {
      name: LIVE_VOICE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
    },
  ),
);

export function selectLiveVoiceEnabled(
  byThreadKey: Record<string, true>,
  ref: ScopedThreadRef | null,
): boolean {
  return ref !== null && byThreadKey[scopedThreadKey(ref)] === true;
}
