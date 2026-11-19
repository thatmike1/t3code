import { describe, expect, it } from "vite-plus/test";

import {
  ALL_WORKSPACES,
  DEFAULT_THREAD_WORKSPACES,
  isThreadInWorkspace,
  newWorkspaceId,
  normalizeThreadWorkspaces,
  resolveThreadWorkspace,
  resolveWorkspaceView,
  type ThreadWorkspaceSubject,
} from "./threadWorkspaces.ts";

const workspaces = DEFAULT_THREAD_WORKSPACES;
const subject: ThreadWorkspaceSubject = {
  threadId: "t1",
  projectId: "p1",
  parentThreadId: null,
};
const empty = { workspaces, projectDefaults: {}, manual: {}, auto: {} };

describe("resolveThreadWorkspace", () => {
  it("leaves a thread with no tag untagged", () => {
    expect(resolveThreadWorkspace(subject, empty)).toBeNull();
  });

  it("puts a manual tag above the project default and the classifier", () => {
    const tags = {
      ...empty,
      manual: { t1: "life" },
      projectDefaults: { p1: "work" },
      auto: { t1: "work" },
    };
    expect(resolveThreadWorkspace(subject, tags)).toEqual({
      workspaceId: "life",
      source: "manual",
    });
  });

  it("puts the project default above the classifier", () => {
    const tags = { ...empty, projectDefaults: { p1: "work" }, auto: { t1: "life" } };
    expect(resolveThreadWorkspace(subject, tags)).toEqual({
      workspaceId: "work",
      source: "project",
    });
  });

  it("uses the classifier when nothing else decides", () => {
    expect(resolveThreadWorkspace(subject, { ...empty, auto: { t1: "life" } })).toEqual({
      workspaceId: "life",
      source: "auto",
    });
  });

  it("skips a tag naming a removed workspace and lets the next rule decide", () => {
    const tags = { ...empty, manual: { t1: "gone" }, auto: { t1: "life" } };
    expect(resolveThreadWorkspace(subject, tags)?.workspaceId).toBe("life");
  });

  it("inherits the parent thread's workspace when the child has none", () => {
    const child = { threadId: "c1", projectId: "p2", parentThreadId: "t1" };
    const tags = { ...empty, manual: { t1: "work" } };
    expect(resolveThreadWorkspace(child, tags, (id) => (id === "t1" ? subject : null))).toEqual({
      workspaceId: "work",
      source: "parent",
    });
  });

  it("stops on a parent cycle", () => {
    const a = { threadId: "a", projectId: "p", parentThreadId: "b" };
    const b = { threadId: "b", projectId: "p", parentThreadId: "a" };
    expect(resolveThreadWorkspace(a, empty, (id) => (id === "a" ? a : b))).toBeNull();
  });
});

describe("isThreadInWorkspace", () => {
  const tagged = { ...empty, manual: { t1: "work" } };

  it("shows a tagged thread only in its own workspace", () => {
    expect(isThreadInWorkspace("work", subject, tagged)).toBe(true);
    expect(isThreadInWorkspace("life", subject, tagged)).toBe(false);
  });

  it("shows an untagged thread in every workspace", () => {
    expect(isThreadInWorkspace("work", subject, empty)).toBe(true);
    expect(isThreadInWorkspace("life", subject, empty)).toBe(true);
  });

  it("shows everything in All", () => {
    expect(isThreadInWorkspace(ALL_WORKSPACES, subject, tagged)).toBe(true);
  });
});

describe("resolveWorkspaceView", () => {
  it("falls back to All for a missing or removed workspace", () => {
    expect(resolveWorkspaceView(null, workspaces)).toBe(ALL_WORKSPACES);
    expect(resolveWorkspaceView("gone", workspaces)).toBe(ALL_WORKSPACES);
    expect(resolveWorkspaceView("life", workspaces)).toBe("life");
  });
});

describe("normalizeThreadWorkspaces", () => {
  it("trims, drops blank and duplicate names, and keeps ids unique and never all", () => {
    expect(
      normalizeThreadWorkspaces([
        { id: "work", name: " Work ", hint: " paid " },
        { id: "", name: "  ", hint: "" },
        { id: "x", name: "work", hint: "" },
        { id: "work", name: "Side", hint: "" },
        { id: "all", name: "All", hint: "" },
      ]),
    ).toEqual([
      { id: "work", name: "Work", hint: "paid" },
      { id: "side", name: "Side", hint: "" },
      { id: "all-2", name: "All", hint: "" },
    ]);
  });

  it("makes ids from names", () => {
    expect(newWorkspaceId("Side projects", ["work"])).toBe("side-projects");
    expect(newWorkspaceId("Work", ["work"])).toBe("work-2");
  });
});
