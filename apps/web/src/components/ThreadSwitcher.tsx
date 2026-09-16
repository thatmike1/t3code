import { scopedProjectKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveSidebarThreadStatus } from "./Sidebar.logic";
import { getTriggerDisplayModelLabel, type ModelEsque } from "./chat/providerIconUtils";
import { cn } from "../lib/utils";
import {
  deriveProviderEntriesByEnvironment,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { resolveThreadRouteRef } from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useThreadShells } from "../state/entities";
import { primaryServerProvidersAtom } from "../state/server";
import {
  beginThreadSwitch,
  getRecentThreads,
  pruneThreadHistory,
  selectedSwitcherThread,
  setRecentThreads,
  stepThreadSwitch,
  type ThreadSwitcherGesture,
  visitThread,
} from "../thread-switcher.logic";

function statusLabel(thread: EnvironmentThreadShell): string | null {
  const status = resolveSidebarThreadStatus(thread);
  return status === "ready" ? null : status.slice(0, 1).toUpperCase() + status.slice(1);
}

export function threadSwitcherAgentLabel(
  thread: Pick<EnvironmentThreadShell, "modelSelection" | "session">,
  providerEntry: {
    readonly displayName: string;
    readonly models: ReadonlyArray<ModelEsque>;
  } | null,
): string {
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  return selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : (providerEntry?.displayName ?? thread.session?.providerName ?? thread.modelSelection.model);
}

function ThreadSwitcherOverlay({
  gesture,
  threadByKey,
  projectByKey,
  environmentLabelById,
  providerEntriesByEnvironment,
}: {
  readonly gesture: ThreadSwitcherGesture;
  readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly environmentLabelById: ReadonlyMap<string, string>;
  readonly providerEntriesByEnvironment: ReadonlyMap<
    string,
    ReadonlyMap<string, ProviderInstanceEntry>
  >;
}) {
  const selectedRef = selectedSwitcherThread(gesture);
  const selectedThread = selectedRef ? threadByKey.get(scopedThreadKey(selectedRef)) : undefined;
  const selectedProject = selectedThread
    ? projectByKey.get(
        scopedProjectKey({
          environmentId: selectedThread.environmentId,
          projectId: selectedThread.projectId,
        }),
      )
    : undefined;
  const selectedProviderEntry = selectedThread
    ? (providerEntriesByEnvironment
        .get(selectedThread.environmentId)
        ?.get(
          selectedThread.session?.providerInstanceId ?? selectedThread.modelSelection.instanceId,
        ) ?? null)
    : null;
  const selectedAgentLabel = selectedThread
    ? threadSwitcherAgentLabel(selectedThread, selectedProviderEntry)
    : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-100 flex items-center justify-center bg-black/20 px-4 backdrop-blur-[1px]">
      <div
        role="dialog"
        aria-label="Recent threads"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        <p className="sr-only" aria-live="polite">
          {selectedThread
            ? [selectedThread.title, selectedProject?.title, selectedAgentLabel]
                .filter(Boolean)
                .join(", ")
            : ""}
        </p>
        <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
          Recent threads
        </div>
        <ol className="max-h-[min(28rem,70vh)] overflow-y-auto p-2">
          {gesture.threads.map((ref, index) => {
            const thread = threadByKey.get(scopedThreadKey(ref));
            if (!thread) return null;
            const project = projectByKey.get(
              scopedProjectKey({
                environmentId: thread.environmentId,
                projectId: thread.projectId,
              }),
            );
            const environmentLabel = environmentLabelById.get(thread.environmentId);
            const providerEntry =
              providerEntriesByEnvironment
                .get(thread.environmentId)
                ?.get(thread.session?.providerInstanceId ?? thread.modelSelection.instanceId) ??
              null;
            const agentLabel = threadSwitcherAgentLabel(thread, providerEntry);
            const status = statusLabel(thread);
            const selected = index === gesture.selectedIndex;
            return (
              <li
                key={scopedThreadKey(ref)}
                ref={
                  selected
                    ? (row) => {
                        row?.scrollIntoView({ block: "nearest" });
                      }
                    : undefined
                }
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5",
                  selected ? "bg-accent text-accent-foreground" : "text-muted-foreground",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {thread.title}
                  </span>
                  <span className="flex min-w-0 items-center gap-1 text-xs">
                    <span className="min-w-0 truncate">
                      {[project?.title, environmentLabel].filter(Boolean).join(" · ")}
                    </span>
                    {project?.title || environmentLabel ? (
                      <span className="shrink-0 text-muted-foreground/60">·</span>
                    ) : null}
                    <span className="max-w-[45%] shrink-0 truncate text-foreground/70">
                      {agentLabel}
                    </span>
                  </span>
                </span>
                {status ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                    {status}
                  </span>
                ) : null}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatRelativeTimeLabel(thread.latestUserMessageAt ?? thread.updatedAt)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export function ThreadSwitcher() {
  const params = useParams({ strict: false });
  const routeThreadRef = resolveThreadRouteRef(params);
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryProviders = useAtomValue(primaryServerProvidersAtom);
  const [gesture, setGesture] = useState<ThreadSwitcherGesture | null>(null);
  const gestureRef = useRef<ThreadSwitcherGesture | null>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);

  const threadByKey = useMemo(
    () =>
      new Map(
        threads.map((thread) => [
          scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
          thread,
        ]),
      ),
    [threads],
  );
  const projectByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }),
          project,
        ]),
      ),
    [projects],
  );
  const environmentLabelById = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );
  const providerEntriesByEnvironment = useMemo(
    () =>
      deriveProviderEntriesByEnvironment(
        environments.map(
          (environment) =>
            [
              environment.environmentId,
              environment.serverConfig?.providers ??
                (environment.environmentId === primaryEnvironmentId ? primaryProviders : []),
            ] as const,
        ),
      ),
    [environments, primaryEnvironmentId, primaryProviders],
  );

  useEffect(() => {
    let history = pruneThreadHistory(getRecentThreads(), new Set(threadByKey.keys()));
    if (routeThreadRef && threadByKey.has(scopedThreadKey(routeThreadRef))) {
      history = visitThread(history, routeThreadRef);
    }
    setRecentThreads(history);
  }, [routeThreadRef, threadByKey]);

  const closeGesture = useCallback((restoreFocus: boolean) => {
    const priorFocus = priorFocusRef.current;
    gestureRef.current = null;
    setGesture(null);
    priorFocusRef.current = null;
    if (restoreFocus) {
      requestAnimationFrame(() => {
        if (priorFocus?.isConnected) priorFocus.focus();
      });
    }
  }, []);

  const cancel = useCallback(() => closeGesture(true), [closeGesture]);
  const commit = useCallback(() => {
    const activeGesture = gestureRef.current;
    const selected = activeGesture ? selectedSwitcherThread(activeGesture) : null;
    closeGesture(false);
    if (!selected || !threadByKey.has(scopedThreadKey(selected))) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: selected.environmentId, threadId: selected.threadId },
    });
  }, [closeGesture, navigate, threadByKey]);

  const step = useCallback(
    (reverse: boolean): boolean => {
      if (gestureRef.current) {
        const next = stepThreadSwitch(gestureRef.current, reverse);
        gestureRef.current = next;
        setGesture(next);
        return true;
      }
      if (!routeThreadRef) return false;
      const next = beginThreadSwitch(getRecentThreads(), routeThreadRef, reverse);
      if (!next) return false;
      priorFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      gestureRef.current = next;
      setGesture(next);
      return true;
    },
    [routeThreadRef],
  );

  useEffect(() => {
    const nativeInput = window.desktopBridge?.onThreadSwitcherInput;
    const usesNativeInput = nativeInput !== undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab" && event.ctrlKey && !event.metaKey && !event.altKey) {
        if (usesNativeInput) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (step(event.shiftKey)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.key === "Escape" && gestureRef.current) {
        event.preventDefault();
        event.stopPropagation();
        if (usesNativeInput) return;
        cancel();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if ((event.key === "Control" || event.key === "Ctrl") && gestureRef.current) {
        event.preventDefault();
        if (usesNativeInput) return;
        commit();
      }
    };
    const onBlur = () => {
      if (gestureRef.current) cancel();
    };
    const unsubscribeDesktop = nativeInput?.((event) => {
      if (event.type === "step") step(event.reverse);
      else if (event.type === "commit") commit();
      else cancel();
    });
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      unsubscribeDesktop?.();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [cancel, commit, step]);

  return gesture ? (
    <ThreadSwitcherOverlay
      gesture={gesture}
      threadByKey={threadByKey}
      projectByKey={projectByKey}
      environmentLabelById={environmentLabelById}
      providerEntriesByEnvironment={providerEntriesByEnvironment}
    />
  ) : null;
}
