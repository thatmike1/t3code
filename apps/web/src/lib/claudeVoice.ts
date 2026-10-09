/**
 * Text side of the fork's voice feature: which part of an assistant message is
 * spoken, how it is split for the local speech service, and which messages the
 * per-thread live voice mode reads aloud.
 *
 * Claude ends the final reply of a turn with `<!-- say: ... -->`, a few
 * sentences written for the ear. That comment is invisible in the rendered
 * message and stripped from copies.
 */

const HTML_COMMENT_PATTERN = /<!--[\s\S]*?(?:-->|$)/g;
const SAY_COMMENT_PATTERN = /<!--\s*say:([\s\S]*?)-->/gi;
// a trailing say comment still being streamed has no closing marker yet
const OPEN_SAY_COMMENT_PATTERN = /<!--\s*say:[\s\S]*$/i;

/** Spoken text longer than this, with no say part, is cut to its first paragraph in live mode. */
export const LIVE_VOICE_FULL_TEXT_LIMIT = 600;

/** Upper bound for one request to the speech service; a short clip renders in about half a second. */
export const SPEECH_CHUNK_MAX_CHARS = 350;
/** The first chunk is kept shorter so audio starts quickly. */
export const SPEECH_FIRST_CHUNK_MAX_CHARS = 200;

/** Returns the content of the last `<!-- say: ... -->` comment, or null when there is none. */
export function extractSay(text: string): string | null {
  let last: string | null = null;
  for (const match of text.matchAll(SAY_COMMENT_PATTERN)) {
    const content = match[1]?.trim() ?? "";
    if (content.length > 0) last = content;
  }
  return last;
}

/** Removes every say comment, including one still open at the end of a streaming message. */
export function stripSayComments(text: string): string {
  const stripped = text.replace(SAY_COMMENT_PATTERN, "").replace(OPEN_SAY_COMMENT_PATTERN, "");
  return stripped === text ? text : stripped.replace(/\n{3,}/g, "\n\n").trimEnd();
}

function stripHtmlComments(text: string): string {
  return text.replace(HTML_COMMENT_PATTERN, "");
}

/** What the speak button reads: the say part when present, otherwise the text without HTML comments. */
export function spokenText(text: string): string {
  return extractSay(text) ?? stripHtmlComments(text).trim();
}

/** What the speak button's tooltip previews: the say part verbatim, or a note that the whole message is read. */
export type SpeakPreview = { kind: "say"; text: string } | { kind: "whole-message" };

/** Tooltip preview for the speak button, matching what {@link spokenText} reads. */
export function speakPreview(text: string): SpeakPreview {
  const say = extractSay(text);
  return say === null ? { kind: "whole-message" } : { kind: "say", text: say };
}

/**
 * What live mode reads for a finished message: the say part when present,
 * the whole text when it is short, otherwise only its first paragraph.
 */
export function liveSpokenText(text: string): string {
  const say = extractSay(text);
  if (say !== null) return say;
  const full = stripHtmlComments(text).trim();
  if (full.length <= LIVE_VOICE_FULL_TEXT_LIMIT) return full;
  return firstParagraph(full);
}

function firstParagraph(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim());
  return paragraphs.find((paragraph) => paragraph.length > 0 && !paragraph.startsWith("```")) ?? "";
}

/** Fenced code reads terribly aloud, and a fence split across chunks defeats the service's markdown stripping. */
function dropFencedCode(text: string): string {
  return text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, "");
}

function splitLongSentence(sentence: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const breakAt = Math.max(
      window.lastIndexOf(", "),
      window.lastIndexOf("; "),
      window.lastIndexOf(": "),
    );
    const cut = breakAt > maxChars / 3 ? breakAt + 1 : window.lastIndexOf(" ");
    const end = cut > 0 ? cut : maxChars;
    parts.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

/**
 * Splits text into sentence-aligned chunks for the speech service, so the first
 * clip comes back fast and later ones are fetched while earlier ones play.
 * Never returns an empty chunk (the service rejects empty text).
 */
export function chunkForSpeech(
  text: string,
  options: { maxChars?: number; firstChunkMaxChars?: number } = {},
): string[] {
  const maxChars = options.maxChars ?? SPEECH_CHUNK_MAX_CHARS;
  const firstChunkMaxChars = options.firstChunkMaxChars ?? SPEECH_FIRST_CHUNK_MAX_CHARS;
  const sentences = dropFencedCode(text)
    .split(/\n+/)
    .flatMap((line) => line.trim().split(/(?<=[.!?…])\s+(?=\S)/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence));

  const chunks: string[] = [];
  let current = "";
  const limit = () => (chunks.length === 0 ? firstChunkMaxChars : maxChars);
  const flush = () => {
    if (current.length > 0) chunks.push(current);
    current = "";
  };
  for (const sentence of sentences) {
    for (const piece of splitLongSentence(sentence, maxChars)) {
      const joined = current.length === 0 ? piece : `${current} ${piece}`;
      if (joined.length <= limit() || current.length === 0) {
        current = joined;
      } else {
        flush();
        current = piece;
      }
      if (current.length >= limit()) flush();
    }
  }
  flush();
  return chunks;
}

// --- live mode ------------------------------------------------------------

export interface LiveVoiceMessage {
  readonly id: string;
  readonly role: string;
  readonly text: string;
  readonly streaming: boolean;
  readonly turnId: string | null;
  readonly createdAt: string;
}

export interface LiveVoiceTracker {
  readonly threadKey: string | null;
  readonly enabled: boolean;
  /** When the current baseline was taken (thread mounted or toggle switched on), in ms. */
  readonly baselineAt: number;
  /** Ids that are never spoken again: history at baseline and messages already queued. */
  readonly settledIds: ReadonlySet<string>;
  /** Assistant messages seen streaming since the baseline. */
  readonly streamingIds: ReadonlySet<string>;
}

export interface LiveVoiceInput {
  readonly threadKey: string | null;
  readonly enabled: boolean;
  readonly messages: ReadonlyArray<LiveVoiceMessage>;
  /**
   * The thread's latest turn when it has completed, else null. A message of
   * that turn still flagged streaming is treated as done.
   */
  readonly settledTurnId: string | null;
  readonly now: number;
}

/**
 * Allowed clock difference between the server's message timestamps and this
 * client when deciding whether a message that arrives already finished is new.
 */
export const LIVE_VOICE_CLOCK_SLACK_MS = 10_000;

function baseline(input: LiveVoiceInput): LiveVoiceTracker {
  return {
    threadKey: input.threadKey,
    enabled: input.enabled,
    baselineAt: input.now,
    settledIds: new Set(input.messages.map((message) => message.id)),
    streamingIds: new Set(),
  };
}

/**
 * Advances the live voice tracker and returns the messages to queue, oldest
 * first. A message is spoken once, when it finishes streaming after the toggle
 * went on: its streaming flag flips off, it arrives already finished with a
 * timestamp after the baseline, or it is still flagged streaming but has been
 * superseded by a later assistant message or its turn has settled (providers
 * can leave the flag stuck). History present at the baseline is never spoken.
 */
export function advanceLiveVoice(
  previous: LiveVoiceTracker | null,
  input: LiveVoiceInput,
): { tracker: LiveVoiceTracker; toSpeak: LiveVoiceMessage[] } {
  if (
    previous === null ||
    previous.threadKey !== input.threadKey ||
    previous.enabled !== input.enabled ||
    !input.enabled
  ) {
    return { tracker: baseline(input), toSpeak: [] };
  }

  const settledIds = new Set(previous.settledIds);
  const streamingIds = new Set(previous.streamingIds);
  const toSpeak: LiveVoiceMessage[] = [];
  const assistantMessages = input.messages.filter((message) => message.role === "assistant");

  for (const [index, message] of assistantMessages.entries()) {
    if (settledIds.has(message.id)) continue;
    const superseded = index < assistantMessages.length - 1;
    const turnSettled = input.settledTurnId !== null && message.turnId === input.settledTurnId;
    const finished = !message.streaming || superseded || turnSettled;
    if (!finished) {
      streamingIds.add(message.id);
      continue;
    }
    const sawItStream = streamingIds.has(message.id);
    const createdAt = Date.parse(message.createdAt);
    const arrivedAfterBaseline =
      Number.isFinite(createdAt) && createdAt >= previous.baselineAt - LIVE_VOICE_CLOCK_SLACK_MS;
    settledIds.add(message.id);
    streamingIds.delete(message.id);
    if ((sawItStream || arrivedAfterBaseline) && liveSpokenText(message.text).length > 0) {
      toSpeak.push(message);
    }
  }

  return {
    tracker: { ...previous, settledIds, streamingIds },
    toSpeak,
  };
}
