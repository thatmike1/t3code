import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  beginThreadSwitch,
  pruneThreadHistory,
  selectedSwitcherThread,
  stepThreadSwitch,
  visitThread,
} from "./thread-switcher.logic";

const ENV_A = EnvironmentId.make("environment-a");
const ENV_B = EnvironmentId.make("environment-b");
const THREAD_A = scopeThreadRef(ENV_A, ThreadId.make("thread"));
const THREAD_B = scopeThreadRef(ENV_B, ThreadId.make("thread"));
const THREAD_C = scopeThreadRef(ENV_A, ThreadId.make("thread-c"));

describe("thread switcher MRU", () => {
  it("tracks environment and thread identity and moves revisits to the front", () => {
    const history = visitThread(visitThread([THREAD_A], THREAD_B), THREAD_A);
    expect(history).toEqual([THREAD_A, THREAD_B]);
  });

  it("starts on the previous thread and wraps in either direction", () => {
    const forward = beginThreadSwitch([THREAD_A, THREAD_B, THREAD_C], THREAD_A, false);
    if (forward === null) throw new Error("expected a forward gesture");
    expect(selectedSwitcherThread(forward)).toEqual(THREAD_B);
    expect(
      selectedSwitcherThread(stepThreadSwitch(stepThreadSwitch(forward, false), false)),
    ).toEqual(THREAD_A);

    const reverse = beginThreadSwitch([THREAD_A, THREAD_B, THREAD_C], THREAD_A, true);
    if (reverse === null) throw new Error("expected a reverse gesture");
    expect(selectedSwitcherThread(reverse)).toEqual(THREAD_C);
    expect(selectedSwitcherThread(stepThreadSwitch(reverse, true))).toEqual(THREAD_B);
  });

  it("keeps the gesture snapshot stable while later visits update history", () => {
    const gesture = beginThreadSwitch([THREAD_A, THREAD_B, THREAD_C], THREAD_A, false);
    if (gesture === null) throw new Error("expected a gesture");
    const updatedHistory = visitThread([THREAD_A, THREAD_B, THREAD_C], THREAD_C);
    expect(updatedHistory).toEqual([THREAD_C, THREAD_A, THREAD_B]);
    expect(gesture.threads).toEqual([THREAD_A, THREAD_B, THREAD_C]);
  });

  it("toggles the last two threads after each committed route visit", () => {
    const firstGesture = beginThreadSwitch([THREAD_A, THREAD_B], THREAD_A, false);
    if (firstGesture === null) throw new Error("expected a first gesture");
    const firstSelection = selectedSwitcherThread(firstGesture);
    if (firstSelection === null) throw new Error("expected a first selection");

    const historyAfterRouteVisit = visitThread([THREAD_A, THREAD_B], firstSelection);
    const secondGesture = beginThreadSwitch(historyAfterRouteVisit, firstSelection, false);
    if (secondGesture === null) throw new Error("expected a second gesture");
    expect(selectedSwitcherThread(secondGesture)).toEqual(THREAD_A);
  });

  it("prunes unavailable threads and declines a gesture without an alternative", () => {
    const available = new Set([scopedThreadKey(THREAD_A)]);
    const history = pruneThreadHistory([THREAD_A, THREAD_B, THREAD_C], available);
    expect(history).toEqual([THREAD_A]);
    expect(beginThreadSwitch(history, THREAD_A, false)).toBeNull();
  });

  it("cycles through a long history without losing the selected thread", () => {
    const threads = Array.from({ length: 12 }, (_, index) =>
      scopeThreadRef(ENV_A, ThreadId.make(`thread-${index}`)),
    );
    const current = threads[0];
    if (current === undefined) throw new Error("expected a current thread");
    const initialGesture = beginThreadSwitch(threads, current, false);
    if (initialGesture === null) throw new Error("expected a gesture");
    let gesture = initialGesture;
    for (let index = 0; index < 10; index += 1) {
      gesture = stepThreadSwitch(gesture, false);
    }
    expect(selectedSwitcherThread(gesture)).toEqual(threads[11]);
  });
});
