import type { ScopedThreadRef } from "@t3tools/contracts";
import { AudioLinesIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { selectLiveVoiceEnabled, useLiveVoiceStore } from "~/liveVoiceStore";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Per-thread switch in the chat header that reads each finished assistant message aloud. */
export const LiveVoiceToggle = memo(function LiveVoiceToggle({
  threadRef,
}: {
  threadRef: ScopedThreadRef;
}) {
  const enabled = useLiveVoiceStore((state) =>
    selectLiveVoiceEnabled(state.byThreadKey, threadRef),
  );
  const setLiveVoice = useLiveVoiceStore((state) => state.setLiveVoice);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-label="Live voice"
            className="shrink-0"
            pressed={enabled}
            onPressedChange={(pressed) => setLiveVoice(threadRef, pressed)}
            size="xs"
            variant="ghost"
          />
        }
      >
        <AudioLinesIcon
          aria-hidden="true"
          className={cn("size-3.5", enabled ? "text-primary" : "text-muted-foreground")}
        />
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
