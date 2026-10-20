import type { ScopedThreadRef } from "@t3tools/contracts";

import { previewBridge } from "~/components/preview/previewBridge";
import {
  readThreadPreviewState,
  rememberPreviewUrl,
  setActivePreviewTab,
  type ThreadPreviewState,
} from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

import { previewRuntimeTabId } from "./previewRuntimeTabId";

function urlOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The thread's browser tab already showing the board `href` lives on, so a bead opened from chat
 * replaces the last one instead of stacking a tab per click. Only a desktop tab with a live page
 * qualifies: those are the ones the client can navigate itself, and a desktop navigate to a tab
 * with no page would leave a phantom loading entry. The active tab wins a tie.
 */
export function findBoardPreviewTab(
  state: Pick<
    ThreadPreviewState,
    "sessions" | "activeTabId" | "suppressedTabIds" | "desktopByTabId"
  >,
  href: string,
): string | null {
  const origin = urlOrigin(href);
  if (!origin) return null;
  const matches = Object.entries(state.sessions).filter(([tabId, snapshot]) => {
    if (state.suppressedTabIds.has(tabId)) return false;
    if (snapshot.runtime === "server") return false;
    if (state.desktopByTabId[tabId]?.hasWebContents !== true) return false;
    if (snapshot.navStatus._tag === "Idle") return false;
    return urlOrigin(snapshot.navStatus.url) === origin;
  });
  const active = matches.find(([tabId]) => tabId === state.activeTabId);
  return (active ?? matches[0])?.[0] ?? null;
}

/**
 * Points the thread's board tab at `href` and brings it forward. Resolves false when there is no
 * such tab to reuse, so the caller opens a new one.
 */
export async function navigateBoardPreviewTab(
  threadRef: ScopedThreadRef,
  href: string,
): Promise<boolean> {
  if (!previewBridge) return false;
  const state = readThreadPreviewState(threadRef);
  const tabId = findBoardPreviewTab(state, href);
  if (!tabId) return false;
  await previewBridge.navigate(previewRuntimeTabId(threadRef, state.serverEpoch, tabId), href);
  rememberPreviewUrl(threadRef, href);
  setActivePreviewTab(threadRef, tabId);
  useRightPanelStore.getState().openBrowser(threadRef, tabId);
  return true;
}
