/**
 * fork: ThreadWorkspaces keeps each thread's workspace tag in its own JSON
 * file and classifies new threads with Jev in the background. Without the key
 * file auto-tagging is off and manual and project tags still work.
 * @module ThreadWorkspaces
 */
import * as NodeOS from "node:os";

import {
  type ThreadWorkspacesCommand,
  type ThreadWorkspacesCommandResult,
  ThreadWorkspacesError,
  type ThreadWorkspacesSnapshot,
} from "@t3tools/contracts";
import { normalizeThreadWorkspaces } from "@t3tools/shared/threadWorkspaces";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";
import { askJev, buildJevRequestBody, type JevFetch, parseJevAnswer } from "./jev.ts";
import {
  type ClassifyCandidate,
  isDueForAutoTag,
  isDueForBackfill,
  parseStore,
  recordAttempt,
  setManualTags,
  setProjectDefaults,
  STORE_FILE_NAME,
  type ThreadWorkspacesStore,
  toSnapshot,
} from "./threadWorkspacesStore.ts";

const MAX_AUTO_TAGS_PER_POLL = 5;
const BACKFILL_CONCURRENCY = 4;
const MAX_BACKFILL_LIMIT = 500;

export class ThreadWorkspaces extends Context.Service<
  ThreadWorkspaces,
  {
    readonly subscribe: Effect.Effect<
      {
        readonly latest: ThreadWorkspacesSnapshot;
        readonly changes: Stream.Stream<ThreadWorkspacesSnapshot>;
      },
      never,
      Scope.Scope
    >;
    readonly command: (
      command: ThreadWorkspacesCommand,
    ) => Effect.Effect<ThreadWorkspacesCommandResult, ThreadWorkspacesError>;
  }
>()("t3/threadWorkspaces/ThreadWorkspaces") {}

export interface ThreadWorkspacesOptions {
  /** where the Jev API key is read from on every call; defaults to `~/.config/jev/key` */
  readonly keyFile?: string;
  readonly pollInterval?: Duration.Input;
  readonly fetch?: JevFetch;
}

interface CandidateRow {
  readonly threadId: string;
  readonly projectId: string;
  readonly parentThreadId: string | null;
  readonly createdAt: string;
  readonly userMessageCount: number;
  readonly firstUserMessageAt: string | null;
}

const NO_RESULT: ThreadWorkspacesCommandResult = { asked: 0, tagged: 0, failed: 0, remaining: 0 };

const snapshotKey = (snapshot: ThreadWorkspacesSnapshot): string => JSON.stringify(snapshot);

/** @public */
export const make = Effect.fn("threadWorkspaces.make")(function* (
  options: ThreadWorkspacesOptions = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  const { stateDir } = yield* ServerConfig.ServerConfig;

  const storePath = path.join(stateDir, STORE_FILE_NAME);
  const keyFileOverride = yield* Config.String("T3CODE_JEV_KEY_FILE").pipe(
    Config.option,
    Effect.orElseSucceed(() => Option.none<string>()),
  );
  const keyFile =
    options.keyFile ??
    Option.getOrElse(keyFileOverride, () => path.join(NodeOS.homedir(), ".config", "jev", "key"));
  const pollInterval = options.pollInterval ?? Duration.seconds(15);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const readKey = fs.readFileString(keyFile).pipe(
    Effect.map((raw) => raw.trim()),
    Effect.map((key) => (key.length > 0 ? key : null)),
    Effect.orElseSucceed(() => null),
  );

  const raw = yield* fs.readFileString(storePath).pipe(Effect.orElseSucceed(() => null));
  const store = yield* Ref.make(parseStore(raw, yield* nowIso));
  const hasKey = yield* Ref.make((yield* readKey) !== null);
  const changes = yield* PubSub.sliding<ThreadWorkspacesSnapshot>(1);
  const writeMutex = yield* Semaphore.make(1);
  const inFlight = new Set<string>();
  let published = snapshotKey(toSnapshot(yield* Ref.get(store), yield* Ref.get(hasKey)));
  if (raw === null) yield* persist(yield* Ref.get(store));

  const latest = Effect.gen(function* () {
    return toSnapshot(yield* Ref.get(store), yield* Ref.get(hasKey));
  });

  function persist(next: ThreadWorkspacesStore) {
    const tmp = `${storePath}.tmp`;
    return fs.makeDirectory(stateDir, { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(tmp, `${JSON.stringify(next, null, 1)}\n`)),
      Effect.andThen(fs.rename(tmp, storePath)),
      Effect.tapError((error) => Effect.logWarning("thread workspaces: could not save", { error })),
      Effect.ignore,
    );
  }

  const publish = Effect.gen(function* () {
    const snapshot = yield* latest;
    const key = snapshotKey(snapshot);
    if (key === published) return;
    published = key;
    yield* PubSub.publish(changes, snapshot);
  });

  /** applies one change under the write lock, saves it and tells subscribers */
  const update = (change: (current: ThreadWorkspacesStore) => ThreadWorkspacesStore) =>
    writeMutex.withPermits(1)(
      Effect.gen(function* () {
        const next = change(yield* Ref.get(store));
        yield* Ref.set(store, next);
        yield* persist(next);
        yield* publish;
      }),
    );

  const candidates = Effect.fn("threadWorkspaces.candidates")(function* (since: string | null) {
    const rows = yield* sql<CandidateRow>`
      SELECT thread.thread_id AS "threadId", thread.project_id AS "projectId",
        thread.created_at AS "createdAt",
        json_extract(thread.payload_json, '$.lineage.parentThreadId') AS "parentThreadId",
        (SELECT COUNT(*) FROM orchestration_v2_projection_messages AS message
          WHERE message.thread_id = thread.thread_id AND message.role = 'user') AS "userMessageCount",
        (SELECT MIN(message.created_at) FROM orchestration_v2_projection_messages AS message
          WHERE message.thread_id = thread.thread_id AND message.role = 'user') AS "firstUserMessageAt"
      FROM orchestration_v2_projection_threads AS thread
      WHERE thread.deleted_at IS NULL AND thread.archived_at IS NULL
        AND (${since} IS NULL OR thread.created_at >= ${since})
      ORDER BY thread.updated_at DESC
    `;
    return rows.map((row): ClassifyCandidate => ({
      ...row,
      userMessageCount: Number(row.userMessageCount),
    }));
  });

  const threadContext = Effect.fn("threadWorkspaces.threadContext")(function* (threadId: string) {
    const [thread] = yield* sql<{ readonly title: string; readonly projectName: string | null }>`
      SELECT thread.title AS title, project.title AS "projectName"
      FROM orchestration_v2_projection_threads AS thread
      LEFT JOIN projection_projects AS project ON project.project_id = thread.project_id
      WHERE thread.thread_id = ${threadId}
    `;
    const messages = yield* sql<{ readonly text: string | null }>`
      SELECT json_extract(payload_json, '$.text') AS text
      FROM orchestration_v2_projection_messages
      WHERE thread_id = ${threadId} AND role = 'user'
      ORDER BY created_at ASC, message_id ASC
      LIMIT 3
    `;
    return {
      title: thread?.title ?? "",
      projectName: thread?.projectName ?? null,
      messages: messages.flatMap((message) => (message.text ? [message.text] : [])),
    };
  });

  /** one classifier call; true when it tagged the thread. Every outcome counts as an attempt. */
  const classify = Effect.fn("threadWorkspaces.classify")(function* (
    key: string,
    threadId: string,
  ) {
    if (inFlight.has(threadId)) return "skipped" as const;
    inFlight.add(threadId);
    return yield* Effect.gen(function* () {
      const context = yield* threadContext(threadId);
      const workspaces = (yield* Ref.get(store)).workspaces;
      const body = buildJevRequestBody(workspaces, context);
      const outcome = yield* Effect.tryPromise({
        try: () => askJev(key, body, fetchImpl),
        catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
      }).pipe(
        Effect.map((response) => parseJevAnswer(response, workspaces)),
        Effect.tapError((error) =>
          Effect.logWarning("thread workspaces: jev call failed", { threadId, error }),
        ),
        Effect.option,
      );
      const answer = outcome._tag === "Some" ? outcome.value : null;
      const workspaceId = answer?._tag === "tagged" ? answer.workspaceId : null;
      const at = yield* nowIso;
      yield* update((current) => recordAttempt(current, threadId, workspaceId, at));
      if (answer?._tag === "unsure") {
        yield* Effect.logInfo("thread workspaces: jev unsure, left untagged", {
          threadId,
          choice: answer.choice,
          confidence: answer.confidence,
        });
      }
      return answer === null ? ("failed" as const) : workspaceId === null ? "unsure" : "tagged";
    }).pipe(Effect.ensuring(Effect.sync(() => inFlight.delete(threadId))));
  });

  const autoTag = Effect.gen(function* () {
    const key = yield* readKey;
    yield* Ref.set(hasKey, key !== null);
    yield* writeMutex.withPermits(1)(publish);
    if (key === null) return;
    const current = yield* Ref.get(store);
    const nowMs = yield* Clock.currentTimeMillis;
    const due = (yield* candidates(current.autoSince))
      .filter((candidate) => isDueForAutoTag(current, candidate, nowMs))
      .slice(0, MAX_AUTO_TAGS_PER_POLL);
    for (const candidate of due) yield* classify(key, candidate.threadId);
  });

  const backfill = Effect.fn("threadWorkspaces.backfill")(function* (limit: number) {
    const key = yield* readKey;
    if (key === null) {
      return yield* new ThreadWorkspacesError({
        detail: `No Jev key at ${keyFile}, so threads cannot be tagged automatically.`,
      });
    }
    const current = yield* Ref.get(store);
    const due = (yield* candidates(null).pipe(
      Effect.mapError(
        (error) =>
          new ThreadWorkspacesError({ detail: `Could not read threads: ${error.message}` }),
      ),
    )).filter((candidate) => isDueForBackfill(current, candidate));
    const capped = Math.max(1, Math.min(MAX_BACKFILL_LIMIT, Math.floor(limit)));
    const batch = due.slice(0, capped);
    const outcomes = yield* Effect.forEach(
      batch,
      (candidate) => classify(key, candidate.threadId).pipe(Effect.orElseSucceed(() => "failed")),
      { concurrency: BACKFILL_CONCURRENCY },
    );
    return {
      asked: outcomes.filter((outcome) => outcome !== "skipped").length,
      tagged: outcomes.filter((outcome) => outcome === "tagged").length,
      failed: outcomes.filter((outcome) => outcome === "failed").length,
      remaining: due.length - batch.length,
    } satisfies ThreadWorkspacesCommandResult;
  });

  const knownOrNull = Effect.fn("threadWorkspaces.knownOrNull")(function* (
    workspaceId: string | null,
  ) {
    if (workspaceId === null) return;
    const { workspaces } = yield* Ref.get(store);
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
      return yield* new ThreadWorkspacesError({ detail: `Unknown workspace ${workspaceId}.` });
    }
  });

  const command = Effect.fn("threadWorkspaces.command")(function* (input: ThreadWorkspacesCommand) {
    switch (input._tag) {
      case "setWorkspaces": {
        const workspaces = normalizeThreadWorkspaces(input.workspaces);
        if (workspaces.length === 0) {
          return yield* new ThreadWorkspacesError({ detail: "Keep at least one workspace." });
        }
        yield* update((current) => ({ ...current, workspaces }));
        return NO_RESULT;
      }
      case "setThreadWorkspace":
        yield* knownOrNull(input.workspaceId);
        yield* update((current) => setManualTags(current, input.threadIds, input.workspaceId));
        return NO_RESULT;
      case "setProjectDefault":
        yield* knownOrNull(input.workspaceId);
        yield* update((current) =>
          setProjectDefaults(current, input.projectIds, input.workspaceId),
        );
        return NO_RESULT;
      case "tagUntagged":
        return yield* backfill(input.limit);
    }
  });

  // not awaited: classification runs in the background and never delays startup
  yield* autoTag.pipe(
    Effect.ignoreCause({ log: true }),
    Effect.repeat(Schedule.spaced(pollInterval)),
    Effect.forkScoped,
    Effect.asVoid,
  );

  return ThreadWorkspaces.of({
    subscribe: subscribeBeforeSnapshot(changes, latest, writeMutex),
    command,
  });
});

export const layer = Layer.effect(ThreadWorkspaces, make());
