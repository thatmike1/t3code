import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

/**
 * agent threads: which thread an agent was running in when it started another
 * thread through the T3 MCP `create_threads` tool. the orchestration engine
 * keeps no such link, so the server stores it beside the engine's tables and
 * clients use it to nest a launched thread under the one that launched it.
 */
export const AgentThreadLink = Schema.Struct({
  /** the thread the agent started */
  threadId: ThreadId,
  /** the thread the agent was running in */
  parentThreadId: ThreadId,
  createdAt: Schema.String,
});
export type AgentThreadLink = typeof AgentThreadLink.Type;

export const AgentThreadsSnapshot = Schema.Struct({
  /** oldest first, so equal sets compare equal and siblings keep launch order */
  links: Schema.Array(AgentThreadLink),
});
export type AgentThreadsSnapshot = typeof AgentThreadsSnapshot.Type;
