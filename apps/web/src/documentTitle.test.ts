import { describe, expect, it } from "vite-plus/test";

import { composeDocumentTitle, threadTitleLabel } from "./documentTitle";

describe("document title", () => {
  it("leads with the thread and its project when a thread is open", () => {
    const label = threadTitleLabel("fix sidebar hints", "t3code");
    expect(composeDocumentTitle("T3 Code (Beta)", label)).toBe(
      "fix sidebar hints · t3code · T3 Code (Beta)",
    );
  });

  it("falls back to the app name without a thread, and drops a missing project", () => {
    expect(composeDocumentTitle("T3 Code (Beta)", null)).toBe("T3 Code (Beta)");
    expect(threadTitleLabel("  ", "t3code")).toBeNull();
    expect(threadTitleLabel("plan", null)).toBe("plan");
  });
});
