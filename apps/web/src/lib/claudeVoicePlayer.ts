/**
 * One global player for the local speech service: plays a text as a queue of
 * sentence chunks, fetching the next clip while the current one plays.
 * Failures never reach the UI as exceptions; they surface as one throttled toast.
 */

import { create } from "zustand";

import { toastManager } from "~/components/ui/toast";
import { chunkForSpeech } from "./claudeVoice";

export const VOICE_SERVICE_URL = "http://127.0.0.1:1357";

export type VoiceStatus = "idle" | "loading" | "playing";

export interface VoicePlayerState {
  readonly status: VoiceStatus;
  /** The message being read, or null for text that has no message. */
  readonly messageId: string | null;
}

export type SpeakMode = "interrupt" | "queue";

export interface SpeakOptions {
  readonly mode: SpeakMode;
  readonly messageId?: string | null;
}

export interface VoicePlayerDeps {
  /** Fetches one rendered clip; rejects on network or service errors. */
  readonly fetchClip: (text: string, signal: AbortSignal) => Promise<Blob>;
  /** Plays a clip and resolves when it ends or the signal aborts. */
  readonly playClip: (clip: Blob, signal: AbortSignal) => Promise<void>;
  readonly setState: (state: VoicePlayerState) => void;
  readonly onError: (error: unknown) => void;
}

export interface VoicePlayer {
  speak: (text: string, options: SpeakOptions) => void;
  stop: () => void;
}

interface SpeechJob {
  readonly chunks: ReadonlyArray<string>;
  readonly messageId: string | null;
}

const IDLE: VoicePlayerState = { status: "idle", messageId: null };

export function createVoicePlayer(deps: VoicePlayerDeps): VoicePlayer {
  let queue: SpeechJob[] = [];
  let running = false;
  let currentController: AbortController | null = null;

  const abortCurrent = () => {
    currentController?.abort();
    currentController = null;
  };

  async function playJob(job: SpeechJob, signal: AbortSignal) {
    const fetchChunk = (index: number) => {
      const pending = deps.fetchClip(job.chunks[index]!, signal);
      // a prefetch may fail while the previous clip still plays; it is awaited below
      pending.catch(() => undefined);
      return pending;
    };
    let next = fetchChunk(0);
    for (let index = 0; index < job.chunks.length; index += 1) {
      deps.setState({ status: "loading", messageId: job.messageId });
      const clip = await next;
      if (signal.aborted) return;
      if (index + 1 < job.chunks.length) next = fetchChunk(index + 1);
      deps.setState({ status: "playing", messageId: job.messageId });
      await deps.playClip(clip, signal);
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
      deps.setState(IDLE);
    }
  }

  return {
    speak(text, options) {
      const chunks = chunkForSpeech(text);
      if (chunks.length === 0) return;
      const job: SpeechJob = { chunks, messageId: options.messageId ?? null };
      if (options.mode === "interrupt") {
        queue = [job];
        abortCurrent();
      } else {
        queue.push(job);
      }
      if (!running) void run();
    },
    stop() {
      queue = [];
      abortCurrent();
      deps.setState(IDLE);
    },
  };
}

// --- browser wiring -------------------------------------------------------

export const useVoicePlayerStore = create<VoicePlayerState>(() => IDLE);

async function fetchClipFromService(text: string, signal: AbortSignal): Promise<Blob> {
  // text/plain keeps this a simple CORS request: no preflight to the loopback service
  const response = await fetch(`${VOICE_SERVICE_URL}/speak`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok) throw new Error(`Speech service answered ${response.status}`);
  return response.blob();
}

function playClipInAudioElement(clip: Blob, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const url = URL.createObjectURL(clip);
  const audio = new Audio(url);
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      signal.removeEventListener("abort", onAbort);
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      URL.revokeObjectURL(url);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onAbort = () => finish();
    signal.addEventListener("abort", onAbort, { once: true });
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("Could not play the speech clip"));
    audio.play().catch((error: unknown) => finish(error));
  });
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
