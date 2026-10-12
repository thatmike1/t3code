import type {
  EnvironmentId,
  TabTintColor,
  TabTintSnapshot,
  ThreadId,
  ThreadTabTint,
} from "@t3tools/contracts";

import { appendTabFocusMarker } from "@t3tools/shared/tabFocus";

import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";

/** Sidebery's own swatches, so the marker is the colour Mike sees on the tab. */
export const TAB_TINT_HEX: Readonly<Record<TabTintColor, string>> = {
  blue: "#37adff",
  turquoise: "#00c79a",
  green: "#51cd00",
  yellow: "#ffcb00",
  orange: "#ff9f00",
  red: "#ff613d",
  pink: "#ff4bda",
  purple: "#af51f5",
};

/** The tint a thread has earned, or null. Pure so the lookup rule is testable. */
export function findThreadTabTint(
  snapshot: TabTintSnapshot | null,
  snapshotEnvironmentId: EnvironmentId | null,
  environmentId: EnvironmentId,
  threadId: ThreadId,
): ThreadTabTint | null {
  // The browser session is read on the primary environment's machine, so its
  // tints only describe that environment's threads.
  if (snapshot === null || snapshotEnvironmentId !== environmentId) return null;
  return snapshot.tints.find((tint) => tint.threadId === threadId) ?? null;
}

/** The colour of the browser tabs this thread opened, when the user coloured them. */
export function useThreadTabTint(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): ThreadTabTint | null {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    primaryEnvironmentId === null
      ? null
      : serverEnvironment.tabTints({ environmentId: primaryEnvironmentId, input: {} }),
  );
  return findThreadTabTint(query.data, primaryEnvironmentId, environmentId, threadId);
}

/**
 * Asks the system browser to bring the tab showing `focusUrl` forward, by
 * opening that URL with the focus marker on it; a hook in the browser swaps
 * the new tab for the one already open. Goes through the desktop shell, the
 * way an external link does, so the desktop hands window focus to the
 * browser. Resolves false when nothing could be opened.
 */
export async function focusTintedTab(focusUrl: string): Promise<boolean> {
  const marked = appendTabFocusMarker(focusUrl);
  const openTabFocus = window.desktopBridge?.openTabFocus;
  if (openTabFocus) return openTabFocus(marked);
  // outside the desktop app a page can open web URLs but never local files
  if (window.desktopBridge || !/^https?:/iu.test(marked)) return false;
  window.open(marked, "_blank", "noopener,noreferrer");
  return true;
}
