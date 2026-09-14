import { useSyncExternalStore } from "react";

import { BEAD_BOARD_ORIGIN } from "../markdown-bead-links";

/**
 * The ids bd-board knows, so a short id in inline code only becomes a chip
 * when it names a real bead. One fetch serves every message; a stale set is
 * refetched lazily so beads filed mid-session start linking. When bd-board is
 * down the set stays empty and short ids render as plain code.
 */

const STALE_AFTER_MS = 60_000;
const EMPTY_IDS: ReadonlySet<string> = new Set();

let knownIds: ReadonlySet<string> = EMPTY_IDS;
let fetchedAt = 0;
let inFlight = false;
const listeners = new Set<() => void>();

function refreshIfStale(): void {
  if (inFlight || Date.now() - fetchedAt < STALE_AFTER_MS) {
    return;
  }
  inFlight = true;
  fetch(`${BEAD_BOARD_ORIGIN}/api/issue-ids`)
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => {
      const ids = typeof body === "object" && body !== null && "ids" in body ? body.ids : null;
      if (Array.isArray(ids)) {
        knownIds = new Set(ids.filter((id): id is string => typeof id === "string"));
        for (const listener of listeners) {
          listener();
        }
      }
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight = false;
      fetchedAt = Date.now();
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  refreshIfStale();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadonlySet<string> {
  return knownIds;
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY_IDS;
}

/** Every bead id bd-board reported, empty until the first fetch lands. */
export function useBeadBoardIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
