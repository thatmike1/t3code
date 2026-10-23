import { describe, expect, it } from "vite-plus/test";
import {
  resolveSidebarArtworkVariant,
  resolveSidebarStageBackdropVariant,
} from "./SidebarStageBackdrop";

describe("fork artwork resolution", () => {
  it.each(["paint", "bonsai", "scribble"] as const)(
    "uses %s on every stage independently of environment identification",
    (artwork) => {
      for (const stage of ["Latest", "Nightly", "Dev"]) {
        for (const enabled of [true, false]) {
          expect(resolveSidebarArtworkVariant(stage, enabled, artwork)).toBe(artwork);
        }
      }
    },
  );

  it.each(["Latest", "Nightly", "Dev", "Alpha"])("Off preserves the original %s path", (stage) => {
    for (const enabled of [true, false]) {
      expect(resolveSidebarArtworkVariant(stage, enabled, "off")).toBe(
        resolveSidebarStageBackdropVariant(stage, enabled),
      );
    }
  });
});
