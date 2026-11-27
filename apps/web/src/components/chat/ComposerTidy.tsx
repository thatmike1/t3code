import type { EnvironmentId, ThreadId, TidyDraftAsk } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { CheckIcon, CircleIcon, Undo2Icon, ListChecksIcon, XIcon } from "lucide-react";
import { useGT } from "gt-react";
import { useState, type PointerEvent } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
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
  readonly dismiss: () => void;
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
  // Sending clears the draft, and the strip belongs to the draft it checked.
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

  return { running, result, run, undo, dismiss: () => setStored(null), addAsk };
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

export function ComposerTidyStrip(props: { tidy: ComposerTidy }) {
  const gt = useGT();
  const result = props.tidy.result;
  if (result === null) return null;
  const open = result.asks.filter((ask) => !ask.answered).length;
  return (
    <div
      data-chat-composer-tidy-strip="true"
      className="mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-border/70 bg-card/80 px-2.5 py-1.5 text-xs"
    >
      <span className="me-1 font-medium text-foreground">
        {result.asks.length === 0
          ? gt("Tidied. The last reply asked for nothing.")
          : open === 0
            ? gt("Tidied. Your draft answers everything the last reply asked.")
            : gt("Tidied. {open} of {total} asks still open:", {
                open,
                total: result.asks.length,
              })}
      </span>
      {result.asks.map((ask) => (
        <button
          key={ask.ask}
          type="button"
          disabled={ask.answered}
          onPointerDown={keepFocus}
          onClick={() => props.tidy.addAsk(ask.ask)}
          aria-label={
            ask.answered
              ? gt("Answered: {ask}", { ask: ask.ask })
              : gt("Open, add a line for it: {ask}", { ask: ask.ask })
          }
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5",
            ask.answered
              ? "border-transparent text-muted-foreground"
              : "border-warning/50 bg-warning-surface text-foreground hover:bg-warning/20",
          )}
        >
          {ask.answered ? (
            <CheckIcon className="size-3 shrink-0" />
          ) : (
            <CircleIcon className="size-3 shrink-0" />
          )}
          <span className="truncate">{ask.ask}</span>
        </button>
      ))}
      <span className="ms-auto flex items-center gap-0.5">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onPointerDown={keepFocus}
          onClick={props.tidy.undo}
        >
          <Undo2Icon className="size-3" />
          {gt("Undo")}
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Close")}
          onPointerDown={keepFocus}
          onClick={props.tidy.dismiss}
        >
          <XIcon className="size-3" />
        </Button>
      </span>
    </div>
  );
}
