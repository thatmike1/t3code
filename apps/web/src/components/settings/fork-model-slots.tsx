import type { ModelShortcutSlots, QuickModelKeybindingCommand } from "@t3tools/contracts";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { modelShortcutSlotNumber } from "../../quick-model-shortcuts";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { toastManager } from "../ui/toast";
import { useSettingsScope } from "./SettingsScopeContext";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingResetButton } from "./settingsLayout";
import { useScopedSettings } from "./useScopedSettings";

const saveSlots = (modelShortcutSlots: ModelShortcutSlots) =>
  void updateClientSettings({ modelShortcutSlots }).catch(() =>
    toastManager.add({ type: "error", title: "Could not save the model shortcut." }),
  );

/** fork: the model a numbered shortcut slot picks on this client, shown beside its key. */
export function ForkModelSlotPicker({ command }: { command: QuickModelKeybindingCommand }) {
  const slots = useClientSettings((settings) => settings.modelShortcutSlots) ?? {};
  const scopedSettings = useScopedSettings();
  const { environment } = useSettingsScope();
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environment ? providersByEnvironment.get(environment.environmentId) : undefined) ??
    EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, scopedSettings, null);
  const modelOptions = getCustomModelOptionsByInstance(scopedSettings, providers);
  const label = `model shortcut ${modelShortcutSlotNumber(command)}`;
  const target = slots[command];
  const usable = entries.filter((entry) => entry.enabled && entry.isAvailable);
  const sameDriver = usable.filter((entry) => entry.driverKind === target?.driver);
  const instance =
    sameDriver.find((entry) => entry.isDefault) ??
    sameDriver[0] ??
    usable.find((entry) => entry.isDefault) ??
    usable[0];

  if (!instance) {
    return <span className="text-sm text-muted-foreground">No provider available</span>;
  }
  return (
    <span className="flex items-center gap-1">
      {target ? (
        <SettingResetButton
          label={label}
          tooltip="Clear the model"
          onClick={() =>
            saveSlots(Object.fromEntries(Object.entries(slots).filter(([key]) => key !== command)))
          }
        />
      ) : null}
      <ProviderModelPicker
        environmentId={environment?.environmentId ?? null}
        activeInstanceId={instance.instanceId}
        model={target?.model ?? ""}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={modelOptions}
        triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
        triggerAriaLabel={`Model for ${label}`}
        onInstanceModelChange={(instanceId, model) => {
          const entry = entries.find((candidate) => candidate.instanceId === instanceId);
          if (entry) saveSlots({ ...slots, [command]: { driver: entry.driverKind, model } });
        }}
      />
    </span>
  );
}
