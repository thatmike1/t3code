/**
 * Pure side of the spoken summary strip: the words it shows, when each one is
 * spoken, and where the strip sits beside the chat lane.
 */

import { chunkForSpeech, extractSay } from "./claudeVoice";

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

/** The words the strip shows: exactly the words the player sends, chunk after chunk. */
export function sayWords(say: string): string[] {
  return chunkForSpeech(say).flatMap(splitWords);
}

export type WordTimings = ReadonlyArray<readonly [number, number]>;

/** Reads the speech service's `X-Word-Timings` header; null when absent or malformed. */
export function parseWordTimings(header: string | null): WordTimings | null {
  if (!header) return null;
  try {
    const parsed: unknown = JSON.parse(header);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const timings: Array<readonly [number, number]> = [];
    for (const pair of parsed) {
      if (!Array.isArray(pair) || pair.length !== 2) return null;
      const [start, end] = pair;
      if (typeof start !== "number" || typeof end !== "number") return null;
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      timings.push([start, end]);
    }
    return timings;
  } catch {
    return null;
  }
}

// the voice pauses after punctuation, so those words get extra weight in the estimate
function wordWeight(word: string): number {
  const base = word.length + 1;
  if (/[.!?…]["')\]]*$/.test(word)) return base + 6;
  if (/[,;:]["')\]]*$/.test(word)) return base + 3;
  return base;
}

/**
 * When each word of a clip starts, in seconds. Uses the service's timings
 * when it sent one per word, spreads them in order when the counts differ
 * (markdown the service stripped), and otherwise estimates from word length
 * across the clip's duration.
 */
export function wordStarts(
  words: ReadonlyArray<string>,
  timings: WordTimings | null,
  duration: number,
): number[] {
  if (words.length === 0) return [];
  if (timings !== null && timings.length > 0) {
    const starts = words.map((_, index) => {
      const source =
        timings.length === words.length
          ? index
          : Math.floor((index * timings.length) / words.length);
      return timings[source]![0];
    });
    return monotonic(starts);
  }
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const weights = words.map(wordWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsed = 0;
  return weights.map((weight) => {
    const start = (elapsed / total) * safeDuration;
    elapsed += weight;
    return start;
  });
}

function monotonic(starts: number[]): number[] {
  let floor = 0;
  return starts.map((start) => {
    floor = Math.max(floor, start);
    return floor;
  });
}

/** The word being spoken at `time`: the last one that has started, or -1 before the first. */
export function wordIndexAt(starts: ReadonlyArray<number>, time: number): number {
  let low = 0;
  let high = starts.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (starts[middle]! <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

export interface LayoutRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface SayStripLayoutInput {
  /** Everything below is in the same coordinates, the chat canvas's. */
  readonly canvas: { readonly width: number; readonly height: number };
  /** The composer card; its left side is the chat lane's left side. */
  readonly composer: LayoutRect;
  /** Floating things the strip must not cover, such as the thread details card. */
  readonly obstacles: ReadonlyArray<LayoutRect>;
  /** The strip's own rendered height, so it can be kept clear of obstacles. */
  readonly height: number;
  /** The width the strip wants beside the lane; it narrows down to `minWidth`. */
  readonly maxWidth: number;
  readonly minWidth: number;
}

export type SayStripLayout =
  | { readonly kind: "dock" }
  | {
      readonly kind: "side";
      readonly left: number;
      readonly width: number;
      /** The strip's bottom edge, level with the composer's. */
      readonly bottom: number;
    };

const SAY_STRIP_LANE_GAP = 24;
const CANVAS_EDGE = 16;

const overlapsVertically = (rect: LayoutRect, top: number, bottom: number) =>
  rect.top < bottom && rect.bottom > top;

/**
 * Where the strip goes: in the gutter left of the composer, level with its
 * bottom, when that gutter is at least `minWidth` wide clear of obstacles at
 * the strip's height; otherwise docked above the composer, which always fits.
 */
export function resolveSayStripLayout(input: SayStripLayoutInput): SayStripLayout {
  const { composer, canvas, height } = input;
  if (canvas.width <= 0 || composer.right <= composer.left) return { kind: "dock" };
  const bottom = composer.bottom;
  const top = bottom - height;
  let regionLeft = CANVAS_EDGE;
  const regionRight = composer.left - SAY_STRIP_LANE_GAP;
  for (const obstacle of input.obstacles) {
    if (!overlapsVertically(obstacle, top, bottom)) continue;
    if (obstacle.right > regionLeft && obstacle.left < regionRight) {
      regionLeft = Math.max(regionLeft, obstacle.right + SAY_STRIP_LANE_GAP);
    }
  }
  const width = Math.min(input.maxWidth, regionRight - regionLeft);
  if (width < input.minWidth) return { kind: "dock" };
  // the strip hugs the lane, so the eye travels the shortest way to it
  return { kind: "side", left: regionRight - width, width, bottom };
}

export interface SaySummary {
  readonly messageId: string;
  readonly say: string;
}

/** The newest finished assistant message that carries a say part. */
export function latestSaySummary(
  messages: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly streaming: boolean;
  }>,
): SaySummary | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.streaming) continue;
    const say = extractSay(message.text);
    if (say !== null) return { messageId: message.id, say };
  }
  return null;
}
