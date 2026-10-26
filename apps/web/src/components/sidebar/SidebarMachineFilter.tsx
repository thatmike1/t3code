import type { EnvironmentId } from "@t3tools/contracts";
import { MonitorIcon } from "lucide-react";

import { isElectron } from "../../env";
import {
  buildSidebarMachineFilterOptions,
  toggleSidebarMachineFilter,
} from "../../sidebarProjectPreferences";
import {
  useConnectedEnvironmentIds,
  useEnvironmentIdentities,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

// "Machine" is a T3 environment. The filter only changes what the thread list
// shows; it never disconnects a machine or limits where new threads start.
export function SidebarMachineFilter(props: {
  selected: readonly EnvironmentId[] | null;
  onChange: (environmentIds: readonly EnvironmentId[] | null) => void;
}) {
  const environments = useEnvironmentIdentities();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const options = buildSidebarMachineFilterOptions({
    environments,
    primaryEnvironmentId,
    connectedEnvironmentIds,
    selected: props.selected,
  });
  if (environments.length < 2 && props.selected === null) return null;
  const allEnvironmentIds = environments.map((environment) => environment.environmentId);
  const primary = options.find((option) => option.isPrimary) ?? null;
  const selectedLabels = options
    .filter((option) => props.selected?.includes(option.environmentId))
    .map((option) => option.label);
  const label =
    props.selected === null
      ? "Filter threads by machine"
      : `Filter threads by machine: ${selectedLabels.join(", ")}`;
  return (
    <Menu>
      <MenuTrigger render={<SidebarHeaderIconButton label={label} />}>
        <MonitorIcon className="size-4" />
        {props.selected !== null ? (
          <span
            aria-hidden
            className="pointer-events-none absolute right-1 top-1 size-1.5 rounded-full bg-primary"
          />
        ) : null}
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuCheckboxItem
          checked={props.selected === null}
          closeOnClick={false}
          onCheckedChange={() => props.onChange(null)}
        >
          All machines
        </MenuCheckboxItem>
        <MenuItem
          disabled={primary === null}
          onClick={() => {
            if (primary) props.onChange([primary.environmentId]);
          }}
        >
          {isElectron || primary === null ? "Only this machine" : `Only ${primary.label}`}
        </MenuItem>
        <MenuSeparator />
        {options.map((option) => (
          <MenuCheckboxItem
            key={option.environmentId}
            checked={props.selected === null || props.selected.includes(option.environmentId)}
            closeOnClick={false}
            onCheckedChange={(checked) =>
              props.onChange(
                toggleSidebarMachineFilter({
                  selected: props.selected,
                  allEnvironmentIds,
                  environmentId: option.environmentId,
                  checked,
                }),
              )
            }
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.isPrimary && isElectron ? (
                <span className="shrink-0 text-xs text-muted-foreground">this machine</span>
              ) : !option.connected ? (
                <span className="shrink-0 text-xs text-muted-foreground">offline</span>
              ) : null}
            </span>
          </MenuCheckboxItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
