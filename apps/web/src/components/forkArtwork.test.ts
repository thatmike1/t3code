// @effect-diagnostics nodeBuiltinImport:off - verifies the shipped binary assets on disk.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import { resolveForkArtworkAssets } from "./forkArtwork";

// assert the resolver points at real, theme-specific files, including transparent glyphs.
describe("fork artwork assets", () => {
  for (const direction of ["paint", "bonsai"] as const) {
    it.each(["dark", "light"] as const)(`${direction} resolves the %s artwork`, (theme) => {
      const assets = resolveForkArtworkAssets(direction, theme);
      for (const path of Object.values(assets)) {
        expect(path).toContain(`${direction}-${theme}-`);
        expect(NodeFS.existsSync(new URL(`../../public${path}`, import.meta.url))).toBe(true);
      }
      const arrow = NodeFS.readFileSync(new URL(`../../public${assets.arrow}`, import.meta.url));
      expect(arrow[25]).toBe(6); // rgba PNG, including the keyed alpha channel.
    });
  }
});
