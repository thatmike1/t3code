import { describe, expect, it } from "vite-plus/test";

import {
  type ClassifyCandidate,
  emptyStore,
  FIRST_MESSAGE_SETTLE_MS,
  isDueForAutoTag,
  isDueForBackfill,
  parseStore,
  recordAttempt,
  setManualTags,
  setProjectDefaults,
} from "./threadWorkspacesStore.ts";

const SINCE = "2026-11-19T10:00:00.000Z";
const NOW_MS = Date.parse("2026-11-19T12:00:00.000Z");
const store = emptyStore(SINCE);
const candidate: ClassifyCandidate = {
  threadId: "t1",
  projectId: "p1",
  parentThreadId: null,
  createdAt: "2026-11-19T11:00:00.000Z",
  userMessageCount: 1,
  firstUserMessageAt: "2026-11-19T11:00:01.000Z",
};

describe("isDueForAutoTag", () => {
  it("asks about a new thread once its first message has settled", () => {
    expect(FIRST_MESSAGE_SETTLE_MS).toBe(15_000);
    expect(isDueForAutoTag(store, candidate, NOW_MS)).toBe(true);
    const fresh = { ...candidate, firstUserMessageAt: "2026-11-19T11:59:59.000Z" };
    expect(isDueForAutoTag(store, fresh, NOW_MS)).toBe(false);
    const settled = {
      ...candidate,
      firstUserMessageAt: "2026-11-19T11:59:45.000Z",
    };
    expect(isDueForAutoTag(store, settled, NOW_MS)).toBe(true);
  });

  it("never asks about a thread without a user message", () => {
    expect(isDueForAutoTag(store, { ...candidate, firstUserMessageAt: null }, NOW_MS)).toBe(false);
  });

  it("leaves threads from before the feature to the Settings button", () => {
    const old = { ...candidate, createdAt: "2026-11-18T00:00:00.000Z" };
    expect(isDueForAutoTag(store, old, NOW_MS)).toBe(false);
    expect(isDueForBackfill(store, old)).toBe(true);
  });

  it("never asks when a manual tag exists", () => {
    expect(isDueForAutoTag(setManualTags(store, ["t1"], "life"), candidate, NOW_MS)).toBe(false);
  });

  it("never asks when the project has a default", () => {
    expect(isDueForAutoTag(setProjectDefaults(store, ["p1"], "work"), candidate, NOW_MS)).toBe(
      false,
    );
  });

  it("never asks about a child thread, which inherits its parent's workspace", () => {
    expect(isDueForAutoTag(store, { ...candidate, parentThreadId: "t0" }, NOW_MS)).toBe(false);
  });

  it("stops after a confident answer", () => {
    const tagged = recordAttempt(store, "t1", "work", SINCE);
    expect(isDueForAutoTag(tagged, { ...candidate, userMessageCount: 5 }, NOW_MS)).toBe(false);
  });

  it("retries an unsure answer once, from the third user message", () => {
    const unsure = recordAttempt(store, "t1", null, SINCE);
    expect(isDueForAutoTag(unsure, { ...candidate, userMessageCount: 2 }, NOW_MS)).toBe(false);
    expect(isDueForAutoTag(unsure, { ...candidate, userMessageCount: 3 }, NOW_MS)).toBe(true);
    const twice = recordAttempt(unsure, "t1", null, SINCE);
    expect(isDueForAutoTag(twice, { ...candidate, userMessageCount: 9 }, NOW_MS)).toBe(false);
  });

  it("asks again when a manual tag points at a removed workspace", () => {
    expect(isDueForAutoTag(setManualTags(store, ["t1"], "gone"), candidate, NOW_MS)).toBe(true);
  });
});

describe("isDueForBackfill", () => {
  it("skips a thread the classifier was already asked about", () => {
    expect(isDueForBackfill(recordAttempt(store, "t1", null, SINCE), candidate)).toBe(false);
  });
});

describe("recordAttempt", () => {
  it("writes a tag only for a confident answer and counts every call", () => {
    const unsure = recordAttempt(store, "t1", null, SINCE);
    expect(unsure.auto).toEqual({});
    expect(unsure.attempts.t1?.count).toBe(1);
    const tagged = recordAttempt(unsure, "t1", "life", SINCE);
    expect(tagged.auto).toEqual({ t1: "life" });
    expect(tagged.attempts.t1?.count).toBe(2);
  });

  it("never touches a manual tag", () => {
    const manual = setManualTags(store, ["t1"], "work");
    expect(recordAttempt(manual, "t1", "life", SINCE).manual).toEqual({ t1: "work" });
  });
});

describe("parseStore", () => {
  it("starts fresh from a missing or broken file", () => {
    expect(parseStore(null, SINCE)).toEqual(emptyStore(SINCE));
    expect(parseStore("{not json", SINCE)).toEqual(emptyStore(SINCE));
  });

  it("round-trips a saved store and drops malformed entries", () => {
    const saved = recordAttempt(setManualTags(store, ["t1"], "life"), "t2", "work", SINCE);
    const raw = JSON.parse(JSON.stringify(saved));
    raw.manual.bad = 3;
    raw.attempts.bad = { count: "x" };
    expect(parseStore(JSON.stringify(raw), "2030-01-01T00:00:00.000Z")).toEqual(saved);
  });
});
