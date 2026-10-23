import {
  DEFAULT_CLIENT_SETTINGS,
  SidebarWorkingShelfReturn,
  SidebarWorkingShelfScope,
} from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";

import { useClientSettings, updateClientSettings } from "../../hooks/useSettings";
import { useEnvironmentIdentities } from "../../state/environments";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

const RETURN_LABELS: Record<SidebarWorkingShelfReturn, string> = {
  top: "Top of the list",
  in_place: "Its old spot",
};
const SCOPE_LABELS: Record<SidebarWorkingShelfScope, string> = {
  all: "All threads",
  environments: "Picked environments",
};
const isReturn = Schema.is(SidebarWorkingShelfReturn);
const isScope = Schema.is(SidebarWorkingShelfScope);

/** fork: knobs under the Working section toggle, shown while it is on. The
    defaults reproduce upstream's beta. */
export function WorkingShelfSettings() {
  const settings = useClientSettings();
  const update = updateClientSettings;
  const environments = useEnvironmentIdentities();
  const picked = new Set<string>(settings.sidebarWorkingShelfEnvironmentIds);
  // A picked environment that left the catalog stays listed so it can be unpicked.
  const rows = [
    ...environments.map(({ environmentId, label }) => ({ id: environmentId as string, label })),
    ...settings.sidebarWorkingShelfEnvironmentIds
      .filter((id) => !environments.some((environment) => environment.environmentId === id))
      .map((id) => ({ id, label: `Removed environment (${id})` })),
  ];
  const overrideCount = Object.keys(settings.sidebarWorkingShelfThreadOverrides).length;

  return (
    <>
      <SettingsRow
        title="Finished threads return to"
        description={
          settings.sidebarWorkingShelfReturn === "top"
            ? "The top of the list, which is ordered by when threads came back. Drag reordering is off."
            : "Their old spot in your saved order. Drag reordering stays on."
        }
        resetAction={
          settings.sidebarWorkingShelfReturn !==
          DEFAULT_CLIENT_SETTINGS.sidebarWorkingShelfReturn ? (
            <SettingResetButton
              label="return placement"
              onClick={() =>
                void update({
                  sidebarWorkingShelfReturn: DEFAULT_CLIENT_SETTINGS.sidebarWorkingShelfReturn,
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={settings.sidebarWorkingShelfReturn}
            onValueChange={(value) => {
              if (isReturn(value)) void update({ sidebarWorkingShelfReturn: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Return placement">
              <SelectValue>{RETURN_LABELS[settings.sidebarWorkingShelfReturn]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {SidebarWorkingShelfReturn.literals.map((value) => (
                <SelectItem hideIndicator key={value} value={value}>
                  {RETURN_LABELS[value]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Shelve working threads from"
        description={
          (settings.sidebarWorkingShelfScope === "all"
            ? "Every busy thread folds into the Working section."
            : "Only busy threads on the environments switched on below fold away.") +
          (overrideCount > 0
            ? ` ${overrideCount} thread${overrideCount === 1 ? " has its" : "s have their"} own choice in the thread menu.`
            : "")
        }
        resetAction={
          settings.sidebarWorkingShelfScope !== DEFAULT_CLIENT_SETTINGS.sidebarWorkingShelfScope ? (
            <SettingResetButton
              label="shelf scope"
              onClick={() =>
                void update({
                  sidebarWorkingShelfScope: DEFAULT_CLIENT_SETTINGS.sidebarWorkingShelfScope,
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={settings.sidebarWorkingShelfScope}
            onValueChange={(value) => {
              if (isScope(value)) void update({ sidebarWorkingShelfScope: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Shelf scope">
              <SelectValue>{SCOPE_LABELS[settings.sidebarWorkingShelfScope]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {SidebarWorkingShelfScope.literals.map((value) => (
                <SelectItem hideIndicator key={value} value={value}>
                  {SCOPE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {settings.sidebarWorkingShelfScope === "environments"
        ? rows.map((row) => (
            <SettingsRow
              key={row.id}
              title={row.label}
              description="Shelve this environment's working threads."
              control={
                <Switch
                  checked={picked.has(row.id)}
                  onCheckedChange={(checked) =>
                    void update({
                      sidebarWorkingShelfEnvironmentIds: checked
                        ? [...picked, row.id]
                        : settings.sidebarWorkingShelfEnvironmentIds.filter((id) => id !== row.id),
                    })
                  }
                  aria-label={`Shelve working threads on ${row.label}`}
                />
              }
            />
          ))
        : null}
    </>
  );
}
