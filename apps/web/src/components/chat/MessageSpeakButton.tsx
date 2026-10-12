import { memo } from "react";
import { SquareIcon, Volume2Icon } from "lucide-react";

import { speakPreview, spokenText } from "~/lib/claudeVoice";
import { speak, stopSpeaking, useVoicePlayerStore } from "~/lib/claudeVoicePlayer";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Reads an assistant message aloud through the local speech service; a second click stops it.
 * The tooltip previews what gets spoken: the say part in full, or a note that the whole message is read.
 */
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
  const preview = speakPreview(text);

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
      {/* a say part is a few sentences, so give it a wider column than the default label width */}
      <TooltipPopup className={preview.kind === "say" ? "max-w-96" : undefined}>
        <div className="flex flex-col gap-1 py-0.5">
          <p className="font-medium">{label}</p>
          {preview.kind === "say" ? (
            <>
              <p className="text-muted-foreground">Speaks this summary:</p>
              <p className="whitespace-pre-line text-pretty">{preview.text}</p>
            </>
          ) : (
            <p className="text-muted-foreground">
              No spoken summary, so the whole message is read.
            </p>
          )}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
});
