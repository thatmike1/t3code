import type {
  EnvironmentId,
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";

/** a reading older than this, or from a disconnected environment, is shown as stale. */
const USAGE_METER_STALE_AFTER_MS = 15 * 60_000;
/** opening the popup re-reads when a reading is older than the Claude usage cache. */
const USAGE_METER_REFRESH_ON_OPEN_AFTER_MS = 5 * 60_000;

export interface UsageMeterEnvironment {
  readonly label: string;
  readonly connected: boolean;
  readonly providers: readonly ServerProvider[];
}

export interface UsageMeterSource {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly connected: boolean;
  readonly provider: ServerProvider;
}

export type UsageMeterDriver = "claudeAgent" | "codex";
export type UsageMeterRowId = "codexWeekly" | "claudeSession" | "claudeWeekly";

const ROWS: ReadonlyArray<{
  readonly id: UsageMeterRowId;
  readonly driver: UsageMeterDriver;
  readonly label: string;
  readonly pick: (
    windows: readonly ServerProviderUsageWindow[],
  ) => ServerProviderUsageWindow | undefined;
}> = [
  {
    id: "codexWeekly",
    driver: "codex",
    label: "Codex weekly",
    pick: (windows) =>
      windows.find((window) => window.id === "secondary" && window.kind === "weekly") ??
      windows.find((window) => window.kind === "weekly"),
  },
  {
    id: "claudeSession",
    driver: "claudeAgent",
    label: "Claude 5-hour",
    pick: (windows) => windows.find((window) => window.id === "five_hour"),
  },
  {
    id: "claudeWeekly",
    driver: "claudeAgent",
    label: "Claude weekly",
    pick: (windows) => windows.find((window) => window.id === "seven_day"),
  },
];

/**
 * One source per driver, independent of the active thread: the primary environment first,
 * then connected ones, then the driver's default instance, then ids.
 */
export function selectUsageMeterSource(
  environments: ReadonlyMap<EnvironmentId, UsageMeterEnvironment>,
  driver: UsageMeterDriver,
  primaryEnvironmentId: EnvironmentId | null,
): UsageMeterSource | null {
  const candidates: UsageMeterSource[] = [];
  for (const [environmentId, environment] of environments) {
    for (const provider of environment.providers) {
      if (
        String(provider.driver) !== driver ||
        !provider.enabled ||
        provider.auth.status === "unauthenticated" ||
        provider.usageLimits === undefined ||
        provider.usageLimits.unavailable?.reason === "unsupported"
      )
        continue;
      candidates.push({
        environmentId,
        environmentLabel: environment.label,
        connected: environment.connected,
        provider,
      });
    }
  }
  const rank = (source: UsageMeterSource) => [
    source.environmentId === primaryEnvironmentId ? 0 : 1,
    source.connected ? 0 : 1,
    String(source.provider.instanceId) === driver ? 0 : 1,
  ];
  candidates.sort((left, right) => {
    const [a, b] = [rank(left), rank(right)];
    for (let index = 0; index < a.length; index++) {
      if (a[index] !== b[index]) return a[index]! - b[index]!;
    }
    return (
      left.environmentId.localeCompare(right.environmentId) ||
      String(left.provider.instanceId).localeCompare(String(right.provider.instanceId))
    );
  });
  return candidates[0] ?? null;
}

export type UsageMeterReading =
  /** the provider's own last reading, with its original check time. */
  | {
      readonly state: "measured";
      readonly usedPercent: number;
      readonly checkedAt: string;
      readonly resetsAt: string | null;
      readonly stale: boolean;
    }
  /** the window reset after the last reading; zero is assumed, never measured. */
  | {
      readonly state: "resetSinceReading";
      readonly usedPercent: 0;
      readonly measuredPercent: number;
      readonly checkedAt: string;
      readonly resetsAt: string;
    }
  | { readonly state: "missing" };

export interface UsageMeterRow {
  readonly id: UsageMeterRowId;
  readonly label: string;
  readonly source: UsageMeterSource | null;
  readonly reading: UsageMeterReading;
  /** the provider's own note when its last read failed. */
  readonly notice: string | null;
}

function readWindow(
  source: UsageMeterSource,
  limits: ServerProviderUsageLimits,
  window: ServerProviderUsageWindow,
  now: number,
): UsageMeterReading {
  const resetsAt = window.resetsAt ?? null;
  const resetMs = resetsAt === null ? Number.NaN : Date.parse(resetsAt);
  const checkedMs = Date.parse(limits.checkedAt);
  if (resetsAt !== null && Number.isFinite(resetMs) && resetMs <= now && !(checkedMs >= resetMs)) {
    return {
      state: "resetSinceReading",
      usedPercent: 0,
      measuredPercent: Math.round(window.usedPercent),
      checkedAt: limits.checkedAt,
      resetsAt,
    };
  }
  return {
    state: "measured",
    usedPercent: Math.round(window.usedPercent),
    checkedAt: limits.checkedAt,
    resetsAt,
    stale:
      !source.connected ||
      !Number.isFinite(checkedMs) ||
      now - checkedMs > USAGE_METER_STALE_AFTER_MS,
  };
}

/** popup order: Codex weekly, Claude 5-hour, Claude weekly. */
export function usageMeterRows(
  sources: Readonly<Record<UsageMeterDriver, UsageMeterSource | null>>,
  now: number,
): readonly UsageMeterRow[] {
  return ROWS.map(({ id, driver, label, pick }) => {
    const source = sources[driver];
    const limits = source?.provider.usageLimits;
    const window = limits ? pick(limits.windows) : undefined;
    return {
      id,
      label,
      source,
      reading:
        source && limits && window ? readWindow(source, limits, window, now) : { state: "missing" },
      notice:
        limits?.unavailable?.reason === "probeFailed"
          ? (limits.unavailable.message ?? "Could not read limits.")
          : null,
    };
  });
}

/** whether opening the popup should ask for a new reading. */
export function shouldRefreshOnOpen(rows: readonly UsageMeterRow[], now: number): boolean {
  return rows.some((row) => {
    if (row.source === null || !row.source.connected) return false;
    if (row.reading.state !== "measured") return true;
    return now - Date.parse(row.reading.checkedAt) > USAGE_METER_REFRESH_ON_OPEN_AFTER_MS;
  });
}

export type UsageMeterRefreshOutcome =
  | { readonly status: "updated" }
  /** the provider answered, but its reading time did not move: the read failed or was skipped. */
  | { readonly status: "unchanged"; readonly message: string | null }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "unavailable"; readonly message: string };

/** classifies a usage refresh by the reply's reading time against the one shown before it. */
export function usageRefreshOutcome(
  source: UsageMeterSource,
  reply: readonly ServerProvider[],
): UsageMeterRefreshOutcome {
  const refreshed = reply.find((provider) => provider.instanceId === source.provider.instanceId);
  const unavailable = refreshed?.usageLimits?.unavailable;
  if (unavailable?.reason === "probeFailed") {
    return {
      status: "unchanged",
      message: unavailable.message ?? "Could not read limits.",
    };
  }
  const before = source.provider.usageLimits?.checkedAt;
  const after = refreshed?.usageLimits?.checkedAt;
  if (
    refreshed?.usageLimits?.windows.length &&
    after !== undefined &&
    (before === undefined || Date.parse(after) > Date.parse(before))
  ) {
    return { status: "updated" };
  }
  return { status: "unchanged", message: null };
}
