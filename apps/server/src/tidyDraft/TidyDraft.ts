import type { TidyDraftAsk } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { ACTIVE_RUN_STATUSES } from "../orchestration-v2/ThreadManagementService.ts";

const TIDY_WARM_UP_PREFIX = "[T3 Tidy: warming this thread's cache before a tidy.";
export const TIDY_WARM_UP_MESSAGE = `${TIDY_WARM_UP_PREFIX} Reply with only: ok. Do not use any tools or add anything else. The user's real message comes next.]`;

/**
 * the composer's Tidy button asks the thread's own agent, as a side question, to rewrite a
 * dictated draft and to list what its last reply asked for. the question carries the whole
 * contract, because a side question sees the conversation but no T3 instructions.
 */
export function buildTidyDraftQuestion(draft: string, skipWarmUp = false): string {
  const warmUpInstruction = skipWarmUp
    ? `If the conversation ends with one or more exchanges starting with "${TIDY_WARM_UP_PREFIX}", skip those messages and your replies to them. Your last reply means your last reply before those exchanges.\n\n`
    : "";
  return `[Tidy request from T3 Code, not a message from the user. Answer it as a side question and do not continue the conversation.]

${warmUpInstruction}The user is about to reply to your last message. Below is their draft. They dictated it with speech-to-text, often in several passes, so it may ramble, repeat itself, restart sentences, carry filler words and contain misheard words.

Rewrite the draft so it is easy to read and nothing gets lost:
- It stays the user's message to you, in their voice: first person, their tone, their slang and swearing, their jokes. Do not make it formal or polite, and do not summarise it.
- Keep every point, question, decision, fact, feeling and aside they made. Cut only fillers, restarts and repeats of the same point.
- Fix words speech-to-text clearly misheard, using the conversation for what they meant (names, tools, projects). Do not guess beyond that.
- When the draft covers several topics, give each topic its own point of a Markdown numbered list ("1. ", "2. "), in the order they raised them, with no blank line between points, and merge the parts of one topic that were dictated at different times. A draft with one topic stays plain paragraphs.
- When one point holds several separate parts (sub-questions, a list of items, steps), put them in a nested Markdown numbered list under that point, indented three spaces ("   1. ", "   2. "); the chat shows them as a, b, c, so the user can answer "2b". Keep a short point as one sentence.
- Do not answer the draft, add ideas, or add anything they did not say.
- Keep the draft's language. Keep everything that is not prose (paths, code, links, ids, placeholders such as [image]) exactly as written.

Then list what your last reply asked the user for: every question, decision, choice or confirmation it waited on, including any inside a hidden comment such as <!-- say: ... -->. For each, say whether the draft answers it. Name each ask in a few words, in the language of your reply. Leave the list empty when your last reply asked for nothing.

Answer with one JSON object and nothing else:
{"draft": "<the rewritten draft>", "asks": [{"ask": "<what you asked>", "answered": true}]}

The draft:
<draft>
${draft}
</draft>`;
}

/**
 * A thread whose prompt cache has expired would pay a full cache write of its whole conversation
 * for a side question, and its next real turn a second one, since the side question's cache entry
 * ends at the tidy question. A normal warm-up turn puts the cache breakpoint in shared history. Claude
 * subscriptions cache for an hour; the margin covers the time a turn's last request took.
 */
export const TIDY_COLD_CACHE_AFTER_MS = 55 * 60_000;
/** Overrides TIDY_COLD_CACHE_AFTER_MS in milliseconds, so the warm-up can be tried without waiting. */
export const TIDY_COLD_CACHE_AFTER_ENV = "T3CODE_TIDY_COLD_AFTER_MS";

export function tidyColdCacheAfterMs(environment: Readonly<Record<string, string | undefined>>) {
  const raw = environment[TIDY_COLD_CACHE_AFTER_ENV]?.trim();
  const value = raw === undefined || raw.length === 0 ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : TIDY_COLD_CACHE_AFTER_MS;
}

const activeRunStatuses = new Set<string>(ACTIVE_RUN_STATUSES);

/**
 * Whether the thread's prompt cache has most likely expired. A running turn keeps it warm; an
 * idle thread is cold once its last request is older than the threshold, or once the cache expiry
 * its last request reported has passed (a five-minute cache on API keys). Without any record of a
 * request it is not called cold, so the tidy keeps today's path.
 */
export function isTidyCacheCold(input: {
  readonly runs: ReadonlyArray<{ readonly status: string }>;
  readonly latestProviderTurn:
    | {
        readonly status: string;
        readonly completedAt: DateTime.Utc | null;
        readonly tokenUsage?:
          | { readonly updatedAt: string; readonly promptCacheExpiresAt?: string | undefined }
          | undefined;
      }
    | undefined;
  readonly nowMs: number;
  readonly coldAfterMs: number;
}): boolean {
  if (input.runs.some((run) => activeRunStatuses.has(run.status))) return false;
  const turn = input.latestProviderTurn;
  if (turn === undefined || turn.status === "running" || turn.status === "pending") return false;
  const usageAt =
    turn.tokenUsage === undefined ? Number.NaN : Date.parse(turn.tokenUsage.updatedAt);
  const lastRequestMs = Math.max(
    Number.isFinite(usageAt) ? usageAt : Number.NEGATIVE_INFINITY,
    turn.completedAt === null ? Number.NEGATIVE_INFINITY : DateTime.toEpochMillis(turn.completedAt),
  );
  if (!Number.isFinite(lastRequestMs)) return false;
  if (input.nowMs - lastRequestMs > input.coldAfterMs) return true;
  const expiresAt =
    turn.tokenUsage?.promptCacheExpiresAt === undefined
      ? Number.NaN
      : Date.parse(turn.tokenUsage.promptCacheExpiresAt);
  return Number.isFinite(expiresAt) && input.nowMs >= expiresAt;
}

export interface ParsedTidyDraft {
  readonly draft: string;
  readonly asks: ReadonlyArray<TidyDraftAsk>;
}

/** reads the agent's JSON answer, tolerating a code fence or a sentence around it. */
export function parseTidyDraftAnswer(answer: string): ParsedTidyDraft | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { draft, asks } = value as { draft?: unknown; asks?: unknown };
  if (typeof draft !== "string" || draft.trim().length === 0) return null;
  const parsedAsks: TidyDraftAsk[] = [];
  if (Array.isArray(asks)) {
    for (const entry of asks) {
      if (typeof entry !== "object" || entry === null) continue;
      const { ask, answered } = entry as { ask?: unknown; answered?: unknown };
      if (typeof ask !== "string" || ask.trim().length === 0) continue;
      parsedAsks.push({ ask: ask.trim(), answered: answered === true });
    }
  }
  return { draft: draft.trim(), asks: parsedAsks };
}
