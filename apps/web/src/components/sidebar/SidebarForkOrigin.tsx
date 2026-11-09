import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { GitForkIcon } from "lucide-react";
import { memo, useState, type MouseEvent as ReactMouseEvent } from "react";

import { useArchivedThreadSnapshots } from "~/lib/archivedThreadsState";
import { cn } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";

import { resolveSidebarForkParent, sidebarForkOriginLabel } from "../Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const NO_ENVIRONMENTS: ReadonlyArray<EnvironmentId> = [];

/**
 * Fork glyph on a forked thread's row: the tooltip names the parent, a click opens it.
 * The archived snapshot loads on first hover or focus, not at mount; archived and
 * deleted parents cannot be opened, so the glyph stays a label for them.
 */
export const SidebarForkOrigin = memo(function SidebarForkOrigin(props: {
  readonly environmentId: EnvironmentId;
  readonly parentThreadId: ThreadId;
  readonly onOpenParent: (threadRef: ScopedThreadRef) => void;
}) {
  const { environmentId, parentThreadId, onOpenParent } = props;
  const parentRef = scopeThreadRef(environmentId, parentThreadId);
  const liveParent = useThreadShell(parentRef);
  const [archiveRequested, setArchiveRequested] = useState(false);
  const archivedEnvironmentIds =
    archiveRequested && liveParent === null ? [environmentId] : NO_ENVIRONMENTS;
  const archived = useArchivedThreadSnapshots(archivedEnvironmentIds);
  const archivedParents =
    archived.snapshots.find((entry) => entry.environmentId === environmentId)?.snapshot.threads ??
    null;
  const parent = resolveSidebarForkParent({ liveParent, archivedParents, parentThreadId });
  const label = sidebarForkOriginLabel(parent);
  // Unresolved means the archive was never checked (a tap with no hover or
  // focus first); the click still tries and the route handles a missing thread.
  const canOpen = parent.kind === "open" || parent.kind === "unresolved";

  const handleOpenChange = (open: boolean) => {
    if (open) setArchiveRequested(true);
  };
  const handleClick = (event: ReactMouseEvent) => {
    // the glyph sits inside the row: a click must not also open the fork.
    event.preventDefault();
    event.stopPropagation();
    if (!canOpen) return;
    onOpenParent(parentRef);
  };

  return (
    <Tooltip onOpenChange={handleOpenChange}>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-disabled={!canOpen || undefined}
            data-testid="sidebar-fork-origin"
            onClick={handleClick}
            className={cn(
              "inline-flex shrink-0 items-center rounded-sm text-muted-foreground/65 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              canOpen ? "cursor-pointer hover:text-foreground" : "cursor-default",
            )}
          />
        }
      >
        <GitForkIcon aria-hidden className="size-3 shrink-0" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
});
