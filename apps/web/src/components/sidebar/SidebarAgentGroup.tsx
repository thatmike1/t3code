import { BotIcon, ChevronDownIcon } from "lucide-react";
import type { DragEvent, ReactNode } from "react";

import { cn } from "~/lib/utils";

import { agentGroupLabel } from "./SidebarAgentThreads.logic";

// The group sits inside its host row's list item, so a file dragged over a
// nested row would otherwise also land on the host.
const stopDrag = (event: DragEvent) => event.stopPropagation();

/**
 * The threads an agent started from one thread, shown under that thread's
 * row: a count that collapses the list, then one compact row per thread.
 * `children` are the rows still visible, already rendered by the sidebar.
 */
export function SidebarAgentGroup(props: {
  hostKey: string;
  count: number;
  collapsed: boolean;
  onToggle: (hostKey: string) => void;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="sidebar-agent-group"
      data-agent-group={props.hostKey}
      className="ml-3.5 border-l border-sidebar-foreground/15 pb-0.5 pl-1"
      onDragEnter={stopDrag}
      onDragOver={stopDrag}
      onDragLeave={stopDrag}
      onDrop={stopDrag}
    >
      <button
        type="button"
        aria-expanded={!props.collapsed}
        data-testid="sidebar-agent-group-toggle"
        onClick={() => props.onToggle(props.hostKey)}
        className="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-left text-[11px] font-medium text-sidebar-muted-foreground/70 outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BotIcon aria-hidden className="size-3 shrink-0" />
        <span>{agentGroupLabel(props.count)}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "ml-auto size-3 shrink-0 transition-transform",
            !props.collapsed && "rotate-180",
          )}
        />
      </button>
      {props.children ? (
        <ul role="list" className="flex flex-col gap-px">
          {props.children}
        </ul>
      ) : null}
    </div>
  );
}
