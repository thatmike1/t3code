import { EnvironmentId, ThreadId, type TabTintSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { findThreadTabTint } from "./tabTintState";

const LOCAL = EnvironmentId.make("env-local");
const REMOTE = EnvironmentId.make("env-remote");
const THREAD = ThreadId.make("thread-1");
const SNAPSHOT: TabTintSnapshot = { tints: [{ threadId: THREAD, color: "red", tabCount: 2 }] };

describe("findThreadTabTint", () => {
  it("finds the thread's tint in the primary environment's snapshot", () => {
    expect(findThreadTabTint(SNAPSHOT, LOCAL, LOCAL, THREAD)).toEqual(SNAPSHOT.tints[0]);
    expect(findThreadTabTint(SNAPSHOT, LOCAL, LOCAL, ThreadId.make("thread-2"))).toBeNull();
  });

  it("never tints a thread from another environment with the same id", () => {
    expect(findThreadTabTint(SNAPSHOT, LOCAL, REMOTE, THREAD)).toBeNull();
    expect(findThreadTabTint(null, LOCAL, LOCAL, THREAD)).toBeNull();
  });
});
