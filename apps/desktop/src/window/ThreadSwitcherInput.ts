import type { ThreadSwitcherInputEvent } from "@t3tools/contracts";

export interface ThreadSwitcherKeyInput {
  readonly type: string;
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export function makeThreadSwitcherInputHandler(notify: (event: ThreadSwitcherInputEvent) => void): {
  readonly handleInput: (
    event: { preventDefault: () => void },
    input: ThreadSwitcherKeyInput,
  ) => void;
  readonly cancel: () => void;
} {
  let active = false;

  const cancel = () => {
    if (!active) return;
    active = false;
    notify({ type: "cancel" });
  };

  return {
    handleInput: (event, input) => {
      const key = input.key.toLowerCase();
      if (input.type === "keyDown" && key === "tab" && input.control && !input.meta && !input.alt) {
        event.preventDefault();
        active = true;
        notify({ type: "step", reverse: input.shift });
        return;
      }
      if (input.type === "keyDown" && key === "escape" && active) {
        event.preventDefault();
        cancel();
        return;
      }
      if (input.type === "keyUp" && (key === "control" || key === "ctrl") && active) {
        event.preventDefault();
        active = false;
        notify({ type: "commit" });
      }
    },
    cancel,
  };
}
