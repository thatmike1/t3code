/**
 * One global player for the local speech service: plays a text as a queue of
 * sentence chunks, fetching the next clip while the current one plays.
 * Failures never reach the UI as exceptions; they surface as one throttled toast.
 */

import { create } from "zustand";

import { toastManager } from "~/components/ui/toast";
import { chunkForSpeech } from "./claudeVoice";
import {
  parseWordTimings,
  splitWords,
  wordIndexAt,
  wordStarts,
  type WordTimings,
} from "./sayStrip.logic";

const VOICE_SERVICE_URL = "http://127.0.0.1:1357";

export type VoiceStatus = "idle" | "loading" | "playing" | "paused";

export interface VoicePlayerState {
  readonly status: VoiceStatus;
  /** The message being read, or null for text that has no message. */
  readonly messageId: string | null;
}

/** Which word of the text being read is spoken now, counted across all its chunks. */
export interface VoiceProgress {
  readonly messageId: string | null;
  /** -1 until the first word starts. */
  readonly wordIndex: number;
}

export type SpeakMode = "interrupt" | "queue";

export interface SpeakOptions {
  readonly mode: SpeakMode;
  readonly messageId?: string | null;
  /** Starts reading at this word, counted across all chunks as {@link VoiceProgress} counts them. */
  readonly startWord?: number;
}

export interface SpeechClip {
  readonly audio: Blob;
  /** One [start, end] pair per word of the chunk when the service sent them. */
  readonly timings: WordTimings | null;
}

export interface ClipHooks {
  /** The clip starts playing at this word instead of its beginning. */
  readonly startWord: number;
  /** When each of the clip's words starts, once the audio knows its duration. */
  readonly wordStarts: (duration: number) => number[];
  readonly onWord: (index: number) => void;
}

export interface ClipPlayback {
  /** Settles when the clip ends or the signal aborts; rejects when it cannot play. */
  readonly ended: Promise<void>;
  readonly pause: () => void;
  readonly resume: () => void;
}

export interface VoicePlayerDeps {
  /** Fetches one rendered clip; rejects on network or service errors. */
  readonly fetchClip: (text: string, signal: AbortSignal) => Promise<SpeechClip>;
  readonly playClip: (clip: SpeechClip, signal: AbortSignal, hooks: ClipHooks) => ClipPlayback;
  readonly setState: (state: VoicePlayerState) => void;
  readonly setProgress?: (progress: VoiceProgress) => void;
  readonly onError: (error: unknown) => void;
}

export interface VoicePlayer {
  speak: (text: string, options: SpeakOptions) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

interface SpeechJob {
  readonly chunks: ReadonlyArray<string>;
  readonly messageId: string | null;
  readonly startWord: number;
}

// enough for a few replies, so clicking back to an earlier word replays without a new render
const CLIP_CACHE_SIZE = 24;

/** Which chunk holds the word, and its index inside that chunk; past the end clamps to the last word. */
export function locateWord(
  chunkWordCounts: ReadonlyArray<number>,
  word: number,
): { chunk: number; local: number; before: number } {
  let before = 0;
  for (let chunk = 0; chunk < chunkWordCounts.length; chunk += 1) {
    const count = chunkWordCounts[chunk]!;
    if (word < before + count) return { chunk, local: Math.max(0, word - before), before };
    before += count;
  }
  const last = chunkWordCounts.length - 1;
  if (last < 0) return { chunk: 0, local: 0, before: 0 };
  const lastCount = chunkWordCounts[last]!;
  return { chunk: last, local: Math.max(0, lastCount - 1), before: before - lastCount };
}

/** Resolves with the promise's value, or with null as soon as the signal aborts. */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

const IDLE: VoicePlayerState = { status: "idle", messageId: null };
const NO_PROGRESS: VoiceProgress = { messageId: null, wordIndex: -1 };

export function createVoicePlayer(deps: VoicePlayerDeps): VoicePlayer {
  let queue: SpeechJob[] = [];
  let running = false;
  let currentController: AbortController | null = null;
  let currentPlayback: ClipPlayback | null = null;
  let paused = false;
  // what the job is doing underneath a pause, restored on resume
  let activity: VoicePlayerState = IDLE;
  // renders outlive the job that asked for them, so a seek or replay reuses them
  const clips = new Map<string, Promise<SpeechClip>>();
  const neverAborted = new AbortController().signal;

  const clipFor = (text: string): Promise<SpeechClip> => {
    const cached = clips.get(text);
    if (cached) {
      clips.delete(text);
      clips.set(text, cached);
      return cached;
    }
    const pending = deps.fetchClip(text, neverAborted);
    clips.set(text, pending);
    pending.catch(() => {
      if (clips.get(text) === pending) clips.delete(text);
    });
    while (clips.size > CLIP_CACHE_SIZE) clips.delete(clips.keys().next().value!);
    return pending;
  };

  const publish = (state: VoicePlayerState) => {
    activity = state;
    deps.setState(paused && state.status !== "idle" ? { ...state, status: "paused" } : state);
  };
  const setProgress = (progress: VoiceProgress) => deps.setProgress?.(progress);

  const abortCurrent = () => {
    currentController?.abort();
    currentController = null;
    currentPlayback = null;
  };

  async function playJob(job: SpeechJob, signal: AbortSignal) {
    const fetchChunk = (index: number) => {
      const pending = clipFor(job.chunks[index]!);
      // a prefetch may fail while the previous clip still plays; it is awaited below
      pending.catch(() => undefined);
      return pending;
    };
    const chunkWords = job.chunks.map(splitWords);
    const start =
      job.startWord > 0
        ? locateWord(
            chunkWords.map((words) => words.length),
            job.startWord,
          )
        : { chunk: 0, local: 0, before: 0 };
    let next = fetchChunk(start.chunk);
    let wordOffset = start.before;
    // a seek lights its word at once instead of waiting for the clip
    setProgress({
      messageId: job.messageId,
      wordIndex: job.startWord > 0 ? start.before + start.local : -1,
    });
    for (let index = start.chunk; index < job.chunks.length; index += 1) {
      publish({ status: "loading", messageId: job.messageId });
      const clip = await unlessAborted(next, signal);
      if (clip === null || signal.aborted) return;
      if (index + 1 < job.chunks.length) next = fetchChunk(index + 1);
      const words = chunkWords[index]!;
      const offset = wordOffset;
      wordOffset += words.length;
      publish({ status: "playing", messageId: job.messageId });
      const playback = deps.playClip(clip, signal, {
        startWord: index === start.chunk ? start.local : 0,
        wordStarts: (duration) => wordStarts(words, clip.timings, duration),
        onWord: (word) => {
          if (signal.aborted) return;
          setProgress({ messageId: job.messageId, wordIndex: offset + Math.max(0, word) });
        },
      });
      currentPlayback = playback;
      if (paused) playback.pause();
      await playback.ended;
      if (currentPlayback === playback) currentPlayback = null;
      if (signal.aborted) return;
    }
  }

  async function run() {
    running = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift()!;
        const controller = new AbortController();
        currentController = controller;
        try {
          await playJob(job, controller.signal);
        } catch (error) {
          if (!controller.signal.aborted) deps.onError(error);
        }
        if (currentController === controller) currentController = null;
      }
    } finally {
      running = false;
      paused = false;
      publish(IDLE);
      setProgress(NO_PROGRESS);
    }
  }

  return {
    speak(text, options) {
      const chunks = chunkForSpeech(text);
      if (chunks.length === 0) return;
      const job: SpeechJob = {
        chunks,
        messageId: options.messageId ?? null,
        startWord: Math.max(0, Math.floor(options.startWord ?? 0)),
      };
      if (options.mode === "interrupt") {
        queue = [job];
        paused = false;
        abortCurrent();
      } else {
        queue.push(job);
      }
      if (!running) void run();
    },
    stop() {
      queue = [];
      paused = false;
      abortCurrent();
      publish(IDLE);
      setProgress(NO_PROGRESS);
    },
    pause() {
      if (!running || paused) return;
      paused = true;
      currentPlayback?.pause();
      publish(activity);
    },
    resume() {
      if (!paused) return;
      paused = false;
      currentPlayback?.resume();
      publish(activity);
    },
  };
}

export const useVoicePlayerStore = create<VoicePlayerState>(() => IDLE);
export const useVoiceProgressStore = create<VoiceProgress>(() => NO_PROGRESS);

async function fetchClipFromService(text: string, signal: AbortSignal): Promise<SpeechClip> {
  // text/plain keeps this a simple CORS request: no preflight to the loopback service
  const response = await fetch(`${VOICE_SERVICE_URL}/speak`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok) throw new Error(`Speech service answered ${response.status}`);
  return {
    audio: await response.blob(),
    timings: parseWordTimings(response.headers.get("X-Word-Timings")),
  };
}

function playClipInAudioElement(
  clip: SpeechClip,
  signal: AbortSignal,
  hooks: ClipHooks,
): ClipPlayback {
  if (signal.aborted) return { ended: Promise.resolve(), pause() {}, resume() {} };
  const url = URL.createObjectURL(clip.audio);
  const audio = new Audio(url);
  let starts: number[] | null = null;
  let reported = Number.NaN;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let holding = false;
  let fail: (error: unknown) => void = () => undefined;

  // one timeout to the next word boundary, re-read from the audio clock each time
  const tick = () => {
    clearTimeout(timer);
    if (starts === null || audio.paused) return;
    const now = audio.currentTime;
    const index = wordIndexAt(starts, now);
    if (index !== reported) {
      reported = index;
      hooks.onWord(index);
    }
    const nextStart = starts[index + 1];
    if (nextStart === undefined) return;
    timer = setTimeout(tick, Math.max(15, ((nextStart - now) * 1000) / (audio.playbackRate || 1)));
  };
  const start = () =>
    audio.play().catch((error: unknown) => {
      // pausing before playback began rejects the play request; that is not a failure
      if (!holding) fail(error);
    });

  const ended = new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      audio.onended = null;
      audio.onerror = null;
      audio.onplaying = null;
      audio.onpause = null;
      audio.onloadedmetadata = null;
      audio.pause();
      URL.revokeObjectURL(url);
      if (error === undefined) resolve();
      else reject(error);
    };
    fail = finish;
    const onAbort = () => finish();
    signal.addEventListener("abort", onAbort, { once: true });
    audio.onloadedmetadata = () => {
      starts = hooks.wordStarts(audio.duration);
      if (hooks.startWord > 0) {
        audio.currentTime = starts[hooks.startWord] ?? 0;
        // playback waits for the seek so the clip's opening words never sound
        if (!holding) void start();
      }
      tick();
    };
    audio.onplaying = tick;
    audio.onpause = () => clearTimeout(timer);
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("Could not play the speech clip"));
    if (hooks.startWord === 0) void start();
  });

  return {
    ended,
    pause() {
      holding = true;
      audio.pause();
    },
    resume() {
      holding = false;
      void start();
    },
  };
}

const ERROR_TOAST_INTERVAL_MS = 30_000;
let lastErrorToastAt = 0;

function reportVoiceError(error: unknown) {
  const now = Date.now();
  if (now - lastErrorToastAt < ERROR_TOAST_INTERVAL_MS) return;
  lastErrorToastAt = now;
  toastManager.add({
    type: "warning",
    title: "Voice is unavailable",
    description:
      error instanceof Error && error.message.startsWith("Speech service")
        ? error.message
        : `Could not reach the speech service on ${VOICE_SERVICE_URL}.`,
  });
}

const voicePlayer = createVoicePlayer({
  fetchClip: fetchClipFromService,
  playClip: playClipInAudioElement,
  setState: (state) => useVoicePlayerStore.setState(state, true),
  setProgress: (progress) => {
    const current = useVoiceProgressStore.getState();
    if (current.messageId === progress.messageId && current.wordIndex === progress.wordIndex)
      return;
    useVoiceProgressStore.setState(progress, true);
  },
  onError: reportVoiceError,
});

/** Reads text aloud; `interrupt` replaces anything playing, `queue` plays after it. */
export function speak(text: string, options: SpeakOptions): void {
  voicePlayer.speak(text, options);
}

/** Stops playback and drops everything queued. */
export function stopSpeaking(): void {
  voicePlayer.stop();
}

/** Holds playback where it is; {@link resumeSpeaking} carries on from the same word. */
export function pauseSpeaking(): void {
  voicePlayer.pause();
}

export function resumeSpeaking(): void {
  voicePlayer.resume();
}
