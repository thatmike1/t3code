import { QUICK_MODEL_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { buildKeybindingRows, groupKeybindingRows } from "./KeybindingsSettings.logic";
import { withUnboundModelSlotRows } from "./fork-model-slot-rows";

const slotRows = (rows: ReturnType<typeof buildKeybindingRows>) =>
  rows.filter((row) =>
    (QUICK_MODEL_KEYBINDING_COMMANDS as ReadonlyArray<string>).includes(row.command),
  );

describe("model shortcut slot rows", () => {
  it("shows all nine slots in order, with slots 2 and 5 unassigned by default", () => {
    const rows = withUnboundModelSlotRows(
      buildKeybindingRows(DEFAULT_RESOLVED_KEYBINDINGS, "Linux"),
    );
    const slots = slotRows(rows);
    expect(slots.map((row) => row.command)).toEqual([...QUICK_MODEL_KEYBINDING_COMMANDS]);
    expect(slots.map((row) => row.key)).toEqual([
      "alt+1",
      "",
      "alt+3",
      "alt+4",
      "",
      "alt+6",
      "alt+7",
      "alt+8",
      "alt+9",
    ]);
    const unbound = slots[1];
    expect(unbound?.when).toBe(slots[0]?.when);
    expect(unbound?.source).toBe("Default");
    expect(unbound?.defaultKey).toBeNull();
    const composer = groupKeybindingRows(rows).find((group) => group.id === "composer");
    expect(slotRows(composer?.rows ?? [])).toHaveLength(9);
  });

  it("gives a slot whose key was removed a row of its own", () => {
    const withoutSlot3 = DEFAULT_RESOLVED_KEYBINDINGS.filter(
      (binding) => binding.command !== "composer.model.slot3",
    );
    const rows = withUnboundModelSlotRows(buildKeybindingRows(withoutSlot3, "Linux"));
    expect(slotRows(rows).find((row) => row.command === "composer.model.slot3")?.key).toBe("");
  });

  it("adds nothing for slots that already have a row", () => {
    const rows = withUnboundModelSlotRows(
      buildKeybindingRows(DEFAULT_RESOLVED_KEYBINDINGS, "Linux"),
    );
    expect(withUnboundModelSlotRows(rows)).toEqual(rows);
  });
});
