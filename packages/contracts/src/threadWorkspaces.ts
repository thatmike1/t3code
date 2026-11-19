import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { EnvironmentAuthorizationError } from "./auth.ts";

/**
 * fork: thread workspaces. every thread may carry a workspace tag, and the
 * sidebar shows only the current workspace's threads. tags live in a
 * fork-owned file on the server, never in the orchestration schema.
 */
export const ThreadWorkspace = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** a short description that helps the classifier pick this workspace */
  hint: Schema.String,
});
export type ThreadWorkspace = typeof ThreadWorkspace.Type;

export const ThreadWorkspacesSnapshot = Schema.Struct({
  workspaces: Schema.Array(ThreadWorkspace),
  /** project id to workspace id */
  projectDefaults: Schema.Record(Schema.String, Schema.String),
  /** thread id to workspace id, set by hand; always wins */
  manual: Schema.Record(Schema.String, Schema.String),
  /** thread id to workspace id, set by the classifier */
  auto: Schema.Record(Schema.String, Schema.String),
  /** whether the classifier key exists on the server machine */
  autoTagging: Schema.Boolean,
});
export type ThreadWorkspacesSnapshot = typeof ThreadWorkspacesSnapshot.Type;

export const ThreadWorkspacesCommand = Schema.Union([
  Schema.TaggedStruct("setWorkspaces", { workspaces: Schema.Array(ThreadWorkspace) }),
  Schema.TaggedStruct("setThreadWorkspace", {
    threadIds: Schema.Array(Schema.String),
    /** null removes the manual tag */
    workspaceId: Schema.NullOr(Schema.String),
  }),
  Schema.TaggedStruct("setProjectDefault", {
    projectIds: Schema.Array(Schema.String),
    workspaceId: Schema.NullOr(Schema.String),
  }),
  Schema.TaggedStruct("tagUntagged", { limit: Schema.Finite }),
]);
export type ThreadWorkspacesCommand = typeof ThreadWorkspacesCommand.Type;

export const ThreadWorkspacesCommandResult = Schema.Struct({
  /** threads the classifier was asked about */
  asked: Schema.Finite,
  tagged: Schema.Finite,
  failed: Schema.Finite,
  /** untagged threads left over beyond the limit */
  remaining: Schema.Finite,
});
export type ThreadWorkspacesCommandResult = typeof ThreadWorkspacesCommandResult.Type;

export class ThreadWorkspacesError extends Schema.TaggedError<ThreadWorkspacesError>()(
  "ThreadWorkspacesError",
  { detail: Schema.String },
) {}

export const THREAD_WORKSPACES_WS_METHODS = {
  subscribeThreadWorkspaces: "threadWorkspaces.subscribe",
  threadWorkspacesCommand: "threadWorkspaces.command",
} as const;

export const WsSubscribeThreadWorkspacesRpc = Rpc.make(
  THREAD_WORKSPACES_WS_METHODS.subscribeThreadWorkspaces,
  {
    payload: Schema.Struct({}),
    success: ThreadWorkspacesSnapshot,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

export const WsThreadWorkspacesCommandRpc = Rpc.make(
  THREAD_WORKSPACES_WS_METHODS.threadWorkspacesCommand,
  {
    payload: ThreadWorkspacesCommand,
    success: ThreadWorkspacesCommandResult,
    error: Schema.Union([ThreadWorkspacesError, EnvironmentAuthorizationError]),
  },
);
