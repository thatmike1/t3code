import {
  type ClientSettings,
  type KeybindingCommand,
  LEGACY_QUICK_MODEL_COMMAND_SLOTS,
  type ModelSelection,
  type ModelShortcutSlots,
  type ProviderInstanceId,
  QUICK_MODEL_KEYBINDING_COMMANDS,
  type QuickModelKeybindingCommand,
} from "@t3tools/contracts";
import type { AppModelOption } from "./modelSelection";
import type { ProviderInstanceEntry } from "./providerInstances";

export type ModelShortcutSlotTarget = ModelShortcutSlots[string];

/** the slot number of a model shortcut command, or null for any other command. */
export function modelShortcutSlotNumber(command: KeybindingCommand | null): number | null {
  const index = QUICK_MODEL_KEYBINDING_COMMANDS.indexOf(command as QuickModelKeybindingCommand);
  return index === -1 ? null : index + 1;
}

export function isModelShortcutSlotCommand(
  command: KeybindingCommand | null,
): command is QuickModelKeybindingCommand {
  return modelShortcutSlotNumber(command) !== null;
}

// what each named shortcut picked before the slots, used only to migrate existing clients
const LEGACY_DEFAULT_TARGETS: Readonly<Record<string, ModelShortcutSlotTarget>> = {
  "composer.model.opus": { driver: "claudeAgent", model: "claude-opus-5-5" },
  "composer.model.sol": { driver: "codex", model: "gpt-6.1-sol" },
  "composer.model.fable": { driver: "claudeAgent", model: "claude-fable-5-1" },
  "composer.model.astra": { driver: "codex", model: "gpt-6-astra" },
  "composer.model.luna": { driver: "codex", model: "gpt-6-luna" },
};

/**
 * gives persisted settings from before the slots explicit slot targets: each old shortcut's
 * override, else its old default. Settings that already carry slots pass through unchanged.
 */
export function withModelShortcutSlots(settings: ClientSettings): ClientSettings {
  if (settings.modelShortcutSlots !== undefined) return settings;
  const slots: Record<string, ModelShortcutSlotTarget> = {};
  // persisted settings can be partial, so the legacy overrides may be missing
  const overrides: Readonly<Record<string, string>> | undefined = settings.quickModelTargets;
  for (const [legacyCommand, slot] of Object.entries(LEGACY_QUICK_MODEL_COMMAND_SLOTS)) {
    const fallback = LEGACY_DEFAULT_TARGETS[legacyCommand];
    if (!fallback) continue;
    const override = overrides?.[legacyCommand]?.trim();
    slots[slot] = { driver: fallback.driver, model: override || fallback.model };
  }
  return { ...settings, modelShortcutSlots: slots };
}

type QuickModelInstance = Pick<
  ProviderInstanceEntry,
  "instanceId" | "driverKind" | "isDefault" | "enabled" | "isAvailable" | "status"
>;
type QuickModelOption = Pick<AppModelOption, "slug" | "isUnavailable">;

/** the model a slot points at, or null when the command is not a slot or the slot is empty. */
export function modelShortcutSlotTarget(
  command: KeybindingCommand | null,
  slots: ModelShortcutSlots = {},
): ModelShortcutSlotTarget | null {
  if (!isModelShortcutSlotCommand(command)) return null;
  const target = slots[command];
  return target && target.model.trim() ? target : null;
}

/** resolves a slot's target model to an available instance in the current environment. */
export function quickModelSelectionForCommand(
  command: KeybindingCommand | null,
  instances: ReadonlyArray<QuickModelInstance>,
  optionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<QuickModelOption>>,
  slots: ModelShortcutSlots = {},
): ModelSelection | null {
  const target = modelShortcutSlotTarget(command, slots);
  if (!target) return null;
  const model = target.model.trim();

  const matches = instances.filter(
    (instance) =>
      instance.driverKind === target.driver &&
      instance.enabled &&
      instance.isAvailable &&
      instance.status === "ready" &&
      optionsByInstance
        .get(instance.instanceId)
        ?.some((option) => option.slug === model && option.isUnavailable !== true),
  );
  const instance = matches.find((candidate) => candidate.isDefault) ?? matches[0];
  return instance ? { instanceId: instance.instanceId, model } : null;
}
