import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  resolveSidebarArtworkVariant,
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  StageBackdropArt,
} from "./SidebarStageBackdrop";

describe("SidebarStageBackdrop", () => {
  it("resolves stage artwork only when enabled", () => {
    expect(resolveSidebarStageBackdropVariant("Dev")).toBe("dev");
    expect(resolveSidebarStageBackdropVariant("Nightly")).toBe("nightly");
    expect(resolveSidebarStageBackdropVariant("Dev", false)).toBeNull();
    expect(resolveSidebarStageBackdropVariant("Alpha")).toBeNull();
  });

  it("resolves supported environment pill labels", () => {
    expect(resolveEnvironmentIdentificationPillLabel("Dev")).toBe("Dev");
    expect(resolveEnvironmentIdentificationPillLabel("nightly")).toBe("Nightly");
    expect(resolveEnvironmentIdentificationPillLabel("Latest")).toBeNull();
    expect(resolveEnvironmentIdentificationPillLabel("Alpha")).toBeNull();
  });

  it.each(["nightly", "dev"] as const)(
    "uses unique SVG definition ids when %s artwork is rendered more than once",
    (variant) => {
      const markup = renderToStaticMarkup(
        <>
          <StageBackdropArt variant={variant} />
          <StageBackdropArt variant={variant} />
        </>,
      );
      const ids = Array.from(markup.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);

      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );
});

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
