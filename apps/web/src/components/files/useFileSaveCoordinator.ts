import { AuthFilesystemWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { createRef, useEffect, useMemo } from "react";

import { projectEnvironment } from "~/state/projects";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { FileSaveCoordinator } from "./fileSaveCoordinator";
import {
  confirmProjectFileQueryData,
  getConfirmedProjectFileContents,
  getUnsavedProjectFileQueryData,
} from "./projectFilesQueryState";
import { isAbsolutePath } from "@t3tools/shared/path";

const FILE_SAVE_DEBOUNCE_MS = 500;

interface FileSaveOptions {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  initialContents: string;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

export function useFileSaveCoordinator({
  environmentId,
  cwd,
  relativePath,
  initialContents,
  onPendingChange,
}: FileSaveOptions): Pick<FileSaveCoordinator, "change"> {
  const canWriteFiles = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const writeFile = useAtomCommand(projectEnvironment.writeFile);
  const session = useMemo(() => {
    const coordinatorRef = createRef<FileSaveCoordinator>();
    const hostFile = isAbsolutePath(relativePath) || relativePath.startsWith("~/");
    // A host file write must name what is on disk. A recovered draft is not,
    // so its compare basis is the last read instead of the opened contents.
    const lastConfirmedContents = {
      current:
        hostFile && getUnsavedProjectFileQueryData(environmentId, cwd, relativePath)
          ? (getConfirmedProjectFileContents(environmentId, cwd, relativePath) ?? initialContents)
          : initialContents,
    };
    return {
      change: (contents: string) => coordinatorRef.current?.change(contents),
      setup: () => {
        const coordinator = new FileSaveCoordinator({
          debounceMs: FILE_SAVE_DEBOUNCE_MS,
          canPersist: () => readEnvironmentScope(environmentId, AuthFilesystemWriteScope),
          onPendingChange: (pending) => onPendingChange(relativePath, pending),
          persist: (nextContents) =>
            writeFile({
              environmentId,
              input: {
                cwd,
                relativePath,
                contents: nextContents,
                ...(hostFile ? { expectedContents: lastConfirmedContents.current } : {}),
              },
            }),
          onConfirmed: (savedContents) => {
            lastConfirmedContents.current = savedContents;
            confirmProjectFileQueryData(environmentId, cwd, relativePath, savedContents);
          },
        });
        coordinatorRef.current = coordinator;
        return () => {
          coordinatorRef.current = null;
          coordinator.dispose();
        };
      },
    };
  }, [cwd, environmentId, initialContents, onPendingChange, relativePath, writeFile]);

  // StrictMode replays effect setup. Retired file sessions stay inert, while the
  // replay gets a fresh coordinator instead of reusing a disposed one.
  useEffect(session.setup, [session]);
  useEffect(() => {
    if (!canWriteFiles) return;
    let cancelled = false;
    // Replay must retire the first session before recovery queues a draft to flush.
    queueMicrotask(() => {
      if (cancelled) return;
      const unsaved = getUnsavedProjectFileQueryData(environmentId, cwd, relativePath);
      if (unsaved) session.change(unsaved.contents);
    });
    return () => {
      cancelled = true;
    };
  }, [canWriteFiles, cwd, environmentId, relativePath, session]);
  return session;
}
