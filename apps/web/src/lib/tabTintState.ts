import type {
  EnvironmentId,
  TabTintColor,
  TabTintSnapshot,
  ThreadId,
  ThreadTabTint,
} from "@t3tools/contracts";

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
