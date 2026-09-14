import { CommandId, MessageId, ThreadId, type OrchestrationThreadShell } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { DEFAULT_THREAD_TITLE } from "../../../orchestration/threadTitles.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  StartThreadCallerNotFoundError,
  StartThreadFailedError,
  type StartThreadInput,
  ThreadsToolkit,
} from "./tools.ts";

const encoder = new TextEncoder();

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * The new thread starts with the caller's provider, checkout, and modes. The
 * agent can change the model and the two modes, never the provider or the
 * worktree: those decide what the new thread can touch, and the user set them.
 */
function inheritedThreadSettings(
  parent: OrchestrationThreadShell,
  input: StartThreadInput,
): Pick<
  OrchestrationThreadShell,
  "projectId" | "modelSelection" | "runtimeMode" | "interactionMode" | "branch" | "worktreePath"
> {
  return {
    projectId: parent.projectId,
    modelSelection:
      input.model === undefined
        ? parent.modelSelection
        : { instanceId: parent.modelSelection.instanceId, model: input.model },
    runtimeMode: input.runtimeMode ?? parent.runtimeMode,
    interactionMode: input.interactionMode ?? parent.interactionMode,
    branch: parent.branch,
    worktreePath: parent.worktreePath,
  };
}

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const failed = <E>(cause: Cause.Cause<E>): Effect.Effect<never, StartThreadFailedError> =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.failCause(cause as Cause.Cause<never>)
      : Effect.fail(new StartThreadFailedError({ cause }));

  // A clientRequestId makes the thread id a function of the caller and the id,
  // so a retried call after a dropped response lands on the same thread
  // instead of starting a second agent in the same checkout.
  const newThreadId = (scope: McpInvocationContext.McpInvocationScope, input: StartThreadInput) =>
    input.clientRequestId === undefined
      ? crypto.randomUUIDv4.pipe(Effect.orDie, Effect.map(ThreadId.make))
      : crypto.digest("SHA-256", encoder.encode(`${scope.threadId} ${input.clientRequestId}`)).pipe(
          Effect.orDie,
          Effect.map((digest) => ThreadId.make(`mcp-${hex(digest).slice(0, 32)}`)),
        );

  const commandId = (tag: string, threadId: ThreadId) =>
    crypto.randomUUIDv4.pipe(
      Effect.orDie,
      Effect.map((uuid) => CommandId.make(`server:${tag}:${threadId}:${uuid}`)),
    );

  return ThreadsToolkit.of({
    start_thread: (input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("threads");
        const parent = yield* snapshots
          .getThreadShellById(scope.threadId)
          .pipe(Effect.catchCause(failed));
        if (Option.isNone(parent)) {
          return yield* new StartThreadCallerNotFoundError({ threadId: scope.threadId });
        }

        const threadId = yield* newThreadId(scope, input);
        const existing =
          input.clientRequestId === undefined
            ? Option.none()
            : yield* snapshots.getThreadShellById(threadId).pipe(Effect.catchCause(failed));
        if (Option.isSome(existing)) {
          return { threadId, title: existing.value.title, alreadyStarted: true };
        }

        const title = input.title ?? DEFAULT_THREAD_TITLE;
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        yield* engine
          .dispatch({
            type: "thread.create",
            commandId: yield* commandId("mcp-thread-create", threadId),
            threadId,
            title,
            createdAt,
            ...inheritedThreadSettings(parent.value, input),
          })
          .pipe(Effect.catchCause(failed));
        yield* engine
          .dispatch({
            type: "thread.turn.start",
            commandId: yield* commandId("mcp-thread-turn-start", threadId),
            threadId,
            message: {
              messageId: MessageId.make(`mcp-start:${threadId}`),
              role: "user",
              text: input.prompt,
              attachments: [],
            },
            // The reactor generates a title from the first turn unless the
            // agent named the thread. Seeding with the given title keeps it.
            ...(input.title !== undefined ? { titleSeed: input.title } : {}),
            runtimeMode: input.runtimeMode ?? parent.value.runtimeMode,
            interactionMode: input.interactionMode ?? parent.value.interactionMode,
            createdAt,
          })
          .pipe(Effect.catchCause(failed));
        return { threadId, title, alreadyStarted: false };
      }),
  });
});

export const ThreadsToolkitHandlersLive = ThreadsToolkit.toLayer(make);
