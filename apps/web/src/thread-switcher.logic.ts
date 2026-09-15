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
