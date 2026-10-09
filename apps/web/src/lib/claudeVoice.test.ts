import { describe, expect, it } from "vite-plus/test";

import {
  advanceLiveVoice,
  chunkForSpeech,
  extractSay,
  LIVE_VOICE_FULL_TEXT_LIMIT,
  liveSpokenText,
  speakPreview,
  spokenText,
  stripSayComments,
  type LiveVoiceInput,
  type LiveVoiceMessage,
  type LiveVoiceTracker,
} from "./claudeVoice";

describe("extractSay", () => {
  it("returns the trimmed content of the say comment", () => {
    expect(extractSay("Done.\n\n<!-- say: All done, the tests pass. -->")).toBe(
      "All done, the tests pass.",
    );
  });

  it("returns the last say comment when there are several", () => {
    expect(extractSay("<!-- say: first -->\ntext\n<!--say:second\nline -->")).toBe("second\nline");
  });

  it("ignores other comments, empty say comments and unclosed ones", () => {
    expect(extractSay("<!-- note: hi --> text")).toBeNull();
    expect(extractSay("text <!-- say:   -->")).toBeNull();
    expect(extractSay("text <!-- say: still streaming")).toBeNull();
  });

  it("matches the marker case-insensitively", () => {
    expect(extractSay("<!-- Say: Hello -->")).toBe("Hello");
  });
});

describe("stripSayComments", () => {
  it("removes the say comment and the gap it leaves", () => {
    expect(stripSayComments("Done.\n\n<!-- say: All done. -->\n")).toBe("Done.");
  });

  it("removes a say comment still open at the end", () => {
    expect(stripSayComments("Done.\n\n<!-- say: All do")).toBe("Done.");
  });

  it("keeps other comments and leaves text without say comments untouched", () => {
    const text = "Keep <!-- other --> this.\n\n\n\nAnd spacing.  ";
    expect(stripSayComments(text)).toBe(text);
  });
});

describe("spokenText", () => {
  it("prefers the say part", () => {
    expect(spokenText("# Long report\n\nlots of detail\n\n<!-- say: Short version. -->")).toBe(
      "Short version.",
    );
  });

  it("falls back to the text with every HTML comment removed", () => {
    expect(spokenText("Hello <!-- hidden --> world.\n<!-- open")).toBe("Hello  world.");
  });
});

describe("liveSpokenText", () => {
  it("reads short messages in full", () => {
    expect(liveSpokenText("First.\n\nSecond.")).toBe("First.\n\nSecond.");
  });

  it("reads only the first paragraph of a long message with no say part", () => {
    const text = `Intro paragraph.\n\n${"detail ".repeat(LIVE_VOICE_FULL_TEXT_LIMIT / 6)}`;
    expect(liveSpokenText(text)).toBe("Intro paragraph.");
  });

  it("skips a leading code block when picking the first paragraph", () => {
    const text = `\`\`\`ts\nconst x = 1;\n\`\`\`\n\nThe fix.\n\n${"more ".repeat(200)}`;
    expect(liveSpokenText(text)).toBe("The fix.");
  });

  it("reads the say part of a long message", () => {
    expect(liveSpokenText(`${"long ".repeat(300)}\n<!-- say: Summary. -->`)).toBe("Summary.");
  });
});

describe("chunkForSpeech", () => {
  it("keeps short text in one chunk", () => {
    expect(chunkForSpeech("Hello there. How are you?")).toEqual(["Hello there. How are you?"]);
  });

  it("splits on sentence boundaries within the size limits", () => {
    const sentence = "This sentence is about forty characters.";
    const chunks = chunkForSpeech(Array.from({ length: 30 }, () => sentence).join(" "), {
      maxChars: 120,
      firstChunkMaxChars: 50,
    });
    expect(chunks[0]).toBe(sentence);
    for (const chunk of chunks.slice(1)) {
      expect(chunk.length).toBeLessThanOrEqual(120);
      expect(chunk.endsWith(".")).toBe(true);
    }
    expect(chunks.join(" ")).toBe(Array.from({ length: 30 }, () => sentence).join(" "));
  });

  it("breaks a sentence longer than the limit at a comma or space", () => {
    const long = `${"word ".repeat(30).trim()}, ${"other ".repeat(30).trim()}.`;
    const chunks = chunkForSpeech(long, { maxChars: 160, firstChunkMaxChars: 160 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(160);
    expect(chunks[0]!.endsWith(",")).toBe(true);
  });

  it("treats line breaks as boundaries and drops fenced code and punctuation-only lines", () => {
    expect(
      chunkForSpeech("Title\n\n```sh\nrm -rf /tmp/x\n```\n\n---\n- item one\n- item two", {
        maxChars: 12,
        firstChunkMaxChars: 12,
      }),
    ).toEqual(["Title", "- item one", "- item two"]);
  });

  it("never returns an empty chunk", () => {
    expect(chunkForSpeech("")).toEqual([]);
    expect(chunkForSpeech("  \n\n ```\ncode\n```")).toEqual([]);
  });
});

describe("advanceLiveVoice", () => {
  const T0 = Date.parse("2026-10-09T12:00:00.000Z");
  const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

  function message(id: string, overrides: Partial<LiveVoiceMessage> = {}): LiveVoiceMessage {
    return {
      id,
      role: "assistant",
      text: `Message ${id}.`,
      streaming: false,
      turnId: "turn-1",
      createdAt: iso(-60_000),
      ...overrides,
    };
  }

  function step(
    tracker: LiveVoiceTracker | null,
    input: Partial<LiveVoiceInput> & Pick<LiveVoiceInput, "messages">,
  ) {
    const result = advanceLiveVoice(tracker, {
      threadKey: "env:thread-1",
      enabled: true,
      settledTurnId: null,
      now: T0,
      ...input,
    });
    return { tracker: result.tracker, spoken: result.toSpeak.map((entry) => entry.id) };
  }

  it("never replays history present when the toggle goes on", () => {
    const history = [message("a"), message("b", { createdAt: iso(-1000) })];
    const first = step(null, { messages: history });
    expect(first.spoken).toEqual([]);
    expect(step(first.tracker, { messages: history }).spoken).toEqual([]);
  });

  it("ignores a message that was already streaming when the toggle went on", () => {
    const streaming = message("a", { streaming: true, createdAt: iso(0) });
    const first = step(null, { messages: [streaming] });
    expect(step(first.tracker, { messages: [{ ...streaming, streaming: false }] }).spoken).toEqual(
      [],
    );
  });

  it("speaks a message when its streaming flag flips off, once", () => {
    let { tracker } = step(null, { messages: [] });
    ({ tracker } = step(tracker, { messages: [message("a", { streaming: true })] }));
    const done = [message("a", { streaming: false, text: "Finished." })];
    const finished = step(tracker, { messages: done });
    expect(finished.spoken).toEqual(["a"]);
    expect(step(finished.tracker, { messages: done }).spoken).toEqual([]);
  });

  it("speaks a new message that arrives already finished after the baseline", () => {
    const { tracker } = step(null, { messages: [] });
    expect(step(tracker, { messages: [message("a", { createdAt: iso(2000) })] }).spoken).toEqual([
      "a",
    ]);
  });

  it("ignores old messages that load after the baseline", () => {
    const { tracker } = step(null, { messages: [] });
    expect(
      step(tracker, { messages: [message("old-1"), message("old-2", { createdAt: iso(-30_000) })] })
        .spoken,
    ).toEqual([]);
  });

  it("only speaks assistant messages with something to say", () => {
    const { tracker } = step(null, { messages: [] });
    const messages = [
      message("user", { role: "user", createdAt: iso(1) }),
      message("think", { role: "reasoning", createdAt: iso(2) }),
      message("empty", { text: "<!-- nothing -->", createdAt: iso(3) }),
      message("real", { createdAt: iso(4) }),
    ];
    expect(step(tracker, { messages }).spoken).toEqual(["real"]);
  });

  it("speaks mid-turn commentary in order as each one finishes", () => {
    let { tracker } = step(null, { messages: [] });
    const a = message("a", { streaming: true, createdAt: iso(1) });
    ({ tracker } = step(tracker, { messages: [a] }));
    const b = message("b", { streaming: true, createdAt: iso(2) });
    const result = step(tracker, { messages: [{ ...a, streaming: false }, b] });
    expect(result.spoken).toEqual(["a"]);
    expect(
      step(result.tracker, {
        messages: [
          { ...a, streaming: false },
          { ...b, streaming: false },
        ],
      }).spoken,
    ).toEqual(["b"]);
  });

  it("treats a stuck streaming flag as done once a later assistant message arrives", () => {
    let { tracker } = step(null, { messages: [] });
    const stuck = message("a", { streaming: true, createdAt: iso(1) });
    ({ tracker } = step(tracker, { messages: [stuck] }));
    const next = message("b", { streaming: true, createdAt: iso(2) });
    expect(step(tracker, { messages: [stuck, next] }).spoken).toEqual(["a"]);
  });

  it("treats a stuck streaming flag as done once its own turn settles", () => {
    let { tracker } = step(null, { messages: [] });
    const stuck = message("a", { streaming: true, createdAt: iso(1), turnId: "turn-2" });
    ({ tracker } = step(tracker, { messages: [stuck] }));
    expect(step(tracker, { messages: [stuck], settledTurnId: "turn-1" }).spoken).toEqual([]);
    expect(step(tracker, { messages: [stuck], settledTurnId: "turn-2" }).spoken).toEqual(["a"]);
  });

  it("speaks nothing while off and re-baselines when switched back on", () => {
    let { tracker } = step(null, { messages: [], enabled: false });
    const msgs = [message("a", { createdAt: iso(1) })];
    const off = step(tracker, { messages: msgs, enabled: false });
    expect(off.spoken).toEqual([]);
    ({ tracker } = off);
    const on = step(tracker, { messages: msgs, enabled: true });
    expect(on.spoken).toEqual([]);
    const later = [...msgs, message("b", { createdAt: iso(5000) })];
    expect(step(on.tracker, { messages: later, now: T0 + 5000 }).spoken).toEqual(["b"]);
  });

  it("re-baselines on a thread switch", () => {
    const { tracker } = step(null, { messages: [] });
    const other = [message("x", { createdAt: iso(1) })];
    expect(step(tracker, { messages: other, threadKey: "env:thread-2" }).spoken).toEqual([]);
  });
});

describe("speakPreview", () => {
  it("previews the say part, which is exactly what gets spoken", () => {
    const text = "# Report\n\nDetails.\n\n<!-- say: Tests pass,\nall green. -->";
    expect(speakPreview(text)).toEqual({ kind: "say", text: "Tests pass,\nall green." });
    expect(speakPreview(text)).toEqual({ kind: "say", text: spokenText(text) });
  });

  it("notes the whole message is read when there is no say part", () => {
    expect(speakPreview("Just a reply. <!-- note: hidden -->")).toEqual({ kind: "whole-message" });
  });

  it("treats an empty or unclosed say comment as no say part", () => {
    expect(speakPreview("Reply <!-- say:   -->")).toEqual({ kind: "whole-message" });
    expect(speakPreview("Reply <!-- say: still streaming")).toEqual({ kind: "whole-message" });
  });
});
