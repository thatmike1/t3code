/**
 * Widgets - status tiles any process on this machine publishes.
 *
 * A tray daemon, a cron job, or a shell script writes
 * `<stateDir>/widgets/<id>.json`; this service watches that directory and
 * streams the decoded set to connected clients, which render each widget as a
 * small icon in the sidebar. The filename is the widget id, so a publisher
 * rewriting its file keeps the same tile rather than growing a new one, and a
 * body `id` that disagrees with the filename loses. v1 is view only.
 *
 * Widgets are cosmetic, so every failure degrades to "that file is not
 * published" rather than emptying the set or failing the subscription.
 *
 * @module Widgets
 */
import { type Widget, WidgetFile, WidgetId, type WidgetsSnapshot } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";

const WIDGET_FILE_SUFFIX = ".json";

const decodeWidgetFileJsonExit = Schema.decodeUnknownExit(Schema.fromJsonString(WidgetFile));
const isWidgetId = Schema.is(WidgetId);

export class Widgets extends Context.Service<
  Widgets,
  {
    /** The set as the watcher last observed it, seeded before the service is handed out. */
    readonly latest: Effect.Effect<WidgetsSnapshot>;
    readonly changes: Stream.Stream<WidgetsSnapshot>;
    /**
     * The current snapshot plus every later one. The subscription is acquired
     * before the snapshot is read, so a write landing while a client connects
     * is delivered rather than lost.
     */
    readonly subscribe: Effect.Effect<
      {
        readonly latest: WidgetsSnapshot;
        readonly changes: Stream.Stream<WidgetsSnapshot>;
      },
      never,
      Scope.Scope
    >;
  }
>()("t3/widgets/Widgets") {}

/**
 * Every widget the directory actually publishes, sorted by `order` then id.
 * A file that is unreadable, malformed, or misnamed is skipped on its own; the
 * rest of the set is unaffected.
 */
export const readWidgets = Effect.fn("widgets.readWidgets")(function* (widgetsDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fs
    .readDirectory(widgetsDir)
    .pipe(Effect.orElseSucceed((): Array<string> => []));

  const widgets: Array<Widget> = [];
  for (const entry of entries) {
    if (!entry.endsWith(WIDGET_FILE_SUFFIX)) continue;
    const id = entry.slice(0, -WIDGET_FILE_SUFFIX.length);
    const filePath = path.join(widgetsDir, entry);
    if (!isWidgetId(id)) {
      yield* Effect.logDebug("ignoring widget file with an unusable name", { path: filePath });
      continue;
    }

    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => undefined));
    if (raw === undefined) {
      yield* Effect.logDebug("ignoring unreadable widget file", { path: filePath });
      continue;
    }

    const decoded = decodeWidgetFileJsonExit(raw);
    if (decoded._tag === "Failure") {
      yield* Effect.logWarning("ignoring invalid widget file", {
        path: filePath,
        detail: Cause.pretty(decoded.cause),
      });
      continue;
    }

    // The filename wins over a body `id`, so the tile a publisher rewrites is
    // the tile clients already have.
    widgets.push({ ...decoded.value, id });
  }

  return widgets.toSorted(
    (left, right) =>
      left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
});

/**
 * Structural identity of a snapshot. Compared as a string rather than field by
 * field because a hand-rolled list here silently drops republishes for any
 * field it forgets; the set is small and only compared once per watch event.
 */
const snapshotKey = (snapshot: WidgetsSnapshot): string => JSON.stringify(snapshot);

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("widgets.make")(function* () {
  const { widgetsDir } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  /**
   * Sliding with capacity 1: every update carries the complete set, so a
   * subscriber that stops consuming holds the newest set rather than a
   * backlog of sets it would only repaint past anyway.
   */
  const changes = yield* PubSub.sliding<WidgetsSnapshot>(1);
  const state = yield* Ref.make<WidgetsSnapshot>({ directory: widgetsDir, widgets: [] });
  /**
   * Guards the whole read/compare/publish rather than just the state write, so
   * two watch events cannot finish out of order and publish an older set last.
   * `latest` deliberately does not take it: it is a plain `Ref.get`, which is
   * what lets `subscribeBeforeSnapshot` hold this same permit while reading.
   */
  const refreshMutex = yield* Semaphore.make(1);

  const latest = Ref.get(state);

  const refresh = refreshMutex.withPermits(1)(
    Effect.gen(function* () {
      const widgets = yield* readWidgets(widgetsDir).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
      const next: WidgetsSnapshot = { directory: widgetsDir, widgets };
      const [changed, current] = yield* Ref.modify(
        state,
        (previous): readonly [readonly [boolean, WidgetsSnapshot], WidgetsSnapshot] =>
          snapshotKey(previous) === snapshotKey(next)
            ? [[false, previous], previous]
            : [[true, next], next],
      );
      if (changed) yield* PubSub.publish(changes, current).pipe(Effect.asVoid);
      return current;
    }),
  );

  // Created up front so the watcher has something to attach to before the
  // first publisher writes into it.
  yield* fs.makeDirectory(widgetsDir, { recursive: true }).pipe(Effect.ignoreCause({ log: true }));

  // Debounced for the same reason settings watching is: a publisher emits
  // several events per save and `fs.watch` can fire before the content is
  // flushed. Every event triggers a full re-read, so no event needs filtering.
  const watchEvents = fs.watch(widgetsDir).pipe(Stream.debounce(Duration.millis(100)));

  // Seeds `latest` so a client connecting before any write still gets a
  // snapshot, and so a watch event reporting no real change publishes nothing.
  yield* refresh;
  yield* Stream.runForEach(watchEvents, () => refresh.pipe(Effect.ignoreCause({ log: true }))).pipe(
    Effect.ignoreCause({ log: true }),
    Effect.forkScoped,
    Effect.asVoid,
  );

  return Widgets.of({
    latest,
    changes: Stream.fromPubSub(changes),
    subscribe: subscribeBeforeSnapshot(changes, latest, refreshMutex),
  });
});

export const layer = Layer.effect(Widgets, make());
