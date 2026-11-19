import type { ThreadWorkspace } from "@t3tools/contracts";
import { MAX_THREAD_WORKSPACES, newWorkspaceId } from "@t3tools/shared/threadWorkspaces";
import { useState } from "react";

import { runThreadWorkspacesCommand, useThreadWorkspaces } from "~/lib/threadWorkspacesState";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const SECTION_NOTE_CLASSNAME = "px-3 py-3 text-xs leading-normal text-muted-foreground sm:px-4";
const DEFAULT_TAG_LIMIT = 100;

/** fork: the workspace list, and a one-off pass that tags older threads with Jev. */
export function ThreadWorkspacesSettings() {
  const snapshot = useThreadWorkspaces();
  // null while showing the server's list; a copy once the user starts editing
  const [draft, setDraft] = useState<ReadonlyArray<ThreadWorkspace> | null>(null);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(String(DEFAULT_TAG_LIMIT));
  const [tagging, setTagging] = useState(false);
  const [tagReport, setTagReport] = useState("");
  if (snapshot === null) return null;
  const list = draft ?? snapshot.workspaces;

  const edit = (index: number, change: Partial<ThreadWorkspace>) =>
    setDraft(list.map((workspace, at) => (at === index ? { ...workspace, ...change } : workspace)));

  const save = async () => {
    if (draft === null) return;
    const outcome = await runThreadWorkspacesCommand({ _tag: "setWorkspaces", workspaces: draft });
    if (outcome.ok) {
      setDraft(null);
      setError("");
    } else {
      setError(outcome.message);
    }
  };

  const tagUntagged = async () => {
    const parsed = Number.parseInt(limit, 10);
    setTagging(true);
    setTagReport("");
    const outcome = await runThreadWorkspacesCommand({
      _tag: "tagUntagged",
      limit: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TAG_LIMIT,
    });
    setTagging(false);
    if (!outcome.ok) {
      setTagReport(outcome.message);
      return;
    }
    const { asked, tagged, failed, remaining } = outcome.result;
    setTagReport(
      asked === 0
        ? "Nothing to tag: every thread already has a workspace or was asked about before."
        : `Asked about ${asked}: ${tagged} tagged, ${asked - tagged - failed} left untagged (unsure)${
            failed > 0 ? `, ${failed} failed` : ""
          }.${remaining > 0 ? ` ${remaining} more remain; run it again to continue.` : ""}`,
    );
  };

  return (
    <SettingsSection title="Workspaces">
      <p className={SECTION_NOTE_CLASSNAME}>
        The sidebar shows one workspace at a time. A thread takes, in order: the workspace you move
        it to, its project&apos;s default workspace (right-click a project), or Jev&apos;s pick from
        its first message. A thread with none shows in every workspace.
      </p>
      {list.map((workspace, index) => (
        <SettingsRow
          key={workspace.id}
          title={workspace.name.trim() || "Unnamed"}
          description="The hint tells Jev what belongs here."
          control={
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Input
                size="sm"
                className="w-28"
                aria-label="Workspace name"
                value={workspace.name}
                onChange={(event) => edit(index, { name: event.target.value })}
              />
              <Input
                size="sm"
                className="w-72"
                aria-label="Hint for Jev"
                value={workspace.hint}
                onChange={(event) => edit(index, { hint: event.target.value })}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={list.length === 1}
                onClick={() => setDraft(list.filter((_, at) => at !== index))}
              >
                Remove
              </Button>
            </div>
          }
        />
      ))}
      <SettingsRow
        title="Edit workspaces"
        description="Removing a workspace untags its threads, so they show everywhere again."
        status={
          error ? (
            <span role="alert" className="text-destructive">
              {error}
            </span>
          ) : undefined
        }
        control={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={list.length >= MAX_THREAD_WORKSPACES}
              onClick={() => {
                const name = `Workspace ${list.length + 1}`;
                const id = newWorkspaceId(
                  name,
                  list.map((workspace) => workspace.id),
                );
                setDraft([...list, { id, name, hint: "" }]);
              }}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={draft === null}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={draft === null} onClick={() => void save()}>
              Save
            </Button>
          </div>
        }
      />
      <SettingsRow
        title="Tag older threads"
        description={
          snapshot.autoTagging
            ? "Asks Jev once about each untagged thread, newest first, up to the limit. New threads are tagged on their own."
            : "Jev auto-tagging is off: there is no key at ~/.config/jev/key on the server machine."
        }
        status={tagReport ? <span>{tagReport}</span> : undefined}
        control={
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              className="w-20"
              aria-label="Most threads to tag"
              inputMode="numeric"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
            <Button
              size="sm"
              disabled={!snapshot.autoTagging || tagging}
              onClick={() => void tagUntagged()}
            >
              {tagging ? "Tagging…" : "Tag untagged"}
            </Button>
          </div>
        }
      />
    </SettingsSection>
  );
}
