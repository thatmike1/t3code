import { createElement } from "react";
import { act, render } from "../test/render";

import { describe, expect, it, vi } from "vite-plus/test";

import {
  shortcutModifierStateAfterKeyboardEvent,
  useShortcutModifierState,
  type ShortcutModifierState,
} from "./shortcutModifierState";

const emptyState = (): ShortcutModifierState => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
});

function keyboardEventLike(type: "keydown" | "keyup", init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    type,
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

describe("shortcutModifierState", () => {
  it("tracks bare modifier keydown and keyup events explicitly", () => {
    let state = emptyState();
    state = shortcutModifierStateAfterKeyboardEvent(
      state,
      keyboardEventLike("keydown", {
        key: "Meta",
        metaKey: false,
      }),
    );
    expect(state).toEqual({
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    });

    state = shortcutModifierStateAfterKeyboardEvent(
      state,
      keyboardEventLike("keydown", {
        key: "Shift",
        metaKey: true,
        shiftKey: false,
      }),
    );
    expect(state).toEqual({
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    });

    state = shortcutModifierStateAfterKeyboardEvent(
      state,
      keyboardEventLike("keyup", {
        key: "Meta",
        metaKey: true,
        shiftKey: true,
      }),
    );
    expect(state).toEqual({
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    });

    state = shortcutModifierStateAfterKeyboardEvent(
      state,
      keyboardEventLike("keyup", {
        key: "Shift",
        shiftKey: true,
      }),
    );
    expect(state).toEqual({
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    });
  });

  it("ignores poisoned modifier flags on non-modifier keys", () => {
    // Synthetic dictation paste can poison later real key events with metaKey=true.
    const state = shortcutModifierStateAfterKeyboardEvent(
      emptyState(),
      keyboardEventLike("keydown", { key: "Enter", metaKey: true }),
    );
    expect(state).toEqual(emptyState());
  });

  it("clears a held modifier when a non-modifier key reports it released", () => {
    const heldMeta: ShortcutModifierState = {
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    };
    const state = shortcutModifierStateAfterKeyboardEvent(
      heldMeta,
      keyboardEventLike("keydown", { key: "a", metaKey: false }),
    );
    expect(state).toEqual(emptyState());
  });
});

function ModifierHints() {
  const state = useShortcutModifierState();
  return createElement("output", null, state.ctrlKey ? "shown" : "hidden");
}

describe("shortcut modifier hints", () => {
  it.each(["commit", "cancel"])("clears on Ctrl release after a Ctrl+Tab %s", async (outcome) => {
    await using screen = await render(createElement(ModifierHints), {
      // a bare hook host has no navigation.
      router: false,
    });
    const key = async (type: string, key: string, ctrlKey: boolean) => {
      await act(() => {
        window.dispatchEvent(new KeyboardEvent(type, { key, ctrlKey }));
      });
    };
    await key("keydown", "Control", true);
    await expect.element(screen.getByRole("status")).toHaveTextContent("shown");
    await key("keydown", "Tab", true);
    if (outcome === "cancel") await key("keydown", "Escape", true);
    await key("keyup", "Tab", true);
    await expect.element(screen.getByRole("status")).toHaveTextContent("shown");
    await key("keyup", "Control", false);
    await expect.element(screen.getByRole("status")).toHaveTextContent("hidden");
    await key("keydown", "Control", true);
    await act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    await expect.element(screen.getByRole("status")).toHaveTextContent("hidden");
  });

  it("clears when the document becomes hidden", async () => {
    await using screen = await render(createElement(ModifierHints), {
      // a bare hook host has no navigation.
      router: false,
    });
    await act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true }));
    });
    await expect.element(screen.getByRole("status")).toHaveTextContent("shown");
    using _visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.element(screen.getByRole("status")).toHaveTextContent("hidden");
  });

  it("recovers a missed Ctrl release from another modifier event", () => {
    const held = { ...emptyState(), ctrlKey: true };
    expect(
      shortcutModifierStateAfterKeyboardEvent(
        held,
        keyboardEventLike("keyup", { key: "Shift", ctrlKey: false }),
      ),
    ).toEqual(emptyState());
  });
});
