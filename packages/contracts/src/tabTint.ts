import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

/**
 * tab tint: a colour the user gave a browser tab by hand (Sidebery's
 * per-tab `customColor` in Firefox), carried back to the thread that opened
 * that tab. the server reads the browser's session file and T3's own tool
 * activity; nothing is ever written to the browser, so removing the colour
 * there removes the marker here.
 */
export const TabTintColor = Schema.Literals([
  "blue",
  "turquoise",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
]);
export type TabTintColor = typeof TabTintColor.Type;

export const ThreadTabTint = Schema.Struct({
  threadId: ThreadId,
  color: TabTintColor,
  /** how many coloured tabs this thread claims, across every colour */
  tabCount: Schema.Finite,
  /**
   * the current URL, exactly as the browser reports it, of the tab to bring
   * forward when the marker is clicked: among this thread's tabs in `color`,
   * the one the thread opened most recently
   */
  focusUrl: Schema.String,
});
export type ThreadTabTint = typeof ThreadTabTint.Type;

export const TabTintSnapshot = Schema.Struct({
  /** sorted by thread id so equal sets compare equal */
  tints: Schema.Array(ThreadTabTint),
});
export type TabTintSnapshot = typeof TabTintSnapshot.Type;
