import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * a widget is one JSON file in the environment's widgets directory
 * (`<state dir>/widgets/<id>.json`), written by whatever process owns the
 * state: a tray daemon, a cron job, a shell script. the server watches the
 * directory and streams the decoded set to clients, which render each widget
 * as a small icon in the sidebar. v1 is view only: no actions.
 */
export const WidgetId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,63}$/));
export type WidgetId = typeof WidgetId.Type;

export const WidgetState = Schema.Literals(["ok", "attention", "off", "error"]);
export type WidgetState = typeof WidgetState.Type;

/** a closed list so the client ships the icons; it maps 1:1 to lucide names */
export const WidgetIcon = Schema.Literals([
  "circle",
  "terminal",
  "mic",
  "activity",
  "list-checks",
  "bell",
  "server",
  "clock",
  "zap",
  "folder",
]);
export type WidgetIcon = typeof WidgetIcon.Type;

/** an informational row in the widget's popover; `hint` sits right-aligned and muted */
export const WidgetRow = Schema.Struct({
  label: TrimmedNonEmptyString,
  hint: Schema.optionalKey(TrimmedNonEmptyString),
});
export type WidgetRow = typeof WidgetRow.Type;

export const Widget = Schema.Struct({
  id: WidgetId,
  /** short text next to the icon, e.g. "2/5"; omit for icon-only */
  label: Schema.optionalKey(TrimmedNonEmptyString),
  /** one line shown on hover; defaults to the id */
  tooltip: Schema.optionalKey(TrimmedNonEmptyString),
  state: WidgetState.pipe(Schema.withDecodingDefault(Effect.succeed("ok" as const))),
  icon: WidgetIcon.pipe(Schema.withDecodingDefault(Effect.succeed("circle" as const))),
  rows: Schema.Array(WidgetRow).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** lower sorts first; ties break on id */
  order: Schema.Finite.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  /** unix seconds of the last write; the client greys the widget past `staleAfterSeconds` */
  updatedAt: Schema.optionalKey(Schema.Finite),
  staleAfterSeconds: Schema.optionalKey(Schema.Finite),
});
export type Widget = typeof Widget.Type;

/** what the file on disk must decode to; the id comes from the filename, not the body */
export const WidgetFile = Schema.Struct({
  ...Widget.fields,
  id: Schema.optionalKey(WidgetId),
});
export type WidgetFile = typeof WidgetFile.Type;

export const WidgetsSnapshot = Schema.Struct({
  /** absolute path of the watched directory, so the UI can say where to drop files */
  directory: Schema.String,
  widgets: Schema.Array(Widget),
});
export type WidgetsSnapshot = typeof WidgetsSnapshot.Type;
