/**
 * Sidebar grouping for threads an agent started through the T3 MCP
 * `create_threads` tool. Pure so the nesting rules are testable.
 *
 * A launched thread nests under the thread that launched it only while both
 * are ordinary open rows: the child sits in the active section and the
 * parent is a pinned or active card. Everything else (a settled, snoozed or
 * pinned child, a parent that is settled, archived, deleted or filtered out)
 * falls back to the sidebar's normal rows, where the thread keeps a mark.
 */

/** One parent link, as scoped thread keys. */
export interface AgentThreadKeyLink {
  readonly childKey: string;
  readonly parentKey: string;
}

export interface AgentThreadGrouping<TThread> {
  /** The active section without the rows that moved into a group. */
  readonly active: readonly TThread[];
  /** Nested threads by the key of the row they sit under, in launch order. */
  readonly childrenByHostKey: ReadonlyMap<string, readonly TThread[]>;
}

const EMPTY_GROUPS: ReadonlyMap<string, readonly never[]> = new Map();

/** Thread ids `create_threads` mints: `mcp-` plus 32 hex characters. */
const AGENT_THREAD_ID_PATTERN = /^mcp-[0-9a-f]{32}$/u;

/**
 * Whether a thread was started by an agent. The stored link is the source of
 * truth; the id shape covers a thread whose link is unknown to this client.
 */
export function isAgentLaunchedThread(
  threadId: string,
  threadKey: string,
  parentKeyByChildKey: ReadonlyMap<string, string>,
): boolean {
  return parentKeyByChildKey.has(threadKey) || AGENT_THREAD_ID_PATTERN.test(threadId);
}

/**
 * Splits the active section into top-level rows and nested groups.
 *
 * A thread launched by a nested thread joins the same group as its launcher,
 * so a group is one flat list under the nearest top-level ancestor.
 */
export function groupAgentThreads<TThread>(input: {
  readonly pinned: readonly TThread[];
  readonly active: readonly TThread[];
  /** In launch order; the order siblings are listed in. */
  readonly links: readonly AgentThreadKeyLink[];
  readonly keyOf: (thread: TThread) => string;
}): AgentThreadGrouping<TThread> {
  if (input.links.length === 0) return { active: input.active, childrenByHostKey: EMPTY_GROUPS };

  const parentKeyByChildKey = new Map(input.links.map((link) => [link.childKey, link.parentKey]));
  const pinnedKeys = new Set(input.pinned.map(input.keyOf));
  const activeByKey = new Map(input.active.map((thread) => [input.keyOf(thread), thread]));

  // The row a thread nests under, or null when it stays top level.
  const hostByKey = new Map<string, string | null>();
  const resolveHost = (key: string, visiting: Set<string>): string | null => {
    const known = hostByKey.get(key);
    if (known !== undefined) return known;
    const parentKey = parentKeyByChildKey.get(key);
    let host: string | null = null;
    // A pinned thread is never nested, so it cannot sit under anything.
    if (parentKey !== undefined && activeByKey.has(key) && !visiting.has(key)) {
      visiting.add(key);
      if (pinnedKeys.has(parentKey)) host = parentKey;
      else if (activeByKey.has(parentKey)) host = resolveHost(parentKey, visiting) ?? parentKey;
      visiting.delete(key);
    }
    // A loop in the links would leave every member hidden under another;
    // inside one, nobody nests.
    if (host === key) host = null;
    hostByKey.set(key, host);
    return host;
  };

  const childrenByHostKey = new Map<string, TThread[]>();
  const nestedKeys = new Set<string>();
  for (const link of input.links) {
    const thread = activeByKey.get(link.childKey);
    if (thread === undefined || nestedKeys.has(link.childKey)) continue;
    const host = resolveHost(link.childKey, new Set());
    if (host === null) continue;
    nestedKeys.add(link.childKey);
    const group = childrenByHostKey.get(host);
    if (group === undefined) childrenByHostKey.set(host, [thread]);
    else group.push(thread);
  }
  // A host that itself got nested (only possible through a loop) would take
  // its group out of sight; release those groups back to the top level.
  for (const hostKey of [...childrenByHostKey.keys()]) {
    if (!nestedKeys.has(hostKey)) continue;
    for (const thread of childrenByHostKey.get(hostKey)!) nestedKeys.delete(input.keyOf(thread));
    childrenByHostKey.delete(hostKey);
  }
  if (nestedKeys.size === 0) return { active: input.active, childrenByHostKey: EMPTY_GROUPS };

  return {
    active: input.active.filter((thread) => !nestedKeys.has(input.keyOf(thread))),
    childrenByHostKey,
  };
}

/**
 * The rows a group shows. A collapsed group still shows the open thread, the
 * same exception the settled and snoozed shelves make.
 */
export function visibleAgentChildren<TThread>(input: {
  readonly children: readonly TThread[];
  readonly collapsed: boolean;
  readonly routeThreadKey: string | null;
  readonly keyOf: (thread: TThread) => string;
}): readonly TThread[] {
  if (!input.collapsed) return input.children;
  if (input.routeThreadKey === null) return [];
  return input.children.filter((thread) => input.keyOf(thread) === input.routeThreadKey);
}

/** The rendered order: each host followed by the group rows it is showing. */
export function withVisibleAgentChildren<TThread>(
  threads: readonly TThread[],
  visibleChildrenByHostKey: ReadonlyMap<string, readonly TThread[]>,
  keyOf: (thread: TThread) => string,
): readonly TThread[] {
  if (visibleChildrenByHostKey.size === 0) return threads;
  return threads.flatMap((thread) => [
    thread,
    ...(visibleChildrenByHostKey.get(keyOf(thread)) ?? []),
  ]);
}

export function agentGroupLabel(count: number): string {
  return count === 1 ? "1 agent" : `${count} agents`;
}
