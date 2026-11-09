import { useSyncExternalStore } from "react";
import type { ClientSettings } from "@t3tools/contracts/settings";

const EMPTY_IDS: ReadonlySet<string> = new Set();
const STALE_AFTER_MS = 60_000;

async function fetchBoardIds(board: ClientSettings["beadBoards"][number]): Promise<string[]> {
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
  if (body.ids.length > 0 && ids.length === 0) {
    throw new Error("board belongs to another repository");
  }
  return ids;
}

/**
 * known ids of every board that answered; a failed board contributes nothing. a short id then
 * resolves if it is unique among the boards that answered, so while one board is down its
 * suffixes can shadow nothing and a same-suffix id on the up board links as if unique.
 */
export async function fetchBeadBoardIds(
  boards: ClientSettings["beadBoards"],
): Promise<ReadonlySet<string>> {
  const results = await Promise.allSettled(boards.map(fetchBoardIds));
  const ids = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  return ids.length === 0 ? EMPTY_IDS : new Set(ids);
}

function sameIds(previous: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
  if (previous.size !== next.size) return false;
  for (const id of next) if (!previous.has(id)) return false;
  return true;
}

export function createBeadBoardIdsStore(
  boards: ClientSettings["beadBoards"],
  fetchIds: typeof fetchBeadBoardIds = fetchBeadBoardIds,
) {
  let ids = EMPTY_IDS;
  let inFlight = false;
  let fetchedAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const refresh = () => {
    if (inFlight || Date.now() - fetchedAt < STALE_AFTER_MS) return;
    inFlight = true;
    return fetchIds(boards).then((next) => {
      fetchedAt = Date.now();
      inFlight = false;
      // the remark plugins are cached on this identity, so an unchanged refresh keeps it
      if (sameIds(ids, next)) return;
      ids = next;
      for (const listener of listeners) listener();
    });
  };
  return {
    refresh,
    getSnapshot: () => ids,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (!timer) timer = setInterval(refresh, STALE_AFTER_MS);
      void refresh();
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

const stores = new Map<string, ReturnType<typeof createBeadBoardIdsStore>>();

/** shares one refreshed id index across all messages for a board configuration. */
export function useBeadBoardIds(boards: ClientSettings["beadBoards"]): ReadonlySet<string> {
  const store = (() => {
    const key = JSON.stringify(boards);
    let entry = stores.get(key);
    if (!entry) {
      entry = createBeadBoardIdsStore(boards);
      stores.set(key, entry);
    }
    return entry;
  })();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_IDS);
}
