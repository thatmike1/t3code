import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type { ProviderAdapterV2SessionRuntime } from "@t3tools/provider-core/server/ProviderAdapter";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ClaudeProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { emptyProjection } from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import { TIDY_WARM_UP_MESSAGE } from "./TidyDraft.ts";
import * as TidyDraft from "./TidyDraftService.ts";

const threadId = ThreadId.make("tidy-thread");
const projectId = ProjectId.make("tidy-project");
const providerThreadId = ProviderThreadId.make("tidy-provider-thread");
const runId = RunId.make("tidy-warm-up-run");
const oldSessionId = ProviderSessionId.make("old-session");
const warmedSessionId = ProviderSessionId.make("warmed-session");

const tidy = Effect.fn("test.tidy")(function* (options: {
  readonly driver?: "claudeAgent" | "codex";
  readonly cold?: boolean;
  readonly busy?: boolean;
  readonly warmUpStatus?: "failed" | "timed_out";
  readonly liveAnswer?: "missing";
}) {
  const calls: string[] = [];
  const now = yield* DateTime.now;
  const prior = options.cold ? DateTime.subtract(now, { hours: 2 }) : now;
  const driver = ProviderDriverKind.make(options.driver ?? "claudeAgent");
  const instanceId = ProviderInstanceId.make(driver);
  const modelSelection = { instanceId, model: "test-model" };
  const base = emptyProjection({
    id: EventId.make("tidy-thread-created"),
    type: "thread.created",
    threadId,
    occurredAt: prior,
    payload: {
      id: threadId,
      createdBy: "user",
      creationSource: "web",
      projectId,
      title: "Tidy thread",
      providerInstanceId: instanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: providerThreadId,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: prior,
      updatedAt: prior,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
  const providerThread: OrchestrationV2ProviderThread = {
    id: providerThreadId,
    driver,
    providerInstanceId: instanceId,
    providerSessionId: oldSessionId,
    appThreadId: threadId,
    ownerNodeId: null,
    nativeThreadRef: null,
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: 1,
    lastRunOrdinal: 1,
    handoffIds: [],
    forkedFrom: null,
    pendingBackgroundTasks: [],
    contextUsage: null,
    nativeMetadata: null,
    goal: null,
    createdAt: prior,
    updatedAt: prior,
  };
  const providerSession: OrchestrationV2ProviderSession = {
    id: oldSessionId,
    providerInstanceId: instanceId,
    driver,
    status: "ready",
    cwd: "/workspace",
    capabilities: ClaudeProviderCapabilitiesV2,
    model: modelSelection.model,
    extensionStatuses: [],
    createdAt: prior,
    updatedAt: prior,
    lastError: null,
  };
  const run: OrchestrationV2Run = {
    id: runId,
    threadId,
    ordinal: 2,
    providerInstanceId: instanceId,
    modelSelection,
    providerThreadId,
    userMessageId: MessageId.make("tidy-warm-up"),
    rootNodeId: null,
    activeAttemptId: null,
    status: "starting",
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    checkpointId: null,
    contextHandoffId: null,
  };
  const projection = {
    ...base,
    runs: options.busy ? [{ ...run, status: "waiting" as const }] : [],
    providerThreads: [providerThread],
    providerSessions: [providerSession],
    providerTurns: [
      {
        id: ProviderTurnId.make("previous-turn"),
        providerThreadId,
        nodeId: NodeId.make("previous-node"),
        runAttemptId: null,
        nativeTurnRef: null,
        ordinal: 1,
        status: "completed" as const,
        startedAt: prior,
        completedAt: prior,
      },
    ],
  };
  const runtime: ProviderAdapterV2SessionRuntime = {
    instanceId,
    driver,
    providerSessionId: oldSessionId,
    providerSession,
    events: Stream.empty,
    ensureThread: () => Effect.die("unexpected thread creation"),
    resumeThread: () => Effect.die("unexpected thread resume"),
    startTurn: () => Effect.die("unexpected direct turn start"),
    steerTurn: () => Effect.die("unexpected turn steer"),
    interruptTurn: () => Effect.die("unexpected turn interrupt"),
    respondToRuntimeRequest: () => Effect.die("unexpected runtime response"),
    readThreadSnapshot: () => Effect.die("unexpected snapshot read"),
    rollbackThread: () => Effect.die("unexpected thread rollback"),
    forkThread: () => Effect.die("unexpected thread fork"),
    askSideQuestion: ({ question, providerThread }) =>
      Effect.sync(() => {
        calls.push("side question");
        if (options.cold && driver === "claudeAgent" && !options.busy) {
          expect(providerThread.providerSessionId).toBe(warmedSessionId);
          expect(question).toContain(
            "Your last reply means your last reply before those exchanges.",
          );
        }
        return options.liveAnswer === "missing" ? null : '{"draft":"Clean draft","asks":[]}';
      }),
  };
  const dependencies = Layer.mergeAll(
    NodeCrypto.layer,
    Layer.succeed(HostProcess.Environment, {}),
    Layer.mock(ServerRuntimeStartup.ServerRuntimeStartup)({ enqueueCommand: (effect) => effect }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadRecords: (_threadId, _fields, filter) =>
        Effect.succeed({
          ...projection,
          providerThreads:
            filter?.providerThreadIds === undefined
              ? projection.providerThreads
              : [{ ...providerThread, providerSessionId: warmedSessionId }],
        }),
      sendToThread: (input) =>
        Effect.sync(() => {
          calls.push("send");
          expect(input).toMatchObject({
            threadId,
            text: TIDY_WARM_UP_MESSAGE,
            requireIdle: true,
            createdBy: "system",
          });
          const message: OrchestrationV2ConversationMessage = {
            id: input.messageId,
            threadId,
            runId,
            nodeId: null,
            role: "user",
            text: input.text,
            attachments: [],
            createdBy: input.createdBy,
            creationSource: input.creationSource,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          };
          return {
            dispatch: { sequence: 1, storedEvents: [] },
            projection,
            message,
            run,
            turnItem: null,
            delivery: "started",
          };
        }),
      waitForThread: (input) =>
        Effect.sync(() => {
          calls.push("wait");
          expect(input).toMatchObject({ threadId, runId, timeoutMs: 180_000 });
          return {
            threadId,
            timedOut: options.warmUpStatus === "timed_out",
            run: {
              ...run,
              status: options.warmUpStatus === "failed" ? "failed" : "completed",
            },
          };
        }),
    }),
    Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
      get: (id) => Effect.succeed(Option.some({ ...runtime, providerSessionId: id })),
      askDetachedSideQuestion: () => Effect.die("unexpected detached query"),
    }),
  );
  const outcome = yield* Effect.gen(function* () {
    const service = yield* TidyDraft.TidyDraftService;
    return yield* service.run({ threadId, draft: "uh draft" });
  }).pipe(Effect.provide(TidyDraft.layer.pipe(Layer.provide(dependencies))), Effect.result);
  return { calls, outcome };
});

it.effect("warms a cold Claude thread before asking its reopened live session", () =>
  Effect.gen(function* () {
    const { calls, outcome } = yield* tidy({ cold: true });
    expect(calls).toEqual(["send", "wait", "side question"]);
    expect(outcome).toMatchObject({ _tag: "Success", success: { source: "warmed" } });
  }),
);

it.effect.each(["failed", "timed_out"] as const)(
  "reports a %s warm-up without asking the provider again",
  (warmUpStatus) =>
    Effect.gen(function* () {
      const { calls, outcome } = yield* tidy({ cold: true, warmUpStatus });
      expect(calls).toEqual(["send", "wait"]);
      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "TidyDraftError",
          detail:
            warmUpStatus === "failed"
              ? "Tidy's warm-up turn did not complete."
              : "Tidy's warm-up turn timed out.",
        },
      });
    }),
);

it.effect("reports an unanswered warmed side question without opening a fork", () =>
  Effect.gen(function* () {
    const { calls, outcome } = yield* tidy({ cold: true, liveAnswer: "missing" });
    expect(calls).toEqual(["send", "wait", "side question"]);
    expect(outcome).toMatchObject({ _tag: "Failure", failure: { _tag: "TidyDraftError" } });
  }),
);

it.effect("uses the existing live path for warm, busy, and Codex threads", () =>
  Effect.gen(function* () {
    for (const options of [
      {},
      { cold: true, busy: true },
      { cold: true, driver: "codex" as const },
    ]) {
      const { calls, outcome } = yield* tidy(options);
      expect(calls).toEqual(["side question"]);
      expect(outcome).toMatchObject({ _tag: "Success", success: { source: "live" } });
    }
  }),
);
