import { describe, expect, it, vi } from "vite-plus/test";

import { createVoicePlayer, type VoicePlayerState } from "./claudeVoicePlayer";

interface PendingPlay {
  readonly text: string;
  readonly end: () => void;
}

/** Fakes the service and the audio element: clips resolve at once, playback ends when the test says. */
function harness(options: { failText?: string } = {}) {
  const fetched: string[] = [];
  const plays: PendingPlay[] = [];
  const states: VoicePlayerState[] = [];
  const errors: unknown[] = [];
  const player = createVoicePlayer({
    fetchClip: async (text, signal) => {
      fetched.push(text);
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      if (text === options.failText) throw new Error("Speech service answered 500");
      return new Blob([text]);
    },
    playClip: (clip, signal) =>
      new Promise<void>((resolve) => {
        void clip.text().then((text) => {
          plays.push({ text, end: resolve });
        });
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    setState: (state) => states.push(state),
    onError: (error) => errors.push(error),
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { player, fetched, plays, states, errors, flush };
}

const LONG = Array.from(
  { length: 12 },
  (_, index) => `Sentence number ${index + 1} is long enough to fill a chunk on its own here.`,
).join(" ");

describe("createVoicePlayer", () => {
  it("prefetches the next chunk while the current one plays", async () => {
    const { player, fetched, plays, flush } = harness();
    player.speak(LONG, { mode: "interrupt", messageId: "m1" });
    await flush();
    expect(plays).toHaveLength(1);
    expect(fetched).toHaveLength(2);
    plays[0]!.end();
    await flush();
    expect(plays).toHaveLength(2);
    expect(fetched).toHaveLength(3);
  });

  it("reports loading, playing and idle for the message being read", async () => {
    const { player, plays, states, flush } = harness();
    player.speak("One short sentence.", { mode: "interrupt", messageId: "m1" });
    await flush();
    expect(states).toEqual([
      { status: "loading", messageId: "m1" },
      { status: "playing", messageId: "m1" },
    ]);
    plays[0]!.end();
    await flush();
    expect(states.at(-1)).toEqual({ status: "idle", messageId: null });
  });

  it("queues behind the current text in queue mode", async () => {
    const { player, plays, flush } = harness();
    player.speak("First message.", { mode: "queue", messageId: "a" });
    player.speak("Second message.", { mode: "queue", messageId: "b" });
    await flush();
    expect(plays.map((play) => play.text)).toEqual(["First message."]);
    plays[0]!.end();
    await flush();
    expect(plays.map((play) => play.text)).toEqual(["First message.", "Second message."]);
  });

  it("drops what is playing and queued in interrupt mode", async () => {
    const { player, plays, flush } = harness();
    player.speak("First message.", { mode: "queue", messageId: "a" });
    player.speak("Queued message.", { mode: "queue", messageId: "b" });
    await flush();
    player.speak("Urgent message.", { mode: "interrupt", messageId: "c" });
    await flush();
    expect(plays.map((play) => play.text)).toEqual(["First message.", "Urgent message."]);
  });

  it("stop silences playback and clears the queue", async () => {
    const { player, plays, states, flush } = harness();
    player.speak(LONG, { mode: "queue", messageId: "a" });
    player.speak("Later.", { mode: "queue", messageId: "b" });
    await flush();
    player.stop();
    await flush();
    expect(plays).toHaveLength(1);
    expect(states.at(-1)).toEqual({ status: "idle", messageId: null });
  });

  it("reports a service failure once per text and carries on with the queue", async () => {
    const { player, plays, errors, states, flush } = harness({ failText: "Broken." });
    player.speak("Broken.", { mode: "queue", messageId: "a" });
    player.speak("Fine.", { mode: "queue", messageId: "b" });
    await flush();
    expect(errors).toHaveLength(1);
    expect(plays.map((play) => play.text)).toEqual(["Fine."]);
    plays[0]!.end();
    await flush();
    expect(states.at(-1)).toEqual({ status: "idle", messageId: null });
  });

  it("does nothing for text with nothing to say", async () => {
    const setState = vi.fn();
    const player = createVoicePlayer({
      fetchClip: vi.fn(),
      playClip: vi.fn(),
      setState,
      onError: vi.fn(),
    });
    player.speak("  \n```\ncode\n```", { mode: "interrupt" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setState).not.toHaveBeenCalled();
  });
});
