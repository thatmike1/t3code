import { LEGACY_QUICK_MODEL_COMMAND_SLOTS } from "@t3tools/contracts";

/** fork: points named model shortcut entries at their numbered slot; null when none were found. */
export function renameLegacyModelSlotCommands(
  entries: ReadonlyArray<unknown>,
): ReadonlyArray<unknown> | null {
  let changed = false;
  const next = entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || !("command" in entry)) return entry;
    const { command } = entry;
    if (typeof command !== "string" || !Object.hasOwn(LEGACY_QUICK_MODEL_COMMAND_SLOTS, command)) {
      return entry;
    }
    changed = true;
    return { ...entry, command: LEGACY_QUICK_MODEL_COMMAND_SLOTS[command] };
  });
  return changed ? next : null;
}
