import {
  type KeybindingCommand,
  type ModelSelection,
  type ProviderInstanceId,
  ProviderDriverKind,
  type QuickModelKeybindingCommand,
} from "@t3tools/contracts";
import type { AppModelOption } from "./modelSelection";
import type { ProviderInstanceEntry } from "./providerInstances";

const QUICK_MODELS = [
  {
    command: "composer.model.opus",
    driver: ProviderDriverKind.make("claudeAgent"),
    model: "claude-opus-5-5",
  },
  { command: "composer.model.sol", driver: ProviderDriverKind.make("codex"), model: "gpt-6-sol" },
  {
    command: "composer.model.fable",
    driver: ProviderDriverKind.make("claudeAgent"),
    model: "claude-fable-5-1",
  },
  {
    command: "composer.model.astra",
    driver: ProviderDriverKind.make("codex"),
    model: "gpt-6-astra",
  },
  { command: "composer.model.luna", driver: ProviderDriverKind.make("codex"), model: "gpt-6-luna" },
] satisfies ReadonlyArray<{
  readonly command: QuickModelKeybindingCommand;
  readonly driver: ProviderDriverKind;
  readonly model: string;
}>;

type QuickModelInstance = Pick<
  ProviderInstanceEntry,
  "instanceId" | "driverKind" | "isDefault" | "enabled" | "isAvailable" | "status"
>;
type QuickModelOption = Pick<AppModelOption, "slug" | "isUnavailable">;

export function isQuickModelShortcutCommand(command: KeybindingCommand | null): boolean {
  return QUICK_MODELS.some((candidate) => candidate.command === command);
}

/** Resolves a named model command to an available instance in the current environment. */
export function quickModelSelectionForCommand(
  command: KeybindingCommand | null,
  instances: ReadonlyArray<QuickModelInstance>,
  optionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<QuickModelOption>>,
): ModelSelection | null {
  const target = QUICK_MODELS.find((candidate) => candidate.command === command);
  if (!target) return null;

  const matches = instances.filter(
    (instance) =>
      instance.driverKind === target.driver &&
      instance.enabled &&
      instance.isAvailable &&
      instance.status === "ready" &&
      optionsByInstance
        .get(instance.instanceId)
        ?.some((option) => option.slug === target.model && option.isUnavailable !== true),
  );
  const instance = matches.find((candidate) => candidate.isDefault) ?? matches[0];
  return instance ? { instanceId: instance.instanceId, model: target.model } : null;
}
