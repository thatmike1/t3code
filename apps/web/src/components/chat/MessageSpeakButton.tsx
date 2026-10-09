import { memo } from "react";
import { SquareIcon, Volume2Icon } from "lucide-react";

import { spokenText } from "~/lib/claudeVoice";
import { speak, stopSpeaking, useVoicePlayerStore } from "~/lib/claudeVoicePlayer";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Reads an assistant message aloud through the local speech service; a second click stops it. */
export const MessageSpeakButton = memo(function MessageSpeakButton({
  messageId,
  text,
}: {
  messageId: string;
  text: string;
}) {
  const status = useVoicePlayerStore((state) =>
    state.messageId === messageId ? state.status : "idle",
  );
  const active = status !== "idle";
  const label = active ? "Stop reading" : "Read aloud";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={active}
            onClick={() => {
              if (active) stopSpeaking();
              else speak(spokenText(text), { mode: "interrupt", messageId });
            }}
            type="button"
            size="xs"
            variant="ghost-muted"
          />
        }
      >
        {status === "loading" ? (
          <Spinner className="size-3" />
        ) : status === "playing" ? (
          <SquareIcon className="size-3 fill-current text-primary" />
        ) : (
          <Volume2Icon className="size-3" />
        )}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
});
