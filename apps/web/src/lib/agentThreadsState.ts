import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { AgentThreadsSnapshot, EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import type { AgentThreadKeyLink } from "../components/sidebar/SidebarAgentThreads.logic";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";

const NO_LINKS: readonly AgentThreadKeyLink[] = [];

/** The snapshot's links as scoped thread keys. Pure so the scoping is testable. */
export function agentThreadKeyLinks(
  snapshot: AgentThreadsSnapshot | null,
  environmentId: EnvironmentId | null,
): readonly AgentThreadKeyLink[] {
  if (snapshot === null || environmentId === null || snapshot.links.length === 0) return NO_LINKS;
  return snapshot.links.map((link) => ({
    childKey: scopedThreadKey(scopeThreadRef(environmentId, link.threadId)),
    parentKey: scopedThreadKey(scopeThreadRef(environmentId, link.parentThreadId)),
  }));
}

/**
 * Which thread launched which, for the primary environment, in launch order.
 * Other environments run servers that may not know the subscription, so
 * their agent-launched threads stay ordinary rows.
 */
export function useAgentThreadLinks(): readonly AgentThreadKeyLink[] {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    primaryEnvironmentId === null
      ? null
      : serverEnvironment.agentThreads({ environmentId: primaryEnvironmentId, input: {} }),
  );
  return useMemo(
    () => agentThreadKeyLinks(query.data, primaryEnvironmentId),
    [primaryEnvironmentId, query.data],
  );
}
