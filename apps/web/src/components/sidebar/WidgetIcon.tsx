import type { WidgetIcon as WidgetIconName } from "@t3tools/contracts";
import {
  ActivityIcon,
  BellIcon,
  CircleIcon,
  ClockIcon,
  FolderIcon,
  ListChecksIcon,
  MicIcon,
  ServerIcon,
  TerminalIcon,
  ZapIcon,
} from "lucide-react";

/** Renders the lucide glyph a widget asked for; the contract's icon list maps 1:1 to these. */
export function WidgetIcon({
  icon,
  className = "size-4",
}: {
  icon: WidgetIconName;
  className?: string;
}) {
  if (icon === "terminal") return <TerminalIcon className={className} />;
  if (icon === "mic") return <MicIcon className={className} />;
  if (icon === "activity") return <ActivityIcon className={className} />;
  if (icon === "list-checks") return <ListChecksIcon className={className} />;
  if (icon === "bell") return <BellIcon className={className} />;
  if (icon === "server") return <ServerIcon className={className} />;
  if (icon === "clock") return <ClockIcon className={className} />;
  if (icon === "zap") return <ZapIcon className={className} />;
  if (icon === "folder") return <FolderIcon className={className} />;
  return <CircleIcon className={className} />;
}
