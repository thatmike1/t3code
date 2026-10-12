/**
 * TabTint - the colour a browser tab was given by hand, shown on the thread
 * that opened it.
 *
 * Two read-only sources, polled together:
 * - Firefox's session store (`recovery.jsonlz4` in the default profile),
 *   where Sidebery keeps each tab's `customColor`. Firefox rewrites it about
 *   every 15 s, so it is re-read only when its mtime or size moves.
 * - The orchestration V2 `command_execution` turn items, the shell commands
 *   every thread ran; `xdg-open` and friends in there are the opens. On
 *   start the projection table (`orchestration_v2_projection_turn_items`)
 *   gives every item as it stands, then the shared event log
 *   (`orchestration_events`, V2 `turn-item.updated` rows) is tailed by
 *   sequence for new and changed items. The log's high-water mark is read
 *   before the snapshot, and events commit together with their projection,
 *   so nothing falls between the two. Both are read in bounded batches, so
 *   neither startup nor a poll holds the database for long. Nothing is
 *   persisted: a restart rebuilds the index from the projection again.
 *
 * The items carry no directory, so a relative path resolves against the
 * provider session's `cwd`, else the thread's worktree, else its project root.
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
import * as SqlClient from "effect/sql/SqlClient";

import { subscribeBeforeSnapshotWithoutMutex } from "../utils/subscribeBeforeSnapshot.ts";
import {
  type ColoredTab,
  defaultProfilePath,
  extractColoredTabs,
  SESSION_FILE_RELATIVE_PATH,
} from "./firefoxSession.ts";
import { decodeMozLz4 } from "./mozLz4.ts";
import {
  commandFromTurnItemPayload,
  matchTabTints,
  type OpenClaim,
  openTargetsInCommand,
} from "./tabTintMatch.ts";

/** rowids or sequences per query; each batch is a few tens of milliseconds on a large database. */
const SCAN_BATCH_ROWS = 5000;

/**
 * substrings an opening command's stored JSON must contain. only a cheap SQL
 * prefilter; the shell lexer decides what is really an open.
 */
const OPENER_NEEDLES = ["xdg-open", "gio open", "firefox", "www-browser", "sensible-browser"];

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

interface CommandItemRow {
  /** the rowid (snapshot) or event sequence (tail) the batch pages by */
  readonly row: number;
  /** null only for a malformed event payload */
  readonly turnItemId: string | null;
  readonly threadId: string;
  readonly payload: string;
  readonly cwd: string | null;
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
  /** the last event-log sequence read; null until the projection snapshot has run */
  let eventCursor: number | null = null;
  /** the opens each command turn item made, replaced whole when the item changes */
  const claimsByItem = new Map<string, ReadonlyArray<OpenClaim>>();

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

  const indexItem = (row: CommandItemRow) => {
    if (row.turnItemId === null) return;
    const payload = decodeJsonExit(row.payload);
    const command = payload._tag === "Failure" ? null : commandFromTurnItemPayload(payload.value);
    const targets =
      command === null ? [] : [...new Set(openTargetsInCommand(command.command, row.cwd, homeDir))];
    if (command === null || targets.length === 0) {
      claimsByItem.delete(row.turnItemId);
      return;
    }
    claimsByItem.set(
      row.turnItemId,
      targets.map((target) => ({ threadId: row.threadId, target, openedAt: command.openedAt })),
    );
  };

  const latestSequence = Effect.gen(function* () {
    const [top] = yield* sql<{ readonly max: number | null }>`
      SELECT MAX(sequence) AS max FROM orchestration_events
    `;
    return top?.max ?? 0;
  });

  /** every command turn item as the projection holds it now */
  const snapshotTurnItems = Effect.gen(function* () {
    const [top] = yield* sql<{ readonly max: number | null }>`
      SELECT MAX(rowid) AS max FROM orchestration_v2_projection_turn_items
    `;
    const maxRow = top?.max ?? 0;
    let cursor = 0;
    while (cursor < maxRow) {
      const upper = Math.min(cursor + SCAN_BATCH_ROWS, maxRow);
      const rows = yield* sql<CommandItemRow>`
        SELECT item.rowid AS row, item.turn_item_id AS "turnItemId",
          item.thread_id AS "threadId", item.payload_json AS payload,
          COALESCE(
            json_extract(session.payload_json, '$.cwd'),
            json_extract(thread.payload_json, '$.worktreePath'),
            project.workspace_root
          ) AS cwd
        FROM orchestration_v2_projection_turn_items AS item
        LEFT JOIN orchestration_v2_projection_provider_threads AS provider_thread
          ON provider_thread.provider_thread_id = item.provider_thread_id
        LEFT JOIN orchestration_v2_projection_provider_sessions AS session
          ON session.provider_session_id = provider_thread.provider_session_id
        LEFT JOIN orchestration_v2_projection_threads AS thread
          ON thread.thread_id = item.thread_id
        LEFT JOIN projection_projects AS project ON project.project_id = thread.project_id
        WHERE item.rowid > ${cursor} AND item.rowid <= ${upper}
          AND item.type = 'command_execution'
          AND ${sql.or(OPENER_NEEDLES.map((needle) => sql`instr(item.payload_json, ${needle}) > 0`))}
      `;
      for (const row of rows) indexItem(row);
      cursor = upper;
      yield* Effect.yieldNow;
    }
  });

  /** the command turn items written to the event log after `from`, oldest first */
  const tailEvents = Effect.fn("tabTint.tailEvents")(function* (from: number, through: number) {
    let cursor = from;
    while (cursor < through) {
      // clamped to the newest event read up front: running the cursor past it
      // would skip every event written before the log grows to the overshoot.
      const upper = Math.min(cursor + SCAN_BATCH_ROWS, through);
      const rows = yield* sql<CommandItemRow>`
        SELECT event.sequence AS row,
          json_extract(event.payload_json, '$.id') AS "turnItemId",
          event.stream_id AS "threadId", event.payload_json AS payload,
          COALESCE(
            json_extract(session.payload_json, '$.cwd'),
            json_extract(thread.payload_json, '$.worktreePath'),
            project.workspace_root
          ) AS cwd
        FROM orchestration_events AS event
        LEFT JOIN orchestration_v2_projection_provider_threads AS provider_thread
          ON provider_thread.provider_thread_id = json_extract(event.payload_json, '$.providerThreadId')
        LEFT JOIN orchestration_v2_projection_provider_sessions AS session
          ON session.provider_session_id = provider_thread.provider_session_id
        LEFT JOIN orchestration_v2_projection_threads AS thread
          ON thread.thread_id = event.stream_id
        LEFT JOIN projection_projects AS project ON project.project_id = thread.project_id
        WHERE event.sequence > ${cursor} AND event.sequence <= ${upper}
          AND event.application_event_version = 2
          AND event.aggregate_kind = 'thread'
          AND event.event_type = 'turn-item.updated'
          AND json_extract(event.payload_json, '$.type') = 'command_execution'
          AND ${sql.or(OPENER_NEEDLES.map((needle) => sql`instr(event.payload_json, ${needle}) > 0`))}
        ORDER BY event.sequence ASC
      `;
      for (const row of rows) indexItem(row);
      cursor = upper;
      eventCursor = upper;
      yield* Effect.yieldNow;
    }
  });

  const scanCommands = Effect.gen(function* () {
    const head = yield* latestSequence;
    // a log that went backwards is a different database: index it afresh
    if (eventCursor !== null && head < eventCursor) {
      eventCursor = null;
      claimsByItem.clear();
    }
    if (eventCursor === null) {
      // the high-water mark first: whatever lands during the snapshot is
      // above it and comes in through the tail on the next scan
      yield* snapshotTurnItems;
      eventCursor = head;
      return;
    }
    yield* tailEvents(eventCursor, head);
  });

  const refresh = Effect.gen(function* () {
    yield* scanCommands;
    // after the scan, so a thread created alongside its first command counts
    const liveThreads = yield* sql<{ readonly threadId: string }>`
      SELECT thread_id AS "threadId"
      FROM orchestration_v2_projection_threads
      WHERE archived_at IS NULL AND deleted_at IS NULL
    `;
    const liveThreadIds = new Set(liveThreads.map((thread) => thread.threadId));
    yield* refreshColoredTabs;

    const next: TabTintSnapshot = {
      tints: matchTabTints(coloredTabs, [...claimsByItem.values()].flat(), liveThreadIds),
    };
    const changed = yield* Ref.modify(state, (previous): readonly [boolean, TabTintSnapshot] =>
      snapshotKey(previous) === snapshotKey(next) ? [false, previous] : [true, next],
    );
    if (changed) yield* PubSub.publish(changes, next).pipe(Effect.asVoid);
  });

  // Not awaited: the first full snapshot runs in the background so it
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
