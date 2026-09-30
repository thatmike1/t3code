import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopIpc from "../DesktopIpc.ts";
import { READ_PRIMARY_SELECTION_CHANNEL, WRITE_PRIMARY_SELECTION_CHANNEL } from "../channels.ts";

export const readPrimarySelection = DesktopIpc.makeIpcMethod({
  channel: READ_PRIMARY_SELECTION_CHANNEL,
  payload: Schema.Void,
  result: Schema.String,
  handler: () => Effect.promise(async () => Electron.clipboard.selection?.readText() ?? ""),
});

export const writePrimarySelection = DesktopIpc.makeIpcMethod({
  channel: WRITE_PRIMARY_SELECTION_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: (text) =>
    Effect.promise(async () => {
      // clearing a terminal highlight must not discard the last selected text.
      if (text.length > 0) await Electron.clipboard.selection?.writeText(text);
    }),
});
