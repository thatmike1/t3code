import {
  CommandId,
  MessageId,
  TidyDraftError,
  type TidyDraftInput,
  type TidyDraftResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import * as TidyDraft from "./TidyDraft.ts";

export class TidyDraftService extends Context.Service<
  TidyDraftService,
  {
    readonly run: (input: TidyDraftInput) => Effect.Effect<TidyDraftResult, TidyDraftError>;
  }
>()("t3/tidyDraft/TidyDraftService") {}

const WARM_UP_TIMEOUT_MS = 3 * 60_000;

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
  const random = yield* SecureRandom.SecureRandom;
  const coldAfterMs = TidyDraft.tidyColdCacheAfterMs(yield* HostProcess.Environment);

  const run = Effect.fn("TidyDraftService.run")(function* ({ threadId, draft }: TidyDraftInput) {
    const fail = (detail: string) => new TidyDraftError({ threadId, detail });
    const projection = yield* threads
      .getThreadRecords(
        threadId,
        ["providerThreads", "providerSessions", "runs", "providerTurns"],
        {
          runStatuses: ThreadManagement.ACTIVE_RUN_STATUSES,
          latestProviderTurnUsageOnly: true,
        },
      )
      .pipe(Effect.mapError(() => fail("This thread could not be read.")));
    let providerThread =
      projection.providerThreads.find(
        (candidate) => candidate.id === projection.thread.activeProviderThreadId,
      ) ?? projection.providerThreads.at(-1);
    let providerSessionId = providerThread?.providerSessionId ?? null;
    if (providerThread === undefined || providerSessionId === null) {
      return yield* fail("There is no conversation to tidy against yet. Send a message first.");
    }

    const isClaude = providerThread.driver === "claudeAgent";
    const cold =
      isClaude &&
      TidyDraft.isTidyCacheCold({
        runs: projection.runs,
        latestProviderTurn: projection.providerTurns.at(-1),
        nowMs: DateTime.toEpochMillis(yield* DateTime.now),
        coldAfterMs,
      });
    const { projectId, modelSelection } = projection.thread;
    if (cold) {
      if (modelSelection.instanceId !== providerThread.providerInstanceId) {
        return yield* fail(
          "This thread switched models since its last message. Send a message first.",
        );
      }
      const id = yield* random.uuidV4().pipe(Effect.orDie);
      const messageId = MessageId.make(`tidy-warm-up:${id}`);
      const sent = yield* startup
        .enqueueCommand(
          threads.sendToThread({
            projectId,
            threadId,
            commandId: CommandId.make(`server:${messageId}`),
            messageId,
            text: TidyDraft.TIDY_WARM_UP_MESSAGE,
            attachments: [],
            mode: "queue",
            requireIdle: true,
            createdBy: "system",
            creationSource: "server",
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            fail(`Tidy could not start its warm-up turn. ${cause.message}`),
          ),
        );
      const result = yield* threads
        .waitForThread({ projectId, threadId, runId: sent.run.id, timeoutMs: WARM_UP_TIMEOUT_MS })
        .pipe(
          Effect.mapError((cause) =>
            fail(`Tidy could not wait for its warm-up turn. ${cause.message}`),
          ),
        );
      if (result.timedOut) {
        return yield* fail("Tidy's warm-up turn timed out.");
      }
      if (
        result.run?.status !== "completed" ||
        result.run.id !== sent.run.id ||
        result.run.providerThreadId === null
      ) {
        return yield* fail("Tidy's warm-up turn did not complete.");
      }
      const { providerThreads } = yield* threads
        .getThreadRecords(threadId, ["providerThreads"], {
          providerThreadIds: [result.run.providerThreadId],
        })
        .pipe(Effect.mapError(() => fail("Tidy could not read the warmed Claude session.")));
      providerThread = providerThreads[0];
      providerSessionId = providerThread?.providerSessionId ?? null;
      if (providerThread?.driver !== "claudeAgent" || providerSessionId === null) {
        return yield* fail("Tidy could not find the warmed Claude session.");
      }
    }

    // A retry on a now-warm Claude thread can still end in the previous warm-up exchange.
    const question = TidyDraft.buildTidyDraftQuestion(draft, isClaude);
    const runtime = Option.getOrNull(
      yield* sessions
        .get(providerSessionId)
        .pipe(Effect.mapError(() => fail("Tidy could not read this thread's live session."))),
    );
    let liveFailure: string | null = null;
    const live =
      runtime?.askSideQuestion === undefined
        ? null
        : yield* runtime.askSideQuestion({ providerThread, question }).pipe(
            Effect.catch((cause) =>
              Effect.sync(() => {
                liveFailure = cause.message;
                return null;
              }),
            ),
          );
    let answer = live;
    if (answer === null) {
      // The warm-up already paid to open the conversation. A failed live question must not open it again.
      if (cold) {
        return yield* fail(liveFailure ?? "The warmed Claude session could not answer Tidy.");
      }
      if (modelSelection.instanceId !== providerThread.providerInstanceId) {
        return yield* fail(
          "This thread switched models since its last message. Send a message first.",
        );
      }
      const providerSession = projection.providerSessions.find(
        (candidate) => candidate.id === providerSessionId,
      );
      if (providerSession === undefined || sessions.askDetachedSideQuestion === undefined) {
        return yield* fail("This thread's session could not be found.");
      }
      answer = yield* sessions
        .askDetachedSideQuestion({
          threadId,
          providerSessionId,
          providerThread,
          modelSelection,
          runtimePolicy: {
            runtimeMode: projection.thread.runtimeMode,
            interactionMode: projection.thread.interactionMode,
            cwd: providerSession.cwd,
          },
          question,
        })
        .pipe(Effect.mapError((cause) => fail(liveFailure ?? cause.message)));
      if (answer === null) {
        return yield* fail(`Tidy does not work on ${providerThread.driver} threads yet.`);
      }
    }
    const parsed = TidyDraft.parseTidyDraftAnswer(answer);
    if (parsed === null) {
      return yield* fail("The agent's answer could not be read. Try again.");
    }
    return {
      ...parsed,
      source: cold ? "warmed" : live === null ? "fork" : "live",
    } satisfies TidyDraftResult;
  });

  return TidyDraftService.of({ run });
});

export const layer = Layer.effect(TidyDraftService, make);
