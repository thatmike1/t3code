import type { WidgetsSnapshot } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as Widgets from "./Widgets.ts";

const PHONE_MIC_FILE = JSON.stringify({ label: "live", state: "ok", icon: "mic" });
const BATTERY_FILE = JSON.stringify({ label: "80%", order: -1 });

/**
 * The feature's headline claim: any process drops a file in the directory and
 * connected clients see the widget without a restart. Live clock and a real
 * filesystem event, so this proves the watcher rather than a direct read.
 */
it.live("streams the published set as the directory changes", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-widgets-" });
    const widgetsDir = path.join(baseDir, "userdata", "widgets");

    yield* Effect.gen(function* () {
      const widgets = yield* Widgets.Widgets;
      const { latest, changes } = yield* widgets.subscribe;

      // The service creates the directory on start, so a client connecting
      // before anything is published still gets a snapshot to render.
      assert.deepEqual(latest, { directory: widgetsDir, widgets: [] });
      assert.isTrue(yield* fs.exists(widgetsDir));

      const seen = yield* Queue.unbounded<WidgetsSnapshot>();
      yield* Stream.runForEach(changes, (snapshot) => Queue.offer(seen, snapshot)).pipe(
        Effect.forkScoped,
      );

      // Published atomically, the way a tray daemon writes it.
      const staging = path.join(baseDir, "staged.json");
      yield* fs.writeFileString(staging, PHONE_MIC_FILE);
      yield* fs.rename(staging, path.join(widgetsDir, "phone-mic.json"));

      assert.deepEqual(yield* Queue.take(seen), {
        directory: widgetsDir,
        widgets: [
          {
            id: "phone-mic",
            label: "live",
            state: "ok",
            icon: "mic",
            rows: [],
            order: 0,
          },
        ],
      });

      // One bad file is that file's problem alone. It publishes nothing by
      // itself, so a valid widget lands alongside it and the next snapshot
      // shows what survived.
      yield* fs.writeFileString(path.join(widgetsDir, "broken.json"), "{ not json");
      yield* fs.writeFileString(path.join(widgetsDir, "battery.json"), BATTERY_FILE);

      const afterBroken = yield* Queue.take(seen);
      assert.deepEqual(
        afterBroken.widgets.map((widget) => widget.id),
        ["battery", "phone-mic"],
      );
    }).pipe(
      Effect.provide(
        Widgets.layer.pipe(Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir))),
      ),
      Effect.timeout("30 seconds"),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
