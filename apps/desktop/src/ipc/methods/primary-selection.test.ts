import * as Effect from "effect/Effect";
import { beforeEach, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";

const { readText, writeText, clipboardReadText, clipboardWriteText } = vi.hoisted(() => ({
  readText: vi.fn(),
  writeText: vi.fn(),
  clipboardReadText: vi.fn(),
  clipboardWriteText: vi.fn(),
}));
vi.mock("electron", () => ({
  clipboard: {
    readText: clipboardReadText,
    writeText: clipboardWriteText,
    selection: { readText, writeText },
  },
}));

import { readPrimarySelection, writePrimarySelection } from "./primary-selection.ts";

beforeEach(() => {
  vi.clearAllMocks();
  readText.mockResolvedValue("selected in another app");
  writeText.mockResolvedValue(undefined);
});

it.effect("reads PRIMARY independently of the ordinary clipboard", () =>
  Effect.gen(function* () {
    expect(yield* readPrimarySelection.handler(undefined)).toBe("selected in another app");
    expect(clipboardReadText).not.toHaveBeenCalled();
  }),
);

it.effect("publishes selected terminal text without changing the ordinary clipboard", () =>
  Effect.gen(function* () {
    yield* writePrimarySelection.handler("terminal output");
    expect(writeText).toHaveBeenCalledWith("terminal output");
    expect(clipboardWriteText).not.toHaveBeenCalled();
    yield* writePrimarySelection.handler("");
    expect(writeText).toHaveBeenCalledTimes(1);
  }),
);

it.effect("rejects malformed IPC writes before accessing the clipboard", () =>
  Effect.gen(function* () {
    expect((yield* Effect.exit(writePrimarySelection.handler(42)))._tag).toBe("Failure");
    expect(writeText).not.toHaveBeenCalled();
  }),
);
