import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import type { DraftId } from "./composerDraftStore";

/** something the switcher can land on: a server thread or an unsent new-thread draft. */
export type SwitchTarget =
  | { readonly kind: "thread"; readonly ref: ScopedThreadRef }
  | { readonly kind: "draft"; readonly draftId: DraftId };

/**
 * one entry of the most-recently-used list. `seenAt` is when the target was
 * last on screen: stamped on arrival, and again when the user leaves it, so a
 * thread read for an hour counts as seen when it was left, not when it opened.
 */
export interface RecentEntry {
  readonly target: SwitchTarget;
  readonly seenAt: number;
}

export interface ThreadSwitcherGesture {
  readonly targets: ReadonlyArray<SwitchTarget>;
  readonly selectedIndex: number;
  /** targets[0] is the view the gesture started from */
  readonly anchored: boolean;
}

/**
 * a settled thread stays switchable for this long after it was settled or
 * last on screen, whichever is later. Unsettled threads never age out.
 */
export const RECENTLY_SETTLED_WINDOW_MS = 60 * 60 * 1000;

const MAX_RECENT_ENTRIES = 50;

export function threadTarget(ref: ScopedThreadRef): SwitchTarget {
  return { kind: "thread", ref };
}

export function draftTarget(draftId: DraftId): SwitchTarget {
  return { kind: "draft", draftId };
}

/** prefixed so a draft id can never collide with an environment-scoped thread key */
export function switchTargetKey(target: SwitchTarget): string {
  return target.kind === "thread"
    ? `thread:${scopedThreadKey(target.ref)}`
    : `draft:${target.draftId}`;
}

/**
 * records `target` as the current view. The previous head was on screen until
 * now, so it gets a fresh `seenAt` on the way out. Revisiting the current head
 * is a no-op so frequent re-renders do not churn the list.
 */
export function visitTarget(
  history: ReadonlyArray<RecentEntry>,
  target: SwitchTarget,
  now: number,
): ReadonlyArray<RecentEntry> {
  const key = switchTargetKey(target);
  const [head, ...rest] = history;
  if (head !== undefined && switchTargetKey(head.target) === key) return history;
  const previous = head === undefined ? [] : [{ ...head, seenAt: now }, ...rest];
  return [
    { target, seenAt: now },
    ...previous.filter((entry) => switchTargetKey(entry.target) !== key),
  ].slice(0, MAX_RECENT_ENTRIES);
}

/**
 * drops entries that no longer exist and turns a sent draft into the thread
 * it became, keeping its place in the list. `resolve` returns the target to
 * keep (possibly replaced) or null to drop it.
 */
export function pruneRecentEntries(
  history: ReadonlyArray<RecentEntry>,
  resolve: (target: SwitchTarget) => SwitchTarget | null,
): ReadonlyArray<RecentEntry> {
  const seen = new Set<string>();
  const result: RecentEntry[] = [];
  for (const entry of history) {
    const target = resolve(entry.target);
    if (target === null) continue;
    const key = switchTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target === entry.target ? entry : { ...entry, target });
  }
  return result.length === history.length &&
    result.every((entry, index) => entry === history[index])
    ? history
    : result;
}

export interface ThreadSwitchEligibilityInput {
  readonly settled: boolean;
  readonly snoozed: boolean;
  /** resolveSettledThreadTimestamp for a settled thread, parsed */
  readonly settledAtMs: number | null;
  readonly seenAt: number;
  readonly now: number;
}

/**
 * whether a thread from the history belongs in the switcher: open work always,
 * snoozed threads never (they are deliberately out of sight), settled threads
 * only while recently settled or recently looked at.
 */
export function isThreadSwitchEligible(input: ThreadSwitchEligibilityInput): boolean {
  if (input.snoozed) return false;
  if (!input.settled) return true;
  const lastTouched = Math.max(input.settledAtMs ?? Number.NEGATIVE_INFINITY, input.seenAt);
  return input.now - lastTouched <= RECENTLY_SETTLED_WINDOW_MS;
}

/**
 * opens a gesture. The current view is the anchor at index 0 even when it
 * would not be eligible itself, so a tap always has somewhere to come back
 * from. With no current view (home, settings) the list starts on its first
 * entry, so a quick tap still lands on the most recent thread.
 */
export function beginThreadSwitch(
  history: ReadonlyArray<RecentEntry>,
  current: SwitchTarget | null,
  reverse: boolean,
  isEligible: (entry: RecentEntry) => boolean = () => true,
): ThreadSwitcherGesture | null {
  const currentKey = current === null ? null : switchTargetKey(current);
  const candidates = history
    .filter((entry) => switchTargetKey(entry.target) !== currentKey && isEligible(entry))
    .map((entry) => entry.target);
  const targets = current === null ? candidates : [current, ...candidates];
  if (targets.length === 0 || (current !== null && targets.length < 2)) return null;
  return {
    targets,
    selectedIndex: reverse ? targets.length - 1 : current === null ? 0 : 1,
    anchored: current !== null,
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
      (gesture.selectedIndex + delta + gesture.targets.length) % gesture.targets.length,
  };
}

export function selectThreadSwitch(
  gesture: ThreadSwitcherGesture,
  index: number,
): ThreadSwitcherGesture {
  if (index < 0 || index >= gesture.targets.length) return gesture;
  return { ...gesture, selectedIndex: index };
}

export function selectedSwitchTarget(gesture: ThreadSwitcherGesture): SwitchTarget | null {
  return gesture.targets[gesture.selectedIndex] ?? null;
}

/**
 * picks where to land after closing a thread with mod+w: the most recently
 * visited other thread that the caller still considers open. Drafts are not
 * candidates; closing lands on real work.
 */
export function threadAfterClose(
  history: ReadonlyArray<ScopedThreadRef>,
  closing: ScopedThreadRef,
  isOpen: (thread: ScopedThreadRef) => boolean,
): ScopedThreadRef | null {
  const closingKey = scopedThreadKey(closing);
  return history.find((thread) => scopedThreadKey(thread) !== closingKey && isOpen(thread)) ?? null;
}

// persisted so the list survives a restart; the shape is deliberately tiny.
const STORAGE_KEY = "t3code:thread-switcher:recent";

type StoredEntry =
  | { readonly k: "t"; readonly e: string; readonly t: string; readonly s: number }
  | { readonly k: "d"; readonly d: string; readonly s: number };

export function serializeRecentEntries(history: ReadonlyArray<RecentEntry>): string {
  const stored: StoredEntry[] = history.map((entry) =>
    entry.target.kind === "thread"
      ? { k: "t", e: entry.target.ref.environmentId, t: entry.target.ref.threadId, s: entry.seenAt }
      : { k: "d", d: entry.target.draftId, s: entry.seenAt },
  );
  return JSON.stringify(stored);
}

export function parseRecentEntries(raw: string | null): ReadonlyArray<RecentEntry> {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const result: RecentEntry[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const seenAt = typeof entry.s === "number" && Number.isFinite(entry.s) ? entry.s : 0;
    if (entry.k === "t" && typeof entry.e === "string" && typeof entry.t === "string") {
      result.push({
        target: threadTarget(scopeThreadRef(entry.e as EnvironmentId, entry.t as ThreadId)),
        seenAt,
      });
    } else if (entry.k === "d" && typeof entry.d === "string") {
      result.push({ target: draftTarget(entry.d as DraftId), seenAt });
    }
  }
  return result.slice(0, MAX_RECENT_ENTRIES);
}

let recentEntries: ReadonlyArray<RecentEntry> | null = null;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** the shared MRU list, written by the thread switcher */
export function getRecentEntries(): ReadonlyArray<RecentEntry> {
  if (recentEntries === null) {
    recentEntries = parseRecentEntries(storage()?.getItem(STORAGE_KEY) ?? null);
  }
  return recentEntries;
}

export function setRecentEntries(history: ReadonlyArray<RecentEntry>): void {
  if (history === recentEntries) return;
  recentEntries = history;
  try {
    storage()?.setItem(STORAGE_KEY, serializeRecentEntries(history));
  } catch {
    // a full or blocked storage only costs persistence across restarts.
  }
}

/** server threads of the MRU list, newest first; read by the close shortcut */
export function getRecentThreads(): ReadonlyArray<ScopedThreadRef> {
  return getRecentEntries().flatMap((entry) =>
    entry.target.kind === "thread" ? [entry.target.ref] : [],
  );
}
