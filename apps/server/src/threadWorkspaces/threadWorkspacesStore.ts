/**
 * fork: the thread workspace file, `<stateDir>/thread-workspaces.json`, and
 * the rule for which threads the classifier is asked about. Pure, so the tag
 * priority and the one-call-plus-one-retry limit are testable.
 */
import type { ThreadWorkspace, ThreadWorkspacesSnapshot } from "@t3tools/contracts";
import {
  DEFAULT_THREAD_WORKSPACES,
  normalizeThreadWorkspaces,
} from "@t3tools/shared/threadWorkspaces";

export const STORE_FILE_NAME = "thread-workspaces.json";
/** a thread whose classification came back unsure is asked again from this many user messages */
export const RETRY_AT_USER_MESSAGES = 3;
/** the first message must be this old, so the generated title can land first */
export const FIRST_MESSAGE_SETTLE_MS = 15_000;

export interface ClassifyAttempt {
  readonly count: number;
  readonly lastAt: string;
}

export interface ThreadWorkspacesStore {
  readonly version: 1;
  /** new threads from this moment on are classified on their own; older ones only on request */
  readonly autoSince: string;
  readonly workspaces: ReadonlyArray<ThreadWorkspace>;
  readonly projectDefaults: Readonly<Record<string, string>>;
  readonly manual: Readonly<Record<string, string>>;
  readonly auto: Readonly<Record<string, string>>;
  readonly attempts: Readonly<Record<string, ClassifyAttempt>>;
}

export function emptyStore(now: string): ThreadWorkspacesStore {
  return {
    version: 1,
    autoSince: now,
    workspaces: DEFAULT_THREAD_WORKSPACES,
    projectDefaults: {},
    manual: {},
    auto: {},
    attempts: {},
  };
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

function attemptRecord(value: unknown): Record<string, ClassifyAttempt> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, ClassifyAttempt> = {};
  for (const [key, entry] of Object.entries(value)) {
    const { count, lastAt } = (entry ?? {}) as { count?: unknown; lastAt?: unknown };
    if (typeof count === "number" && typeof lastAt === "string") result[key] = { count, lastAt };
  }
  return result;
}

function workspaceList(value: unknown): ReadonlyArray<ThreadWorkspace> | null {
  if (!Array.isArray(value)) return null;
  const list = value.flatMap((entry): ThreadWorkspace[] => {
    const { id, name, hint } = (entry ?? {}) as { id?: unknown; name?: unknown; hint?: unknown };
    return typeof name === "string"
      ? [{ id: typeof id === "string" ? id : "", name, hint: typeof hint === "string" ? hint : "" }]
      : [];
  });
  return normalizeThreadWorkspaces(list);
}

/** a missing or unreadable file starts fresh; a readable one keeps every valid entry. */
export function parseStore(raw: string | null, now: string): ThreadWorkspacesStore {
  if (raw === null) return emptyStore(now);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return emptyStore(now);
  }
  if (typeof json !== "object" || json === null) return emptyStore(now);
  const file = json as Record<string, unknown>;
  return {
    version: 1,
    autoSince: typeof file.autoSince === "string" ? file.autoSince : now,
    workspaces: workspaceList(file.workspaces) ?? DEFAULT_THREAD_WORKSPACES,
    projectDefaults: stringRecord(file.projectDefaults),
    manual: stringRecord(file.manual),
    auto: stringRecord(file.auto),
    attempts: attemptRecord(file.attempts),
  };
}

export function toSnapshot(
  store: ThreadWorkspacesStore,
  autoTagging: boolean,
): ThreadWorkspacesSnapshot {
  return {
    workspaces: store.workspaces,
    projectDefaults: store.projectDefaults,
    manual: store.manual,
    auto: store.auto,
    autoTagging,
  };
}

function setOrDelete(
  record: Readonly<Record<string, string>>,
  keys: ReadonlyArray<string>,
  value: string | null,
): Record<string, string> {
  const next = { ...record };
  for (const key of keys) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

export function setManualTags(
  store: ThreadWorkspacesStore,
  threadIds: ReadonlyArray<string>,
  workspaceId: string | null,
): ThreadWorkspacesStore {
  return { ...store, manual: setOrDelete(store.manual, threadIds, workspaceId) };
}

export function setProjectDefaults(
  store: ThreadWorkspacesStore,
  projectIds: ReadonlyArray<string>,
  workspaceId: string | null,
): ThreadWorkspacesStore {
  return { ...store, projectDefaults: setOrDelete(store.projectDefaults, projectIds, workspaceId) };
}

/** records one classifier call; only a confident answer writes a tag. */
export function recordAttempt(
  store: ThreadWorkspacesStore,
  threadId: string,
  workspaceId: string | null,
  at: string,
): ThreadWorkspacesStore {
  const previous = store.attempts[threadId]?.count ?? 0;
  return {
    ...store,
    attempts: { ...store.attempts, [threadId]: { count: previous + 1, lastAt: at } },
    auto: workspaceId === null ? store.auto : { ...store.auto, [threadId]: workspaceId },
  };
}

export interface ClassifyCandidate {
  readonly threadId: string;
  readonly projectId: string;
  readonly parentThreadId: string | null;
  readonly createdAt: string;
  readonly userMessageCount: number;
  readonly firstUserMessageAt: string | null;
}

function known(store: ThreadWorkspacesStore, id: string | undefined): boolean {
  return id !== undefined && store.workspaces.some((workspace) => workspace.id === id);
}

/** whether something other than the classifier already decides this thread. */
function decidedElsewhere(store: ThreadWorkspacesStore, candidate: ClassifyCandidate): boolean {
  return (
    candidate.parentThreadId !== null ||
    known(store, store.manual[candidate.threadId]) ||
    known(store, store.projectDefaults[candidate.projectId]) ||
    known(store, store.auto[candidate.threadId])
  );
}

/** a new thread: one call after its first message, one retry from its third if that was unsure. */
export function isDueForAutoTag(
  store: ThreadWorkspacesStore,
  candidate: ClassifyCandidate,
  nowMs: number,
): boolean {
  if (candidate.createdAt < store.autoSince) return false;
  if (decidedElsewhere(store, candidate) || candidate.firstUserMessageAt === null) return false;
  const attempts = store.attempts[candidate.threadId]?.count ?? 0;
  if (attempts === 0) {
    return nowMs - Date.parse(candidate.firstUserMessageAt) >= FIRST_MESSAGE_SETTLE_MS;
  }
  return attempts === 1 && candidate.userMessageCount >= RETRY_AT_USER_MESSAGES;
}

/** an older thread, tagged from Settings: never asked about before, and nothing else decides it. */
export function isDueForBackfill(
  store: ThreadWorkspacesStore,
  candidate: ClassifyCandidate,
): boolean {
  if (decidedElsewhere(store, candidate) || candidate.firstUserMessageAt === null) return false;
  return (store.attempts[candidate.threadId]?.count ?? 0) === 0;
}
