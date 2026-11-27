import type { TidyDraftAsk } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/**
 * the composer's Tidy button asks the thread's own agent, as a side question, to rewrite a
 * dictated draft and to list what its last reply asked for. the question carries the whole
 * contract, because a side question sees the conversation but no T3 instructions.
 */
export function buildTidyDraftQuestion(draft: string): string {
  return `[Tidy request from T3 Code, not a message from the user. Answer it as a side question and do not continue the conversation.]

${tidyDraftInstructions(draft)}`;
}

/** the rewrite rules and the JSON contract, shared by the side question and the light question. */
function tidyDraftInstructions(draft: string): string {
  return `The user is about to reply to your last message. Below is their draft. They dictated it with speech-to-text, often in several passes, so it may ramble, repeat itself, restart sentences, carry filler words and contain misheard words.

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
 * ends at the tidy question. Past this age the tidy asks a fresh one-shot query instead. Claude
 * subscriptions cache for an hour; the margin covers the time a turn's last request took.
 */
export const TIDY_COLD_CACHE_AFTER_MS = 55 * 60_000;
/** Overrides TIDY_COLD_CACHE_AFTER_MS in milliseconds, so the light path can be tried without waiting. */
export const TIDY_COLD_CACHE_AFTER_ENV = "T3CODE_TIDY_COLD_AFTER_MS";
/** Earlier messages the light question carries besides the last reply, at about four characters a token. */
export const TIDY_EXCERPT_BUDGET_TOKENS = 20_000;
const CHARS_PER_TOKEN = 4;

export function tidyColdCacheAfterMs(environment: Readonly<Record<string, string | undefined>>) {
  const raw = environment[TIDY_COLD_CACHE_AFTER_ENV]?.trim();
  const value = raw === undefined || raw.length === 0 ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : TIDY_COLD_CACHE_AFTER_MS;
}

const ACTIVE_RUN_STATUSES = new Set(["preparing", "starting", "running"]);

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
  if (input.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))) return false;
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

export interface TidyExcerptMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

/**
 * The recent end of the conversation for the light question: the last assistant reply whole,
 * hidden comments included, and before it as many earlier messages, newest first, as fit the
 * budget. The message that no longer fits keeps its end, so the excerpt has no gaps. Returns the
 * messages in conversation order, and whether older ones were left out.
 */
export function selectTidyExcerpt(
  messages: ReadonlyArray<TidyExcerptMessage>,
  budgetTokens: number = TIDY_EXCERPT_BUDGET_TOKENS,
): { readonly messages: ReadonlyArray<TidyExcerptMessage>; readonly truncated: boolean } {
  const conversation = messages.filter((message) => message.text.trim().length > 0);
  const lastReply = conversation.findLastIndex((message) => message.role === "assistant");
  if (lastReply === -1) return { messages: [], truncated: conversation.length > 0 };
  let remaining = budgetTokens * CHARS_PER_TOKEN;
  const kept: Array<{ readonly index: number; readonly message: TidyExcerptMessage }> = [
    { index: lastReply, message: conversation[lastReply]! },
  ];
  let truncated = false;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (index === lastReply) continue;
    const message = conversation[index]!;
    if (message.text.length <= remaining) {
      kept.push({ index, message });
      remaining -= message.text.length;
      continue;
    }
    truncated = true;
    if (remaining > 0) {
      kept.push({
        index,
        message: { role: message.role, text: `[…] ${message.text.slice(-remaining)}` },
      });
    }
    break;
  }
  return {
    messages: kept
      .toSorted((left, right) => left.index - right.index)
      .map((entry) => entry.message),
    truncated,
  };
}

/**
 * The tidy question for a cold thread, asked as a fresh one-shot query: the same rules and JSON
 * contract, with the recent part of the conversation written into the prompt.
 */
export function buildLightTidyDraftQuestion(
  draft: string,
  excerpt: ReturnType<typeof selectTidyExcerpt>,
): string {
  const transcript = excerpt.messages
    .map((message) => `<message role="${message.role}">\n${message.text}\n</message>`)
    .join("\n");
  return `[Tidy request from T3 Code, not a message from the user.]

You are the assistant in the conversation below. You see only its most recent part${excerpt.truncated ? ": older messages are left out" : ""}. Its last assistant message is your last reply.

<conversation>
${transcript}
</conversation>

${tidyDraftInstructions(draft)}`;
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
