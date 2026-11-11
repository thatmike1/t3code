import { QUICK_MODEL_KEYBINDING_COMMANDS, type ResolvedKeybindingRule } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";

import { type KeybindingRow, whenAstToExpression } from "./KeybindingsSettings.logic";

// the condition every default slot key carries, offered again when a key is assigned
const slotWhenAst = DEFAULT_RESOLVED_KEYBINDINGS.find(
  (binding) => binding.command === QUICK_MODEL_KEYBINDING_COMMANDS[0],
)?.whenAst;

/**
 * fork: adds an unassigned row for every model shortcut slot without a key, so each slot's model
 * picker shows and a key can be given to it on its own row.
 */
export function withUnboundModelSlotRows(
  rows: ReadonlyArray<KeybindingRow>,
): ReadonlyArray<KeybindingRow> {
  const bound = new Set(rows.map((row) => row.command));
  const next = [...rows];
  for (const command of QUICK_MODEL_KEYBINDING_COMMANDS) {
    if (bound.has(command)) continue;
    const binding: ResolvedKeybindingRule = {
      command,
      shortcut: {
        key: "",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: false,
      },
      ...(slotWhenAst ? { whenAst: slotWhenAst } : {}),
    };
    const when = whenAstToExpression(slotWhenAst);
    const row: KeybindingRow = {
      id: `${command}\u0000\u0000${when}`,
      command,
      key: "",
      when,
      source: "Default",
      defaultKey: null,
      defaultWhen: when,
      binding,
      conflicts: [],
    };
    // rows are sorted by command, so the slot goes before the first command after it
    const index = next.findIndex((candidate) => candidate.command.localeCompare(command) > 0);
    next.splice(index === -1 ? next.length : index, 0, row);
  }
  return next;
}
