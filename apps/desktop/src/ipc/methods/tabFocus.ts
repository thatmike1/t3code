import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { isTabFocusUrl } from "@t3tools/shared/tabFocus";

import * as DesktopIpc from "../DesktopIpc.ts";
import { OPEN_TAB_FOCUS_CHANNEL } from "../channels.ts";

/**
 * Hands a tab-focus request to the system browser through the same
 * `shell.openExternal` the external-link route uses, so the desktop passes
 * window focus along with it. It is its own channel because that route
 * refuses `file:` URLs, and a coloured tab is often a local page; here a
 * `file:` URL is taken only when it ends in the focus marker.
 *
 * The string goes out untouched rather than re-serialised: the browser hook
 * compares it with the open tab's URL exactly.
 */
export const openTabFocusUrl = (rawUrl: unknown): Effect.Effect<boolean> =>
  isTabFocusUrl(rawUrl)
    ? Effect.promise(() =>
        Electron.shell.openExternal(rawUrl).then(
          () => true,
          () => false,
        ),
      )
    : Effect.succeed(false);

export const openTabFocus = DesktopIpc.makeIpcMethod({
  channel: OPEN_TAB_FOCUS_CHANNEL,
  payload: Schema.String,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.openTabFocus")(function* (url) {
    return yield* openTabFocusUrl(url);
  }),
});
