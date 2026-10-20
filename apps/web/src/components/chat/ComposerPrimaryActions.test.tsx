// @vitest-environment jsdom
import type { ForkArtwork } from "@t3tools/contracts/settings";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

let root: Root | undefined;
let container: HTMLDivElement;

async function renderActions(
  overrides: Partial<ComponentProps<typeof ComposerPrimaryActions>> = {},
) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  const backdrop = resolveSidebarArtworkVariant(
    artworkState.stage,
    artworkState.mode === "artwork",
    artworkState.forkArtwork,
  );
  await act(async () =>
    root?.render(
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
    ),
  );
  return container;
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  vi.unstubAllGlobals();
  artworkState.mode = "none";
  artworkState.stage = "Latest";
  artworkState.forkArtwork = "off";
  artworkState.theme = "dark";
  artworkState.hydrated = true;
});

describe("ComposerPrimaryActions", () => {
  it("disables and labels the send button while feedback is uploading", async () => {
    const view = await renderActions({ sendDisabledReason: "Sending feedback" });
    expect(
      view.querySelector<HTMLButtonElement>('button[aria-label="Sending feedback"]')?.disabled,
    ).toBe(true);
  });

  it.each([true, false])(
    "offers Stop generation only for a running pending request (%s)",
    async (isRunning) => {
      const view = await renderActions({
        isRunning,
        canInterrupt: isRunning,
        hasSendableContent: false,
        pendingAction: {
          questionIndex: 0,
          isLastQuestion: true,
          canAdvance: true,
          isResponding: false,
          isComplete: true,
        },
      });
      expect(view.querySelector('button[aria-label="Stop generation"]') !== null).toBe(isRunning);
    },
  );

  it.each(["dark", "light"] as const)("renders each artwork option in %s", async (theme) => {
    artworkState.theme = theme;
    for (const artwork of ["paint", "bonsai", "scribble", "off"] as const) {
      artworkState.forkArtwork = artwork;
      const view = await renderActions();
      const button = view.querySelector('button[aria-label="Submit message"]');
      expect(button).not.toBeNull();
      expect(view.querySelector('[aria-label="fork"]') !== null).toBe(artwork !== "off");
      if (artwork === "paint" || artwork === "bonsai") {
        expect(view.querySelector("[data-fork-artwork]")?.getAttribute("data-fork-artwork")).toBe(
          `${artwork}-${theme}`,
        );
        expect(button?.querySelector("img")?.getAttribute("src")).toBe(
          `/fork-artwork/${artwork}-${theme}-circle.webp`,
        );
        expect(button?.querySelectorAll("img")[1]?.getAttribute("src")).toBe(
          `/fork-artwork/${artwork}-${theme}-arrow.png`,
        );
      } else {
        expect(view.querySelector(".sidebar-stage-backdrop")).toBeNull();
        expect(button?.querySelector("img, [data-stage-art]")).toBeNull();
        expect(button?.querySelector("svg path")).not.toBeNull();
        expect(button?.classList.contains("dark:bg-black")).toBe(artwork === "scribble");
        expect(button?.classList.contains("bg-message-action")).toBe(artwork === "off");
      }
    }
  });

  it.each(["Nightly", "Dev"])("Off preserves upstream %s environment artwork", async (stage) => {
    artworkState.stage = stage;
    artworkState.mode = "artwork";
    let view = await renderActions();
    expect(
      view.querySelectorAll(`[data-stage-art="${stage === "Dev" ? "blueprint" : "nightly"}"]`),
    ).toHaveLength(2);
    expect(view.querySelector('[aria-label="fork"]')).toBeNull();
    artworkState.mode = "none";
    view = await renderActions();
    expect(view.querySelector("[data-stage-art]")).toBeNull();
  });

  it("Scribble suppresses upstream header and button art too", async () => {
    artworkState.forkArtwork = "scribble";
    artworkState.stage = "Nightly";
    artworkState.mode = "artwork";
    const view = await renderActions();
    expect(view.querySelector(".sidebar-stage-backdrop, [data-stage-art], img")).toBeNull();
    expect(view.querySelector('[aria-label="fork"]')).not.toBeNull();
  });

  it("does not show the fork mark before settings hydrate", async () => {
    artworkState.forkArtwork = "scribble";
    artworkState.hydrated = false;
    expect((await renderActions()).querySelector('[aria-label="fork"]')).toBeNull();
  });

  it.each(["paint", "bonsai", "scribble"] as const)(
    "keeps %s status controls clear",
    async (artwork) => {
      artworkState.forkArtwork = artwork;
      for (const state of [
        { isConnecting: true },
        { isSendBusy: true },
        { canResume: true, hasSendableContent: false },
        { isEditingQueuedMessage: true },
        { isRunning: true },
        { isRunning: true, canInterrupt: true, hasSendableContent: false },
      ]) {
        const view = await renderActions(state);
        const button = view.querySelector("button");
        expect(button).not.toBeNull();
        expect(button?.querySelector("img, [data-stage-art]")).toBeNull();
        expect(button?.classList.contains("dark:bg-black")).toBe(false);
        expect(button?.querySelector("svg")).not.toBeNull();
      }
      const view = await renderActions({ hasSendableContent: false });
      expect(view.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
    },
  );
});
