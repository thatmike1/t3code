import { KeybindingsConfig } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "./config.ts";
import * as Keybindings from "./keybindings.ts";
import { renameLegacyModelSlotCommands } from "./fork-model-slot-keybindings.ts";

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(KeybindingsConfig));
const layerKeybindings = () =>
  Keybindings.layer.pipe(
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-model-slots-test-" })),
    ),
  );
const when = "!terminalFocus && !modelPickerOpen";

it("renames only the named model commands and reports when nothing changed", () => {
  const unknown = { key: "alt+x", command: "something.from.the.future" };
  assert.deepStrictEqual(
    renameLegacyModelSlotCommands([
      { key: "alt+4", command: "composer.model.fable", when },
      unknown,
      "not an object",
      { key: "alt+c", command: "constructor" },
    ]),
    [
      { key: "alt+4", command: "composer.model.slot4", when },
      unknown,
      "not an object",
      { key: "alt+c", command: "constructor" },
    ],
  );
  assert.isNull(renameLegacyModelSlotCommands([unknown]));
});

it.layer(NodeServices.layer)("model slot keybindings", (it) => {
  it.effect("moves an older keybindings.json onto the slots before the default sync", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const keybindings = yield* Keybindings.Keybindings;
      // the defaults older builds wrote, with sol moved to another key by hand
      const legacy = [
        { key: "alt+1", command: "composer.model.opus", when },
        { key: "alt+shift+s", command: "composer.model.sol", when },
        { key: "alt+4", command: "composer.model.fable", when },
        { key: "alt+6", command: "composer.model.astra", when },
        { key: "alt+9", command: "composer.model.luna", when },
        { key: "alt+2", command: "composer.decreaseEffort", when: "!terminalFocus" },
      ];
      yield* fileSystem.makeDirectory(path.dirname(keybindingsConfigPath), { recursive: true });
      yield* fileSystem.writeFileString(keybindingsConfigPath, JSON.stringify(legacy));

      yield* keybindings.syncDefaultKeybindingsOnStartup;
      const persisted = yield* decodeConfig(
        yield* fileSystem.readFileString(keybindingsConfigPath),
      );
      const slotRules = persisted
        .filter((rule) => rule.command.startsWith("composer.model."))
        .map((rule) => [rule.command, rule.key])
        .toSorted(([left], [right]) => left!.localeCompare(right!));
      assert.deepStrictEqual(slotRules, [
        ["composer.model.slot1", "alt+1"],
        ["composer.model.slot3", "alt+shift+s"],
        ["composer.model.slot4", "alt+4"],
        ["composer.model.slot6", "alt+6"],
        ["composer.model.slot7", "alt+7"],
        ["composer.model.slot8", "alt+8"],
        ["composer.model.slot9", "alt+9"],
      ]);
      const { issues } = yield* keybindings.loadConfigState;
      assert.deepStrictEqual(issues, []);
    }).pipe(Effect.provide(layerKeybindings())),
  );
});
