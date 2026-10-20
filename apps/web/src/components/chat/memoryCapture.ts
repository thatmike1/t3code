import { workEntryDisplayIndicatesToolFailure } from "@t3tools/client-runtime/work-log/presentation";

import type { WorkLogEntry } from "../../session-logic";

// fork: the memory-capture skill saves notes through
// `python3 .../memory.py capture <folder>/<slug>.md ... --reason '<why>'`.
// The wire item drops command output, so the row is recognised from the command
// text plus the item's status, and the raw command stays in the expanded body.

export interface MemoryCaptureCommand {
  /** `folder/slug`, without the `.md` suffix. */
  readonly notes: ReadonlyArray<string>;
  readonly reason: string | null;
  readonly deleted: boolean;
}

const CAPTURE_PATTERN =
  /memory\.py['"]?\s+capture\s+(['"]?)([\w.-]+\/[\w.-]+?)(?:\.md)?\1(?=\s|$)/g;
const REASON_PATTERN = /--reason(?:\s+|=)(?:'([^']*)'|"((?:[^"\\]|\\.)*)"|([^\s'"]+))/;

export function parseMemoryCaptureCommand(command: string): MemoryCaptureCommand | null {
  const notes = [...command.matchAll(CAPTURE_PATTERN)].map((match) => match[2]!);
  if (notes.length === 0) return null;
  const reasonMatch = REASON_PATTERN.exec(command);
  const rawReason =
    reasonMatch?.[1] ?? reasonMatch?.[2]?.replace(/\\(.)/g, "$1") ?? reasonMatch?.[3];
  const reason = rawReason?.replace(/\s+/g, " ").trim() || null;
  return {
    notes: [...new Set(notes)],
    reason,
    deleted: /\scapture\s[^|;&]*--delete\b/.test(command),
  };
}

/** A compact row heading for a memory-capture command, or null for any other entry. */
export function memoryCaptureLabel(entry: WorkLogEntry): string | null {
  if (entry.itemType !== "command_execution" || !entry.command) return null;
  const capture = parseMemoryCaptureCommand(entry.command);
  if (!capture) return null;
  const [first, ...rest] = capture.notes;
  const target = rest.length > 0 ? `${first} +${rest.length} more` : first;
  const status = entry.toolLifecycleStatus;
  if (status === "inProgress" || status === "idle") return `Saving memory: ${target}`;
  if (status !== "completed" || workEntryDisplayIndicatesToolFailure(entry)) {
    return `Memory not saved: ${target}`;
  }
  const verb = capture.deleted ? "Memory removed" : "Memory saved";
  return capture.reason ? `${verb}: ${target}, ${capture.reason}` : `${verb}: ${target}`;
}
