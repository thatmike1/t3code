import type { Widget } from "@t3tools/contracts";
import { memo, useMemo } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { useWidgets } from "../../lib/widgetsState";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WidgetIcon } from "./WidgetIcon";
import {
  isWidgetStale,
  sortWidgets,
  widgetNowSeconds,
  widgetTooltipText,
} from "./SidebarWidgets.logic";

/** `ok` and `off` keep the sidebar's own icon colour; the other two borrow the semantic tokens. */
const WIDGET_STATE_CLASS: Record<Widget["state"], string> = {
  ok: "text-[var(--sidebar-icon-color)]",
  attention: "text-warning",
  off: "text-[var(--sidebar-icon-color)] opacity-50",
  error: "text-destructive",
};

function SidebarWidgetItem({
  nowSeconds,
  widget,
}: {
  readonly nowSeconds: number;
  readonly widget: Widget;
}) {
  const stale = isWidgetStale(widget, nowSeconds);
  const tooltip = widgetTooltipText(widget, stale);
  const label = widget.label;

  const button = (
    <SidebarMenuButton
      aria-label={tooltip}
      className={cn(
        WIDGET_STATE_CLASS[widget.state],
        stale && "opacity-40",
        // A labelled widget keeps the icon row's height but grows to fit its text.
        label !== undefined && "h-8 w-auto gap-1 px-1.5",
      )}
      size="icon"
    >
      <span className="relative grid size-4 shrink-0 place-items-center">
        <WidgetIcon icon={widget.icon} />
        {widget.state === "attention" ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-current ring-2 ring-sidebar-control-surface"
          />
        ) : null}
      </span>
      {label === undefined ? null : <span className="text-[11px] tabular-nums">{label}</span>}
    </SidebarMenuButton>
  );

  if (widget.rows.length === 0) {
    return (
      <SidebarMenuItem className="shrink-0">
        <Tooltip>
          <TooltipTrigger render={button} />
          <TooltipPopup side="top">{tooltip}</TooltipPopup>
        </Tooltip>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem className="shrink-0">
      <Popover>
        <Tooltip>
          <TooltipTrigger render={<PopoverTrigger render={button} />} />
          <TooltipPopup side="top">{tooltip}</TooltipPopup>
        </Tooltip>
        <PopoverPopup
          align="center"
          aria-label={tooltip}
          className="max-w-none shadow-xl shadow-black/25"
          side="top"
          tooltipStyle
        >
          <div className="flex w-fit min-w-40 max-w-[min(20rem,calc(100vw-2rem))] flex-col gap-1 py-1 text-left">
            {widget.rows.map((row) => (
              <div className="flex items-baseline justify-between gap-3" key={row.label}>
                <span className="min-w-0 truncate">{row.label}</span>
                {row.hint === undefined ? null : (
                  <span className="shrink-0 tabular-nums text-sidebar-muted-foreground">
                    {row.hint}
                  </span>
                )}
              </div>
            ))}
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}

/** The tray strip in the sidebar footer: one icon per widget the server is watching. */
export const SidebarWidgets = memo(function SidebarWidgets() {
  const snapshot = useWidgets();
  const nowMinute = useNowMinute();
  const widgets = snapshot?.widgets;
  const sorted = useMemo(() => (widgets ? sortWidgets(widgets) : []), [widgets]);

  if (sorted.length === 0) return null;

  const nowSeconds = widgetNowSeconds(nowMinute);
  return (
    <SidebarMenu className="flex-row items-center gap-0.5">
      {sorted.map((widget) => (
        <SidebarWidgetItem key={widget.id} nowSeconds={nowSeconds} widget={widget} />
      ))}
    </SidebarMenu>
  );
});
