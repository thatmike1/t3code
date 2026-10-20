import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import { workEntryDisplayLabel } from "./MessagesTimeline.logic";
import { memoryCaptureLabel, parseMemoryCaptureCommand } from "./memoryCapture";

const claudeCommand = `cd ~/git/ccChat-general && python3 projects/memory-system/memory.py capture tools/t3-widgets.md --expected e291 --file /tmp/mem/tw.md --source "current session 20 Oct 2026" --evidence "t3-fork-update.sh check" --reason "fork builds lacked Connect; build script fixed" 2>&1 | grep -E '"error"|capture_id'`;

const codexCommand = `/bin/bash -lc "python3 projects/memory-system/memory.py capture rules/gpt-for-ideas-and-small-model-bulk.md --expected 59c3 --file /tmp/sol-review-routing.md --source 'Mike, Codex session, 19 October 2026' --evidence 'Explicit user model choice' --reason 'Route subsequent inspection and review to gpt-6.1-sol as requested'"`;

function commandEntry(
  command: string,
  toolLifecycleStatus: WorkLogEntry["toolLifecycleStatus"] = "completed",
): WorkLogEntry {
  return {
    id: "item-1",
    createdAt: "2026-10-20T10:00:00.000Z",
    label: "Ran command",
    tone: "tool",
    itemType: "command_execution",
    command,
    rawCommand: command,
    toolTitle: "Command",
    toolLifecycleStatus,
  };
}

describe("parseMemoryCaptureCommand", () => {
  it("reads the note and reason from a Claude capture", () => {
    expect(parseMemoryCaptureCommand(claudeCommand)).toEqual({
      notes: ["tools/t3-widgets"],
      reason: "fork builds lacked Connect; build script fixed",
      deleted: false,
    });
  });

  it("reads a Codex capture wrapped in bash -lc", () => {
    expect(parseMemoryCaptureCommand(codexCommand)).toMatchObject({
      notes: ["rules/gpt-for-ideas-and-small-model-bulk"],
      reason: "Route subsequent inspection and review to gpt-6.1-sol as requested",
    });
  });

  it("ignores reads and commands that only mention the helper", () => {
    expect(
      parseMemoryCaptureCommand("python3 projects/memory-system/memory.py read tools/x.md"),
    ).toBeNull();
    expect(
      parseMemoryCaptureCommand(
        `sqlite3 db "select * from items where payload_json like '%memory.py capture%'"`,
      ),
    ).toBeNull();
  });
});

describe("memoryCaptureLabel", () => {
  it("labels a finished capture as saved, with the note and reason", () => {
    expect(workEntryDisplayLabel(commandEntry(claudeCommand), undefined)).toBe(
      "Memory saved: tools/t3-widgets, fork builds lacked Connect; build script fixed",
    );
  });

  it("never calls a running or failed capture saved", () => {
    expect(memoryCaptureLabel(commandEntry(codexCommand, "inProgress"))).toBe(
      "Saving memory: rules/gpt-for-ideas-and-small-model-bulk",
    );
    expect(memoryCaptureLabel(commandEntry(codexCommand, "failed"))).toBe(
      "Memory not saved: rules/gpt-for-ideas-and-small-model-bulk",
    );
  });

  it("counts several captures in one command and leaves other commands alone", () => {
    const two = `python3 memory.py capture tools/a.md --reason 'x'; python3 memory.py capture life/b.md --reason 'y'`;
    expect(memoryCaptureLabel(commandEntry(two))).toBe("Memory saved: tools/a +1 more, x");
    expect(memoryCaptureLabel(commandEntry("ls -la"))).toBeNull();
  });
});
