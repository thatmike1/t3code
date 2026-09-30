import { describe, expect, it } from "vite-plus/test";

import { upstreamBaseVersion } from "./forkVersion.ts";
import { isNightlyDesktopVersion, resolveDefaultDesktopUpdateChannel } from "./updateChannels.ts";

describe("forkVersion", () => {
  it("strips the fork suffix and leaves upstream versions alone", () => {
    expect(upstreamBaseVersion("0.0.42-fork.20260930.1412")).toBe("0.0.42");
    expect(upstreamBaseVersion("0.0.42")).toBe("0.0.42");
    expect(upstreamBaseVersion("0.0.45-nightly.20260930.2468")).toBe(
      "0.0.45-nightly.20260930.2468",
    );
  });

  it("maps a fork build on a nightly back to that nightly's cli archive", () => {
    expect(upstreamBaseVersion("0.0.46-nightly.20261012.3010-fork.20261012.1530")).toBe(
      "0.0.46-nightly.20261012.3010",
    );
    expect(upstreamBaseVersion("0.0.46-nightly.20261012.3010-fork.20261012.0")).toBe(
      "0.0.46-nightly.20261012.3010",
    );
  });

  it("puts fork builds on the latest channel with stable branding", () => {
    for (const version of [
      "0.0.42-fork.20260930.1412",
      "0.0.46-nightly.20261012.3010-fork.20261012.1530",
    ]) {
      expect(resolveDefaultDesktopUpdateChannel(version)).toBe("latest");
      expect(isNightlyDesktopVersion(version)).toBe(false);
    }
  });
});
