import { useGT } from "gt-react";
import { DEFAULT_CLIENT_SETTINGS, ForkArtwork } from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";

import { useClientSettings, updateClientSettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const LABELS: Record<ForkArtwork, string> = {
  paint: "MS Paint",
  bonsai: "Bonsai",
  scribble: "Scribble",
  off: "Off",
};
const isForkArtwork = Schema.is(ForkArtwork);

export function ForkArtworkSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const artwork = useClientSettings((settings) => settings.forkArtwork);
  const update = updateClientSettings;
  return (
    <SettingsRow
      {...searchableSetting("fork-artwork")}
      description="Artwork in the sidebar header and send button. Scribble uses just the fork mark and a monochrome send button. Off uses the environment identification setting."
      resetAction={
        artwork !== DEFAULT_CLIENT_SETTINGS.forkArtwork ? (
          <SettingResetButton
            ariaLabel={gt("Reset fork artwork to default")}
            onClick={() => void update({ forkArtwork: DEFAULT_CLIENT_SETTINGS.forkArtwork })}
          />
        ) : null
      }
      control={
        <Select
          value={artwork}
          onValueChange={(value) => {
            if (isForkArtwork(value)) void update({ forkArtwork: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Fork artwork">
            <SelectValue>{LABELS[artwork]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {ForkArtwork.literals.map((value) => (
              <SelectItem hideIndicator key={value} value={value}>
                {LABELS[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
