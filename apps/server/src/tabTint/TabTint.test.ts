import { type TabTintSnapshot, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
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

const claudeCommand = (command: string) =>
  JSON.stringify({
    itemType: "command_execution",
    status: "completed",
    data: { toolName: "Bash", input: { command } },
  });

const seedDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const at = "2026-09-29T10:00:00.000Z";
  yield* sql`
    INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES ('project-1', 'Repo', '/work/repo', '[]', ${at}, ${at})
  `;
  yield* sql`
    INSERT INTO projection_threads (thread_id, project_id, title, created_at, updated_at, archived_at)
    VALUES ('thread-live', 'project-1', 'Live', ${at}, ${at}, NULL),
      ('thread-archived', 'project-1', 'Archived', ${at}, ${at}, ${at})
  `;
  const activities = [
    ["a1", "thread-live", "cd site && xdg-open index.html", "2026-09-29T10:01:00.000Z"],
    ["a2", "thread-live", "xdg-open http://127.0.0.1:1344/proto/x", "2026-09-29T10:02:00.000Z"],
    ["a3", "thread-archived", "xdg-open http://127.0.0.1:1344/proto/y", "2026-09-29T10:03:00.000Z"],
    ["a4", "thread-live", "echo xdg-open http://127.0.0.1:1350/", "2026-09-29T10:04:00.000Z"],
  ] as const;
  for (const [id, threadId, command, createdAt] of activities) {
    yield* sql`
      INSERT INTO projection_thread_activities (activity_id, thread_id, tone, kind, summary, payload_json, created_at)
      VALUES (${id}, ${threadId}, 'tool', 'tool.completed', 'Command run', ${claudeCommand(command)}, ${createdAt})
    `;
  }
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
    return yield* Effect.die(new Error("tab tint snapshot never settled"));
  });

it.live("tints the live thread that opened a coloured tab, and follows the browser", () =>
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
        { url: "file:///work/repo/site/index.html", color: "red" },
        { url: "http://127.0.0.1:1350/", color: "blue" },
        { url: "http://127.0.0.1:1344/", color: "green" },
      ]),
    );

    yield* seedDatabase;

    yield* Effect.gen(function* () {
      const service = yield* TabTint.TabTint;
      // /proto/y was opened last by the archived thread, which cannot win it;
      // the echo only mentions a URL; the root belongs to nobody.
      const tinted = yield* awaitSnapshot(service, (s) => s.tints.length > 0);
      assert.deepEqual(tinted.tints, [
        {
          threadId: ThreadId.make("thread-live"),
          color: "red",
          tabCount: 2,
          // of the two red tabs, the one under the /proto/ open, which came later
          focusUrl: "http://127.0.0.1:1344/proto/y",
        },
      ]);

      // a command run after the first scan is still picked up
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_thread_activities (activity_id, thread_id, tone, kind, summary, payload_json, created_at)
        VALUES ('a5', 'thread-live', 'tool', 'tool.completed', 'Command run',
          ${claudeCommand("xdg-open http://127.0.0.1:1360/later")}, '2026-09-29T10:05:00.000Z')
      `;
      yield* fs.writeFile(
        sessionFile,
        sessionWith([{ url: "http://127.0.0.1:1360/later", color: "blue" }]),
      );
      const later = yield* awaitSnapshot(service, (s) => s.tints[0]?.color === "blue");
      assert.deepEqual(later.tints, [
        {
          threadId: ThreadId.make("thread-live"),
          color: "blue",
          tabCount: 1,
          focusUrl: "http://127.0.0.1:1360/later",
        },
      ]);

      // clearing the colour in the browser clears the marker
      yield* fs.writeFile(
        sessionFile,
        sessionWith([{ url: "http://127.0.0.1:1344/proto/y" }, { url: "file:///elsewhere" }]),
      );
      yield* awaitSnapshot(service, (s) => s.tints.length === 0);

      // a vanished profile is simply no tabs
      yield* fs.remove(path.join(firefoxDir, "profiles.ini"));
      yield* Effect.sleep(Duration.millis(100));
      assert.deepEqual((yield* service.latest).tints, []);
    }).pipe(
      Effect.provide(
        Layer.effect(
          TabTint.TabTint,
          TabTint.make({ firefoxDir, homeDir: "/home/mike", pollInterval: Duration.millis(20) }),
        ),
      ),
    );
  }).pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, SqlitePersistenceMemory)),
    Effect.scoped,
  ),
);
