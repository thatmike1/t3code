import "../../index.css";

import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { environmentPresentations } from "../../state/presentation";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { SidebarMenu, SidebarProvider } from "../ui/sidebar";
import { SidebarUsageMeter } from "./SidebarUsageMeter";

const desk = EnvironmentId.make("desk");

const state = vi.hoisted(() => ({
  providers: [] as unknown[],
  refreshCalls: [] as unknown[],
  refresh: (_input: unknown): Promise<unknown> => new Promise(() => {}),
}));

vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: (atom: unknown) =>
    atom === environmentPresentations.presentationsWithProvidersAtom
      ? new Map([
          [
            "desk",
            {
              entry: { target: { label: "This machine" } },
              connection: { phase: "connected" },
              serverConfig: { providers: state.providers },
            },
          ],
        ])
      : atom === primaryEnvironmentIdAtom
        ? "desk"
        : true,
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => (input: unknown) => {
    state.refreshCalls.push(input);
    return state.refresh(input);
  },
}));
vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-11-06T12:00" }));

function provider(driver: "claudeAgent" | "codex", usageLimits: ServerProviderUsageLimits) {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: usageLimits.checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits,
  } satisfies ServerProvider;
}

function setup(refresh: (input: unknown) => Promise<unknown>) {
  state.refreshCalls = [];
  state.refresh = refresh;
  state.providers = [
    provider("codex", {
      checkedAt: "2026-11-06T11:20:00.000Z",
      windows: [{ id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 33 }],
    }),
    provider("claudeAgent", {
      checkedAt: "2026-11-06T11:30:00.000Z",
      windows: [
        { id: "five_hour", kind: "session", label: "Session", usedPercent: 47 },
        { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 61 },
      ],
    }),
  ];
}

const meter = (
  <SidebarProvider>
    <SidebarMenu>
      <SidebarUsageMeter />
    </SidebarMenu>
  </SidebarProvider>
);

describe("SidebarUsageMeter", () => {
  it("opens on the last readings in order while the refresh it starts is still running", async () => {
    setup(() => new Promise(() => {}));
    await using screen = await render(meter);
    await expect
      .element(screen.getByRole("button", { name: /Claude 5-hour: 47% used/ }))
      .toHaveTextContent("47%");

    await userEvent.click(screen.getByRole("button", { name: /Claude 5-hour/ }));
    await expect.element(page.getByText("Refreshing…")).toBeInTheDocument();
    const rows = [...document.querySelectorAll("[data-usage-meter-row]")];
    expect(rows.map((row) => row.getAttribute("data-usage-meter-row"))).toEqual([
      "codexWeekly",
      "claudeSession",
      "claudeWeekly",
    ]);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("33%"),
      expect.stringContaining("47%"),
      expect.stringContaining("61%"),
    ]);
    // readings older than the usage cache ask both providers for a new one, past the cache
    expect(state.refreshCalls).toEqual([
      { environmentId: desk, input: { instanceId: "codex", refreshUsage: true } },
      { environmentId: desk, input: { instanceId: "claudeAgent", refreshUsage: true } },
    ]);
  });

  it("keeps the last readings and says so when a refresh fails", async () => {
    setup(async (input) =>
      (input as { input: { instanceId: string } }).input.instanceId === "codex"
        ? { _tag: "Failure" }
        : { _tag: "Success", value: { providers: state.providers } },
    );
    await using screen = await render(meter);
    await userEvent.click(screen.getByRole("button", { name: /Claude 5-hour/ }));
    await expect
      .element(page.getByText("Codex: Refresh failed. Claude: no new reading."))
      .toBeInTheDocument();
    const rows = [...document.querySelectorAll("[data-usage-meter-row]")];
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("33%"),
      expect.stringContaining("47%"),
      expect.stringContaining("61%"),
    ]);
  });
});

it("does not report up to date when neither provider has a source", async () => {
  setup(async () => ({ _tag: "Failure" }));
  state.providers = [];
  await using screen = await render(meter);
  await userEvent.click(screen.getByRole("button", { name: "Claude 5-hour: no reading" }));
  await userEvent.click(page.getByRole("button", { name: "Refresh", exact: true }));
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("Codex: No source configured. Claude: No source configured.");
  await expect.element(page.getByRole("status")).not.toHaveTextContent("Up to date.");
  expect(state.refreshCalls).toHaveLength(0);
});
