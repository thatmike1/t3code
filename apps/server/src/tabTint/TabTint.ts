/**
 * TabTint - the colour a browser tab was given by hand, shown on the thread
 * that opened it.
 *
 * Two read-only sources, polled together:
 * - Firefox's session store (`recovery.jsonlz4` in the default profile),
 *   where Sidebery keeps each tab's `customColor`. Firefox rewrites it about
 *   every 15 s, so it is re-read only when its mtime or size moves.
 * - T3's own `projection_thread_activities`, where every shell command a
 *   thread ran is stored; `xdg-open` and friends in there are the opens.
 *   Scanned incrementally by rowid, in bounded batches, so neither startup
 *   nor a poll holds the database for long.
 *
 * Nothing is written anywhere. No Firefox, no profile, or an unreadable
 * session all mean "no coloured tabs", never an error on the subscription.
 *
 * @module TabTint
 */
import * as NodeOS from "node:os";

import type { TabTintSnapshot } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { subscribeBeforeSnapshotWithoutMutex } from "../utils/subscribeBeforeSnapshot.ts";
import {
  type ColoredTab,
  defaultProfilePath,
  extractColoredTabs,
  SESSION_FILE_RELATIVE_PATH,
} from "./firefoxSession.ts";
import { decodeMozLz4 } from "./mozLz4.ts";
import {
  commandFromActivityPayload,
  matchTabTints,
  type OpenClaim,
  openTargetsInCommand,
} from "./tabTintMatch.ts";

/** Rowids per activity query; each batch is a few tens of milliseconds on a large database. */
const ACTIVITY_BATCH_ROWS = 5000;

export class TabTint extends Context.Service<
  TabTint,
  {
    readonly latest: Effect.Effect<TabTintSnapshot>;
    readonly changes: Stream.Stream<TabTintSnapshot>;
    /** The current snapshot plus every later one, subscribed before the snapshot is read. */
    readonly subscribe: Effect.Effect<
      {
        readonly latest: TabTintSnapshot;
        readonly changes: Stream.Stream<TabTintSnapshot>;
      },
      never,
      Scope.Scope
    >;
  }
>()("t3/tabTint/TabTint") {}

export interface TabTintOptions {
  /** The directory holding `profiles.ini`; defaults to `~/.mozilla/firefox`. */
  readonly firefoxDir?: string;
  /** Where `~` in a command points; defaults to the server user's home. */
  readonly homeDir?: string;
  readonly pollInterval?: Duration.Input;
}

interface ThreadRow {
  readonly threadId: string;
  readonly cwd: string | null;
  readonly live: number;
}

interface ActivityRow {
  readonly row: number;
  readonly threadId: string;
  readonly payload: string;
  readonly createdAt: string;
}

const decodeJsonExit = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

const snapshotKey = (snapshot: TabTintSnapshot): string => JSON.stringify(snapshot.tints);

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("tabTint.make")(function* (options: TabTintOptions = {}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;

  const homeDir = options.homeDir ?? NodeOS.homedir();
  const firefoxDir = options.firefoxDir ?? path.join(homeDir, ".mozilla", "firefox");
  const pollInterval = options.pollInterval ?? Duration.seconds(3);

  const changes = yield* PubSub.sliding<TabTintSnapshot>(1);
  const state = yield* Ref.make<TabTintSnapshot>({ tints: [] });

  // Poll-local state, only ever touched by the single polling fiber.
  let sessionKey: string | null = null;
  let coloredTabs: ReadonlyArray<ColoredTab> = [];
  let activityCursor = 0;
  const claims = new Map<string, OpenClaim>();

  /** The session file of the profile Firefox launches by default, or null when there is none. */
  const resolveSessionFile = Effect.gen(function* () {
    const ini = yield* fs
      .readFileString(path.join(firefoxDir, "profiles.ini"))
      .pipe(Effect.orElseSucceed(() => null));
    if (ini === null) return null;
    const profile = defaultProfilePath(ini);
    if (profile === null) return null;
    const profileDir = path.isAbsolute(profile) ? profile : path.join(firefoxDir, profile);
    return path.join(profileDir, SESSION_FILE_RELATIVE_PATH);
  });

  const refreshColoredTabs = Effect.gen(function* () {
    const sessionFile = yield* resolveSessionFile;
    const info =
      sessionFile === null
        ? null
        : yield* fs.stat(sessionFile).pipe(Effect.orElseSucceed(() => null));
    if (sessionFile === null || info === null) {
      sessionKey = null;
      coloredTabs = [];
      return;
    }
    const mtime = Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() });
    const key = `${sessionFile}\n${mtime}\n${info.size}`;
    if (key === sessionKey) return;

    const bytes = yield* fs.readFile(sessionFile).pipe(Effect.orElseSucceed(() => null));
    if (bytes === null) return;
    const decoded = yield* Effect.try(() => {
      const json = decodeJsonExit(new TextDecoder().decode(decodeMozLz4(bytes)));
      if (json._tag === "Failure") throw new Error("session file is not JSON");
      return extractColoredTabs(json.value);
    }).pipe(
      Effect.tapError((error) =>
        Effect.logDebug("tab tint: session file unreadable", { sessionFile, error }),
      ),
      Effect.orElseSucceed(() => null),
    );
    // A half-written or corrupt file keeps the last good tabs; the key is not
    // advanced, so the next poll tries again.
    if (decoded === null) return;
    sessionKey = key;
    coloredTabs = decoded;
  });

  const scanActivities = Effect.fn("tabTint.scanActivities")(function* (
    cwdByThread: ReadonlyMap<string, string | null>,
  ) {
    const [top] = yield* sql<{ readonly max: number | null }>`
      SELECT MAX(rowid) AS max FROM projection_thread_activities
    `;
    const maxRow = top?.max ?? 0;
    while (activityCursor < maxRow) {
      // clamped to the newest row: running the cursor past it would skip every
      // activity written before the table grows to the overshoot.
      const upper = Math.min(activityCursor + ACTIVITY_BATCH_ROWS, maxRow);
      // The instr() filter is only a cheap prefilter; the shell lexer decides.
      const rows = yield* sql<ActivityRow>`
        SELECT rowid AS row, thread_id AS "threadId", payload_json AS payload,
          created_at AS "createdAt"
        FROM projection_thread_activities
        WHERE rowid > ${activityCursor} AND rowid <= ${upper}
          AND kind IN ('tool.started', 'tool.updated', 'tool.completed')
          AND (instr(payload_json, 'xdg-open') > 0
            OR instr(payload_json, 'gio open') > 0
            OR instr(payload_json, 'firefox') > 0
            OR instr(payload_json, 'www-browser') > 0)
      `;
      for (const row of rows) {
        const payload = decodeJsonExit(row.payload);
        if (payload._tag === "Failure") continue;
        const command = commandFromActivityPayload(payload.value);
        if (command === null) continue;
        const cwd = command.cwd ?? cwdByThread.get(row.threadId) ?? null;
        const openedAt = Date.parse(row.createdAt);
        if (Number.isNaN(openedAt)) continue;
        for (const target of openTargetsInCommand(command.command, cwd, homeDir)) {
          const key = `${row.threadId}\n${target}`;
          const previous = claims.get(key);
          if (previous === undefined || previous.openedAt < openedAt) {
            claims.set(key, { threadId: row.threadId, target, openedAt });
          }
        }
      }
      activityCursor = upper;
      yield* Effect.yieldNow;
    }
  });

  const refresh = Effect.gen(function* () {
    const threads = yield* sql<ThreadRow>`
        SELECT t.thread_id AS "threadId",
          COALESCE(t.worktree_path, p.workspace_root) AS cwd,
          (t.archived_at IS NULL AND t.deleted_at IS NULL) AS live
        FROM projection_threads AS t
        LEFT JOIN projection_projects AS p ON p.project_id = t.project_id
      `;
    const cwdByThread = new Map(threads.map((thread) => [thread.threadId, thread.cwd]));
    const liveThreadIds = new Set(
      threads.filter((thread) => Number(thread.live) === 1).map((thread) => thread.threadId),
    );

    yield* scanActivities(cwdByThread);
    yield* refreshColoredTabs;

    const next: TabTintSnapshot = {
      tints: matchTabTints(coloredTabs, [...claims.values()], liveThreadIds),
    };
    const changed = yield* Ref.modify(state, (previous): readonly [boolean, TabTintSnapshot] =>
      snapshotKey(previous) === snapshotKey(next) ? [false, previous] : [true, next],
    );
    if (changed) yield* PubSub.publish(changes, next).pipe(Effect.asVoid);
  });

  // Not awaited: the first full activity scan runs in the background so it
  // never delays server startup. Clients get the empty set until it lands.
  yield* refresh.pipe(
    Effect.ignoreCause({ log: true }),
    Effect.repeat(Schedule.spaced(pollInterval)),
    Effect.forkScoped,
    Effect.asVoid,
  );

  return TabTint.of({
    latest: Ref.get(state),
    changes: Stream.fromPubSub(changes),
    // Without the mutex a subscriber never waits out a long first scan; the
    // worst case is receiving the same snapshot twice.
    subscribe: subscribeBeforeSnapshotWithoutMutex(changes, Ref.get(state)),
  });
});

export const layer = Layer.effect(TabTint, make());
