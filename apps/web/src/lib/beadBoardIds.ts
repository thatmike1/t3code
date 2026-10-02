import { useMemo, useSyncExternalStore } from "react";
import type { ClientSettings } from "@t3tools/contracts/settings";

const EMPTY_IDS: ReadonlySet<string> = new Set();
const STALE_AFTER_MS = 60_000;

/** fetches all configured boards; a missing board makes short-id ownership uncertain. */
export async function fetchBeadBoardIds(
  boards: ClientSettings["beadBoards"],
): Promise<ReadonlySet<string>> {
  try {
    const results = await Promise.all(
      boards.map(async (board) => {
        const response = await fetch(`${board.origin.replace(/\/+$/, "")}/api/issue-ids`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (!response.ok) throw new Error("board unavailable");
        const body: unknown = await response.json();
        if (
          typeof body !== "object" ||
          body === null ||
          !("ids" in body) ||
          !Array.isArray(body.ids) ||
          !body.ids.every((id: unknown) => typeof id === "string")
        ) {
          throw new Error("invalid board response");
        }
        const ids = body.ids.filter((id: string) => id.startsWith(`${board.prefix}-`));
        if (body.ids.length > 0 && ids.length === 0)
          throw new Error("board belongs to another repository");
        return ids;
      }),
    );
    return new Set(results.flat());
  } catch {
    return EMPTY_IDS;
  }
}

function createStore(boards: ClientSettings["beadBoards"]) {
  let ids = EMPTY_IDS;
  let inFlight = false;
  let fetchedAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const refresh = () => {
    if (inFlight || Date.now() - fetchedAt < STALE_AFTER_MS) return;
    inFlight = true;
    void fetchBeadBoardIds(boards).then((next) => {
      ids = next;
      fetchedAt = Date.now();
      inFlight = false;
      for (const listener of listeners) listener();
    });
  };
  return {
    getSnapshot: () => ids,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (!timer) timer = setInterval(refresh, STALE_AFTER_MS);
      refresh();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
  };
}

const stores = new Map<string, ReturnType<typeof createStore>>();

/** shares one refreshed id index across all messages for a board configuration. */
export function useBeadBoardIds(boards: ClientSettings["beadBoards"]): ReadonlySet<string> {
  const store = useMemo(() => {
    const key = JSON.stringify(boards);
    let entry = stores.get(key);
    if (!entry) {
      entry = createStore(boards);
      stores.set(key, entry);
    }
    return entry;
  }, [boards]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_IDS);
}
