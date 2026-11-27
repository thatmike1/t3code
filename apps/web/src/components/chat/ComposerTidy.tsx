import type { EnvironmentId, ThreadId, TidyDraftAsk } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { CheckIcon, CircleIcon, ListChecksIcon, Undo2Icon } from "lucide-react";
import { useGT } from "gt-react";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Tidy: the thread's own agent rewrites a long dictated draft in the user's voice and lists what
 * its last reply asked for, so the user can see which asks the draft still leaves open.
 */
interface TidyResult {
  readonly previous: string;
  readonly tidied: string;
  readonly asks: ReadonlyArray<TidyDraftAsk>;
}

export interface ComposerTidy {
  readonly running: boolean;
  readonly result: TidyResult | null;
  readonly run: () => void;
  readonly undo: () => void;
  readonly addAsk: (ask: string) => void;
}

export function useComposerTidy(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly prompt: string;
  readonly readPrompt: () => string;
  /** Replaces the whole draft when it still reads `expected`; false when the user changed it. */
  readonly replacePrompt: (next: string, expected: string) => boolean;
}): ComposerTidy {
  const gt = useGT();
  const tidyDraft = useOrchestrationCommand(threadEnvironment.tidyDraft, { reportFailure: false });
  // Both are keyed by thread, so switching threads hides the other thread's work.
  const [runningFor, setRunningFor] = useState<ThreadId | null>(null);
  const [stored, setStored] = useState<(TidyResult & { readonly threadId: ThreadId }) | null>(null);
  // Reads the thread on screen when the reply lands, not the one the click saw.
  const isOnThread = useStableCallback((threadId: ThreadId) => input.threadId === threadId);
  const running = runningFor !== null && runningFor === input.threadId;
  // Sending clears the draft, and the asks belong to the draft they checked.
  const result =
    stored !== null && stored.threadId === input.threadId && input.prompt.trim().length > 0
      ? stored
      : null;

  const run = () => {
    const threadId = input.threadId;
    const draft = input.readPrompt();
    if (running || threadId === null || draft.trim().length === 0) return;
    setRunningFor(threadId);
    void tidyDraft({ environmentId: input.environmentId, input: { threadId, draft } }).then(
      (outcome) => {
        setRunningFor((current) => (current === threadId ? null : current));
        // A reply that lands after the user moved to another thread belongs to the old one.
        if (!isOnThread(threadId)) return;
        if (outcome._tag !== "Success") {
          if (isAtomCommandInterrupted(outcome)) return;
          const error = squashAtomCommandFailure(outcome);
          toastManager.add({
            type: "error",
            title: gt("Tidy failed"),
            description: error instanceof Error ? error.message : gt("Try again."),
          });
          return;
        }
        if (!input.replacePrompt(outcome.value.draft, draft)) {
          toastManager.add({
            type: "info",
            title: gt("Draft changed while tidying"),
            description: gt("Your edits are kept. Press Tidy again to tidy the new draft."),
          });
          return;
        }
        setStored({
          threadId,
          previous: draft,
          tidied: outcome.value.draft,
          asks: outcome.value.asks,
        });
      },
    );
  };

  const undo = () => {
    if (result === null) return;
    if (!input.replacePrompt(result.previous, result.tidied)) {
      toastManager.add({
        type: "info",
        title: gt("Nothing to undo"),
        description: gt("The draft changed after tidying, so it stays as it is."),
      });
    }
    setStored(null);
  };

  const addAsk = (ask: string) => {
    const current = input.readPrompt();
    const separator = current.trim().length === 0 ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    input.replacePrompt(`${current}${separator}${ask}: `, current);
  };

  return { running, result, run, undo, addAsk };
}

const keepFocus = (event: PointerEvent) => event.preventDefault();

export function ComposerTidyButton(props: { tidy: ComposerTidy; disabled: boolean }) {
  const gt = useGT();
  const label = props.tidy.running ? gt("Tidying the draft…") : gt("Tidy draft");
  return (
    <Tooltip>
      <TooltipTrigger
        delay={300}
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            aria-busy={props.tidy.running}
            disabled={props.disabled || props.tidy.running}
            onPointerDown={keepFocus}
            onClick={props.tidy.run}
            className="shrink-0"
          />
        }
      >
        {props.tidy.running ? <Spinner className="size-4" /> : <ListChecksIcon />}
      </TooltipTrigger>
      <TooltipPopup className="max-w-72">
        <div className="flex flex-col gap-1 py-0.5">
          <p className="font-medium">{label}</p>
          <p className="text-muted-foreground">
            {gt(
              "The thread's agent rewrites your draft in your words and checks which of its questions the draft answers.",
            )}
          </p>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

const CLOSE_DELAY_MS = 140;

/**
 * The asks of the last reply, tucked behind the composer as a shoulder tab. Render it inside a
 * positioned `ComposerBanner.Dock`: the open stack spans the dock's width. Hovering or clicking
 * it slides the asks out as a stack of cards; it never discards them, so the list stays reachable
 * until the tidied draft is sent or cleared.
 */
export function ComposerTidyAsks(props: { tidy: ComposerTidy }) {
  const gt = useGT();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const tabRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const result = props.tidy.result;
  const expanded = result !== null && (pinned || hovered);

  // A pinned stack closes on a click elsewhere or Escape, like a menu.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document listeners held while the stack is pinned
  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (tabRef.current?.contains(target) || stackRef.current?.contains(target)) return;
      setPinned(false);
      setHovered(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pinned]);

  if (result === null) return null;
  const total = result.asks.length;
  const open = result.asks.filter((ask) => !ask.answered).length;

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    setHovered(true);
  };
  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setHovered(false), CLOSE_DELAY_MS);
  };

  const summary =
    total === 0
      ? gt("Tidied. The last reply asked for nothing.")
      : open === 0
        ? gt("Your draft answers everything the last reply asked.")
        : gt("{open} of {total} asks still open. Click one to add a line for it.", {
            open,
            total,
          });

  return (
    <>
      <ComposerBanner.Root
        density="comfortable"
        width="content"
        data-composer-shoulder-tab
        data-chat-composer-tidy-asks="true"
        data-expanded={expanded ? "true" : "false"}
        className="group/tidy-asks"
        ref={tabRef}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        {/* the cards peeking out behind the tab before the stack opens */}
        {total > 1 ? (
          <TidyPeekCard className="inset-x-2 -top-1 group-data-[expanded=true]/tidy-asks:translate-y-1" />
        ) : null}
        {total > 2 ? (
          <TidyPeekCard className="inset-x-4 -top-2 opacity-60 group-data-[expanded=true]/tidy-asks:translate-y-2" />
        ) : null}
        <ComposerBanner.Row
          render={<button type="button" />}
          aria-expanded={expanded}
          aria-label={summary}
          className={cn(
            "transition-colors duration-200",
            expanded ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          onPointerDown={keepFocus}
          onClick={() => {
            cancelClose();
            if (pinned) setHovered(false);
            setPinned(!pinned);
          }}
        >
          <ComposerBanner.Icon>
            <ListChecksIcon />
          </ComposerBanner.Icon>
          <ComposerBanner.Content>
            {total === 0
              ? gt("Tidied")
              : gt("Asks", { $context: "noun, what the agent asked for" })}
          </ComposerBanner.Content>
          {total > 0 ? (
            <ComposerBanner.Actions>
              <ComposerBanner.Count
                className={cn(open > 0 ? "text-warning-foreground" : "text-muted-foreground")}
              >
                {open > 0 ? gt("{open} open", { open }) : <CheckIcon className="size-3" />}
              </ComposerBanner.Count>
            </ComposerBanner.Actions>
          ) : null}
        </ComposerBanner.Row>
      </ComposerBanner.Root>
      <div
        ref={stackRef}
        inert={!expanded}
        aria-hidden={!expanded}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        className={cn(
          // Spans the dock, which the composer positions; bottom padding bridges the gap to the tab.
          "absolute inset-x-0 bottom-full z-10 flex flex-col gap-1 pb-1.5",
          // A frosted backing keeps the thread's text from showing between the cards.
          "before:absolute before:inset-x-0 before:top-0 before:bottom-1.5 before:-z-1 before:-m-1 before:rounded-2xl before:bg-background/75 before:backdrop-blur-md before:transition-opacity before:duration-200 motion-reduce:before:transition-none",
          expanded
            ? "pointer-events-auto before:opacity-100"
            : "pointer-events-none before:opacity-0",
        )}
      >
        <TidyStackCard index={0} count={total + 1} expanded={expanded}>
          <p className="min-w-0 flex-1 text-muted-foreground">{summary}</p>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="shrink-0"
            onPointerDown={keepFocus}
            onClick={props.tidy.undo}
          >
            <Undo2Icon className="size-3" />
            {gt("Undo tidy")}
          </Button>
        </TidyStackCard>
        {result.asks.map((ask, index) => (
          <TidyStackCard
            key={ask.ask}
            index={index + 1}
            count={total + 1}
            expanded={expanded}
            {...(ask.answered
              ? {}
              : {
                  onClick: () => props.tidy.addAsk(ask.ask),
                  label: gt("Open, add a line for it: {ask}", { ask: ask.ask }),
                })}
          >
            {ask.answered ? (
              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
            )}
            <span
              className={cn(
                "min-w-0 flex-1 text-start",
                ask.answered ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {ask.ask}
            </span>
            {ask.answered ? (
              <span className="shrink-0 text-muted-foreground">{gt("answered")}</span>
            ) : (
              <span className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/card:opacity-100">
                {gt("add a line")}
              </span>
            )}
          </TidyStackCard>
        ))}
      </div>
    </>
  );
}

const cardSurface =
  "rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-sm/5";

function TidyPeekCard(props: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-[-2] h-4 rounded-t-xl border border-b-0 border-(--chat-composer-attached-outline) bg-(--chat-composer-attached-surface)",
        "transition-[translate,opacity] duration-200 ease-out group-data-[expanded=true]/tidy-asks:opacity-0 motion-reduce:transition-none",
        props.className,
      )}
    />
  );
}

/**
 * One card of the open stack. Closed, the cards sit pressed down behind the tab; opening slides
 * them up one after another, nearest the composer first, and closing drops them back together.
 */
function TidyStackCard(props: {
  index: number;
  count: number;
  expanded: boolean;
  onClick?: () => void;
  label?: string;
  children: ReactNode;
}) {
  const fromBottom = props.count - 1 - props.index;
  const className = cn(
    cardSurface,
    "group/card flex w-full items-start gap-2 px-2.5 py-1.5 text-xs/4",
    "transition-[translate,opacity,scale] ease-drawer motion-reduce:transition-opacity",
    props.expanded
      ? "translate-y-0 scale-100 opacity-100 duration-300"
      : "translate-y-3 scale-[0.97] opacity-0 duration-150",
    props.onClick !== undefined &&
      "cursor-pointer hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
  );
  const style = { transitionDelay: props.expanded ? `${Math.min(fromBottom, 6) * 35}ms` : "0ms" };
  if (props.onClick === undefined) {
    return (
      <div className={className} style={style}>
        {props.children}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={props.label}
      className={className}
      style={style}
      onPointerDown={keepFocus}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
