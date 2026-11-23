import { useAtomValue } from "@effect/atom-react";
import { ChevronDownIcon, ChevronUpIcon, PauseIcon, PlayIcon } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { shortcutLabelForCommand } from "~/keybindings";
import { observeResize } from "~/lib/observeResize";
import {
  resolveSayStripLayout,
  sayWords,
  type LayoutRect,
  type SayStripLayout,
} from "~/lib/sayStrip.logic";
import {
  pauseSpeaking,
  resumeSpeaking,
  speak,
  useVoicePlayerStore,
  useVoiceProgressStore,
} from "~/lib/claudeVoicePlayer";
import { cn } from "~/lib/utils";
import { useStableCallback } from "~/hooks/useStableCallback";
import { registerCommands } from "~/shortcuts/dispatcher";
import { useSayStripStore } from "~/sayStripStore";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const STRIP_MAX_WIDTH = 440;
const STRIP_MIN_WIDTH = 200;
const OBSTACLE_SELECTOR =
  "[data-thread-details-card], [data-preview-mini-player], [data-thread-find-bar]";

/**
 * The strip's shortcuts, live while a server thread is open: play or pause,
 * and fold. They work with no summary too, so folding is never stuck.
 */
export function useSayStripCommands(summary: { messageId: string; say: string } | null) {
  const playPause = useStableCallback(() => toggleSayPlayback(summary));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers keyboard commands with the app-global shortcut dispatcher
  useEffect(
    () =>
      registerCommands({
        "voice.playPause": (event) => {
          event.preventDefault();
          playPause();
        },
        "voice.toggleSummary": (event) => {
          event.preventDefault();
          useSayStripStore.getState().toggleCollapsed();
        },
      }),
    [playPause],
  );
}

/** Plays the strip's summary, or pauses and resumes whatever is reading right now. */
function toggleSayPlayback(summary: { messageId: string; say: string } | null) {
  const { status, messageId } = useVoicePlayerStore.getState();
  if (status === "paused") return resumeSpeaking();
  if (status !== "idle" && (summary === null || messageId === summary.messageId)) {
    return pauseSpeaking();
  }
  if (summary !== null) speak(summary.say, { mode: "interrupt", messageId: summary.messageId });
}

function relativeRect(rect: DOMRect, origin: DOMRect): LayoutRect {
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    right: rect.right - origin.left,
    bottom: rect.bottom - origin.top,
  };
}

interface Placed {
  readonly layout: SayStripLayout;
  /** The composer stack's left and bottom in canvas coordinates, to place a side strip inside it. */
  readonly stackLeft: number;
  readonly stackBottom: number;
}

/**
 * Measures the chat canvas around the composer stack the strip is portalled
 * into and resolves where the strip goes. Re-measures on resizes, the
 * strip's own included, so a fold settles into place as it animates.
 */
function useSayStripPlacement(input: {
  slot: HTMLElement;
  strip: HTMLElement | null;
}): Placed | null {
  const { slot, strip } = input;
  const [placed, setPlaced] = useState<Placed | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures DOM geometry outside React (canvas, composer, floating cards)
  useLayoutEffect(() => {
    const stack = slot.closest<HTMLElement>('[data-chat-composer-stack="true"]');
    const canvas = slot.closest<HTMLElement>("[data-chat-canvas]");
    if (!stack || !canvas) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const origin = canvas.getBoundingClientRect();
      const stackRect = relativeRect(stack.getBoundingClientRect(), origin);
      // the stack runs past the composer card into the safe-area spacer; align to the card
      const shell = stack.querySelector<HTMLElement>('[data-slot="composer-shell"]');
      const composer = shell ? relativeRect(shell.getBoundingClientRect(), origin) : stackRect;
      const obstacles = [...canvas.querySelectorAll<HTMLElement>(OBSTACLE_SELECTOR)]
        .map((element) => relativeRect(element.getBoundingClientRect(), origin))
        .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
      const layout = resolveSayStripLayout({
        canvas: { width: origin.width, height: origin.height },
        composer,
        obstacles,
        height: strip?.offsetHeight ?? 0,
        maxWidth: STRIP_MAX_WIDTH,
        minWidth: STRIP_MIN_WIDTH,
      });
      setPlaced((previous) => {
        const next = { layout, stackLeft: stackRect.left, stackBottom: stackRect.bottom };
        return previous !== null && JSON.stringify(previous) === JSON.stringify(next)
          ? previous
          : next;
      });
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    const observed: Element[] = [canvas, stack];
    if (strip) observed.push(strip);
    for (const element of canvas.querySelectorAll(OBSTACLE_SELECTOR)) observed.push(element);
    const stopObserving = observeResize(observed, schedule);
    return () => {
      stopObserving();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [slot, strip]);

  return placed;
}

/** Reads the summary from a word; a click that ends a text selection is left alone. */
function playFromWord(summary: { messageId: string; say: string }, word: number) {
  if (window.getSelection()?.isCollapsed === false) return;
  speak(summary.say, { mode: "interrupt", messageId: summary.messageId, startWord: word });
}

function SayWords({
  words,
  spokenIndex,
  active,
  onWord,
}: {
  words: string[];
  spokenIndex: number;
  active: boolean;
  onWord: (index: number) => void;
}) {
  return (
    <p className="text-pretty">
      {words.map((word, index) => (
        // words never reorder, so the index is the word's identity
        // oxlint-disable-next-line react/no-array-index-key
        <span key={index}>
          <span
            onClick={() => onWord(index)}
            className={cn(
              "cursor-pointer rounded-xs transition-colors duration-150 box-decoration-clone hover:bg-accent hover:text-foreground",
              !active
                ? undefined
                : index < spokenIndex
                  ? "text-foreground"
                  : index === spokenIndex
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground/70",
            )}
          >
            {word}
          </span>{" "}
        </span>
      ))}
    </p>
  );
}

function ShortcutHint({ label, shortcut }: { label: string; shortcut: string | null }) {
  return (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      {shortcut ? <kbd className="font-sans text-muted-foreground">{shortcut}</kbd> : null}
    </span>
  );
}

/**
 * The spoken summary of the newest reply, readable without hovering. A thin
 * row on top holds play and fold, the words run the strip's full width below.
 * It sits left of the composer where there is room, otherwise above it; folded,
 * only the faint row stays, so a summary can still be played without opening it.
 */
export const SayStrip = memo(function SayStrip({
  messageId,
  say,
  slot,
}: {
  messageId: string;
  say: string;
  /** The empty box at the top of the composer stack the strip renders into. */
  slot: HTMLElement;
}) {
  const folded = useSayStripStore((state) => state.collapsed);
  const toggleCollapsed = useSayStripStore((state) => state.toggleCollapsed);
  const status = useVoicePlayerStore((state) =>
    state.messageId === messageId ? state.status : "idle",
  );
  const spokenIndex = useVoiceProgressStore((state) =>
    state.messageId === messageId ? state.wordIndex : -1,
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const words = sayWords(say);
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const placed = useSayStripPlacement({ slot, strip });

  const active = status !== "idle";
  const playShortcut = shortcutLabelForCommand(keybindings, "voice.playPause");
  const foldShortcut = shortcutLabelForCommand(keybindings, "voice.toggleSummary");
  const layout = placed?.layout ?? { kind: "dock" as const };
  const playLabel =
    status === "playing" || status === "loading"
      ? "Pause"
      : status === "paused"
        ? "Resume"
        : "Play summary";
  const foldLabel = folded ? "Show spoken summary" : "Fold away";

  const sideStyle: CSSProperties | undefined =
    layout.kind === "side" && placed !== null
      ? {
          position: "absolute",
          left: layout.left - placed.stackLeft,
          bottom: placed.stackBottom - layout.bottom,
          width: layout.width,
        }
      : undefined;

  return createPortal(
    <div
      ref={setStrip}
      data-say-strip={layout.kind === "side" ? "left" : "dock"}
      data-say-strip-state={status}
      data-say-strip-folded={folded}
      className={cn(
        "group/say pointer-events-auto flex flex-col text-sm leading-relaxed",
        layout.kind === "dock" && (folded ? "pb-1" : "pb-2"),
        // quiet until it speaks; it brightens under the pointer so it reads easily
        active
          ? "text-muted-foreground"
          : "text-muted-foreground/75 transition-colors hover:text-muted-foreground",
      )}
      style={sideStyle}
    >
      <div
        className={cn(
          "-ms-1.5 flex items-center gap-1 transition-opacity duration-200",
          // folded and silent, the row is a faint mark until the pointer finds it
          folded &&
            !active &&
            "opacity-40 group-hover/say:opacity-100 group-focus-within/say:opacity-100",
        )}
      >
        <Tooltip>
          <TooltipTrigger
            delay={0}
            render={
              <button
                aria-label={playLabel}
                aria-pressed={status === "playing"}
                onClick={() => toggleSayPlayback({ messageId, say })}
                type="button"
                className={cn(
                  "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active ? "bg-accent/60 text-foreground" : "text-muted-foreground",
                )}
              />
            }
          >
            {status === "loading" ? (
              <Spinner className="size-4" />
            ) : status === "playing" ? (
              <PauseIcon className="size-4 fill-current" />
            ) : (
              <PlayIcon className="size-4 translate-x-px fill-current" />
            )}
          </TooltipTrigger>
          <TooltipPopup>
            <ShortcutHint label={playLabel} shortcut={playShortcut} />
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            delay={0}
            render={
              <button
                aria-label={foldLabel}
                aria-expanded={!folded}
                onClick={toggleCollapsed}
                type="button"
                className={cn(
                  "ms-auto inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-[opacity,color,background-color] hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:opacity-100",
                  // open, the fold control waits for the pointer; folded, it is the way back
                  !folded && "opacity-0 group-hover/say:opacity-100",
                )}
              />
            }
          >
            {folded ? (
              <ChevronUpIcon className="size-3.5" />
            ) : (
              <ChevronDownIcon className="size-3.5" />
            )}
          </TooltipTrigger>
          <TooltipPopup>
            <ShortcutHint label={foldLabel} shortcut={foldShortcut} />
          </TooltipPopup>
        </Tooltip>
      </div>
      {/* rows from 1fr to 0fr fold the words to nothing; bottom-anchored, the play row settles into the corner */}
      <div
        aria-hidden={folded}
        inert={folded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          folded ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <SayWords
            words={words}
            spokenIndex={spokenIndex}
            active={active}
            onWord={(word) => playFromWord({ messageId, say }, word)}
          />
        </div>
      </div>
    </div>,
    slot,
  );
});
