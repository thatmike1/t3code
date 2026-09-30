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

  it("puts fork builds on the latest channel with stable branding", () => {
    expect(resolveDefaultDesktopUpdateChannel("0.0.42-fork.20260930.1412")).toBe("latest");
    expect(isNightlyDesktopVersion("0.0.42-fork.20260930.1412")).toBe(false);
  });
});
