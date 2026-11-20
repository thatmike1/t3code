import { describe, expect, it } from "vite-plus/test";

import {
  nextSayStripPlacement,
  parseWordTimings,
  resolveSayStripLayout,
  sayWords,
  SAY_STRIP_PLACEMENTS,
  wordIndexAt,
  wordStarts,
  type SayStripLayoutInput,
  type SayStripPlacement,
} from "./sayStrip.logic";
import { chunkForSpeech } from "./claudeVoice";

describe("sayWords", () => {
  it("shows exactly the words the player sends, across chunks", () => {
    const say = Array.from({ length: 8 }, (_, index) => `Sentence ${index} says a few words.`).join(
      "\n",
    );
    const chunks = chunkForSpeech(say);
    expect(chunks.length).toBeGreaterThan(1);
    expect(sayWords(say)).toEqual(chunks.join(" ").split(" "));
  });
});

describe("parseWordTimings", () => {
  it("reads the header the speech service sends", () => {
    expect(parseWordTimings("[[0.08,0.16],[0.21,0.48]]")).toEqual([
      [0.08, 0.16],
      [0.21, 0.48],
    ]);
  });

  it.each([null, "", "[]", "not json", "[[1]]", '[["a","b"]]', "{}"])("ignores %s", (header) => {
    expect(parseWordTimings(header)).toBeNull();
  });
});

describe("wordStarts", () => {
  const words = ["The", "strip", "is", "built."];

  it("takes the service's starts when it timed every word", () => {
    const timings = [
      [0.1, 0.2],
      [0.25, 0.5],
      [0.55, 0.65],
      [0.7, 1.2],
    ] as const;
    expect(wordStarts(words, timings, 2)).toEqual([0.1, 0.25, 0.55, 0.7]);
  });

  it("spreads the service's timings in order when the word counts differ", () => {
    const starts = wordStarts(
      words,
      [
        [0, 0.1],
        [1, 1.1],
      ],
      2,
    );
    expect(starts).toEqual([0, 0, 1, 1]);
  });

  it("estimates from word length without timings, starting at zero and in order", () => {
    const starts = wordStarts(["Hi,", "a", "longerword", "end."], null, 4);
    expect(starts[0]).toBe(0);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index]!).toBeGreaterThan(starts[index - 1]!);
    }
    expect(starts.at(-1)!).toBeLessThan(4);
    // the long word takes more time than the one-letter word before it
    expect(starts[3]! - starts[2]!).toBeGreaterThan(starts[2]! - starts[1]!);
  });

  it("never runs backwards when the service's starts do", () => {
    const starts = wordStarts(
      ["a", "b", "c"],
      [
        [0.5, 0.6],
        [0.4, 0.7],
        [0.9, 1],
      ],
      1,
    );
    expect(starts).toEqual([0.5, 0.5, 0.9]);
  });
});

describe("wordIndexAt", () => {
  const starts = [0.1, 0.4, 0.4, 0.9];
  it.each([
    [0, -1],
    [0.1, 0],
    [0.39, 0],
    [0.4, 2],
    [5, 3],
  ])("at %s s is word %s", (time, index) => {
    expect(wordIndexAt(starts, time)).toBe(index);
  });
});

describe("nextSayStripPlacement", () => {
  it("cycles through every placement and back", () => {
    let placement: SayStripPlacement = SAY_STRIP_PLACEMENTS[0];
    const seen: SayStripPlacement[] = [placement];
    for (let step = 1; step < SAY_STRIP_PLACEMENTS.length; step += 1) {
      placement = nextSayStripPlacement(placement);
      seen.push(placement);
    }
    expect(seen).toEqual([...SAY_STRIP_PLACEMENTS]);
    expect(nextSayStripPlacement(placement)).toBe(SAY_STRIP_PLACEMENTS[0]);
  });
});

describe("resolveSayStripLayout", () => {
  // a 1760 px canvas with the lane at 335..1071 and the composer at the bottom
  const base: SayStripLayoutInput = {
    placement: "left-composer",
    canvas: { width: 1760, height: 1080 },
    composer: { left: 335, right: 1071, top: 960, bottom: 1060 },
    viewport: { top: 0, bottom: 960 },
    replyEnd: { left: 335, right: 1071, top: 900, bottom: 920 },
    obstacles: [],
    height: 90,
    maxWidth: 340,
    minWidth: 200,
  };

  it("hugs the lane on the left, level with the composer's bottom", () => {
    expect(resolveSayStripLayout(base)).toEqual({
      kind: "side",
      side: "left",
      left: 335 - 24 - 295,
      width: 295,
      bottom: 1060,
    });
  });

  it("takes its full width on the right", () => {
    expect(resolveSayStripLayout({ ...base, placement: "right-composer" })).toEqual({
      kind: "side",
      side: "right",
      left: 1071 + 24,
      width: 340,
      bottom: 1060,
    });
  });

  it("docks above the composer when the gutter is too narrow", () => {
    const narrow = {
      ...base,
      canvas: { width: 900, height: 800 },
      composer: { ...base.composer, left: 80, right: 820 },
    };
    for (const placement of ["left-composer", "right-composer", "right-reply"] as const) {
      expect(resolveSayStripLayout({ ...narrow, placement })).toEqual({
        kind: "dock",
        fellBack: true,
      });
    }
    expect(resolveSayStripLayout({ ...narrow, placement: "above-composer" })).toEqual({
      kind: "dock",
      fellBack: false,
    });
  });

  it("follows the latest reply's end, clamped inside the visible timeline", () => {
    const reply = { ...base, placement: "right-reply" as const };
    expect(resolveSayStripLayout(reply)).toMatchObject({ bottom: 920 });
    // reply scrolled above the viewport: pinned under the top edge
    expect(
      resolveSayStripLayout({
        ...reply,
        replyEnd: { left: 335, right: 1071, top: -400, bottom: -380 },
      }),
    ).toMatchObject({ bottom: 8 + 90 });
    // reply not rendered by the list: it is below, so sit at the bottom of the timeline
    expect(resolveSayStripLayout({ ...reply, replyEnd: null })).toMatchObject({ bottom: 960 });
    // never lower than the composer's bottom
    expect(
      resolveSayStripLayout({
        ...reply,
        replyEnd: { left: 335, right: 1071, top: 1100, bottom: 1200 },
      }),
    ).toMatchObject({ bottom: 1060 });
  });

  it("narrows to stay clear of a card at its height and docks when that leaves too little", () => {
    const card = { left: 1400, right: 1750, top: 40, bottom: 300 };
    const reply = { ...base, placement: "right-reply" as const, obstacles: [card] };
    // level with the card: squeezed between the lane and the card
    expect(
      resolveSayStripLayout({
        ...reply,
        replyEnd: { left: 335, right: 1071, top: 200, bottom: 220 },
      }),
    ).toMatchObject({ kind: "side", left: 1095, width: 1400 - 24 - 1095 });
    // below the card: the card does not matter
    expect(resolveSayStripLayout(reply)).toMatchObject({ kind: "side", width: 340 });
    const wideCard = { ...card, left: 1150 };
    expect(
      resolveSayStripLayout({
        ...reply,
        obstacles: [wideCard],
        replyEnd: { left: 335, right: 1071, top: 200, bottom: 220 },
      }),
    ).toEqual({ kind: "dock", fellBack: true });
  });
});
