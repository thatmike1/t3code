import type { TidyDraftAsk } from "@t3tools/contracts";

/**
 * the composer's Tidy button asks the thread's own agent, as a side question, to rewrite a
 * dictated draft and to list what its last reply asked for. the question carries the whole
 * contract, because a side question sees the conversation but no T3 instructions.
 */
export function buildTidyDraftQuestion(draft: string): string {
  return `[Tidy request from T3 Code, not a message from the user. Answer it as a side question and do not continue the conversation.]

The user is about to reply to your last message. Below is their draft. They dictated it with speech-to-text, often in several passes, so it may ramble, repeat itself, restart sentences, carry filler words and contain misheard words.

Rewrite the draft so it is easy to read and nothing gets lost:
- It stays the user's message to you, in their voice: first person, their tone, their slang and swearing, their jokes. Do not make it formal or polite, and do not summarise it.
- Keep every point, question, decision, fact, feeling and aside they made. Cut only fillers, restarts and repeats of the same point.
- Fix words speech-to-text clearly misheard, using the conversation for what they meant (names, tools, projects). Do not guess beyond that.
- When the draft covers several topics, give each topic its own numbered point, in the order they raised them, and merge the parts of one topic that were dictated at different times. A draft with one topic stays plain paragraphs.
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
