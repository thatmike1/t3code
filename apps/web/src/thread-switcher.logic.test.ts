import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DraftId } from "./composerDraftStore";
import {
  beginThreadSwitch,
  draftTarget,
  isThreadSwitchEligible,
  parseRecentEntries,
  pruneRecentEntries,
  RECENTLY_SETTLED_WINDOW_MS,
  type RecentEntry,
  selectThreadSwitch,
  selectedSwitchTarget,
  serializeRecentEntries,
  stepThreadSwitch,
  type SwitchTarget,
  switchTargetKey,
  threadAfterClose,
  threadTarget,
  visitTarget,
} from "./thread-switcher.logic";

const ENV_A = EnvironmentId.make("environment-a");
const ENV_B = EnvironmentId.make("environment-b");
const REF_A = scopeThreadRef(ENV_A, ThreadId.make("thread"));
const REF_B = scopeThreadRef(ENV_B, ThreadId.make("thread"));
const REF_C = scopeThreadRef(ENV_A, ThreadId.make("thread-c"));
const THREAD_A = threadTarget(REF_A);
const THREAD_B = threadTarget(REF_B);
const THREAD_C = threadTarget(REF_C);
const DRAFT = draftTarget(DraftId.make("draft-1"));

function entries(...targets: SwitchTarget[]): RecentEntry[] {
  return targets.map((target) => ({ target, seenAt: 0 }));
}

function keys(targets: ReadonlyArray<SwitchTarget> | ReadonlyArray<RecentEntry>): string[] {
  return targets.map((item) => switchTargetKey("target" in item ? item.target : item));
}

describe("thread switcher history", () => {
  it("tracks environment and thread identity and moves revisits to the front", () => {
    const history = visitTarget(visitTarget(entries(THREAD_A), THREAD_B, 1), THREAD_A, 2);
    expect(keys(history)).toEqual(keys([THREAD_A, THREAD_B]));
  });

  it("stamps the view being left, so time spent reading counts as seen", () => {
    const history = visitTarget([{ target: THREAD_A, seenAt: 100 }], THREAD_B, 5_000);
    expect(history).toEqual([
      { target: THREAD_B, seenAt: 5_000 },
      { target: THREAD_A, seenAt: 5_000 },
    ]);
  });

  it("leaves the list untouched when the current view is visited again", () => {
    const history = entries(THREAD_A, THREAD_B);
    expect(visitTarget(history, THREAD_A, 9)).toBe(history);
  });

  it("keeps drafts and threads apart even with matching ids", () => {
    const draftNamedLikeThread = draftTarget(DraftId.make(`${ENV_A}:thread`));
    const history = visitTarget(entries(THREAD_A), draftNamedLikeThread, 1);
    expect(history).toHaveLength(2);
  });

  it("swaps a sent draft for its thread in place and drops duplicates", () => {
    const history = entries(THREAD_B, DRAFT, THREAD_A, THREAD_C);
    const pruned = pruneRecentEntries(history, (target) => {
      if (target.kind === "draft") return THREAD_A;
      return switchTargetKey(target) === switchTargetKey(THREAD_C) ? null : target;
    });
    expect(keys(pruned)).toEqual(keys([THREAD_B, THREAD_A]));
  });

  it("returns the same list when nothing was pruned", () => {
    const history = entries(THREAD_A, THREAD_B);
    expect(pruneRecentEntries(history, (target) => target)).toBe(history);
  });

  it("survives a round trip through storage and ignores junk", () => {
    const history: RecentEntry[] = [
      { target: THREAD_B, seenAt: 3 },
      { target: DRAFT, seenAt: 2 },
    ];
    expect(parseRecentEntries(serializeRecentEntries(history))).toEqual(history);
    expect(parseRecentEntries("not json")).toEqual([]);
    expect(parseRecentEntries('[{"k":"t"},null,{"k":"d","d":"x","s":1}]')).toEqual([
      { target: draftTarget(DraftId.make("x")), seenAt: 1 },
    ]);
  });
});

describe("thread switch eligibility", () => {
  const now = 10 * RECENTLY_SETTLED_WINDOW_MS;
  const base = { settled: false, snoozed: false, settledAtMs: null, seenAt: 0, now };

  it("keeps open threads however old they are", () => {
    expect(isThreadSwitchEligible(base)).toBe(true);
  });

  it("hides snoozed threads", () => {
    expect(isThreadSwitchEligible({ ...base, snoozed: true, seenAt: now })).toBe(false);
  });

  it("keeps a thread settled within the window and drops one settled long ago", () => {
    expect(isThreadSwitchEligible({ ...base, settled: true, settledAtMs: now - 5 * 60_000 })).toBe(
      true,
    );
    expect(
      isThreadSwitchEligible({
        ...base,
        settled: true,
        settledAtMs: now - RECENTLY_SETTLED_WINDOW_MS - 1,
      }),
    ).toBe(false);
  });

  it("keeps an old settled thread the user was just looking at", () => {
    expect(
      isThreadSwitchEligible({ ...base, settled: true, settledAtMs: 0, seenAt: now - 60_000 }),
    ).toBe(true);
  });
});

describe("thread switch gesture", () => {
  it("starts on the previous view and wraps in either direction", () => {
    const history = entries(THREAD_A, THREAD_B, THREAD_C);
    const forward = beginThreadSwitch(history, THREAD_A, false);
    if (forward === null) throw new Error("expected a forward gesture");
    expect(selectedSwitchTarget(forward)).toEqual(THREAD_B);
    expect(selectedSwitchTarget(stepThreadSwitch(stepThreadSwitch(forward, false), false))).toEqual(
      THREAD_A,
    );

    const reverse = beginThreadSwitch(history, THREAD_A, true);
    if (reverse === null) throw new Error("expected a reverse gesture");
    expect(selectedSwitchTarget(reverse)).toEqual(THREAD_C);
    expect(selectedSwitchTarget(stepThreadSwitch(reverse, true))).toEqual(THREAD_B);
  });

  it("anchors on the current view even when it is not eligible itself", () => {
    const gesture = beginThreadSwitch(
      entries(THREAD_A, THREAD_B, THREAD_C),
      THREAD_A,
      false,
      (entry) => switchTargetKey(entry.target) !== switchTargetKey(THREAD_A),
    );
    expect(gesture?.anchored).toBe(true);
    expect(keys(gesture?.targets ?? [])).toEqual(keys([THREAD_A, THREAD_B, THREAD_C]));
  });

  it("leaves ineligible entries out of the list", () => {
    const gesture = beginThreadSwitch(
      entries(THREAD_A, THREAD_B, THREAD_C),
      THREAD_A,
      false,
      (entry) => switchTargetKey(entry.target) !== switchTargetKey(THREAD_B),
    );
    expect(keys(gesture?.targets ?? [])).toEqual(keys([THREAD_A, THREAD_C]));
  });

  it("starts from a draft and lands on drafts", () => {
    const fromDraft = beginThreadSwitch(entries(DRAFT, THREAD_A), DRAFT, false);
    expect(fromDraft && selectedSwitchTarget(fromDraft)).toEqual(THREAD_A);
    const toDraft = beginThreadSwitch(entries(THREAD_A, DRAFT), THREAD_A, false);
    expect(toDraft && selectedSwitchTarget(toDraft)).toEqual(DRAFT);
  });

  it("starts on the most recent entry when no thread is on screen", () => {
    const gesture = beginThreadSwitch(entries(THREAD_B, THREAD_C), null, false);
    expect(gesture?.anchored).toBe(false);
    expect(gesture && selectedSwitchTarget(gesture)).toEqual(THREAD_B);
    expect(beginThreadSwitch([], null, false)).toBeNull();
  });

  it("toggles the last two views after each committed visit", () => {
    const first = beginThreadSwitch(entries(THREAD_A, THREAD_B), THREAD_A, false);
    const firstSelection = first && selectedSwitchTarget(first);
    if (!firstSelection) throw new Error("expected a first selection");
    const afterVisit = visitTarget(entries(THREAD_A, THREAD_B), firstSelection, 1);
    const second = beginThreadSwitch(afterVisit, firstSelection, false);
    expect(second && selectedSwitchTarget(second)).toEqual(THREAD_A);
  });

  it("declines a gesture without an alternative", () => {
    expect(beginThreadSwitch(entries(THREAD_A), THREAD_A, false)).toBeNull();
  });

  it("selects a clicked row and ignores out-of-range indexes", () => {
    const gesture = beginThreadSwitch(entries(THREAD_A, THREAD_B, THREAD_C), THREAD_A, false);
    if (gesture === null) throw new Error("expected a gesture");
    expect(selectedSwitchTarget(selectThreadSwitch(gesture, 2))).toEqual(THREAD_C);
    expect(selectThreadSwitch(gesture, 7)).toBe(gesture);
  });

  it("cycles through a long history without losing the selected entry", () => {
    const targets = Array.from({ length: 12 }, (_, index) =>
      threadTarget(scopeThreadRef(ENV_A, ThreadId.make(`thread-${index}`))),
    );
    const initial = beginThreadSwitch(entries(...targets), targets[0]!, false);
    if (initial === null) throw new Error("expected a gesture");
    let gesture = initial;
    for (let index = 0; index < 10; index += 1) gesture = stepThreadSwitch(gesture, false);
    expect(selectedSwitchTarget(gesture)).toEqual(targets[11]);
  });
});

describe("threadAfterClose", () => {
  it("lands on the most recent other thread that is still open", () => {
    expect(
      threadAfterClose(
        [REF_A, REF_B, REF_C],
        REF_A,
        (thread) => switchTargetKey(threadTarget(thread)) !== switchTargetKey(THREAD_B),
      ),
    ).toEqual(REF_C);
  });

  it("returns null when nothing else is open", () => {
    expect(threadAfterClose([REF_A], REF_A, () => true)).toBeNull();
  });
});
