import { type AgentThreadsSnapshot, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import {
  makeSqlitePersistenceLive,
  SqlitePersistenceMemory,
} from "../persistence/Layers/Sqlite.ts";
import * as AgentThreads from "./AgentThreads.ts";

const PARENT = ThreadId.make("thread-parent");
const CHILD_A = ThreadId.make("mcp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const CHILD_B = ThreadId.make("mcp-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

const pairs = (snapshot: AgentThreadsSnapshot) =>
  snapshot.links.map((link) => [link.threadId, link.parentThreadId]);

const memoryLayer = AgentThreads.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory));

it.layer(Layer.mergeAll(memoryLayer, NodeServices.layer))("AgentThreads", (it) => {
  it.effect("starts empty, then keeps each link in launch order", () =>
    Effect.gen(function* () {
      const service = yield* AgentThreads.AgentThreads;
      assert.deepEqual((yield* service.latest).links, []);

      yield* service.record({ threadId: CHILD_A, parentThreadId: PARENT });
      yield* service.record({ threadId: CHILD_B, parentThreadId: CHILD_A });
      assert.deepEqual(pairs(yield* service.latest), [
        [CHILD_A, PARENT],
        [CHILD_B, CHILD_A],
      ]);
    }),
  );

  it.effect("keeps the first parent when a launch is retried, and refuses a self link", () =>
    Effect.gen(function* () {
      const service = yield* AgentThreads.AgentThreads;
      const other = ThreadId.make("thread-other");
      yield* service.record({ threadId: CHILD_A, parentThreadId: PARENT });
      yield* service.record({ threadId: CHILD_A, parentThreadId: other });
      yield* service.record({ threadId: other, parentThreadId: other });
      const links = pairs(yield* service.latest);
      assert.deepEqual(
        links.filter(([threadId]) => threadId === CHILD_A),
        [[CHILD_A, PARENT]],
      );
      assert.isFalse(links.some(([threadId]) => threadId === other));
    }),
  );

  it.effect("hands a subscriber the current links and every later set", () =>
    Effect.gen(function* () {
      const service = yield* AgentThreads.AgentThreads;
      const late = ThreadId.make("mcp-cccccccccccccccccccccccccccccccc");
      yield* Effect.gen(function* () {
        const { latest, changes } = yield* service.subscribe;
        assert.isFalse(latest.links.some((link) => link.threadId === late));
        const next = yield* Stream.runHead(changes).pipe(Effect.forkScoped);
        yield* service.record({ threadId: late, parentThreadId: PARENT });
        const pushed = yield* Fiber.join(next);
        assert.isTrue(
          pushed._tag === "Some" && pushed.value.links.some((l) => l.threadId === late),
        );
      }).pipe(Effect.scoped);
    }),
  );
});

it.live("survives a restart: a second server on the same database reads the links back", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-agent-threads-" });
    const onDisk = AgentThreads.layer.pipe(
      Layer.provide(makeSqlitePersistenceLive(path.join(dir, "state.sqlite"))),
    );

    yield* Effect.gen(function* () {
      const service = yield* AgentThreads.AgentThreads;
      yield* service.record({ threadId: CHILD_A, parentThreadId: PARENT });
    }).pipe(Effect.provide(onDisk));

    const reopened = yield* Effect.gen(function* () {
      const service = yield* AgentThreads.AgentThreads;
      return yield* service.latest;
    }).pipe(Effect.provide(onDisk));
    assert.deepEqual(pairs(reopened), [[CHILD_A, PARENT]]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
