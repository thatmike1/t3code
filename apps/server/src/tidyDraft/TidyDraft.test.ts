import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  buildLightTidyDraftQuestion,
  buildTidyDraftQuestion,
  isTidyCacheCold,
  parseTidyDraftAnswer,
  selectTidyExcerpt,
  TIDY_COLD_CACHE_AFTER_MS,
  tidyColdCacheAfterMs,
} from "./TidyDraft.ts";

describe("parseTidyDraftAnswer", () => {
  it("reads a bare JSON answer", () => {
    expect(
      parseTidyDraftAnswer(
        '{"draft":"1. one\\n2. two","asks":[{"ask":"Day plan","answered":false}]}',
      ),
    ).toEqual({ draft: "1. one\n2. two", asks: [{ ask: "Day plan", answered: false }] });
  });

  it("reads JSON inside a code fence with text around it", () => {
    const answer = 'Here it is:\n```json\n{"draft":" tidy ","asks":[]}\n```\nDone.';
    expect(parseTidyDraftAnswer(answer)).toEqual({ draft: "tidy", asks: [] });
  });

  it("drops malformed asks and treats a missing answered as unanswered", () => {
    const answer = JSON.stringify({
      draft: "x",
      asks: [
        { ask: "Go?" },
        { ask: "" },
        "nope",
        { answered: true },
        { ask: "Yes?", answered: true },
      ],
    });
    expect(parseTidyDraftAnswer(answer)?.asks).toEqual([
      { ask: "Go?", answered: false },
      { ask: "Yes?", answered: true },
    ]);
  });

  it("refuses an answer without a draft", () => {
    expect(parseTidyDraftAnswer("I can't do that.")).toBeNull();
    expect(parseTidyDraftAnswer('{"asks":[]}')).toBeNull();
    expect(parseTidyDraftAnswer('{"draft":"   "}')).toBeNull();
    expect(parseTidyDraftAnswer("{not json}")).toBeNull();
  });
});

describe("buildTidyDraftQuestion", () => {
  it("carries the draft verbatim inside its tags", () => {
    const draft = "so like [image] and ~/git/x <!-- say: hi -->";
    expect(buildTidyDraftQuestion(draft)).toContain(`<draft>\n${draft}\n</draft>`);
  });
});

describe("isTidyCacheCold", () => {
  const now = Date.parse("2026-11-27T12:00:00.000Z");
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const turn = (
    minutes: number,
    extra: { promptCacheExpiresAt?: string; status?: string } = {},
  ) => ({
    status: extra.status ?? "completed",
    completedAt: DateTime.makeUnsafe(minutesAgo(minutes)),
    tokenUsage: {
      updatedAt: minutesAgo(minutes),
      ...(extra.promptCacheExpiresAt === undefined
        ? {}
        : { promptCacheExpiresAt: extra.promptCacheExpiresAt }),
    },
  });
  const cold = (input: Partial<Parameters<typeof isTidyCacheCold>[0]>) =>
    isTidyCacheCold({
      runs: [],
      latestProviderTurn: undefined,
      nowMs: now,
      coldAfterMs: TIDY_COLD_CACHE_AFTER_MS,
      ...input,
    });

  it("calls a thread cold once its last request is older than the threshold", () => {
    expect(cold({ latestProviderTurn: turn(56) })).toBe(true);
    expect(cold({ latestProviderTurn: turn(54) })).toBe(false);
  });

  it("keeps a running thread warm however old its last usage is", () => {
    expect(cold({ latestProviderTurn: turn(90), runs: [{ status: "running" }] })).toBe(false);
    expect(cold({ latestProviderTurn: turn(90, { status: "running" }) })).toBe(false);
    expect(cold({ latestProviderTurn: turn(90), runs: [{ status: "rolled_back" }] })).toBe(true);
  });

  it("reads the later of the turn's end and its last usage", () => {
    expect(
      cold({
        latestProviderTurn: { ...turn(90), tokenUsage: { updatedAt: minutesAgo(10) } },
      }),
    ).toBe(false);
  });

  it("is cold early when the reported cache expiry has passed", () => {
    expect(cold({ latestProviderTurn: turn(10, { promptCacheExpiresAt: minutesAgo(5) }) })).toBe(
      true,
    );
    expect(cold({ latestProviderTurn: turn(10, { promptCacheExpiresAt: minutesAgo(-50) }) })).toBe(
      false,
    );
  });

  it("is not cold without a record of a request", () => {
    expect(cold({})).toBe(false);
    expect(
      cold({
        latestProviderTurn: { status: "completed", completedAt: null, tokenUsage: undefined },
      }),
    ).toBe(false);
  });

  it("takes the threshold from the environment when set", () => {
    expect(tidyColdCacheAfterMs({})).toBe(TIDY_COLD_CACHE_AFTER_MS);
    expect(tidyColdCacheAfterMs({ T3CODE_TIDY_COLD_AFTER_MS: "0" })).toBe(0);
    expect(tidyColdCacheAfterMs({ T3CODE_TIDY_COLD_AFTER_MS: "nope" })).toBe(
      TIDY_COLD_CACHE_AFTER_MS,
    );
    expect(cold({ latestProviderTurn: turn(1), coldAfterMs: 0 })).toBe(true);
  });
});

describe("selectTidyExcerpt", () => {
  const user = (text: string) => ({ role: "user" as const, text });
  const assistant = (text: string) => ({ role: "assistant" as const, text });

  it("keeps everything in order when it fits", () => {
    const messages = [user("a"), assistant("b"), user("c"), assistant("d <!-- say: go? -->")];
    expect(selectTidyExcerpt(messages, 100)).toEqual({ messages, truncated: false });
  });

  it("keeps the last reply whole even past the budget", () => {
    const reply = assistant("r".repeat(1_000));
    const excerpt = selectTidyExcerpt([user("older"), user("question"), reply], 2);
    expect(excerpt.messages.at(-1)).toEqual(reply);
    expect(excerpt.truncated).toBe(true);
  });

  it("fills the budget newest first and cuts the message that no longer fits from its start", () => {
    // 10 tokens is 40 characters.
    const excerpt = selectTidyExcerpt(
      [user("x".repeat(30)), assistant("y".repeat(30)), user("z".repeat(20)), assistant("last")],
      10,
    );
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.messages).toEqual([
      assistant(`[…] ${"y".repeat(20)}`),
      user("z".repeat(20)),
      assistant("last"),
    ]);
  });

  it("keeps messages after the last reply and drops empty ones", () => {
    const excerpt = selectTidyExcerpt(
      [user("q"), assistant("a"), user("  "), user("follow-up")],
      100,
    );
    expect(excerpt.messages).toEqual([user("q"), assistant("a"), user("follow-up")]);
  });

  it("has nothing to offer without an assistant reply", () => {
    expect(selectTidyExcerpt([user("hi")]).messages).toEqual([]);
  });
});

describe("buildLightTidyDraftQuestion", () => {
  it("writes the excerpt before the same rules and says it is partial", () => {
    const excerpt = {
      messages: [
        { role: "user" as const, text: "hi" },
        { role: "assistant" as const, text: "go? <!-- say: say go -->" },
      ],
      truncated: true,
    };
    const question = buildLightTidyDraftQuestion("yeah go", excerpt);
    expect(question).toContain("only its most recent part: older messages are left out");
    expect(question).toContain(
      '<conversation>\n<message role="user">\nhi\n</message>\n<message role="assistant">\ngo? <!-- say: say go -->\n</message>\n</conversation>',
    );
    const rules = buildTidyDraftQuestion("yeah go").split("\n\n").slice(1).join("\n\n");
    expect(question.endsWith(rules)).toBe(true);
  });
});
