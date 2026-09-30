/**
 * AgentThreads - remembers which thread launched which.
 *
 * The T3 MCP `create_threads` handler knows the thread its caller runs in,
 * but the orchestration engine stores nothing about it. This service keeps
 * that one fact, child thread id to parent thread id, in its own small table
 * in the state database and streams the whole set to clients.
 *
 * The table is created here on startup, not through a numbered migration:
 * it belongs to no upstream schema, and a numbered file would collide with
 * the next migration upstream adds.
 *
 * @module AgentThreads
 */
import type { AgentThreadsSnapshot, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";

export class AgentThreads extends Context.Service<
  AgentThreads,
  {
    /**
     * Stores that `threadId` was launched from `parentThreadId`. The first
     * record for a thread wins, so a retried launch keeps its original link.
     * Never fails: a lost link only costs the nesting, and must not fail the
     * launch that already happened.
     */
    readonly record: (input: {
      readonly threadId: ThreadId;
      readonly parentThreadId: ThreadId;
    }) => Effect.Effect<void>;
    readonly latest: Effect.Effect<AgentThreadsSnapshot>;
    /** The current snapshot plus every later one, subscribed before the snapshot is read. */
    readonly subscribe: Effect.Effect<
      {
        readonly latest: AgentThreadsSnapshot;
        readonly changes: Stream.Stream<AgentThreadsSnapshot>;
      },
      never,
      Scope.Scope
    >;
  }
>()("t3/agentThreads/AgentThreads") {}

const EMPTY_SNAPSHOT: AgentThreadsSnapshot = { links: [] };

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("agentThreads.make")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.sliding<AgentThreadsSnapshot>(1);
  // Serializes a write with its publish, and a subscriber's read with its
  // subscription, so no subscriber can miss the link written beside it.
  const mutex = yield* Semaphore.make(1);

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_thread_parents (
      thread_id TEXT PRIMARY KEY,
      parent_thread_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `.pipe(Effect.orDie);

  // insertion order is launch order; a batch shares one timestamp, so the
  // rowid is the only thing that keeps its threads in the order they were asked for.
  const read = sql<AgentThreadsSnapshot["links"][number]>`
    SELECT thread_id AS "threadId", parent_thread_id AS "parentThreadId",
      created_at AS "createdAt"
    FROM agent_thread_parents
    ORDER BY rowid ASC
  `.pipe(
    Effect.map((links): AgentThreadsSnapshot => ({ links })),
    Effect.tapError((error) => Effect.logWarning("agent threads: could not read links", error)),
    Effect.orElseSucceed(() => EMPTY_SNAPSHOT),
  );

  const record: AgentThreads["Service"]["record"] = (input) =>
    mutex
      .withPermits(1)(
        Effect.gen(function* () {
          // a thread cannot be its own parent; a row like that would hide it
          if (input.threadId === input.parentThreadId) return;
          const createdAt = DateTime.formatIso(yield* DateTime.now);
          yield* sql`
            INSERT OR IGNORE INTO agent_thread_parents (thread_id, parent_thread_id, created_at)
            VALUES (${input.threadId}, ${input.parentThreadId}, ${createdAt})
          `;
          yield* PubSub.publish(changes, yield* read);
        }),
      )
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("agent threads: could not store a link", { ...input, error }),
        ),
        Effect.asVoid,
      );

  return AgentThreads.of({
    record,
    latest: read,
    subscribe: subscribeBeforeSnapshot(changes, read, mutex),
  });
});

export const layer = Layer.effect(AgentThreads, make());
