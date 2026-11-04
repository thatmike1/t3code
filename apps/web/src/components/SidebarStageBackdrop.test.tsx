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
        for (const mode of ["artwork", "none", "pill"] as const) {
          expect(resolveSidebarArtworkVariant(stage, mode, artwork)).toBe(artwork);
        }
      }
    },
  );

  it.each(["Latest", "Nightly", "Dev", "Alpha"])("Off preserves the original %s path", (stage) => {
    for (const mode of ["artwork", "nightly-artwork", "dev-artwork", "none", "pill"] as const) {
      expect(resolveSidebarArtworkVariant(stage, mode, "off")).toBe(
        resolveSidebarStageBackdropVariant(stage, mode),
      );
    }
  });
});
