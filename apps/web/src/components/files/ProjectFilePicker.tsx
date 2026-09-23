import { useAtomValue } from "@effect/atom-react";
import { useMemo, useState, type ReactNode } from "react";

import { useActiveProjectTarget, type ActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useTheme } from "~/hooks/useTheme";
import { useRightPanelStore } from "~/rightPanelStore";
import { primaryServerKeybindingsAtom } from "~/state/server";

import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { type CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteResults } from "../CommandPaletteResults";
import {
  getProjectFilePickerMatches,
  PROJECT_FILE_PICKER_RESULT_LIMIT,
} from "./ProjectFilePicker.logic";
import { useProjectFilePickerQuery } from "./projectFilesQueryState";
import { isAbsolutePath, resolvePathLinkTarget } from "~/terminal-links";

interface ProjectFilePickerProps {
  readonly setOpen: (open: boolean) => void;
}

function HighlightedFuzzyText(props: {
  readonly active: boolean;
  readonly indices: ReadonlyArray<number>;
  readonly value: string;
}) {
  if (!props.active) return props.value;

  const parts: ReactNode[] = [];
  let start = 0;
  for (const index of props.indices) {
    if (start < index) parts.push(props.value.slice(start, index));
    parts.push(
      <strong className="font-semibold text-foreground" key={index}>
        {props.value[index]}
      </strong>,
    );
    start = index + 1;
  }
  if (start < props.value.length) parts.push(props.value.slice(start));

  return <span className="text-muted-foreground">{parts}</span>;
}

function getEmptyStateMessage(query: string, error: string | null, isPending: boolean): string {
  if (error) return error;
  const isSearching = query.trim().length > 0;
  if (isPending) return isSearching ? "Searching workspace files…" : "Indexing workspace files…";
  return isSearching ? "No matching files." : "No files found.";
}

function EmptyProjectFilePicker() {
  return (
    <CommandPaletteContent
      aria-label="File picker"
      escapeLabel="Back"
      footerActionLabel="Open file"
      inputProps={{ disabled: true, placeholder: "Search files…" }}
      mode="none"
      testId="project-file-picker"
      value=""
    >
      <div className="py-10 text-center text-sm text-muted-foreground">
        Open a project to search its files.
      </div>
    </CommandPaletteContent>
  );
}

function OpenProjectFilePicker(props: ProjectFilePickerProps & { target: ActiveProjectTarget }) {
  const { target } = props;
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const result = useProjectFilePickerQuery(
    target.environmentId,
    target.cwd,
    query,
    PROJECT_FILE_PICKER_RESULT_LIMIT,
  );
  const { resolvedTheme } = useTheme();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const matches = useMemo(
    () => getProjectFilePickerMatches(result.entries, result.matchedQuery),
    [result.entries, result.matchedQuery],
  );
  const hasMatchedQuery = /\S/.test(result.matchedQuery);
  const requestedPath = query.trim();
  const directPath =
    isAbsolutePath(requestedPath) || requestedPath.startsWith("~/")
      ? resolvePathLinkTarget(requestedPath, target.cwd)
      : null;
  const items = useMemo<CommandPaletteActionItem[]>(
    () => [
      ...(directPath
        ? [
            {
              kind: "action" as const,
              value: `direct-file:${directPath}`,
              searchTerms: [requestedPath],
              title: "Open file by path",
              description: requestedPath,
              icon: <PierreEntryIcon pathValue={directPath} kind="file" theme={resolvedTheme} />,
              run: async () => {
                useRightPanelStore.getState().openFile(target.threadRef, directPath);
              },
            },
          ]
        : []),
      ...matches.map((match) => ({
        kind: "action" as const,
        value: `file:${match.path}`,
        searchTerms: [match.name, match.path],
        title: (
          <HighlightedFuzzyText
            active={hasMatchedQuery}
            value={match.name}
            indices={match.nameMatchIndices}
          />
        ),
        description: (
          <HighlightedFuzzyText
            active={hasMatchedQuery}
            value={match.path}
            indices={match.pathMatchIndices}
          />
        ),
        icon: <PierreEntryIcon pathValue={match.path} kind="file" theme={resolvedTheme} />,
        run: async () => {
          useRightPanelStore.getState().openFile(target.threadRef, match.path);
        },
      })),
    ],
    [directPath, hasMatchedQuery, matches, requestedPath, resolvedTheme, target.threadRef],
  );

  const emptyStateMessage = getEmptyStateMessage(query, result.error, result.isPending);

  return (
    <CommandPaletteContent
      aria-label="File picker"
      autoHighlight="always"
      escapeLabel="Back"
      footerActionLabel="Open file"
      inputProps={{ placeholder: "Search files…" }}
      mode="none"
      onItemHighlighted={(value) => {
        setHighlightedItemValue(typeof value === "string" ? value : null);
      }}
      onValueChange={(value) => {
        setHighlightedItemValue(null);
        setQuery(value);
      }}
      panelClassName="max-h-[min(34rem,76vh)]"
      testId="project-file-picker"
      value={query}
    >
      <CommandPaletteResults
        groups={[
          ...(directPath
            ? [{ value: "file-by-path", label: "File by path", items: items.slice(0, 1) }]
            : []),
          ...(items.length > (directPath ? 1 : 0)
            ? [
                {
                  value: "project-files",
                  label: target.projectName,
                  items: directPath ? items.slice(1) : items,
                },
              ]
            : []),
        ]}
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={false}
        keybindings={keybindings}
        onExecuteItem={(item) => {
          if (item.kind !== "action") return;
          props.setOpen(false);
          void item.run();
        }}
        emptyStateMessage={emptyStateMessage}
      />
    </CommandPaletteContent>
  );
}

export function ProjectFilePicker(props: ProjectFilePickerProps) {
  const target = useActiveProjectTarget();

  if (!target) {
    return <EmptyProjectFilePicker />;
  }

  return <OpenProjectFilePicker setOpen={props.setOpen} target={target} />;
}
