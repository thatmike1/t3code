import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { threadSwitcherAgentLabel } from "./ThreadSwitcher";

const THREAD = {
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex-work"),
    model: "gpt-5.4-internal-slug",
  },
  session: null,
};

describe("threadSwitcherAgentLabel", () => {
  it("prefers a short human-readable model label", () => {
    expect(
      threadSwitcherAgentLabel(THREAD, {
        displayName: "Work Codex",
        models: [
          {
            slug: "gpt-5.4-internal-slug",
            name: "OpenAI GPT-5.4",
            shortName: "GPT-5.4",
          },
        ],
      }),
    ).toBe("GPT-5.4");
  });

  it("uses the configured provider label when model metadata is unavailable", () => {
    expect(
      threadSwitcherAgentLabel(THREAD, {
        displayName: "Work Codex",
        models: [],
      }),
    ).toBe("Work Codex");
  });

  it("keeps the stored model as a final fallback", () => {
    expect(threadSwitcherAgentLabel(THREAD, null)).toBe("gpt-5.4-internal-slug");
  });
});
