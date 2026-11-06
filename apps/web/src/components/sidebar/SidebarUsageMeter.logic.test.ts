import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  selectUsageMeterSource,
  shouldRefreshOnOpen,
  type UsageMeterEnvironment,
  usageMeterRows,
  usageRefreshOutcome,
} from "./SidebarUsageMeter.logic";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const desk = EnvironmentId.make("desk");
const vps = EnvironmentId.make("vps");

function provider(
  driver: "claudeAgent" | "codex" | "cursor",
  usageLimits: ServerProviderUsageLimits | undefined,
  instanceId: string = driver,
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-06T11:59:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...(usageLimits ? { usageLimits } : {}),
  };
}

const claudeLimits = (checkedAt: string, fiveHourResetsAt = "2026-11-06T14:00:00.000Z") =>
  ({
    checkedAt,
    windows: [
      {
        id: "five_hour",
        kind: "session",
        label: "Session",
        usedPercent: 47.4,
        resetsAt: fiveHourResetsAt,
      },
      {
        id: "seven_day",
        kind: "weekly",
        label: "Weekly",
        usedPercent: 61,
        resetsAt: "2026-11-09T08:00:00.000Z",
      },
      { id: "seven_day_opus", kind: "weekly", label: "Opus", usedPercent: 12 },
    ],
  }) satisfies ServerProviderUsageLimits;

const codexLimits = (checkedAt: string) =>
  ({
    checkedAt,
    windows: [
      { id: "primary", kind: "session", label: "Session", usedPercent: 9 },
      {
        id: "secondary",
        kind: "weekly",
        label: "Weekly",
        usedPercent: 33,
        resetsAt: "2026-11-10T00:00:00.000Z",
      },
    ],
  }) satisfies ServerProviderUsageLimits;

function environments(
  entries: ReadonlyArray<[EnvironmentId, Partial<UsageMeterEnvironment>]>,
): ReadonlyMap<EnvironmentId, UsageMeterEnvironment> {
  return new Map(
    entries.map(([id, environment]) => [
      id,
      { label: String(id), connected: true, providers: [], ...environment },
    ]),
  );
}

describe("selectUsageMeterSource", () => {
  it("picks the same source for each driver whatever else is configured", () => {
    const envs = environments([
      [
        vps,
        {
          providers: [
            provider("claudeAgent", claudeLimits("2026-11-06T11:58:00.000Z")),
            provider("codex", codexLimits("2026-11-06T11:58:00.000Z")),
          ],
        },
      ],
      [
        desk,
        {
          providers: [
            provider("cursor", codexLimits("2026-11-06T11:58:00.000Z")),
            provider("claudeAgent", claudeLimits("2026-11-06T11:50:00.000Z"), "claude-work"),
            provider("claudeAgent", claudeLimits("2026-11-06T11:40:00.000Z")),
            provider("codex", undefined),
          ],
        },
      ],
    ]);
    // primary environment first, then the driver's default instance
    const claude = selectUsageMeterSource(envs, "claudeAgent", desk);
    expect([claude?.environmentId, claude?.provider.instanceId]).toEqual([desk, "claudeAgent"]);
    // a provider that never reported limits is not a source; another environment is
    const codex = selectUsageMeterSource(envs, "codex", desk);
    expect([codex?.environmentId, codex?.provider.instanceId]).toEqual([vps, "codex"]);
  });

  it("prefers a connected environment and skips signed-out or unsupported accounts", () => {
    const signedOut = {
      ...provider("claudeAgent", claudeLimits("2026-11-06T11:58:00.000Z")),
      auth: { status: "unauthenticated" as const },
    };
    const envs = environments([
      [
        desk,
        {
          connected: false,
          providers: [provider("codex", codexLimits("2026-11-06T09:00:00.000Z"))],
        },
      ],
      [vps, { providers: [provider("codex", codexLimits("2026-11-06T11:00:00.000Z")), signedOut] }],
    ]);
    expect(selectUsageMeterSource(envs, "codex", null)?.environmentId).toBe(vps);
    expect(selectUsageMeterSource(envs, "claudeAgent", null)).toBeNull();
  });
});

describe("usageMeterRows", () => {
  const source = (environmentId: EnvironmentId, value: ServerProvider, connected = true) => ({
    environmentId,
    environmentLabel: String(environmentId),
    connected,
    provider: value,
  });

  it("lists Codex weekly, Claude 5-hour, Claude weekly with their own check and reset times", () => {
    const rows = usageMeterRows(
      {
        codex: source(vps, provider("codex", codexLimits("2026-11-06T11:56:00.000Z"))),
        claudeAgent: source(
          desk,
          provider("claudeAgent", claudeLimits("2026-11-06T11:57:00.000Z")),
        ),
      },
      NOW,
    );
    expect(rows.map((row) => [row.id, row.reading])).toEqual([
      [
        "codexWeekly",
        {
          state: "measured",
          usedPercent: 33,
          checkedAt: "2026-11-06T11:56:00.000Z",
          resetsAt: "2026-11-10T00:00:00.000Z",
          stale: false,
        },
      ],
      [
        "claudeSession",
        {
          state: "measured",
          usedPercent: 47,
          checkedAt: "2026-11-06T11:57:00.000Z",
          resetsAt: "2026-11-06T14:00:00.000Z",
          stale: false,
        },
      ],
      [
        "claudeWeekly",
        {
          state: "measured",
          usedPercent: 61,
          checkedAt: "2026-11-06T11:57:00.000Z",
          resetsAt: "2026-11-09T08:00:00.000Z",
          stale: false,
        },
      ],
    ]);
  });

  it("assumes zero after a reset without calling it measured, and marks old or offline readings stale", () => {
    const rows = usageMeterRows(
      {
        codex: source(vps, provider("codex", codexLimits("2026-11-06T11:56:00.000Z")), false),
        claudeAgent: source(
          desk,
          provider("claudeAgent", {
            ...claudeLimits("2026-11-06T10:30:00.000Z", "2026-11-06T11:00:00.000Z"),
            unavailable: { reason: "probeFailed", message: "Claude did not answer." },
          }),
        ),
      },
      NOW,
    );
    const [codex, session, weekly] = rows;
    expect(codex?.reading).toMatchObject({ state: "measured", usedPercent: 33, stale: true });
    expect(session?.reading).toEqual({
      state: "resetSinceReading",
      usedPercent: 0,
      measuredPercent: 47,
      checkedAt: "2026-11-06T10:30:00.000Z",
      resetsAt: "2026-11-06T11:00:00.000Z",
    });
    expect(weekly?.reading).toMatchObject({ state: "measured", usedPercent: 61, stale: true });
    expect(session?.notice).toBe("Claude did not answer.");
  });

  it("shows missing rows when no source reports the window", () => {
    const rows = usageMeterRows({ codex: null, claudeAgent: null }, NOW);
    expect(rows.map((row) => row.reading.state)).toEqual(["missing", "missing", "missing"]);
    expect(shouldRefreshOnOpen(rows, NOW)).toBe(false);
  });

  it("asks for a reading on open only when a reachable reading is older than the usage cache", () => {
    const fresh = usageMeterRows(
      {
        codex: source(vps, provider("codex", codexLimits("2026-11-06T11:57:00.000Z"))),
        claudeAgent: source(
          desk,
          provider("claudeAgent", claudeLimits("2026-11-06T11:58:00.000Z")),
        ),
      },
      NOW,
    );
    expect(shouldRefreshOnOpen(fresh, NOW)).toBe(false);
    expect(shouldRefreshOnOpen(fresh, NOW + 6 * 60_000)).toBe(true);
    const offline = usageMeterRows(
      {
        codex: source(vps, provider("codex", codexLimits("2026-11-06T08:00:00.000Z")), false),
        claudeAgent: null,
      },
      NOW,
    );
    expect(shouldRefreshOnOpen(offline, NOW)).toBe(false);
  });
});

describe("usageRefreshOutcome", () => {
  const claude = provider("claudeAgent", claudeLimits("2026-11-06T11:40:00.000Z"));
  const meterSource = {
    environmentId: desk,
    environmentLabel: "desk",
    connected: true,
    provider: claude,
  };

  it("counts a refresh as new only when the reading time moved", () => {
    expect(
      usageRefreshOutcome(meterSource, [
        provider("claudeAgent", claudeLimits("2026-11-06T12:00:00.000Z")),
      ]),
    ).toEqual({ status: "updated" });
    // a failed read keeps the last good limits and their original time
    expect(usageRefreshOutcome(meterSource, [claude])).toEqual({
      status: "unchanged",
      message: null,
    });
    expect(
      usageRefreshOutcome(meterSource, [
        provider("claudeAgent", {
          checkedAt: "2026-11-06T11:40:00.000Z",
          windows: [],
          unavailable: { reason: "probeFailed" },
        }),
      ]),
    ).toEqual({ status: "unchanged", message: "Could not read limits." });
  });
});

it("does not call a failed probe fresh just because its check timestamp advanced", () => {
  const source = {
    environmentId: desk,
    environmentLabel: "desk",
    connected: true,
    provider: provider("claudeAgent", claudeLimits("2026-11-06T11:40:00.000Z")),
  };
  expect(
    usageRefreshOutcome(source, [
      provider("claudeAgent", {
        checkedAt: "2026-11-06T12:00:00.000Z",
        windows: [],
        unavailable: { reason: "probeFailed", message: "Could not contact Claude." },
      }),
    ]),
  ).toEqual({ status: "unchanged", message: "Could not contact Claude." });
});
