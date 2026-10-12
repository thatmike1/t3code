import * as Effect from "effect/Effect";
import { beforeEach, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";

const { openExternalMock } = vi.hoisted(() => ({ openExternalMock: vi.fn() }));
vi.mock("electron", () => ({ shell: { openExternal: openExternalMock } }));

import { openTabFocusUrl } from "./tabFocus.ts";

const HUB = "file:///home/thatmike1/git/ccChat-general/hubs/2026-09-30/index.html#t3-focus";

beforeEach(() => {
  openExternalMock.mockReset();
  openExternalMock.mockResolvedValue(undefined);
});

it.effect("opens marked file and web URLs exactly as given", () =>
  Effect.gen(function* () {
    const odd = "http://LOCALHOST:1344/a%7Eb#frag&t3-focus";
    expect(yield* openTabFocusUrl(HUB)).toBe(true);
    expect(yield* openTabFocusUrl(odd)).toBe(true);
    expect(openExternalMock.mock.calls).toEqual([[HUB], [odd]]);
  }),
);

it.effect("refuses unmarked URLs and other schemes", () =>
  Effect.gen(function* () {
    expect(yield* openTabFocusUrl("file:///etc/passwd")).toBe(false);
    expect(yield* openTabFocusUrl("https://example.com/")).toBe(false);
    expect(yield* openTabFocusUrl("javascript:alert(1)#t3-focus")).toBe(false);
    expect(yield* openTabFocusUrl(42)).toBe(false);
    expect(openExternalMock).not.toHaveBeenCalled();
  }),
);

it.effect("reports false when the shell rejects", () =>
  Effect.gen(function* () {
    openExternalMock.mockRejectedValue(new Error("open failed"));
    expect(yield* openTabFocusUrl(HUB)).toBe(false);
  }),
);
