import type { Widget } from "@t3tools/contracts";

/** How long a widget stays fresh when its file does not say. */
export const DEFAULT_WIDGET_STALE_AFTER_SECONDS = 120;

/**
 * Unix seconds for the minute-quantized clock string `useNowMinute` emits
 * ("YYYY-MM-DDTHH:MM", always UTC but without the zone suffix).
 */
export function widgetNowSeconds(nowMinute: string): number {
  const parsed = Date.parse(`${nowMinute}:00Z`);
  return Math.floor((Number.isNaN(parsed) ? Date.now() : parsed) / 1000);
}

/**
 * A widget is stale once nothing has rewritten its file inside its own freshness
 * window. Widgets that never report a write time are never stale.
 */
export function isWidgetStale(
  widget: Pick<Widget, "updatedAt" | "staleAfterSeconds">,
  nowSeconds: number,
): boolean {
  if (widget.updatedAt === undefined) return false;
  const staleAfter = widget.staleAfterSeconds ?? DEFAULT_WIDGET_STALE_AFTER_SECONDS;
  return nowSeconds - widget.updatedAt > staleAfter;
}

/** The hover line: the widget's own tooltip, its id as a fallback, plus a stale marker. */
export function widgetTooltipText(
  widget: Pick<Widget, "id" | "tooltip">,
  isStale: boolean,
): string {
  return `${widget.tooltip ?? widget.id}${isStale ? " (stale)" : ""}`;
}

/** The contract's documented order: lower `order` first, ties broken on id. */
export function sortWidgets(widgets: ReadonlyArray<Widget>): ReadonlyArray<Widget> {
  return [...widgets].sort((left, right) =>
    left.order === right.order ? left.id.localeCompare(right.id) : left.order - right.order,
  );
}
