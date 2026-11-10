import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { GaugeIcon, RefreshCwIcon } from "lucide-react";
import { memo, useRef, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  formatRelativeTimeLabel,
  formatShortTimestamp,
  formatUpcomingTimestamp,
} from "../../timestampFormat";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { widgetNowSeconds } from "./SidebarWidgets.logic";
import {
  formatSessionReset,
  selectUsageMeterSource,
  shouldRefreshOnOpen,
  type UsageMeterDriver,
  type UsageMeterEnvironment,
  type UsageMeterRefreshOutcome,
  type UsageMeterRow,
  type UsageMeterSource,
  usageMeterRows,
  usageRefreshOutcome,
} from "./SidebarUsageMeter.logic";

const DRIVERS = ["codex", "claudeAgent"] as const satisfies readonly UsageMeterDriver[];
const DRIVER_NAME: Record<UsageMeterDriver, string> = { codex: "Codex", claudeAgent: "Claude" };

type RefreshState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | {
      readonly status: "done";
      readonly outcomes: Partial<Record<UsageMeterDriver, UsageMeterRefreshOutcome>>;
    };

function useMeterEnvironments(): ReadonlyMap<EnvironmentId, UsageMeterEnvironment> {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const environments = new Map<EnvironmentId, UsageMeterEnvironment>();
  for (const [environmentId, presentation] of presentations) {
    environments.set(environmentId, {
      label: presentation.entry.target.label,
      connected: presentation.connection.phase === "connected",
      providers: presentation.serverConfig?.providers ?? [],
    });
  }
  return environments;
}

function rowValue(row: UsageMeterRow): string {
  return row.reading.state === "missing" ? "–" : `${row.reading.usedPercent}%`;
}

function outcomeText(driver: UsageMeterDriver, outcome: UsageMeterRefreshOutcome): string | null {
  switch (outcome.status) {
    case "updated":
      return null;
    case "unchanged":
      return `${DRIVER_NAME[driver]}: no new reading${outcome.message ? ` (${outcome.message})` : ""}.`;
    case "failed":
    case "unavailable":
      return `${DRIVER_NAME[driver]}: ${outcome.message}`;
  }
}

function UsageMeterRowView({
  row,
  now,
  showEnvironment,
}: {
  readonly row: UsageMeterRow;
  readonly now: number;
  readonly showEnvironment: boolean;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const { reading, source } = row;
  let detail: string;
  if (reading.state === "missing") {
    detail = source === null ? "No source configured" : "No reading yet";
  } else if (reading.state === "resetSinceReading") {
    detail = `Reset ${formatShortTimestamp(reading.resetsAt, timestampFormat)}, not measured since (was ${reading.measuredPercent}% ${formatRelativeTimeLabel(reading.checkedAt, now)})`;
  } else {
    const clock = reading.resetsAt
      ? formatUpcomingTimestamp(reading.resetsAt, timestampFormat, now)
      : null;
    const resets =
      reading.resetsAt === null || clock === null
        ? ""
        : row.id === "claudeSession"
          ? `, ${formatSessionReset(reading.resetsAt, clock, now)}`
          : `, resets ${clock}`;
    detail = `Checked ${formatRelativeTimeLabel(reading.checkedAt, now)}${resets}`;
  }
  const where =
    source !== null && (showEnvironment || !source.connected)
      ? `${source.environmentLabel}${source.connected ? "" : " (offline)"} · `
      : "";
  const muted = reading.state !== "measured" || reading.stale;
  return (
    <div className="flex flex-col" data-usage-meter-row={row.id}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate">{row.label}</span>
        <span className={cn("shrink-0 tabular-nums", muted && "text-sidebar-muted-foreground")}>
          {rowValue(row)}
        </span>
      </div>
      <span className="text-2xs text-sidebar-muted-foreground">
        {where}
        {detail}
        {row.notice ? ` · ${row.notice}` : ""}
      </span>
    </div>
  );
}

/** claude's five-hour use in the footer utility row; click for Codex and Claude weekly too. */
export const SidebarUsageMeter = memo(function SidebarUsageMeter() {
  const environments = useMeterEnvironments();
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const now = widgetNowSeconds(useNowMinute()) * 1000;
  const sources: Record<UsageMeterDriver, UsageMeterSource | null> = {
    codex: selectUsageMeterSource(environments, "codex", primaryEnvironmentId),
    claudeAgent: selectUsageMeterSource(environments, "claudeAgent", primaryEnvironmentId),
  };
  const rows = usageMeterRows(sources, now);
  const canRefreshCodex = useAtomValue(
    serverEnvironment.refreshProviders.permissionAtom(sources.codex?.environmentId ?? null),
  );
  const canRefreshClaude = useAtomValue(
    serverEnvironment.refreshProviders.permissionAtom(sources.claudeAgent?.environmentId ?? null),
  );
  const canRefresh: Record<UsageMeterDriver, boolean> = {
    codex: canRefreshCodex,
    claudeAgent: canRefreshClaude,
  };
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    label: "Refresh usage limits",
    reportFailure: false,
  });
  const refreshingRef = useRef(false);
  const [refresh, setRefresh] = useState<RefreshState>({ status: "idle" });

  const runRefresh = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefresh({ status: "running" });
    const outcomes: Partial<Record<UsageMeterDriver, UsageMeterRefreshOutcome>> = {};
    await Promise.all(
      DRIVERS.map(async (driver) => {
        const source = sources[driver];
        if (source === null) {
          outcomes[driver] = { status: "unavailable", message: "No source configured." };
          return;
        }
        if (!source.connected) {
          outcomes[driver] = {
            status: "unavailable",
            message: `${source.environmentLabel} is offline.`,
          };
          return;
        }
        if (!canRefresh[driver]) {
          outcomes[driver] = {
            status: "unavailable",
            message: `No permission to refresh on ${source.environmentLabel}.`,
          };
          return;
        }
        try {
          const result = await refreshProviders({
            environmentId: source.environmentId,
            input: { instanceId: source.provider.instanceId, refreshUsage: true },
          });
          outcomes[driver] =
            result._tag === "Success"
              ? usageRefreshOutcome(source, result.value.providers)
              : { status: "failed", message: "Refresh failed." };
        } catch {
          outcomes[driver] = { status: "failed", message: "Refresh failed." };
        }
      }),
    );
    refreshingRef.current = false;
    setRefresh({ status: "done", outcomes });
  };

  const onOpenChange = (open: boolean) => {
    if (open && shouldRefreshOnOpen(rows, now)) void runRefresh();
  };

  const session = rows.find((row) => row.id === "claudeSession")!;
  const sessionText =
    session.reading.state === "missing"
      ? "Claude 5-hour: no reading"
      : session.reading.state === "resetSinceReading"
        ? `Claude 5-hour: reset ${formatRelativeTimeLabel(session.reading.resetsAt, now)}, not measured since`
        : `Claude 5-hour: ${session.reading.usedPercent}% used, checked ${formatRelativeTimeLabel(session.reading.checkedAt, now)}`;
  const footerMuted = session.reading.state !== "measured" || session.reading.stale;
  const showEnvironment = new Set(DRIVERS.map((driver) => sources[driver]?.environmentId)).size > 1;
  const messages =
    refresh.status === "done"
      ? DRIVERS.flatMap((driver) => {
          const outcome = refresh.outcomes[driver];
          const text = outcome ? outcomeText(driver, outcome) : null;
          return text === null ? [] : [text];
        })
      : [];

  return (
    <SidebarMenuItem className="shrink-0 not-first:ml-0.5">
      <Popover onOpenChange={onOpenChange}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <SidebarMenuButton aria-label={sessionText} className="h-8 w-auto" size="icon">
                    <span className={cn("flex items-center px-1.5", footerMuted && "opacity-50")}>
                      {session.reading.state === "missing" ? (
                        <GaugeIcon className="size-4" />
                      ) : (
                        <span className="text-2xs tabular-nums">
                          {session.reading.usedPercent}%
                        </span>
                      )}
                    </span>
                  </SidebarMenuButton>
                }
              />
            }
          />
          <TooltipPopup side="top">{sessionText}</TooltipPopup>
        </Tooltip>
        <PopoverPopup
          align="center"
          aria-label="Usage limits"
          className="max-w-none"
          side="top"
          tooltipStyle
        >
          <div className="flex w-fit min-w-56 max-w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 py-1 text-left">
            {rows.map((row) => (
              <UsageMeterRowView
                key={row.id}
                now={now}
                row={row}
                showEnvironment={showEnvironment}
              />
            ))}
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-2xs text-sidebar-muted-foreground" role="status">
                {refresh.status === "running"
                  ? "Refreshing…"
                  : messages.length > 0
                    ? messages.join(" ")
                    : refresh.status === "done"
                      ? "Up to date."
                      : null}
              </span>
              <Button
                disabled={refresh.status === "running"}
                onClick={() => void runRefresh()}
                size="micro"
                variant="ghost-muted"
              >
                <RefreshCwIcon />
                Refresh
              </Button>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
});
