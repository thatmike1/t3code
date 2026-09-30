import { describe, expect, it } from "vite-plus/test";

import {
  agentGroupLabel,
  groupAgentThreads,
  isAgentLaunchedThread,
  visibleAgentChildren,
  withVisibleAgentChildren,
} from "./SidebarAgentThreads.logic";

const keyOf = (key: string) => key;
const link = (childKey: string, parentKey: string) => ({ childKey, parentKey });

const group = (input: {
  pinned?: readonly string[];
  active: readonly string[];
  links: ReadonlyArray<{ childKey: string; parentKey: string }>;
}) => {
  const result = groupAgentThreads({ pinned: input.pinned ?? [], ...input, keyOf });
  return { active: result.active, groups: Object.fromEntries(result.childrenByHostKey) };
};

describe("groupAgentThreads", () => {
  it("leaves the list untouched when no thread was launched by an agent", () => {
    const active = ["a", "b"];
    const result = groupAgentThreads({ pinned: [], active, links: [], keyOf });
    expect(result.active).toBe(active);
    expect(result.childrenByHostKey.size).toBe(0);
  });

  it("moves launched threads under their parent, in launch order", () => {
    expect(
      group({
        active: ["c2", "parent", "other", "c1"],
        links: [link("c1", "parent"), link("c2", "parent")],
      }),
    ).toEqual({ active: ["parent", "other"], groups: { parent: ["c1", "c2"] } });
  });

  it("nests under a pinned parent too", () => {
    expect(
      group({ pinned: ["parent"], active: ["c1", "other"], links: [link("c1", "parent")] }),
    ).toEqual({ active: ["other"], groups: { parent: ["c1"] } });
  });

  it("keeps a child top level when its parent is not an open row", () => {
    // settled, snoozed, archived, deleted or filtered out: not in either list
    const active = ["c1", "other"];
    const result = groupAgentThreads({
      pinned: [],
      active,
      links: [link("c1", "gone")],
      keyOf,
    });
    expect(result.active).toBe(active);
    expect(result.childrenByHostKey.size).toBe(0);
  });

  it("keeps a pinned, settled or snoozed child out of the group", () => {
    expect(
      group({
        pinned: ["c-pinned"],
        active: ["parent", "c-open"],
        links: [link("c-pinned", "parent"), link("c-settled", "parent"), link("c-open", "parent")],
      }),
    ).toEqual({ active: ["parent"], groups: { parent: ["c-open"] } });
  });

  it("puts a thread launched by a nested thread into the same flat group", () => {
    expect(
      group({
        active: ["root", "child", "grandchild"],
        links: [link("child", "root"), link("grandchild", "child")],
      }),
    ).toEqual({ active: ["root"], groups: { root: ["child", "grandchild"] } });
  });

  it("nests a grandchild under its parent when that parent fell back to a normal row", () => {
    expect(
      group({
        active: ["child", "grandchild"],
        links: [link("child", "gone"), link("grandchild", "child")],
      }),
    ).toEqual({ active: ["child"], groups: { child: ["grandchild"] } });
  });

  it("never hides every thread of a loop", () => {
    const result = group({ active: ["a", "b"], links: [link("a", "b"), link("b", "a")] });
    const shown = [...result.active, ...Object.values(result.groups).flat()];
    expect(shown.toSorted()).toEqual(["a", "b"]);
    expect(result.active.length).toBeGreaterThan(0);
    expect(group({ active: ["a"], links: [link("a", "a")] })).toEqual({
      active: ["a"],
      groups: {},
    });
  });
});

describe("visibleAgentChildren", () => {
  const children = ["c1", "c2"];

  it("shows every row of an expanded group", () => {
    expect(
      visibleAgentChildren({ children, collapsed: false, routeThreadKey: null, keyOf }),
    ).toEqual(children);
  });

  it("shows nothing when collapsed, except the open thread", () => {
    expect(
      visibleAgentChildren({ children, collapsed: true, routeThreadKey: null, keyOf }),
    ).toEqual([]);
    expect(
      visibleAgentChildren({ children, collapsed: true, routeThreadKey: "c2", keyOf }),
    ).toEqual(["c2"]);
    expect(
      visibleAgentChildren({ children, collapsed: true, routeThreadKey: "elsewhere", keyOf }),
    ).toEqual([]);
  });
});

describe("withVisibleAgentChildren", () => {
  it("lists each group right after its host", () => {
    expect(
      withVisibleAgentChildren(["a", "parent", "b"], new Map([["parent", ["c1", "c2"]]]), keyOf),
    ).toEqual(["a", "parent", "c1", "c2", "b"]);
  });

  it("returns the same list when nothing is nested", () => {
    const threads = ["a", "b"];
    expect(withVisibleAgentChildren(threads, new Map(), keyOf)).toBe(threads);
  });
});

describe("isAgentLaunchedThread", () => {
  const links = new Map([["env:linked", "env:parent"]]);

  it("trusts a stored link", () => {
    expect(isAgentLaunchedThread("linked", "env:linked", links)).toBe(true);
  });

  it("falls back to the id create_threads mints", () => {
    const id = `mcp-${"0123456789abcdef".repeat(2)}`;
    expect(isAgentLaunchedThread(id, `env:${id}`, links)).toBe(true);
    expect(isAgentLaunchedThread("mcp-short", "env:mcp-short", links)).toBe(false);
    expect(isAgentLaunchedThread("thread-1", "env:thread-1", links)).toBe(false);
  });
});

describe("agentGroupLabel", () => {
  it("counts agents", () => {
    expect(agentGroupLabel(1)).toBe("1 agent");
    expect(agentGroupLabel(4)).toBe("4 agents");
  });
});
