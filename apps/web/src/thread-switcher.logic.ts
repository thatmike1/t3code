import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

export interface ThreadSwitcherGesture {
  readonly threads: ReadonlyArray<ScopedThreadRef>;
  readonly selectedIndex: number;
}

export function visitThread(
  history: ReadonlyArray<ScopedThreadRef>,
  thread: ScopedThreadRef,
): ReadonlyArray<ScopedThreadRef> {
  const key = scopedThreadKey(thread);
  return [thread, ...history.filter((candidate) => scopedThreadKey(candidate) !== key)];
}

export function pruneThreadHistory(
  history: ReadonlyArray<ScopedThreadRef>,
  availableKeys: ReadonlySet<string>,
): ReadonlyArray<ScopedThreadRef> {
  return history.filter((thread) => availableKeys.has(scopedThreadKey(thread)));
}

export function beginThreadSwitch(
  history: ReadonlyArray<ScopedThreadRef>,
  current: ScopedThreadRef,
  reverse: boolean,
): ThreadSwitcherGesture | null {
  const threads = visitThread(history, current);
  if (threads.length < 2) return null;
  return {
    threads,
    selectedIndex: reverse ? threads.length - 1 : 1,
  };
}

export function stepThreadSwitch(
  gesture: ThreadSwitcherGesture,
  reverse: boolean,
): ThreadSwitcherGesture {
  const delta = reverse ? -1 : 1;
  return {
    ...gesture,
    selectedIndex:
      (gesture.selectedIndex + delta + gesture.threads.length) % gesture.threads.length,
  };
}

export function selectedSwitcherThread(gesture: ThreadSwitcherGesture): ScopedThreadRef | null {
  return gesture.threads[gesture.selectedIndex] ?? null;
}

/**
 * picks where to land after closing a thread with mod+w: the most recently
 * visited other thread that the caller still considers open.
 */
export function threadAfterClose(
  history: ReadonlyArray<ScopedThreadRef>,
  closing: ScopedThreadRef,
  isOpen: (thread: ScopedThreadRef) => boolean,
): ScopedThreadRef | null {
  const closingKey = scopedThreadKey(closing);
  return history.find((thread) => scopedThreadKey(thread) !== closingKey && isOpen(thread)) ?? null;
}

let recentThreads: ReadonlyArray<ScopedThreadRef> = [];

/** the shared MRU list, written by the thread switcher and read by the close shortcut */
export function getRecentThreads(): ReadonlyArray<ScopedThreadRef> {
  return recentThreads;
}

export function setRecentThreads(history: ReadonlyArray<ScopedThreadRef>): void {
  recentThreads = history;
}
