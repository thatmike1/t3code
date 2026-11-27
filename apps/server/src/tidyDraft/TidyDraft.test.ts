import { describe, expect, it } from "@effect/vitest";

import { buildTidyDraftQuestion, parseTidyDraftAnswer } from "./TidyDraft.ts";

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
