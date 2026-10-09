import type { ScopedThreadRef } from "@t3tools/contracts";
import { AudioLinesIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { selectLiveVoiceEnabled, useLiveVoiceStore } from "~/liveVoiceStore";
import { MenuCheckboxItem } from "../ui/menu";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Per-thread switch that reads each finished assistant message aloud. */
export const LiveVoiceToggle = memo(function LiveVoiceToggle({
  threadRef,
  presentation = "toolbar",
}: {
  threadRef: ScopedThreadRef;
  presentation?: "toolbar" | "menu";
}) {
  const enabled = useLiveVoiceStore((state) =>
    selectLiveVoiceEnabled(state.byThreadKey, threadRef),
  );
  const setLiveVoice = useLiveVoiceStore((state) => state.setLiveVoice);

  if (presentation === "menu") {
    return (
      <MenuCheckboxItem
        variant="switch"
        checked={enabled}
        onCheckedChange={(checked) => setLiveVoice(threadRef, checked)}
      >
        <span className="inline-flex items-center gap-2">
          <AudioLinesIcon className={cn("size-4", enabled && "text-primary")} />
          Live voice
        </span>
      </MenuCheckboxItem>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-label="Live voice"
            pressed={enabled}
            onPressedChange={(pressed) => setLiveVoice(threadRef, pressed)}
            size="xs"
            variant="outline"
          />
        }
      >
        <AudioLinesIcon aria-hidden="true" className={cn("size-3.5", enabled && "text-primary")} />
        {enabled ? <span className="pe-0.5 text-primary text-xs">Live</span> : null}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {enabled
          ? "Live voice is on: finished replies in this thread are read aloud"
          : "Live voice: read finished replies in this thread aloud"}
      </TooltipPopup>
    </Tooltip>
  );
});
