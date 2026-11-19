import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ThreadWorkspacesSnapshot } from "@t3tools/contracts";
import { ALL_WORKSPACES, DEFAULT_THREAD_WORKSPACES } from "@t3tools/shared/threadWorkspaces";
import { describe, expect, it } from "vite-plus/test";

import { filterThreadsByWorkspace } from "./threadWorkspacesState";

function shell(id: string, projectId: string, parentThreadId: string | null = null) {
  return {
    environmentId: "env-local",
    id,
    projectId,
    lineage: { rootThreadId: parentThreadId ?? id, parentThreadId, relationshipToParent: null },
  } as unknown as EnvironmentThreadShell;
}

const snapshot: ThreadWorkspacesSnapshot = {
  workspaces: DEFAULT_THREAD_WORKSPACES,
  projectDefaults: { nexiflow: "work" },
  manual: { tabs: "life", override: "life" },
  auto: { job: "work", override: "work" },
  autoTagging: true,
};

const threads = [
  shell("tabs", "launchpad"),
  shell("job", "launchpad"),
  shell("override", "nexiflow"),
  shell("build", "nexiflow"),
  shell("child", "launchpad", "build"),
  shell("untagged", "launchpad"),
];
const keyOf = (thread: EnvironmentThreadShell) => `${thread.environmentId}:${thread.id}`;
const ids = (list: ReadonlyArray<EnvironmentThreadShell>) => list.map((thread) => thread.id);

describe("filterThreadsByWorkspace", () => {
  it("shows a workspace's threads plus every untagged one", () => {
    expect(ids(filterThreadsByWorkspace(threads, "work", snapshot, null, keyOf))).toEqual([
      "job",
      "build",
      "child",
      "untagged",
    ]);
    expect(ids(filterThreadsByWorkspace(threads, "life", snapshot, null, keyOf))).toEqual([
      "tabs",
      "override",
      "untagged",
    ]);
  });

  it("lets a manual tag beat both the project default and Jev", () => {
    const work = ids(filterThreadsByWorkspace(threads, "work", snapshot, null, keyOf));
    expect(work).not.toContain("override");
  });

  it("shows everything in All and when the server has no workspaces", () => {
    expect(filterThreadsByWorkspace(threads, ALL_WORKSPACES, snapshot, null, keyOf)).toBe(threads);
    expect(filterThreadsByWorkspace(threads, "work", null, null, keyOf)).toBe(threads);
  });

  it("keeps the open thread visible whatever its workspace", () => {
    const work = filterThreadsByWorkspace(threads, "work", snapshot, "env-local:tabs", keyOf);
    expect(ids(work)).toContain("tabs");
  });
});
