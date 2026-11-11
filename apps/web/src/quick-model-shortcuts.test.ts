import { assert, describe, it } from "vite-plus/test";
import {
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  type KeybindingCommand,
  type ModelShortcutSlots,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { AppModelOption } from "./modelSelection";
import type { ProviderInstanceEntry } from "./providerInstances";
import {
  modelShortcutSlotTarget,
  quickModelSelectionForCommand,
  withModelShortcutSlots,
} from "./quick-model-shortcuts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
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
  [codex, [{ slug: "gpt-6-astra" }, { slug: "gpt-6.1-sol" }, { slug: "gpt-6-luna" }]],
  [claude, [{ slug: "claude-opus-5-5" }, { slug: "claude-fable-5-1" }]],
  [customClaude, [{ slug: "claude-opus-5-5" }]],
]);

const slots: ModelShortcutSlots = {
  "composer.model.slot1": { driver: "claudeAgent", model: "claude-opus-5-5" },
  "composer.model.slot3": { driver: "codex", model: "gpt-6.1-sol" },
  "composer.model.slot4": { driver: "claudeAgent", model: "claude-fable-5-1" },
};

describe("quick model shortcuts", () => {
  it("selects each slot's model on the default instance of its driver", () => {
    const cases = [
      ["composer.model.slot1", claude, "claude-opus-5-5"],
      ["composer.model.slot3", codex, "gpt-6.1-sol"],
      ["composer.model.slot4", claude, "claude-fable-5-1"],
    ] satisfies ReadonlyArray<readonly [KeybindingCommand, ProviderInstanceId, string]>;

    for (const [command, instanceId, model] of cases) {
      assert.deepEqual(quickModelSelectionForCommand(command, instances, options, slots), {
        instanceId,
        model,
      });
    }
  });

  it("treats an unassigned slot and other commands as having no model", () => {
    assert.isNull(modelShortcutSlotTarget("composer.model.slot2", slots));
    assert.isNull(modelShortcutSlotTarget("composer.model.slot1", {}));
    assert.isNull(modelShortcutSlotTarget("chat.new", slots));
    assert.isNull(quickModelSelectionForCommand("composer.model.slot2", instances, options, slots));
  });

  it("ignores unavailable models and can use a ready custom instance", () => {
    const unavailable = new Map(options);
    unavailable.set(claude, [{ slug: "claude-opus-5-5", isUnavailable: true }]);
    assert.deepEqual(
      quickModelSelectionForCommand("composer.model.slot1", instances, unavailable, slots),
      { instanceId: customClaude, model: "claude-opus-5-5" },
    );
    assert.isNull(
      quickModelSelectionForCommand(
        "composer.model.slot4",
        instances,
        new Map([[codex, [{ slug: "gpt-6.1-sol" }]]]),
        slots,
      ),
    );
    assert.isNull(
      quickModelSelectionForCommand("composer.model.slot3", instances, options, {
        "composer.model.slot3": { driver: "codex", model: "missing-model" },
      }),
    );
  });
});

describe("model shortcut slot migration", () => {
  const legacyEffectiveModels = {
    "composer.model.slot1": { driver: "claudeAgent", model: "claude-opus-5-5" },
    "composer.model.slot3": { driver: "codex", model: "gpt-6.1-sol" },
    "composer.model.slot4": { driver: "claudeAgent", model: "claude-fable-5-2" },
    "composer.model.slot6": { driver: "codex", model: "gpt-6-astra" },
    "composer.model.slot9": { driver: "codex", model: "gpt-6-luna" },
  };

  it("moves each named shortcut's effective model into the slot of its old digit", () => {
    // a file from before the slots, with the fable shortcut overridden as on Mike's machine
    const legacy = decodeClientSettings({
      quickModelTargets: { "composer.model.fable": " claude-fable-5-2 " },
    });
    const migrated = withModelShortcutSlots(legacy);
    assert.deepEqual(migrated.modelShortcutSlots, legacyEffectiveModels);

    // the old ids on their old keys and the new slots on the same keys pick the same models
    for (const [slot, target] of Object.entries(legacyEffectiveModels)) {
      const selection = quickModelSelectionForCommand(
        slot as KeybindingCommand,
        instances,
        new Map([
          [codex, [{ slug: "gpt-6-astra" }, { slug: "gpt-6.1-sol" }, { slug: "gpt-6-luna" }]],
          [claude, [{ slug: "claude-opus-5-5" }, { slug: "claude-fable-5-2" }]],
        ]),
        migrated.modelShortcutSlots,
      );
      assert.strictEqual(selection?.model, target.model);
    }
  });

  it("fills slots missing from a partly migrated file and marks it migrated", () => {
    // slot 1 already set, the astra shortcut still overridden only in the legacy targets
    const partial = decodeClientSettings({
      quickModelTargets: { "composer.model.sol": "gpt-6-astra" },
      modelShortcutSlots: {
        "composer.model.slot1": { driver: "claudeAgent", model: "claude-fable-5-2" },
      },
    });
    const migrated = withModelShortcutSlots(partial);
    assert.deepEqual(migrated.modelShortcutSlots, {
      ...legacyEffectiveModels,
      "composer.model.slot1": { driver: "claudeAgent", model: "claude-fable-5-2" },
      "composer.model.slot3": { driver: "codex", model: "gpt-6-astra" },
      "composer.model.slot4": { driver: "claudeAgent", model: "claude-fable-5-1" },
    });
    assert.isTrue(migrated.modelShortcutSlotsMigrated);
  });

  it("keeps a slot the user cleared after migration empty", () => {
    const cleared = decodeClientSettings({
      quickModelTargets: { "composer.model.fable": "claude-fable-5-2" },
      modelShortcutSlots: {},
      modelShortcutSlotsMigrated: true,
    });
    assert.strictEqual(withModelShortcutSlots(cleared), cleared);
    assert.deepEqual(DEFAULT_CLIENT_SETTINGS.modelShortcutSlots, {});
    assert.strictEqual(withModelShortcutSlots(DEFAULT_CLIENT_SETTINGS), DEFAULT_CLIENT_SETTINGS);
  });
});
