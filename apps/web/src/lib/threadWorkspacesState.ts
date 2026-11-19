import {
  type EnvironmentId,
  type ThreadWorkspacesCommand,
  type ThreadWorkspacesCommandResult,
  type ThreadWorkspacesSnapshot,
  WS_METHODS,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ALL_WORKSPACES,
  isThreadInWorkspace,
  resolveThreadWorkspace,
  resolveWorkspaceView,
  type ThreadWorkspaceSubject,
} from "@t3tools/shared/threadWorkspaces";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useSyncExternalStore } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readPrimaryEnvironmentId, usePrimaryEnvironmentId } from "../state/environments";
import { readThreadShell } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";

/**
 * fork: thread workspaces on the client. Tags come from the primary
 * environment's server; the chosen view is this client's own, kept in
 * localStorage so it survives a restart.
 */

const threadWorkspacesSubscription = createEnvironmentRpcSubscriptionAtomFamily(
  connectionAtomRuntime,
  {
    label: "environment-data:server:thread-workspaces",
    tag: WS_METHODS.subscribeThreadWorkspaces,
    idleTtlMs: 0,
  },
);

const threadWorkspacesCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:server:thread-workspaces-command",
  tag: WS_METHODS.threadWorkspacesCommand,
});

/** the primary environment's workspaces and tags, or null when its server has none. */
export function useThreadWorkspaces(): ThreadWorkspacesSnapshot | null {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : threadWorkspacesSubscription({ environmentId, input: {} }),
  );
  return query.data;
}

/** the same, for handlers outside React; the sidebar keeps the subscription open. */
export function readThreadWorkspacesSnapshot(): ThreadWorkspacesSnapshot | null {
  const environmentId = readPrimaryEnvironmentId();
  if (environmentId === null) return null;
  return AsyncResult.getOrElse(
    appAtomRegistry.get(threadWorkspacesSubscription({ environmentId, input: {} })),
    () => null,
  );
}

export async function runThreadWorkspacesCommand(
  input: ThreadWorkspacesCommand,
  environmentId: EnvironmentId | null = readPrimaryEnvironmentId(),
): Promise<
  | { readonly ok: true; readonly result: ThreadWorkspacesCommandResult }
  | { readonly ok: false; readonly message: string }
> {
  if (environmentId === null) return { ok: false, message: "No server is connected." };
  const result = await runAtomCommand(
    appAtomRegistry,
    threadWorkspacesCommand,
    { environmentId, input },
    { reportFailure: false },
  );
  if (result._tag === "Success") return { ok: true, result: result.value };
  const error = squashAtomCommandFailure(result);
  const detail =
    typeof error === "object" && error !== null && "detail" in error
      ? String((error as { detail: unknown }).detail)
      : error instanceof Error
        ? error.message
        : "The server did not answer.";
  return { ok: false, message: detail };
}

const VIEW_STORAGE_KEY = "t3code:thread-workspaces:view";
const viewListeners = new Set<() => void>();

function readStoredView(): string | null {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

// read lazily, so importing this module never touches storage
let storedView: string | null | undefined;
function currentStoredView(): string | null {
  if (storedView === undefined) storedView = readStoredView();
  return storedView;
}

export function setWorkspaceView(view: string): void {
  storedView = view;
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // a private window without storage keeps the choice for this session only
  }
  for (const listener of viewListeners) listener();
}

function subscribeView(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

/** the chosen view as stored; a removed workspace reads as All. */
export function useWorkspaceView(snapshot: ThreadWorkspacesSnapshot | null): string {
  const stored = useSyncExternalStore(subscribeView, currentStoredView);
  return snapshot === null ? ALL_WORKSPACES : resolveWorkspaceView(stored, snapshot.workspaces);
}

export function threadWorkspaceSubject(
  thread: Pick<EnvironmentThreadShell, "id" | "projectId" | "lineage">,
): ThreadWorkspaceSubject {
  return {
    threadId: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.lineage.parentThreadId ?? null,
  };
}

/**
 * the threads the current workspace shows, keeping `keepKey` (the open
 * thread) whatever its tag, so switching never hides what is on screen.
 */
export function filterThreadsByWorkspace<T extends EnvironmentThreadShell>(
  threads: ReadonlyArray<T>,
  view: string,
  snapshot: ThreadWorkspacesSnapshot | null,
  keepKey: string | null,
  keyOf: (thread: T) => string,
): ReadonlyArray<T> {
  if (snapshot === null || view === ALL_WORKSPACES) return threads;
  const byId = new Map<string, T>();
  for (const thread of threads) byId.set(`${thread.environmentId}:${thread.id}`, thread);
  return threads.filter((thread) => {
    if (keepKey !== null && keyOf(thread) === keepKey) return true;
    const findParent = (parentId: string) => {
      const parent = byId.get(`${thread.environmentId}:${parentId}`);
      return parent === undefined ? null : threadWorkspaceSubject(parent);
    };
    return isThreadInWorkspace(view, threadWorkspaceSubject(thread), snapshot, findParent);
  });
}

/** the sidebar's hook: every thread in All, else the current workspace's plus the open one. */
export function useWorkspaceThreads<T extends EnvironmentThreadShell>(
  threads: ReadonlyArray<T>,
  keepKey: string | null,
  keyOf: (thread: T) => string,
): ReadonlyArray<T> {
  const snapshot = useThreadWorkspaces();
  const view = useWorkspaceView(snapshot);
  return filterThreadsByWorkspace(threads, view, snapshot, keepKey, keyOf);
}

/** for handlers outside React: whether the thread belongs in the current workspace. */
export function isThreadShellInWorkspaceView(
  thread: Pick<EnvironmentThreadShell, "id" | "projectId" | "lineage">,
  readParent: (
    parentId: string,
  ) => Pick<EnvironmentThreadShell, "id" | "projectId" | "lineage"> | null,
): boolean {
  const snapshot = readThreadWorkspacesSnapshot();
  if (snapshot === null) return true;
  const view = resolveWorkspaceView(currentStoredView(), snapshot.workspaces);
  const findParent = (parentId: string) => {
    const parent = readParent(parentId);
    return parent === null ? null : threadWorkspaceSubject(parent);
  };
  return isThreadInWorkspace(view, threadWorkspaceSubject(thread), snapshot, findParent);
}

/** the same check with parents read from the thread store, for Ctrl+Tab and Ctrl+W */
export function isThreadInCurrentWorkspace(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId" | "lineage">,
): boolean {
  return isThreadShellInWorkspaceView(thread, (parentId) =>
    readThreadShell(scopeThreadRef(thread.environmentId, parentId as ThreadId)),
  );
}

export { resolveThreadWorkspace };
