import type { ThreadWorkspace, ThreadWorkspacesSnapshot } from "@t3tools/contracts";

/**
 * fork: thread workspaces, the rules both sides share. a thread's workspace
 * comes from, in order: a manual tag, its project's default, the classifier,
 * then its parent thread's workspace. a thread with none shows everywhere.
 */

/** the view that shows every thread, never a stored workspace id */
export const ALL_WORKSPACES = "all";

export const DEFAULT_THREAD_WORKSPACES: ReadonlyArray<ThreadWorkspace> = [
  {
    id: "work",
    name: "Work",
    hint: "Paid work, clients, the job hunt, and building or fixing software products",
  },
  {
    id: "life",
    name: "Life",
    hint: "Personal life, home, health, hobbies, shopping, and tidying up the computer",
  },
];

export const EMPTY_THREAD_WORKSPACES_SNAPSHOT: ThreadWorkspacesSnapshot = {
  workspaces: DEFAULT_THREAD_WORKSPACES,
  projectDefaults: {},
  manual: {},
  auto: {},
  autoTagging: false,
};

export const MAX_THREAD_WORKSPACES = 8;
const MAX_NAME_LENGTH = 24;
const MAX_HINT_LENGTH = 200;
/** how far up a chain of parent threads the workspace is inherited */
const MAX_PARENT_DEPTH = 8;

export type ThreadWorkspaceSource = "manual" | "project" | "auto" | "parent";

export interface ThreadWorkspaceSubject {
  readonly threadId: string;
  readonly projectId: string;
  readonly parentThreadId: string | null;
}

export interface ResolvedThreadWorkspace {
  readonly workspaceId: string;
  readonly source: ThreadWorkspaceSource;
}

type TagMaps = Pick<ThreadWorkspacesSnapshot, "workspaces" | "projectDefaults" | "manual" | "auto">;

function knownWorkspace(snapshot: TagMaps, id: string | undefined): string | null {
  if (id === undefined) return null;
  return snapshot.workspaces.some((workspace) => workspace.id === id) ? id : null;
}

/** a tag naming a removed workspace counts as no tag, so the next rule decides. */
export function resolveThreadWorkspace(
  subject: ThreadWorkspaceSubject,
  snapshot: TagMaps,
  findParent: (threadId: string) => ThreadWorkspaceSubject | null = () => null,
): ResolvedThreadWorkspace | null {
  let current: ThreadWorkspaceSubject | null = subject;
  for (let depth = 0; current !== null && depth <= MAX_PARENT_DEPTH; depth += 1) {
    const own = ownWorkspace(current.threadId, current.projectId, snapshot);
    if (own !== null) return depth === 0 ? own : { workspaceId: own.workspaceId, source: "parent" };
    current = current.parentThreadId === null ? null : findParent(current.parentThreadId);
  }
  return null;
}

function ownWorkspace(
  threadId: string,
  projectId: string,
  snapshot: TagMaps,
): ResolvedThreadWorkspace | null {
  const manual = knownWorkspace(snapshot, snapshot.manual[threadId]);
  if (manual !== null) return { workspaceId: manual, source: "manual" };
  const project = knownWorkspace(snapshot, snapshot.projectDefaults[projectId]);
  if (project !== null) return { workspaceId: project, source: "project" };
  const auto = knownWorkspace(snapshot, snapshot.auto[threadId]);
  if (auto !== null) return { workspaceId: auto, source: "auto" };
  return null;
}

/** an untagged thread is in every workspace, so nothing can get lost. */
export function isThreadInWorkspace(
  view: string,
  subject: ThreadWorkspaceSubject,
  snapshot: TagMaps,
  findParent?: (threadId: string) => ThreadWorkspaceSubject | null,
): boolean {
  if (view === ALL_WORKSPACES) return true;
  const resolved = resolveThreadWorkspace(subject, snapshot, findParent);
  return resolved === null || resolved.workspaceId === view;
}

/** the stored view if it still exists, else All. */
export function resolveWorkspaceView(
  stored: string | null,
  workspaces: ReadonlyArray<ThreadWorkspace>,
): string {
  if (stored === null || stored === ALL_WORKSPACES) return ALL_WORKSPACES;
  return workspaces.some((workspace) => workspace.id === stored) ? stored : ALL_WORKSPACES;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : "workspace";
}

/** a workspace id for a new name, unique among `taken` and never "all" */
export function newWorkspaceId(name: string, taken: ReadonlyArray<string>): string {
  const base = slugify(name);
  let candidate = base;
  for (let n = 2; candidate === ALL_WORKSPACES || taken.includes(candidate); n += 1) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}

/**
 * trims names and hints, drops blank or duplicate names, keeps ids unique and
 * never "all", and caps the list. order is kept.
 */
export function normalizeThreadWorkspaces(
  input: ReadonlyArray<ThreadWorkspace>,
): ReadonlyArray<ThreadWorkspace> {
  const result: ThreadWorkspace[] = [];
  for (const workspace of input) {
    const name = workspace.name.trim().slice(0, MAX_NAME_LENGTH);
    if (name.length === 0) continue;
    if (result.some((other) => other.name.toLowerCase() === name.toLowerCase())) continue;
    const ids = result.map((other) => other.id);
    const id =
      workspace.id.length > 0 && workspace.id !== ALL_WORKSPACES && !ids.includes(workspace.id)
        ? workspace.id
        : newWorkspaceId(name, ids);
    result.push({ id, name, hint: workspace.hint.trim().slice(0, MAX_HINT_LENGTH) });
    if (result.length === MAX_THREAD_WORKSPACES) break;
  }
  return result;
}
