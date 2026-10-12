import {
  EventId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  type TabTintColor,
  type TabTintSnapshot,
  ThreadId,
  type ThreadTabTint,
  TurnItemId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { SIDEBERY_EXT_DATA_KEY } from "./firefoxSession.ts";
import * as TabTint from "./TabTint.ts";

/**
 * A valid mozlz4 file holding `text` as one literal-only LZ4 sequence, which
 * the format allows. Enough to exercise the service without an encoder.
 */
function literalOnlyMozLz4(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const run: Array<number> = [];
  if (body.length < 15) {
    run.push(body.length << 4);
  } else {
    run.push(0xf0);
    let rest = body.length - 15;
    while (rest >= 255) {
      run.push(255);
      rest -= 255;
    }
    run.push(rest);
  }
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode("mozLz40\0"));
  new DataView(header.buffer).setUint32(8, body.length, true);
  return new Uint8Array([...header, ...run, ...body]);
}

const sessionWith = (tabs: ReadonlyArray<{ url: string; color?: string }>) =>
  literalOnlyMozLz4(
    JSON.stringify({
      windows: [
        {
          tabs: tabs.map((tab, index) => ({
            entries: [{ url: tab.url }],
            index: 1,
            extData: {
              [SIDEBERY_EXT_DATA_KEY]: JSON.stringify({
                id: index,
                ...(tab.color ? { customColor: tab.color } : {}),
              }),
            },
          })),
        },
      ],
    }),
  );

const providerInstanceId = ProviderInstanceId.make("codex");
const providerDriver = ProviderDriverKind.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.4" } satisfies ModelSelection;
const at = (iso: string) => DateTime.makeUnsafe(iso);

let eventCounter = 0;
const nextEventId = () => EventId.make(`event:tab-tint:${++eventCounter}`);

function threadCreated(input: {
  readonly id: string;
  readonly worktreePath?: string;
  readonly archived?: boolean;
}): OrchestrationV2DomainEvent {
  const now = at("2026-10-12T09:00:00.000Z");
  const threadId = ThreadId.make(input.id);
  const thread: OrchestrationV2AppThread = {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title: input.id,
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: input.worktreePath ?? null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: input.archived ? now : null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
  return {
    id: nextEventId(),
    type: "thread.created",
    threadId,
    providerInstanceId,
    occurredAt: now,
    payload: thread,
  };
}

/** a provider session started in `cwd` and the provider thread it runs for `threadId`. */
function providerSession(input: {
  readonly threadId: string;
  readonly providerThreadId: string;
  readonly cwd: string;
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const now = at("2026-10-12T09:00:00.000Z");
  const threadId = ThreadId.make(input.threadId);
  const providerSessionId = ProviderSessionId.make(`session:${input.providerThreadId}`);
  return [
    {
      id: nextEventId(),
      type: "provider-session.attached",
      threadId,
      driver: providerDriver,
      providerInstanceId,
      occurredAt: now,
      payload: {
        id: providerSessionId,
        driver: providerDriver,
        providerInstanceId,
        status: "ready",
        cwd: input.cwd,
        model: modelSelection.model,
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      },
    },
    {
      id: nextEventId(),
      type: "provider-thread.updated",
      threadId,
      driver: providerDriver,
      providerInstanceId,
      occurredAt: now,
      payload: {
        id: ProviderThreadId.make(input.providerThreadId),
        driver: providerDriver,
        providerInstanceId,
        providerSessionId,
        appThreadId: threadId,
        ownerNodeId: null,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: 1,
        lastRunOrdinal: 1,
        handoffIds: [],
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
      },
    },
  ];
}

let ordinal = 0;
/** one `command_execution` turn item, as a provider adapter reports a shell command. */
function commandItem(input: {
  readonly id: string;
  readonly threadId: string;
  readonly providerThreadId?: string;
  readonly command: string;
  readonly startedAt: string;
  readonly status?: "running" | "completed";
}): OrchestrationV2DomainEvent {
  const startedAt = at(input.startedAt);
  const threadId = ThreadId.make(input.threadId);
  return {
    id: nextEventId(),
    type: "turn-item.updated",
    threadId,
    occurredAt: startedAt,
    payload: {
      id: TurnItemId.make(input.id),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId:
        input.providerThreadId === undefined ? null : ProviderThreadId.make(input.providerThreadId),
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: ordinal++,
      status: input.status ?? "completed",
      title: null,
      startedAt,
      completedAt: input.status === "running" ? null : startedAt,
      updatedAt: startedAt,
      type: "command_execution",
      input: input.command,
    },
  };
}

const write = Effect.fn("tabTintTest.write")(function* (
  events: ReadonlyArray<OrchestrationV2DomainEvent>,
) {
  const sink = yield* EventSink.EventSinkV2;
  return yield* sink.write({ events });
});

const seedDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const created = "2026-10-12T09:00:00.000Z";
  yield* sql`
    INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES ('project-1', 'Repo', '/work/repo', '[]', ${created}, ${created})
  `;
  yield* write([
    threadCreated({ id: "thread-live" }),
    ...providerSession({
      threadId: "thread-live",
      providerThreadId: "provider-thread-live",
      cwd: "/work/session",
    }),
    threadCreated({ id: "thread-archived", archived: true }),
    threadCreated({ id: "thread-worktree", worktreePath: "/work/tree" }),
    threadCreated({ id: "thread-project" }),
    // relative to the provider session's directory
    commandItem({
      id: "item-1",
      threadId: "thread-live",
      providerThreadId: "provider-thread-live",
      command: "cd site && xdg-open index.html",
      startedAt: "2026-10-12T10:01:00.000Z",
    }),
    commandItem({
      id: "item-2",
      threadId: "thread-live",
      providerThreadId: "provider-thread-live",
      command: "/bin/bash -lc 'xdg-open http://127.0.0.1:1344/proto/x'",
      startedAt: "2026-10-12T10:02:00.000Z",
    }),
    commandItem({
      id: "item-3",
      threadId: "thread-archived",
      command: "xdg-open http://127.0.0.1:1344/proto/y",
      startedAt: "2026-10-12T10:03:00.000Z",
    }),
    commandItem({
      id: "item-4",
      threadId: "thread-live",
      command: "echo xdg-open http://127.0.0.1:1350/",
      startedAt: "2026-10-12T10:04:00.000Z",
    }),
    // no provider session: the worktree, then the project root
    commandItem({
      id: "item-5",
      threadId: "thread-worktree",
      command: "xdg-open notes.html",
      startedAt: "2026-10-12T10:05:00.000Z",
    }),
    commandItem({
      id: "item-6",
      threadId: "thread-project",
      command: "firefox docs/a.html",
      startedAt: "2026-10-12T10:06:00.000Z",
    }),
  ]);
});

/** Polls `latest` until it satisfies `done`, failing the test after two seconds. */
const awaitSnapshot = (
  service: TabTint.TabTint["Service"],
  done: (s: TabTintSnapshot) => boolean,
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      const snapshot = yield* service.latest;
      if (done(snapshot)) return snapshot;
      yield* Effect.sleep(Duration.millis(20));
    }
    return yield* Effect.die(
      new Error(`tab tint snapshot never settled: ${JSON.stringify(yield* service.latest)}`),
    );
  });

const tint = (
  threadId: string,
  color: TabTintColor,
  tabCount: number,
  focusUrl: string,
): ThreadTabTint => ({
  threadId: ThreadId.make(threadId),
  color,
  tabCount,
  focusUrl,
});

const layerDatabase = SqlitePersistence.layerMemory;
const layerStores = Layer.mergeAll(
  layerDatabase,
  EventStore.layer.pipe(Layer.provideMerge(layerDatabase)),
  ProjectionStore.layer.pipe(Layer.provideMerge(layerDatabase)),
);
const layerTest = Layer.mergeAll(
  NodeServices.layer,
  layerStores,
  EventSink.layer.pipe(Layer.provide(layerStores)),
);

it.live("tints live threads from V2 command turn items, and follows new and changed items", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const firefoxDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-tab-tint-" });
    const profileDir = path.join(firefoxDir, "abcd.default");
    const sessionFile = path.join(profileDir, "sessionstore-backups", "recovery.jsonlz4");
    yield* fs.makeDirectory(path.dirname(sessionFile), { recursive: true });
    yield* fs.writeFileString(
      path.join(firefoxDir, "profiles.ini"),
      "[Profile0]\nName=default\nIsRelative=1\nPath=abcd.default\nDefault=1\n",
    );
    yield* fs.writeFile(
      sessionFile,
      sessionWith([
        { url: "http://127.0.0.1:1344/proto/y", color: "red" },
        { url: "file:///work/session/site/index.html", color: "red" },
        { url: "http://127.0.0.1:1350/", color: "blue" },
        { url: "http://127.0.0.1:1344/", color: "green" },
        { url: "file:///work/tree/notes.html", color: "purple" },
        { url: "file:///work/repo/docs/a.html", color: "pink" },
      ]),
    );

    yield* seedDatabase;
    const layerTabTint = Layer.effect(
      TabTint.TabTint,
      TabTint.make({ firefoxDir, homeDir: "/home/mike", pollInterval: Duration.millis(20) }),
    );

    yield* Effect.gen(function* () {
      const service = yield* TabTint.TabTint;
      // items written before start come from the projection snapshot. /proto/y
      // was opened last by the archived thread, which cannot win it; the echo
      // only mentions a URL; the site root belongs to nobody.
      const tinted = yield* awaitSnapshot(service, (s) => s.tints.length > 0);
      assert.deepEqual(tinted.tints, [
        // of the two red tabs, the one under the /proto/ open, which came later
        tint("thread-live", "red", 2, "http://127.0.0.1:1344/proto/y"),
        tint("thread-project", "pink", 1, "file:///work/repo/docs/a.html"),
        tint("thread-worktree", "purple", 1, "file:///work/tree/notes.html"),
      ]);

      // a command run after the snapshot comes in through the event log
      yield* write([
        commandItem({
          id: "item-7",
          threadId: "thread-live",
          providerThreadId: "provider-thread-live",
          command: "xdg-open http://127.0.0.1:1360/later",
          startedAt: "2026-10-12T10:07:00.000Z",
          status: "running",
        }),
      ]);
      yield* fs.writeFile(
        sessionFile,
        sessionWith([
          { url: "http://127.0.0.1:1360/later", color: "blue" },
          { url: "http://127.0.0.1:1361/moved/page", color: "green" },
        ]),
      );
      const later = yield* awaitSnapshot(service, (s) => s.tints[0]?.color === "blue");
      assert.deepEqual(later.tints, [
        tint("thread-live", "blue", 1, "http://127.0.0.1:1360/later"),
      ]);

      // the same item updated replaces what it opened rather than adding to it
      yield* write([
        commandItem({
          id: "item-7",
          threadId: "thread-live",
          providerThreadId: "provider-thread-live",
          command: "xdg-open http://127.0.0.1:1361/moved",
          startedAt: "2026-10-12T10:07:00.000Z",
        }),
      ]);
      const moved = yield* awaitSnapshot(service, (s) => s.tints[0]?.color === "green");
      assert.deepEqual(moved.tints, [
        tint("thread-live", "green", 1, "http://127.0.0.1:1361/moved/page"),
      ]);

      // clearing the colour in the browser clears the marker
      yield* fs.writeFile(
        sessionFile,
        sessionWith([{ url: "http://127.0.0.1:1361/moved/page" }, { url: "file:///elsewhere" }]),
      );
      yield* awaitSnapshot(service, (s) => s.tints.length === 0);
    }).pipe(Effect.provide(layerTabTint), Effect.scoped);

    // commands run while the server is down are in the projection on the
    // next start, and the restarted service tails the log from where it is.
    yield* write([
      commandItem({
        id: "item-8",
        threadId: "thread-live",
        providerThreadId: "provider-thread-live",
        command: "xdg-open http://127.0.0.1:1370/while-down",
        startedAt: "2026-10-12T10:08:00.000Z",
      }),
    ]);
    yield* fs.writeFile(
      sessionFile,
      sessionWith([
        { url: "http://127.0.0.1:1370/while-down", color: "orange" },
        { url: "http://127.0.0.1:1380/after-restart", color: "yellow" },
      ]),
    );
    yield* Effect.gen(function* () {
      const service = yield* TabTint.TabTint;
      const restarted = yield* awaitSnapshot(service, (s) => s.tints.length > 0);
      assert.deepEqual(restarted.tints, [
        tint("thread-live", "orange", 1, "http://127.0.0.1:1370/while-down"),
      ]);
      yield* write([
        commandItem({
          id: "item-9",
          threadId: "thread-worktree",
          command: "xdg-open http://127.0.0.1:1380/after-restart",
          startedAt: "2026-10-12T10:09:00.000Z",
        }),
      ]);
      const caughtUp = yield* awaitSnapshot(service, (s) => s.tints.length === 2);
      assert.deepEqual(caughtUp.tints, [
        tint("thread-live", "orange", 1, "http://127.0.0.1:1370/while-down"),
        tint("thread-worktree", "yellow", 1, "http://127.0.0.1:1380/after-restart"),
      ]);

      // a vanished profile is simply no tabs
      yield* fs.remove(path.join(firefoxDir, "profiles.ini"));
      yield* awaitSnapshot(service, (s) => s.tints.length === 0);
    }).pipe(Effect.provide(layerTabTint), Effect.scoped);
  }).pipe(Effect.provide(layerTest), Effect.scoped),
);
