import type { ContextMenuItem, ThreadWorkspacesCommand } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  resolveThreadWorkspace,
  type ThreadWorkspaceSource,
} from "@t3tools/shared/threadWorkspaces";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ThreadId } from "@t3tools/contracts";

import { readThreadShell } from "~/state/entities";
import {
  readThreadWorkspacesSnapshot,
  runThreadWorkspacesCommand,
  threadWorkspaceSubject,
} from "~/lib/threadWorkspacesState";
import { toastManager } from "../ui/toast";

// fork: workspace items for the sidebar's thread and project menus; one id prefix routes the clicks.
const THREAD_PREFIX = "thread-workspace:";
const PROJECT_PREFIX = "project-workspace:";
const NONE = "\0none";

const SOURCE_LABEL: Record<ThreadWorkspaceSource, string> = {
  manual: "Set by hand",
  project: "Project default",
  auto: "Picked by Jev",
  parent: "From parent thread",
};

type WorkspaceThread = Pick<EnvironmentThreadShell, "id" | "projectId" | "lineage">;

export function buildThreadWorkspaceMenuItem(
  thread: WorkspaceThread,
  readParent: (parentId: string) => WorkspaceThread | null,
): ContextMenuItem | null {
  const snapshot = readThreadWorkspacesSnapshot();
  if (snapshot === null) return null;
  const resolved = resolveThreadWorkspace(threadWorkspaceSubject(thread), snapshot, (parentId) => {
    const parent = readParent(parentId);
    return parent === null ? null : threadWorkspaceSubject(parent);
  });
  const hasManual = snapshot.workspaces.some(
    (workspace) => workspace.id === snapshot.manual[thread.id],
  );
  return {
    id: `${THREAD_PREFIX}menu`,
    label: "Move to workspace",
    separatorBefore: true,
    children: [
      ...snapshot.workspaces.map((workspace) => {
        const current = resolved?.workspaceId === workspace.id;
        return {
          id: `${THREAD_PREFIX}${workspace.id}`,
          label: workspace.name,
          checked: current,
          ...(current && resolved ? { detail: SOURCE_LABEL[resolved.source] } : {}),
        };
      }),
      ...(hasManual
        ? [{ id: `${THREAD_PREFIX}${NONE}`, label: "Clear manual choice", separatorBefore: true }]
        : []),
    ],
  };
}

export function buildProjectWorkspaceMenuItem(
  projectIds: ReadonlyArray<string>,
): ContextMenuItem | null {
  const snapshot = readThreadWorkspacesSnapshot();
  if (snapshot === null || projectIds.length === 0) return null;
  const current = projectIds
    .map((projectId) => snapshot.projectDefaults[projectId])
    .find((id) => snapshot.workspaces.some((workspace) => workspace.id === id));
  return {
    id: `${PROJECT_PREFIX}menu`,
    label: "Default workspace",
    separatorBefore: true,
    children: [
      ...snapshot.workspaces.map((workspace) => ({
        id: `${PROJECT_PREFIX}${workspace.id}`,
        label: workspace.name,
        checked: current === workspace.id,
      })),
      {
        id: `${PROJECT_PREFIX}${NONE}`,
        label: "None (Jev decides)",
        checked: current === undefined,
        separatorBefore: true,
      },
    ],
  };
}

/** the "Move to workspace" item to append to a thread menu (empty when there is none); its ids are typed as the menu's own, so route clicks through handleWorkspaceMenuClick first */
export function threadWorkspaceMenuItems<T extends string>(
  thread: WorkspaceThread & Pick<EnvironmentThreadShell, "environmentId">,
): Array<ContextMenuItem<T>> {
  const item = buildThreadWorkspaceMenuItem(thread, (parentId) =>
    readThreadShell(scopeThreadRef(thread.environmentId, parentId as ThreadId)),
  );
  return item === null ? [] : [item as ContextMenuItem<T>];
}

/** the "Default workspace" item to append to a project menu, empty when there is none */
export function projectWorkspaceMenuItems<T extends string>(
  projectRefs: ReadonlyArray<{ readonly projectId: string }>,
): Array<ContextMenuItem<T>> {
  const item = buildProjectWorkspaceMenuItem(projectRefs.map((ref) => ref.projectId));
  return item === null ? [] : [item as ContextMenuItem<T>];
}

function send(command: ThreadWorkspacesCommand) {
  void runThreadWorkspacesCommand(command).then((outcome) => {
    if (!outcome.ok) {
      toastManager.add({
        type: "error",
        title: "Could not change the workspace",
        description: outcome.message,
      });
    }
  });
}

/** handles a click on one of the items above; false for any other menu item. */
export function handleWorkspaceMenuClick(
  clicked: string,
  target: {
    readonly threadIds?: ReadonlyArray<string>;
    readonly projectIds?: ReadonlyArray<string>;
  },
): boolean {
  for (const [prefix, ids, tag] of [
    [THREAD_PREFIX, target.threadIds, "setThreadWorkspace"],
    [PROJECT_PREFIX, target.projectIds, "setProjectDefault"],
  ] as const) {
    if (!clicked.startsWith(prefix)) continue;
    const value = clicked.slice(prefix.length);
    if (ids === undefined || value === "menu") return true;
    const workspaceId = value === NONE ? null : value;
    send(
      tag === "setThreadWorkspace"
        ? { _tag: tag, threadIds: ids, workspaceId }
        : { _tag: tag, projectIds: ids, workspaceId },
    );
    return true;
  }
  return false;
}
