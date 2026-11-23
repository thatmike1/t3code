import { useAtomValue } from "@effect/atom-react";
import { AudioLinesIcon, MinusIcon, MoveHorizontalIcon, PauseIcon, PlayIcon } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { shortcutLabelForCommand } from "~/keybindings";
import { observeResize } from "~/lib/observeResize";
import {
  resolveSayStripLayout,
  sayWords,
  SAY_STRIP_PLACEMENT_LABELS,
  type LayoutRect,
  type SayStripLayout,
  type SayStripPlacement,
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
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const STRIP_MAX_WIDTH = 340;
const STRIP_MIN_WIDTH = 200;
const FOLDED_SIZE = 28;
const OBSTACLE_SELECTOR =
  "[data-thread-details-card], [data-preview-mini-player], [data-thread-find-bar]";

/**
 * The strip's shortcuts, live while a server thread is open: play or pause,
 * fold, and move. They work with no summary too, so folding is never stuck.
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
        "voice.cycleSummaryPlacement": (event) => {
          event.preventDefault();
          const store = useSayStripStore.getState();
          if (store.collapsed) store.toggleCollapsed();
          store.cyclePlacement();
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
 * into and resolves where the strip goes. Re-measures on resizes, and on
 * timeline scrolls while it follows the latest reply.
 */
function useSayStripPlacement(input: {
  slot: HTMLElement;
  strip: HTMLElement | null;
  messageId: string;
  placement: SayStripPlacement;
  folded: boolean;
}): Placed | null {
  const { slot, strip, messageId, placement, folded } = input;
  const [placed, setPlaced] = useState<Placed | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures DOM geometry outside React (canvas, composer, timeline scroll, floating cards)
  useLayoutEffect(() => {
    const stack = slot.closest<HTMLElement>('[data-chat-composer-stack="true"]');
    const canvas = slot.closest<HTMLElement>("[data-chat-canvas]");
    if (!stack || !canvas) return;
    const scroller = canvas.querySelector<HTMLElement>(".messages-timeline-scroll");
    let frame = 0;

    const measure = () => {
      frame = 0;
      const origin = canvas.getBoundingClientRect();
      const stackRect = relativeRect(stack.getBoundingClientRect(), origin);
      // the stack runs past the composer card into the safe-area spacer; align to the card
      const shell = stack.querySelector<HTMLElement>('[data-slot="composer-shell"]');
      const composer = shell ? relativeRect(shell.getBoundingClientRect(), origin) : stackRect;
      const viewport = scroller
        ? relativeRect(scroller.getBoundingClientRect(), origin)
        : { top: 0, bottom: composer.top };
      const anchor = canvas.querySelector<HTMLElement>(
        `[data-say-anchor="${CSS.escape(messageId)}"]`,
      );
      const obstacles = [...canvas.querySelectorAll<HTMLElement>(OBSTACLE_SELECTOR)]
        .map((element) => relativeRect(element.getBoundingClientRect(), origin))
        .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
      const height = folded ? FOLDED_SIZE : (strip?.offsetHeight ?? 0);
      const layout = resolveSayStripLayout({
        // folded, the dock has no row of its own: it waits left of the composer
        placement: folded && placement === "above-composer" ? "left-composer" : placement,
        canvas: { width: origin.width, height: origin.height },
        composer,
        // the composer overlays the timeline's bottom, so the visible part ends at the composer
        viewport: { top: viewport.top, bottom: Math.min(viewport.bottom, composer.top) },
        replyEnd: anchor ? relativeRect(anchor.getBoundingClientRect(), origin) : null,
        obstacles,
        height,
        maxWidth: folded ? FOLDED_SIZE : STRIP_MAX_WIDTH,
        minWidth: folded ? FOLDED_SIZE : STRIP_MIN_WIDTH,
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
    if (scroller) observed.push(scroller);
    if (scroller?.firstElementChild) observed.push(scroller.firstElementChild);
    for (const element of canvas.querySelectorAll(OBSTACLE_SELECTOR)) observed.push(element);
    const stopObserving = observeResize(observed, schedule);
    const follows = placement === "right-reply";
    if (follows) scroller?.addEventListener("scroll", schedule, { passive: true });
    return () => {
      stopObserving();
      if (follows) scroller?.removeEventListener("scroll", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [slot, strip, messageId, placement, folded]);

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
 * The spoken summary of the newest reply, readable without hovering, with a
 * play control. It sits beside the chat lane where there is room, otherwise
 * above the composer, and folds down to a faint icon.
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
  const placement = useSayStripStore((state) => state.placement);
  const folded = useSayStripStore((state) => state.collapsed);
  const cyclePlacement = useSayStripStore((state) => state.cyclePlacement);
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
  const placed = useSayStripPlacement({ slot, strip, messageId, placement, folded });

  const active = status !== "idle";
  const playShortcut = shortcutLabelForCommand(keybindings, "voice.playPause");
  const foldShortcut = shortcutLabelForCommand(keybindings, "voice.toggleSummary");
  const moveShortcut = shortcutLabelForCommand(keybindings, "voice.cycleSummaryPlacement");
  const layout = placed?.layout ?? { kind: "dock" as const, fellBack: false };
  const playLabel =
    status === "playing" || status === "loading"
      ? "Pause"
      : status === "paused"
        ? "Resume"
        : "Play summary";

  const sideStyle: CSSProperties | undefined =
    layout.kind === "side" && placed !== null
      ? {
          position: "absolute",
          left: layout.left - placed.stackLeft,
          bottom: placed.stackBottom - layout.bottom,
          width: layout.width,
        }
      : undefined;

  // a round, borderless control of the strip's own, larger than the row buttons so it is easy to hit
  const playButton = (
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
              "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
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
  );

  if (folded) {
    const foldedStyle: CSSProperties | undefined = sideStyle;
    return createPortal(
      <div
        ref={setStrip}
        data-say-strip="folded"
        className={cn("pointer-events-auto", layout.kind === "dock" && "flex pb-1")}
        style={foldedStyle}
      >
        <Tooltip>
          <TooltipTrigger
            delay={0}
            render={
              <button
                aria-label="Show spoken summary"
                onClick={toggleCollapsed}
                type="button"
                className={cn(
                  "inline-flex size-7 cursor-pointer items-center justify-center rounded-md outline-none transition-[opacity,color,background-color] hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active ? "text-foreground opacity-100" : "text-muted-foreground opacity-35",
                )}
              />
            }
          >
            <AudioLinesIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side={layout.kind === "side" && layout.side === "right" ? "left" : "right"}>
            <ShortcutHint label="Show spoken summary" shortcut={foldShortcut} />
          </TooltipPopup>
        </Tooltip>
      </div>,
      slot,
    );
  }

  const controls = (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/say:opacity-100 group-hover/say:opacity-100 pointer-coarse:opacity-100">
      <Tooltip>
        <TooltipTrigger
          delay={0}
          render={
            <Button
              aria-label={`Move the summary. Now: ${SAY_STRIP_PLACEMENT_LABELS[placement]}`}
              onClick={cyclePlacement}
              size="xs"
              type="button"
              variant="ghost-muted"
              className={layout.kind === "side" ? "-ms-2" : undefined}
            />
          }
        >
          <MoveHorizontalIcon className="size-3.5" />
          {SAY_STRIP_PLACEMENT_LABELS[placement]}
        </TooltipTrigger>
        <TooltipPopup>
          <ShortcutHint
            label={
              layout.kind === "dock" && layout.fellBack
                ? "Next placement. No room for this one here, so it sits above the composer"
                : "Next placement"
            }
            shortcut={moveShortcut}
          />
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          delay={0}
          render={
            <Button
              aria-label="Fold the summary away"
              onClick={toggleCollapsed}
              size="icon-xs"
              type="button"
              variant="ghost-muted"
            />
          }
        >
          <MinusIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>
          <ShortcutHint label="Fold away" shortcut={foldShortcut} />
        </TooltipPopup>
      </Tooltip>
    </div>
  );

  return createPortal(
    <div
      ref={setStrip}
      data-say-strip={layout.kind === "side" ? layout.side : "dock"}
      data-say-strip-placement={placement}
      data-say-strip-state={status}
      className={cn(
        "group/say pointer-events-auto flex items-start gap-1.5 text-sm leading-relaxed",
        layout.kind === "dock" && "pb-2 ps-0.5",
        // quiet until it speaks; it brightens under the pointer so it reads easily
        active
          ? "text-muted-foreground"
          : "text-muted-foreground/75 transition-colors hover:text-muted-foreground",
      )}
      style={sideStyle}
    >
      {playButton}
      <div className="min-w-0 flex-1 pt-1.5">
        <SayWords
          words={words}
          spokenIndex={spokenIndex}
          active={active}
          onWord={(word) => playFromWord({ messageId, say }, word)}
        />
        {layout.kind === "side" ? (
          <div className="mt-0.5 flex h-6 items-center">{controls}</div>
        ) : null}
      </div>
      {layout.kind === "dock" ? (
        <div className="flex shrink-0 items-center pt-1">{controls}</div>
      ) : null}
    </div>,
    slot,
  );
});
