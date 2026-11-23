import { describe, expect, it } from "vite-plus/test";

import {
  parseWordTimings,
  resolveSayStripLayout,
  sayWords,
  wordIndexAt,
  wordStarts,
  type SayStripLayoutInput,
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

describe("resolveSayStripLayout", () => {
  // a 1760 px canvas with the lane at 335..1071 and the composer at the bottom
  const base: SayStripLayoutInput = {
    canvas: { width: 1760, height: 1080 },
    composer: { left: 335, right: 1071, top: 960, bottom: 1060 },
    obstacles: [],
    height: 90,
    maxWidth: 440,
    minWidth: 200,
  };

  it("hugs the lane on the left, level with the composer's bottom", () => {
    expect(resolveSayStripLayout(base)).toEqual({
      kind: "side",
      left: 335 - 24 - 295,
      width: 295,
      bottom: 1060,
    });
  });

  it("takes no more than its full width in a wide gutter", () => {
    const wide = { ...base, composer: { ...base.composer, left: 900, right: 1636 } };
    expect(resolveSayStripLayout(wide)).toEqual({
      kind: "side",
      left: 900 - 24 - 440,
      width: 440,
      bottom: 1060,
    });
  });

  it("docks above the composer when the gutter is too narrow", () => {
    const narrow = {
      ...base,
      canvas: { width: 900, height: 800 },
      composer: { ...base.composer, left: 80, right: 820 },
    };
    expect(resolveSayStripLayout(narrow)).toEqual({ kind: "dock" });
  });

  it("narrows to stay clear of a card at its height and docks when that leaves too little", () => {
    const card = { left: 0, right: 60, top: 980, bottom: 1040 };
    expect(resolveSayStripLayout({ ...base, obstacles: [card] })).toMatchObject({
      kind: "side",
      width: 335 - 24 - (60 + 24),
    });
    // above the strip: the card does not matter
    const high = { ...card, top: 100, bottom: 300 };
    expect(resolveSayStripLayout({ ...base, obstacles: [high] })).toMatchObject({ width: 295 });
    const wideCard = { ...card, right: 150 };
    expect(resolveSayStripLayout({ ...base, obstacles: [wideCard] })).toEqual({ kind: "dock" });
  });
});
