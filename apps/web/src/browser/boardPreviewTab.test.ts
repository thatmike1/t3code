import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { DesktopPreviewOverlay, ThreadPreviewState } from "~/previewStateStore";

import { findBoardPreviewTab } from "./boardPreviewTab";

const BOARD = "http://127.0.0.1:1340/#ccChat-general-v3r2";

function tab(tabId: string, url: string | null, runtime?: "desktop" | "server") {
  return {
    threadId: "thread-1",
    tabId,
    navStatus: url === null ? { _tag: "Idle" } : { _tag: "Success", url, title: "" },
    canGoBack: false,
    canGoForward: false,
    ...(runtime ? { runtime } : {}),
    updatedAt: "2026-10-20T00:00:00.000Z",
  } as unknown as PreviewSessionSnapshot;
}

const LIVE = { hasWebContents: true } as DesktopPreviewOverlay;

function state(
  tabs: readonly PreviewSessionSnapshot[],
  overrides: Partial<Pick<ThreadPreviewState, "activeTabId" | "suppressedTabIds">> & {
    readonly live?: readonly string[];
  } = {},
): Pick<ThreadPreviewState, "sessions" | "activeTabId" | "suppressedTabIds" | "desktopByTabId"> {
  const live = overrides.live ?? tabs.map((snapshot) => snapshot.tabId);
  return {
    sessions: Object.fromEntries(tabs.map((snapshot) => [snapshot.tabId, snapshot])),
    activeTabId: overrides.activeTabId ?? null,
    suppressedTabIds: overrides.suppressedTabIds ?? new Set(),
    desktopByTabId: Object.fromEntries(live.map((tabId) => [tabId, LIVE])),
  };
}

describe("findBoardPreviewTab", () => {
  it("reuses the tab already on the board, whichever bead it shows", () => {
    const tabs = [
      tab("docs", "https://example.com/"),
      tab("board", "http://127.0.0.1:1340/#ccChat-general-qju"),
    ];

    expect(findBoardPreviewTab(state(tabs), BOARD)).toBe("board");
  });

  it("prefers the active tab when two are on the board", () => {
    const tabs = [
      tab("first", "http://127.0.0.1:1340/"),
      tab("second", "http://127.0.0.1:1340/#x"),
    ];

    expect(findBoardPreviewTab(state(tabs, { activeTabId: "second" }), BOARD)).toBe("second");
  });

  it("opens a new tab when no tab is on the board", () => {
    const tabs = [tab("other-port", "http://127.0.0.1:1341/"), tab("empty", null)];

    expect(findBoardPreviewTab(state(tabs), BOARD)).toBeNull();
  });

  it("skips tabs it cannot navigate itself", () => {
    const tabs = [
      tab("server", "http://127.0.0.1:1340/", "server"),
      tab("no-page", "http://127.0.0.1:1340/"),
      tab("closed", "http://127.0.0.1:1340/"),
    ];

    expect(
      findBoardPreviewTab(
        state(tabs, { live: ["server", "closed"], suppressedTabIds: new Set(["closed"]) }),
        BOARD,
      ),
    ).toBeNull();
  });
});
