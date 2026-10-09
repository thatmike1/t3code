import { describe, expect, it, vi } from "vite-plus/test";

import type { LiveVoiceMessage } from "~/lib/claudeVoice";

vi.mock("~/lib/claudeVoicePlayer", () => ({ speak: vi.fn(), stopSpeaking: vi.fn() }));

const { liveVoiceMessagesFromTimeline } = await import("./useLiveVoice");

function message(id: string, role: string): LiveVoiceMessage {
  return {
    id,
    role,
    text: `Message ${id}.`,
    streaming: false,
    runId: "run-1",
    createdAt: "2026-10-12T12:00:00.000Z",
  };
}

describe("liveVoiceMessagesFromTimeline", () => {
  it("keeps only the thread's own projected assistant messages, in order", () => {
    const entries = [
      { kind: "message", message: message("user", "user"), projectedItem: { visibility: "local" } },
      { kind: "work" },
      {
        kind: "message",
        message: message("a", "assistant"),
        projectedItem: { visibility: "local" },
      },
      // inherited from the thread this one was forked from
      {
        kind: "message",
        message: message("inherited", "assistant"),
        projectedItem: { visibility: "inherited" },
      },
      // client-only note with no projected item, such as a feedback receipt
      { kind: "message", message: message("local-note", "assistant") },
      { kind: "event", projectedItem: { visibility: "local" } },
      {
        kind: "message",
        message: message("b", "assistant"),
        projectedItem: { visibility: "local" },
      },
    ];
    expect(liveVoiceMessagesFromTimeline(entries).map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});
