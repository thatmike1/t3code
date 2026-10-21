import { DEFAULT_CLIENT_SETTINGS, type ForkArtwork } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopLinuxUrlHandler from "../../app/DesktopLinuxUrlHandler.ts";
import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as DesktopSnapShot from "../../snapShot/DesktopSnapShot.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import { setClientSettings } from "./clientSettings.ts";

describe("client settings icon updates", () => {
  it.effect(
    "persists artwork changes and updates both icon targets, skipping unrelated changes",
    () => {
      const windowIcons: ForkArtwork[] = [];
      const installedIcons: ForkArtwork[] = [];
      const layer = Layer.mergeAll(
        DesktopClientSettings.layerTest(Option.some(DEFAULT_CLIENT_SETTINGS)),
        Layer.mock(DesktopWindow.DesktopWindow)({
          syncIcon: (artwork) =>
            Effect.sync(() => {
              windowIcons.push(artwork);
            }),
        }),
        Layer.mock(DesktopLinuxUrlHandler.DesktopLinuxUrlHandler)({
          syncIcon: (artwork) =>
            Effect.sync(() => {
              installedIcons.push(artwork);
            }),
        }),
        Layer.mock(DesktopSnapShot.DesktopSnapShot)({ configure: () => Effect.void }),
      );
      return Effect.gen(function* () {
        const store = yield* DesktopClientSettings.DesktopClientSettings;
        for (const forkArtwork of ["bonsai", "scribble", "off", "paint"] as const) {
          const settings = { ...DEFAULT_CLIENT_SETTINGS, forkArtwork };
          yield* setClientSettings.handler(settings);
          assert.equal(Option.getOrThrow(yield* store.get).forkArtwork, forkArtwork);
          yield* setClientSettings.handler({ ...settings, confirmQuit: "direct" });
        }
        assert.deepEqual(windowIcons, ["bonsai", "scribble", "off", "paint"]);
        assert.deepEqual(installedIcons, windowIcons);
      }).pipe(Effect.provide(layer));
    },
  );
});
