import { useAtomValue } from "@effect/atom-react";
import { useMemo, useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { shortcutLabelForCommand } from "../../keybindings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { QUICK_MODELS } from "../../quick-model-shortcuts";
import { EMPTY_SERVER_PROVIDERS, primaryServerKeybindingsAtom } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedSettings } from "./useScopedSettings";

const SECTION_NOTE_CLASSNAME = "px-3 py-3 text-xs leading-normal text-muted-foreground sm:px-4";

/** edits fork preferences stored for this client, separately from shortcut keys. */
export function ForkPreferences() {
  const settings = useClientSettings();
  const scopedSettings = useScopedSettings();
  const { environment } = useSettingsScope();
  const providers = environment?.serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;
  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), scopedSettings),
      ),
    [providers, scopedSettings],
  );
  const modelOptions = useMemo(
    () => getCustomModelOptionsByInstance(scopedSettings, providers),
    [providers, scopedSettings],
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const update = useUpdateClientSettings();
  const [prefix, setPrefix] = useState("");
  const [origin, setOrigin] = useState("");
  const [modelError, setModelError] = useState("");
  const [boardError, setBoardError] = useState("");

  const setTarget = (command: string, defaultModel: string, model: string | null) => {
    const next = { ...settings.quickModelTargets };
    if (model && model !== defaultModel) next[command] = model;
    else delete next[command];
    setModelError("");
    void update({ quickModelTargets: next }).catch(() =>
      setModelError("Could not save the model target."),
    );
  };

  const saveBoard = () => {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(prefix.trim()))
        throw new Error("Enter the full issue prefix, such as nexiflow.");
      const url = new URL(origin.trim());
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      ) {
        throw new Error("Enter a board origin, such as http://127.0.0.1:1339.");
      }
      void update({
        beadBoards: [
          ...settings.beadBoards.filter((board) => board.prefix !== prefix.trim()),
          { prefix: prefix.trim(), origin: url.origin },
        ],
      }).catch(() => setBoardError("Could not save the board."));
      setPrefix("");
      setOrigin("");
      setBoardError("");
    } catch (cause) {
      setBoardError(
        cause instanceof TypeError
          ? "Enter a valid URL, such as http://127.0.0.1:1339."
          : cause instanceof Error
            ? cause.message
            : "Invalid board.",
      );
    }
  };

  return (
    <>
      <SettingsSection title="Model shortcut targets">
        <p className={SECTION_NOTE_CLASSNAME}>
          Which model each shortcut picks on this client. Keys are edited in Keybindings; started
          threads keep their model.
          {modelError ? <span className="block pt-1 text-destructive">{modelError}</span> : null}
        </p>
        {QUICK_MODELS.map((target) => {
          const override = settings.quickModelTargets[target.command];
          const instances = entries.filter(
            (entry) => entry.driverKind === target.driver && entry.enabled && entry.isAvailable,
          );
          const instance = instances.find((entry) => entry.isDefault) ?? instances[0];
          const name = target.command.split(".").at(-1) ?? target.command;
          const shortcut = shortcutLabelForCommand(keybindings, target.command);
          return (
            <SettingsRow
              key={target.command}
              title={
                <span className="flex items-center gap-2">
                  {shortcut ? <Kbd>{shortcut}</Kbd> : null}
                  {name}
                </span>
              }
              description={`${shortcut ? "" : "No key bound. "}Default: ${target.model}`}
              resetAction={
                override ? (
                  <SettingResetButton
                    label={`${name} shortcut model`}
                    onClick={() => setTarget(target.command, target.model, null)}
                  />
                ) : null
              }
              control={
                instance ? (
                  <ProviderModelPicker
                    activeInstanceId={instance.instanceId}
                    model={override ?? target.model}
                    lockedProvider={target.driver}
                    instanceEntries={entries}
                    modelOptionsByInstance={modelOptions}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    triggerAriaLabel={`${name} shortcut model`}
                    onInstanceModelChange={(_instanceId, model) =>
                      setTarget(target.command, target.model, model)
                    }
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">Provider unavailable</span>
                )
              }
            />
          );
        })}
      </SettingsSection>
      <SettingsSection title="Beadside boards">
        <p className={SECTION_NOTE_CLASSNAME}>
          Map each repository's full issue prefix to its running board, at a URL reachable from this
          device. Short IDs link only when every configured board answers and the suffix is unique.
        </p>
        {settings.beadBoards.map((board) => (
          <SettingsRow
            key={board.prefix}
            title={board.prefix}
            description={board.origin}
            control={
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void update({
                    beadBoards: settings.beadBoards.filter((item) => item.prefix !== board.prefix),
                  }).catch(() => setBoardError("Could not remove the board."))
                }
              >
                Remove
              </Button>
            }
          />
        ))}
        <SettingsRow
          title="Add board"
          description="Saving an existing prefix replaces its URL."
          status={
            boardError ? (
              <span role="alert" className="text-destructive">
                {boardError}
              </span>
            ) : undefined
          }
          control={
            <form
              className="flex w-full flex-wrap items-center justify-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                saveBoard();
              }}
            >
              <Input
                size="sm"
                className="w-32"
                aria-label="Bead issue prefix"
                placeholder="nexiflow"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
              />
              <Input
                size="sm"
                className="w-52"
                aria-label="Beadside board URL"
                placeholder="http://127.0.0.1:1339"
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
              />
              <Button size="sm" type="submit">
                Save
              </Button>
            </form>
          }
        />
      </SettingsSection>
    </>
  );
}
