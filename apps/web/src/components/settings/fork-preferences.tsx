import { getAppModelOptionsForInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
} from "../../providerInstances";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings } from "./useScopedSettings";
import { useMemo, useState } from "react";
import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { QUICK_MODELS } from "../../quick-model-shortcuts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** edits fork preferences stored for this client, separately from shortcut keys. */
export function ForkPreferences() {
  const settings = useClientSettings();
  const scopedSettings = useScopedSettings();
  const { environment } = useSettingsScope();
  const catalog = useMemo(
    () =>
      applyProviderInstanceSettings(
        deriveProviderInstanceEntries(environment?.serverConfig?.providers ?? []),
        scopedSettings,
      ),
    [environment?.serverConfig?.providers, scopedSettings],
  );
  const update = useUpdateClientSettings();
  const [prefix, setPrefix] = useState("");
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");
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
      }).catch(() => setError("Could not save the board."));
      setPrefix("");
      setOrigin("");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid board.");
    }
  };
  return (
    <>
      <SettingsSection title="Model shortcut targets">
        <p className="text-sm text-muted-foreground">
          For this client. Keys are edited in Keybindings. Enter a model ID from the corresponding
          provider catalog; unavailable models are ignored. Started threads keep their model.
        </p>
        {QUICK_MODELS.map((target) => (
          <SettingsRow
            key={target.command}
            title={target.command.split(".").at(-1)}
            description={`Default: ${target.model} (${target.driver})`}
          >
            <Input
              key={settings.quickModelTargets[target.command] ?? target.model}
              aria-label={`${target.command} target`}
              list={`fork-models-${target.command}`}
              defaultValue={settings.quickModelTargets[target.command] ?? ""}
              placeholder={target.model}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              onBlur={(event) => {
                const next = { ...settings.quickModelTargets };
                const value = event.currentTarget.value.trim();
                if (value) next[target.command] = value;
                else delete next[target.command];
                void update({ quickModelTargets: next }).catch(() =>
                  setError("Could not save the model target."),
                );
              }}
            />
            <datalist id={`fork-models-${target.command}`}>
              {[
                ...new Set(
                  catalog
                    .filter(
                      (entry) =>
                        entry.driverKind === target.driver && entry.enabled && entry.isAvailable,
                    )
                    .flatMap((entry) => getAppModelOptionsForInstance(scopedSettings, entry, null))
                    .filter((option) => !option.isUnavailable)
                    .map((option) => option.slug),
                ),
              ].map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection title="Beadside boards">
        <p className="text-sm text-muted-foreground">
          For this client. Map each repository's full issue prefix to its running board URL. Use a
          URL reachable from this device. Short IDs link only when every configured board answers
          and the suffix is unique.
        </p>
        {settings.beadBoards.map((board) => (
          <SettingsRow key={board.prefix} title={board.prefix} description={board.origin}>
            <Button
              variant="outline"
              onClick={() =>
                void update({
                  beadBoards: settings.beadBoards.filter((item) => item.prefix !== board.prefix),
                }).catch(() => setError("Could not remove the board."))
              }
            >
              Remove
            </Button>
          </SettingsRow>
        ))}
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Bead issue prefix"
            placeholder="nexiflow"
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
          />
          <Input
            aria-label="Beadside board URL"
            placeholder="http://127.0.0.1:1339"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
          />
          <Button onClick={saveBoard}>Add or update board</Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </SettingsSection>
    </>
  );
}
