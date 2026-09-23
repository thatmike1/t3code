import { assert, describe, it } from "vite-plus/test";
import { type KeybindingCommand, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { AppModelOption } from "./modelSelection";
import type { ProviderInstanceEntry } from "./providerInstances";
import { quickModelSelectionForCommand } from "./quick-model-shortcuts";

const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");
const customClaude = ProviderInstanceId.make("claude_personal");
const instances = [
  {
    instanceId: codex,
    driverKind: ProviderDriverKind.make("codex"),
    isDefault: true,
    enabled: true,
    isAvailable: true,
    status: "ready",
  },
  {
    instanceId: claude,
    driverKind: ProviderDriverKind.make("claudeAgent"),
    isDefault: true,
    enabled: true,
    isAvailable: true,
    status: "ready",
  },
  {
    instanceId: customClaude,
    driverKind: ProviderDriverKind.make("claudeAgent"),
    isDefault: false,
    enabled: true,
    isAvailable: true,
    status: "ready",
  },
] satisfies ReadonlyArray<
  Pick<
    ProviderInstanceEntry,
    "instanceId" | "driverKind" | "isDefault" | "enabled" | "isAvailable" | "status"
  >
>;
const options: Map<
  ProviderInstanceId,
  ReadonlyArray<Pick<AppModelOption, "slug" | "isUnavailable">>
> = new Map([
  [codex, [{ slug: "gpt-6-astra" }, { slug: "gpt-6-sol" }, { slug: "gpt-6-luna" }]],
  [claude, [{ slug: "claude-opus-5-5" }, { slug: "claude-fable-5-1" }]],
  [customClaude, [{ slug: "claude-opus-5-5" }]],
]);

describe("quick model shortcuts", () => {
  it("selects each named model on the default instance", () => {
    const cases = [
      ["composer.model.opus", claude, "claude-opus-5-5"],
      ["composer.model.sol", codex, "gpt-6-sol"],
      ["composer.model.fable", claude, "claude-fable-5-1"],
      ["composer.model.astra", codex, "gpt-6-astra"],
      ["composer.model.luna", codex, "gpt-6-luna"],
    ] satisfies ReadonlyArray<readonly [KeybindingCommand, ProviderInstanceId, string]>;

    for (const [command, instanceId, model] of cases) {
      assert.deepEqual(quickModelSelectionForCommand(command, instances, options), {
        instanceId,
        model,
      });
    }
  });

  it("ignores unavailable models and can use a ready custom instance", () => {
    const unavailable = new Map(options);
    unavailable.set(claude, [{ slug: "claude-opus-5-5", isUnavailable: true }]);
    assert.deepEqual(quickModelSelectionForCommand("composer.model.opus", instances, unavailable), {
      instanceId: customClaude,
      model: "claude-opus-5-5",
    });
    assert.isNull(
      quickModelSelectionForCommand(
        "composer.model.fable",
        instances,
        new Map([[codex, [{ slug: "gpt-6-sol" }]]]),
      ),
    );
  });
});
