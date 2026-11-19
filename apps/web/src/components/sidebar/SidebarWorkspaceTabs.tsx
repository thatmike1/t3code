import { ALL_WORKSPACES } from "@t3tools/shared/threadWorkspaces";

import { cn } from "~/lib/utils";
import {
  setWorkspaceView,
  useThreadWorkspaces,
  useWorkspaceView,
} from "~/lib/threadWorkspacesState";

/**
 * fork: the workspace switcher. Self-contained, so it can move anywhere in
 * the sidebar; it renders nothing when the server has no thread workspaces.
 */
export function SidebarWorkspaceTabs(props: { className?: string }) {
  const snapshot = useThreadWorkspaces();
  const view = useWorkspaceView(snapshot);
  if (snapshot === null) return null;
  const tabs = [
    ...snapshot.workspaces.map((workspace) => ({ id: workspace.id, label: workspace.name })),
    { id: ALL_WORKSPACES, label: "All" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Workspace"
      data-testid="sidebar-workspace-tabs"
      className={cn("flex items-center gap-0.5", props.className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === view;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-workspace-id={tab.id}
            onClick={() => setWorkspaceView(tab.id)}
            className={cn(
              "h-7 min-w-0 flex-1 truncate rounded-md px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70",
              selected
                ? "bg-sidebar-row-active text-sidebar-foreground"
                : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
