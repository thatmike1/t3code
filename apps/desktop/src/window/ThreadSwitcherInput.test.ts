import { describe, expect, it, vi } from "vite-plus/test";

import {
  makeThreadSwitcherInputHandler,
  type ThreadSwitcherKeyInput,
} from "./ThreadSwitcherInput.ts";

function input(overrides: Partial<ThreadSwitcherKeyInput> = {}): ThreadSwitcherKeyInput {
  return {
    type: "keyDown",
    key: "Tab",
    control: true,
    meta: false,
    alt: false,
    shift: false,
    ...overrides,
  };
}

describe("desktop thread switcher input", () => {
  it("captures Ctrl+Tab through release and preserves direction", () => {
    const notify = vi.fn();
    const preventDefault = vi.fn();
    const handler = makeThreadSwitcherInputHandler(notify);
    handler.handleInput({ preventDefault }, input());
    handler.handleInput({ preventDefault }, input({ shift: true }));
    handler.handleInput(
      { preventDefault },
      input({ type: "keyUp", key: "Control", control: false }),
    );
    expect(notify.mock.calls.map(([event]) => event)).toEqual([
      { type: "step", reverse: false },
      { type: "step", reverse: true },
      { type: "commit" },
    ]);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape and blur without later committing", () => {
    const notify = vi.fn();
    const handler = makeThreadSwitcherInputHandler(notify);
    handler.handleInput({ preventDefault: vi.fn() }, input());
    handler.handleInput({ preventDefault: vi.fn() }, input({ key: "Escape", control: true }));
    handler.handleInput(
      { preventDefault: vi.fn() },
      input({ type: "keyUp", key: "Control", control: false }),
    );
    handler.handleInput({ preventDefault: vi.fn() }, input());
    handler.cancel();
    expect(notify.mock.calls.map(([event]) => event)).toEqual([
      { type: "step", reverse: false },
      { type: "cancel" },
      { type: "step", reverse: false },
      { type: "cancel" },
    ]);
  });

  it("does not swallow unrelated input", () => {
    const notify = vi.fn();
    const preventDefault = vi.fn();
    const handler = makeThreadSwitcherInputHandler(notify);
    handler.handleInput({ preventDefault }, input({ key: "K" }));
    handler.handleInput({ preventDefault }, input({ key: "Tab", alt: true }));
    handler.handleInput({ preventDefault }, input({ key: "Tab", meta: true }));
    expect(notify).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("leaves step keydowns dispatchable so Electron delivers the release", () => {
    const notify = vi.fn();
    const preventDefault = vi.fn();
    const handler = makeThreadSwitcherInputHandler(notify);
    handler.handleInput({ preventDefault }, input());
    expect(notify).toHaveBeenCalledWith({ type: "step", reverse: false });
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
