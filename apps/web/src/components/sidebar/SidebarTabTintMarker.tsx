import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { tabFocusLabel } from "@t3tools/shared/tabFocus";
import { memo, useCallback, type MouseEvent as ReactMouseEvent } from "react";

import { focusTintedTab, TAB_TINT_HEX, useThreadTabTint } from "~/lib/tabTintState";
import { cn } from "~/lib/utils";

import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The colour the user gave, in Sidebery, to browser tabs this thread opened.
 * A quiet stripe on the leading edge of a sidebar row; it follows the
 * browser, so clearing the colour there clears it here. Clicking it brings
 * the browser forward on that tab. The stripe is 3 px, so the button around
 * it is a wider invisible strip and the stripe only thickens under the
 * pointer. It stays out of the tab order (the row is the keyboard target),
 * and only `click` is stopped: pointer-down still reaches the row for
 * dragging and a right click still opens the row's menu.
 *
 * Renders nothing when the thread has no tinted tab. The parent row must be
 * positioned, since the marker is absolutely placed against it.
 */
export const SidebarTabTintMarker = memo(function SidebarTabTintMarker(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** the row is dimmed as settled history; the stripe dims with it */
  readonly recede: boolean;
}) {
  const tabTint = useThreadTabTint(props.environmentId, props.threadId);
  const focusUrl = tabTint?.focusUrl ?? null;
  const handleClick = useCallback(
    (event: ReactMouseEvent) => {
      // the stripe sits inside the row: a click on it must not open the thread
      event.preventDefault();
      event.stopPropagation();
      if (focusUrl === null) return;
      void focusTintedTab(focusUrl)
        .then(
          (opened) => opened,
          () => false,
        )
        .then((opened) => {
          if (opened) return;
          toastManager.add({
            type: "error",
            title: "Could not show the tab",
            description: tabFocusLabel(focusUrl),
          });
        });
    },
    [focusUrl],
  );
  if (tabTint === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Show tab in browser: ${tabFocusLabel(tabTint.focusUrl)}`}
            data-testid={`sidebar-tab-tint-${props.threadId}`}
            data-tab-tint={tabTint.color}
            onClick={handleClick}
            className="group/tab-tint absolute inset-y-0 left-0 z-20 w-2.5 cursor-pointer outline-none"
          />
        }
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-2 left-0 w-[3px] rounded-r-full transition-[width,opacity] duration-100 group-hover/tab-tint:w-[5px] group-hover/tab-tint:opacity-100",
            props.recede && "opacity-60",
          )}
          style={{ backgroundColor: TAB_TINT_HEX[tabTint.color] }}
        />
      </TooltipTrigger>
      <TooltipPopup side="top">Show tab: {tabFocusLabel(tabTint.focusUrl)}</TooltipPopup>
    </Tooltip>
  );
});
