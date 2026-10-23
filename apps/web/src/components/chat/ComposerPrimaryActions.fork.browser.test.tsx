import type { ForkArtwork } from "@t3tools/contracts/settings";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";

const artworkState = vi.hoisted(() => ({
  mode: "none" as "artwork" | "none",
  stage: "Latest",
  forkArtwork: "off" as ForkArtwork,
  theme: "dark" as "dark" | "light",
  hydrated: true,
}));

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => artworkState.mode,
  useClientSettings: (select: (settings: { forkArtwork: ForkArtwork }) => unknown) =>
    select(artworkState),
  useClientSettingsHydrated: () => artworkState.hydrated,
}));
vi.mock("../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: artworkState.theme }),
}));
vi.mock("../SidebarStageBackdrop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../SidebarStageBackdrop")>();
  return {
    ...actual,
    useSidebarStageBackdropVariant: (enabled = true) =>
      actual.resolveSidebarArtworkVariant(artworkState.stage, enabled, artworkState.forkArtwork),
  };
});

import { resolveSidebarArtworkVariant, SidebarStageBackdrop } from "../SidebarStageBackdrop";
import { ForkMark } from "../sidebar/ForkMark";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

function renderActions(overrides: Partial<ComponentProps<typeof ComposerPrimaryActions>> = {}) {
  const backdrop = resolveSidebarArtworkVariant(
    artworkState.stage,
    artworkState.mode === "artwork",
    artworkState.forkArtwork,
  );
  return render(
    <>
      <ForkMark />
      {backdrop ? <SidebarStageBackdrop variant={backdrop} /> : null}
      <ComposerPrimaryActions
        compact
        canOperateThread
        pendingAction={null}
        isRunning={false}
        canInterrupt={false}
        showPlanFollowUpPrompt={false}
        promptHasText
        isSendBusy={false}
        sendDisabledReason={null}
        isConnecting={false}
        isEnvironmentUnavailable={false}
        isPreparingWorktree={false}
        hasSendableContent
        onPreviousPendingQuestion={() => {}}
        onInterrupt={() => {}}
        onImplementPlanInNewThread={() => {}}
        {...overrides}
      />
    </>,
    { router: false },
  );
}

function setup(artwork: ForkArtwork, theme: "dark" | "light" = "dark") {
  Object.assign(artworkState, {
    mode: "none",
    stage: "Latest",
    forkArtwork: artwork,
    theme,
    hydrated: true,
  });
}

describe("fork composer artwork", () => {
  it.each(["dark", "light"] as const)("renders each artwork option in %s", async (theme) => {
    for (const artwork of ["paint", "bonsai", "scribble", "off"] as const) {
      setup(artwork, theme);
      await using screen = await renderActions();
      const button = screen.container.querySelector('button[aria-label="Submit message"]');
      expect(button).not.toBeNull();
      expect(screen.container.querySelector('[aria-label="fork"]') !== null).toBe(
        artwork !== "off",
      );
      if (artwork === "paint" || artwork === "bonsai") {
        expect(button?.querySelector("img")?.getAttribute("src")).toBe(
          `/fork-artwork/${artwork}-${theme}-circle.webp`,
        );
        expect(
          screen.container.querySelector("[data-fork-artwork]")?.getAttribute("data-fork-artwork"),
        ).toBe(`${artwork}-${theme}`);
      } else {
        expect(screen.container.querySelector(".sidebar-stage-backdrop")).toBeNull();
        expect(button?.querySelector("img, [data-stage-art]")).toBeNull();
      }
    }
  });

  it.each(["Nightly", "Dev"])("Off preserves upstream %s artwork", async (stage) => {
    setup("off");
    artworkState.stage = stage;
    artworkState.mode = "artwork";
    await using screen = await renderActions();
    expect(
      screen.container.querySelectorAll(
        `[data-stage-art="${stage === "Dev" ? "blueprint" : "nightly"}"]`,
      ),
    ).toHaveLength(2);
    expect(screen.container.querySelector('[aria-label="fork"]')).toBeNull();
  });

  it("does not show the fork mark before settings hydrate", async () => {
    setup("scribble");
    artworkState.hydrated = false;
    await using screen = await renderActions();
    expect(screen.container.querySelector('[aria-label="fork"]')).toBeNull();
  });

  it.each(["paint", "bonsai", "scribble"] as const)(
    "keeps %s status controls clear",
    async (artwork) => {
      setup(artwork);
      for (const state of [
        { isConnecting: true },
        { isSendBusy: true },
        { canResume: true, hasSendableContent: false },
        { isRunning: true, canInterrupt: true, hasSendableContent: false },
      ]) {
        await using screen = await renderActions(state);
        const button = screen.container.querySelector("button");
        expect(button).not.toBeNull();
        expect(button?.querySelector("img, [data-stage-art]")).toBeNull();
        expect(button?.querySelector("svg")).not.toBeNull();
      }
    },
  );
});
