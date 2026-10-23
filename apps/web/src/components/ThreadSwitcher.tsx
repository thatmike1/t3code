import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import { scopedProjectKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { resolveSettledThreadTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  AlarmClockIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  MessageCircleQuestionIcon,
  PinIcon,
  ShieldQuestionIcon,
  SquarePenIcon,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  composerDraftHasUserContent,
  type ComposerThreadDraftState,
  type DraftId,
  type DraftSessionState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { cn } from "../lib/utils";
import {
  deriveProviderEntriesByEnvironment,
  type ProviderInstanceEntry,
  shouldShowInstanceBadge,
} from "../providerInstances";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../state/environments";
import { useProjects, useServerConfigs, useThreadShells } from "../state/entities";
import {
  beginThreadSwitch,
  draftTarget,
  getRecentEntries,
  isThreadSwitchEligible,
  pruneRecentEntries,
  type RecentEntry,
  selectThreadSwitch,
  selectedSwitchTarget,
  setRecentEntries,
  stepThreadSwitch,
  type SwitchTarget,
  switchTargetKey,
  threadTarget,
  type ThreadSwitcherGesture,
  visitTarget,
} from "../thread-switcher.logic";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { useUiStateStore } from "../uiStateStore";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveSidebarV2TopStatus,
  resolveThreadLastVisitedAt,
  resolveWorkingStartedAt,
  type SidebarV2TopStatusKind,
} from "./Sidebar.logic";
import { SidebarProviderStack, WorkingDuration } from "./sidebar/SidebarThreadRow";
import { ThreadCommandSubtitle } from "./ThreadCommandSubtitle";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel, type ModelEsque } from "./chat/providerIconUtils";
import { CommandFooter } from "./ui/command";
import { DIALOG_BACKDROP_CLASS, DIALOG_POPUP_CLASS } from "./ui/dialog-styles";
import { Kbd, KbdGroup } from "./ui/kbd";

export function threadSwitcherAgentLabel(
  thread: Pick<EnvironmentThreadShell, "modelSelection" | "runtime">,
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
    : (providerEntry?.displayName ?? thread.runtime?.providerName ?? thread.modelSelection.model);
}

/** first line of a draft's prompt, or its attachment count, as the sidebar's draft rows show it */
export function draftPreviewLabel(composer: ComposerThreadDraftState): string {
  const promptPreview =
    replaceComposerContextReferences(composer.prompt, (occurrence) => occurrence.label)
      .trim()
      .split("\n", 1)[0] ?? "";
  if (promptPreview.length > 0) return promptPreview;
  const attachmentCount =
    Math.max(composer.images.length, composer.persistedAttachments.length) +
    composer.files.length +
    composer.terminalContexts.length +
    composer.previewAnnotations.length +
    composer.reviewComments.length;
  return attachmentCount > 0
    ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`
    : "New thread";
}

function compactTimeLabel(timestamp: string | null): string {
  if (timestamp === null) return "";
  const label = formatRelativeTimeLabel(timestamp);
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

function isThreadSettled(
  thread: EnvironmentThreadShell,
  config: EnvironmentServerConfig | undefined,
): boolean {
  return (
    config?.environment.capabilities?.threadSettlement === true &&
    thread.settledOverride === "settled"
  );
}

// the sidebar's top-status presentation (SidebarThreadRow): same labels,
// icons and hues, so a thread reads the same in the switcher as in the list.
const TOP_STATUS_PRESENTATION: Record<
  SidebarV2TopStatusKind,
  { readonly label: string; readonly icon: ReactNode; readonly className: string }
> = {
  working: {
    label: "Working",
    icon: <CircleDashedIcon aria-hidden className="size-3.5 shrink-0" />,
    className: "text-info",
  },
  waiting: {
    label: "Waiting",
    icon: <CircleDotDashedIcon aria-hidden className="size-3.5 shrink-0" />,
    className: "text-muted-foreground",
  },
  approval: {
    label: "Approval",
    icon: <ShieldQuestionIcon aria-hidden className="size-3.5 shrink-0" />,
    className: "text-warning-foreground",
  },
  input: {
    label: "Input",
    icon: <MessageCircleQuestionIcon aria-hidden className="size-3.5 shrink-0" />,
    className: "text-indigo-600 dark:text-indigo-300",
  },
  limited: {
    label: "Limited",
    icon: <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />,
    className: "text-warning",
  },
  failed: {
    label: "Failed",
    icon: <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />,
    className: "text-error",
  },
  woke: {
    label: "Woke",
    icon: <AlarmClockIcon aria-hidden className="size-3.5 shrink-0" />,
    className: "text-warning",
  },
  done: {
    label: "Done",
    icon: <CircleCheckIcon aria-hidden className="size-3.5 shrink-0" />,
    className: "text-success",
  },
};

function ThreadSwitcherStatus(props: {
  readonly thread: EnvironmentThreadShell;
  readonly settled: boolean;
}) {
  const { thread } = props;
  const threadKey = scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const status = resolveSidebarThreadStatus(thread);
  const topStatus = resolveSidebarV2TopStatus({
    status,
    isUnread: hasUnseenCompletion({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt),
    }),
    isWoke: false,
  });
  // settling is a deliberate "done with it": a finished run's Failed or Done
  // is noise there, but work still in flight keeps its status.
  const inFlight =
    status === "working" || status === "waiting" || status === "approval" || status === "input";
  if (topStatus === null || (props.settled && !inFlight)) {
    return props.settled ? (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <CheckIcon aria-hidden className="size-3.5 shrink-0" />
        <span>Settled</span>
        <span className="tabular-nums">
          {compactTimeLabel(resolveSettledThreadTimestamp(thread))}
        </span>
      </span>
    ) : (
      <span className="tabular-nums text-muted-foreground">
        {compactTimeLabel(thread.latestUserMessageAt ?? thread.updatedAt)}
      </span>
    );
  }
  const presentation = TOP_STATUS_PRESENTATION[topStatus];
  const label =
    topStatus === "working" && thread.goal?.status === "active" ? "Goal" : presentation.label;
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", presentation.className)}>
      {presentation.icon}
      <span>{label}</span>
      {status === "working" ? (
        <span aria-hidden className="font-normal">
          <WorkingDuration startedAt={resolveWorkingStartedAt(thread)} />
        </span>
      ) : status === "waiting" ? (
        <span aria-hidden className="font-normal">
          <WorkingDuration startedAt={thread.latestRun?.completedAt ?? null} />
        </span>
      ) : null}
    </span>
  );
}

interface RowShellProps {
  readonly index: number;
  readonly selected: boolean;
  readonly lead: ReactNode;
  readonly title: ReactNode;
  readonly titleMuted?: boolean;
  readonly trailing: ReactNode;
  readonly subtitle: ReactNode;
  readonly subtitleTrailing: ReactNode;
  readonly onActivate: (index: number) => void;
}

// one row: a glyph column that says what kind of agent or draft this is, the
// title and its status on top, where it lives and which model below.
function ThreadSwitcherRow(props: RowShellProps) {
  const { index, onActivate } = props;
  return (
    <li
      role="option"
      aria-selected={props.selected}
      data-index={index}
      data-testid="thread-switcher-row"
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
        props.selected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-foreground/[0.06] [&_[data-switcher-title]]:text-foreground/85",
      )}
      // pointerdown would move focus out of the composer and start a text
      // selection; the click alone decides.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => onActivate(index)}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground/[0.05]">
        {props.lead}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span
            data-switcher-title
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-medium",
              props.titleMuted && "text-muted-foreground!",
            )}
          >
            {props.title}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs">{props.trailing}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-1">{props.subtitle}</span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground/80">
            {props.subtitleTrailing}
          </span>
        </span>
      </span>
    </li>
  );
}

function ThreadRow(props: {
  readonly index: number;
  readonly selected: boolean;
  readonly isCurrent: boolean;
  readonly thread: EnvironmentThreadShell;
  readonly project: EnvironmentProject | null;
  readonly environmentLabel: string | null;
  readonly settled: boolean;
  readonly providerEntries: ReadonlyMap<string, ProviderInstanceEntry>;
  readonly onActivate: (index: number) => void;
}) {
  const { thread, providerEntries } = props;
  const instanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = providerEntries.get(instanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null && shouldShowInstanceBadge(providerEntry, providerEntries.values());
  return (
    <ThreadSwitcherRow
      index={props.index}
      selected={props.selected}
      onActivate={props.onActivate}
      lead={
        providerEntry ? (
          <ProviderInstanceIcon
            driverKind={providerEntry.driverKind}
            displayName={providerEntry.displayName}
            accentColor={providerEntry.accentColor}
            acpRegistryAgentId={providerEntry.acpRegistryAgentId}
            acpRegistryIconUrl={providerEntry.acpRegistryIconUrl}
            showBadge={showInstanceBadge}
            iconClassName={cn("size-4", props.settled && "opacity-50 grayscale")}
            badgeClassName="right-[-0.25rem] bottom-[-0.25rem] h-3 min-w-3 px-0.5 text-5xs"
          />
        ) : null
      }
      title={thread.title}
      titleMuted={props.settled}
      trailing={
        <>
          {thread.pinnedAt != null ? (
            <PinIcon
              aria-label="Pinned"
              role="img"
              className="size-3 shrink-0 text-muted-foreground/65"
            />
          ) : null}
          <ThreadSwitcherStatus thread={thread} settled={props.settled} />
        </>
      }
      subtitle={
        <ThreadCommandSubtitle
          project={props.project}
          projectTitle={props.project?.title ?? null}
          environmentLabel={props.environmentLabel}
          branch={thread.branch}
          worktreePath={thread.worktreePath}
          isCurrent={props.isCurrent}
        />
      }
      subtitleTrailing={
        <>
          {thread.providerInstanceHistory.length > 1 ? (
            <SidebarProviderStack thread={thread} providerEntryByInstanceId={providerEntries} />
          ) : null}
          <span className="max-w-40 truncate">
            {threadSwitcherAgentLabel(thread, providerEntry)}
          </span>
        </>
      }
    />
  );
}

function DraftRow(props: {
  readonly index: number;
  readonly selected: boolean;
  readonly isCurrent: boolean;
  readonly draftId: DraftId;
  readonly session: DraftSessionState;
  readonly project: EnvironmentProject | null;
  readonly environmentLabel: string | null;
  readonly providerEntries: ReadonlyMap<string, ProviderInstanceEntry>;
  readonly onActivate: (index: number) => void;
}) {
  const composer = useComposerDraftStore((state) => state.draftsByThreadKey[props.draftId]);
  const instanceId = composer?.activeProvider ?? null;
  const providerEntry = instanceId ? (props.providerEntries.get(instanceId) ?? null) : null;
  const modelSlug = instanceId ? composer?.modelSelectionByProvider[instanceId]?.model : undefined;
  const model = modelSlug
    ? providerEntry?.models.find((entry) => entry.slug === modelSlug)
    : undefined;
  const preview = composer ? draftPreviewLabel(composer) : "New thread";
  return (
    <ThreadSwitcherRow
      index={props.index}
      selected={props.selected}
      onActivate={props.onActivate}
      lead={<SquarePenIcon aria-hidden className="size-4 text-warning-foreground" />}
      title={preview}
      titleMuted={preview === "New thread"}
      trailing={
        <span className="inline-flex items-center gap-1 text-warning-foreground">
          <span className="font-medium">Draft</span>
          <span className="tabular-nums text-muted-foreground">
            {compactTimeLabel(props.session.createdAt)}
          </span>
        </span>
      }
      subtitle={
        <ThreadCommandSubtitle
          project={props.project}
          projectTitle={props.project?.title ?? null}
          environmentLabel={props.environmentLabel}
          branch={props.session.branch}
          worktreePath={props.session.worktreePath}
          isCurrent={props.isCurrent}
        />
      }
      subtitleTrailing={
        providerEntry ? (
          <>
            <ProviderInstanceIcon
              driverKind={providerEntry.driverKind}
              displayName={providerEntry.displayName}
              acpRegistryAgentId={providerEntry.acpRegistryAgentId}
              acpRegistryIconUrl={providerEntry.acpRegistryIconUrl}
              iconClassName="size-3 opacity-60"
            />
            <span className="max-w-40 truncate">
              {model ? getTriggerDisplayModelLabel(model) : providerEntry.displayName}
            </span>
          </>
        ) : null
      }
    />
  );
}

function ThreadSwitcherOverlay(props: {
  readonly gesture: ThreadSwitcherGesture;
  readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, EnvironmentServerConfig>;
  readonly remoteEnvironmentLabel: (environmentId: EnvironmentId) => string | null;
  readonly providerEntriesByEnvironment: ReadonlyMap<
    string,
    ReadonlyMap<string, ProviderInstanceEntry>
  >;
  readonly onActivate: (index: number) => void;
  readonly onDismiss: () => void;
}) {
  const { gesture } = props;
  const draftSessions = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const listRef = useRef<HTMLOListElement>(null);
  const emptyProviders = new Map<string, ProviderInstanceEntry>();

  // follow the keyboard selection only when it moves, so wheel scrolling is
  // not yanked back by unrelated re-renders.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${gesture.selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [gesture.selectedIndex]);

  const projectFor = (environmentId: EnvironmentId, projectId: ProjectId) =>
    props.projectByKey.get(scopedProjectKey({ environmentId, projectId })) ?? null;

  const rows = gesture.targets.map((target, index) => {
    const key = switchTargetKey(target);
    const selected = index === gesture.selectedIndex;
    const isCurrent = gesture.anchored && index === 0;
    if (target.kind === "thread") {
      const thread = props.threadByKey.get(scopedThreadKey(target.ref));
      if (!thread) return null;
      return (
        <ThreadRow
          key={key}
          index={index}
          selected={selected}
          isCurrent={isCurrent}
          thread={thread}
          project={projectFor(thread.environmentId, thread.projectId)}
          environmentLabel={props.remoteEnvironmentLabel(thread.environmentId)}
          settled={isThreadSettled(thread, props.serverConfigs.get(thread.environmentId))}
          providerEntries={
            props.providerEntriesByEnvironment.get(thread.environmentId) ?? emptyProviders
          }
          onActivate={props.onActivate}
        />
      );
    }
    const session = draftSessions[target.draftId];
    if (!session) return null;
    return (
      <DraftRow
        key={key}
        index={index}
        selected={selected}
        isCurrent={isCurrent}
        draftId={target.draftId}
        session={session}
        project={projectFor(session.environmentId, session.projectId)}
        environmentLabel={props.remoteEnvironmentLabel(session.environmentId)}
        providerEntries={
          props.providerEntriesByEnvironment.get(session.environmentId) ?? emptyProviders
        }
        onActivate={props.onActivate}
      />
    );
  });

  const swallow = (event: ReactPointerEvent) => event.preventDefault();

  return (
    // the whole screen takes the pointer while the switcher is open: a drag
    // must not select text behind it and a click outside dismisses it.
    <div
      className="fixed inset-0 z-100 select-none"
      onPointerDown={swallow}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        aria-hidden
        data-testid="thread-switcher-backdrop"
        className={cn(DIALOG_BACKDROP_CLASS, "absolute z-0")}
        onClick={props.onDismiss}
      />
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center px-4 py-4 sm:py-20">
        <div
          role="dialog"
          aria-label="Recent threads"
          data-testid="thread-switcher"
          className={cn(DIALOG_POPUP_CLASS, "pointer-events-auto max-w-xl overflow-hidden")}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            <span>Recent threads</span>
            <span className="tabular-nums text-muted-foreground/70">
              {gesture.selectedIndex + 1} / {gesture.targets.length}
            </span>
          </div>
          <ol
            ref={listRef}
            role="listbox"
            aria-label="Recent threads"
            className="max-h-[min(30rem,62vh)] overflow-y-auto overscroll-contain p-2 pt-1"
          >
            {rows}
          </ol>
          <CommandFooter>
            <div className="flex items-center gap-3 text-xs">
              <KbdGroup>
                <Kbd>Tab</Kbd>
                <span>Next</span>
              </KbdGroup>
              <KbdGroup>
                <Kbd>Shift Tab</Kbd>
                <span>Back</span>
              </KbdGroup>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <span>Release to open</span>
              </KbdGroup>
              <KbdGroup>
                <Kbd>Esc</Kbd>
                <span>Cancel</span>
              </KbdGroup>
            </div>
          </CommandFooter>
        </div>
      </div>
    </div>
  );
}

export function ThreadSwitcher() {
  const params = useParams({ strict: false });
  // primitives, so the callbacks below change only when the route does.
  const routeEnvironmentId = params.environmentId;
  const routeThreadId = params.threadId;
  const routeDraftId = params.draftId;
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const serverConfigs = useServerConfigs();
  const providersByEnvironment = useEnvironmentProviders();
  const [gesture, setGesture] = useState<ThreadSwitcherGesture | null>(null);
  const gestureRef = useRef<ThreadSwitcherGesture | null>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);

  const threadByKey = new Map(
    threads.map((thread) => [
      scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
      thread,
    ]),
  );
  const projectByKey = new Map(
    projects.map((project) => [
      scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }),
      project,
    ]),
  );
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  const remoteEnvironmentLabel = (environmentId: EnvironmentId) =>
    environmentId === primaryEnvironmentId
      ? null
      : (environmentLabelById.get(environmentId) ?? "Remote");
  // instance ids are per-environment routing keys, so each thread resolves its
  // provider entry from its own environment's config, as the sidebar does.
  const providerEntriesByEnvironment = deriveProviderEntriesByEnvironment(
    [...serverConfigs].map(
      ([environmentId, config]) =>
        [environmentId, providersByEnvironment.get(environmentId) ?? [], config.settings] as const,
    ),
  );

  // the view on screen as a switch target; a sent draft counts as its thread.
  const currentTarget = (): SwitchTarget | null => {
    const routeTarget = resolveThreadRouteTarget({
      environmentId: routeEnvironmentId,
      threadId: routeThreadId,
      draftId: routeDraftId,
    });
    if (routeTarget === null) return null;
    if (routeTarget.kind === "server") return threadTarget(routeTarget.threadRef);
    const session = useComposerDraftStore.getState().draftThreadsByThreadKey[routeTarget.draftId];
    if (session?.promotedTo) return threadTarget(session.promotedTo);
    return draftTarget(routeTarget.draftId);
  };

  // drops archived or deleted threads and discarded drafts, swaps a sent
  // draft for its thread, and drops blank drafts no longer on screen. A thread
  // whose shell has not loaded yet (startup, a remote still connecting) stays
  // in the history; it is only left out of the list.
  const resolveTarget = (target: SwitchTarget, keepBlankDraft: boolean): SwitchTarget | null => {
    if (target.kind === "thread") {
      const thread = threadByKey.get(scopedThreadKey(target.ref));
      return thread && (thread.archivedAt !== null || thread.deletedAt !== null) ? null : target;
    }
    const store = useComposerDraftStore.getState();
    const session = store.draftThreadsByThreadKey[target.draftId];
    if (!session) return null;
    if (session.promotedTo) return threadTarget(session.promotedTo);
    if (keepBlankDraft) return target;
    const composer = store.draftsByThreadKey[target.draftId];
    return composer && composerDraftHasUserContent(composer) ? target : null;
  };

  useEffect(() => {
    const current = currentTarget();
    let history = getRecentEntries();
    if (current !== null && resolveTarget(current, true) !== null) {
      history = visitTarget(history, current, Date.now());
    }
    const currentKey = current === null ? null : switchTargetKey(current);
    history = pruneRecentEntries(history, (target) =>
      resolveTarget(target, switchTargetKey(target) === currentKey),
    );
    setRecentEntries(history);
  }, [currentTarget, resolveTarget]);

  const closeGesture = (restoreFocus: boolean) => {
    const priorFocus = priorFocusRef.current;
    gestureRef.current = null;
    setGesture(null);
    priorFocusRef.current = null;
    if (restoreFocus) {
      requestAnimationFrame(() => {
        if (priorFocus?.isConnected) priorFocus.focus();
      });
    }
  };

  const cancel = () => closeGesture(true);
  const commit = () => {
    const activeGesture = gestureRef.current;
    const selected = activeGesture ? selectedSwitchTarget(activeGesture) : null;
    closeGesture(false);
    if (!selected) return;
    const resolved = resolveTarget(selected, true);
    if (resolved === null) return;
    if (resolved.kind === "thread") {
      if (!threadByKey.has(scopedThreadKey(resolved.ref))) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: resolved.ref.environmentId, threadId: resolved.ref.threadId },
      });
    } else {
      void navigate({ to: "/draft/$draftId", params: { draftId: resolved.draftId } });
    }
  };

  const activate = (index: number) => {
    if (!gestureRef.current) return;
    gestureRef.current = selectThreadSwitch(gestureRef.current, index);
    // a click commits at once; the gesture is gone before Ctrl comes up, so
    // the release that follows finds nothing to open twice.
    commit();
  };

  const isEligible = (entry: RecentEntry, now: number): boolean => {
    if (entry.target.kind === "draft") return true;
    const thread = threadByKey.get(scopedThreadKey(entry.target.ref));
    if (!thread || thread.archivedAt !== null || thread.deletedAt !== null) return false;
    const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
    const settledTimestamp = resolveSettledThreadTimestamp(thread);
    const settledAtMs = settledTimestamp === null ? null : Date.parse(settledTimestamp);
    return isThreadSwitchEligible({
      settled: isThreadSettled(thread, serverConfigs.get(thread.environmentId)),
      snoozed:
        capabilities?.threadSnooze === true &&
        effectiveSnoozed(thread, { now: new Date(now).toISOString() }),
      settledAtMs: settledAtMs !== null && Number.isNaN(settledAtMs) ? null : settledAtMs,
      seenAt: entry.seenAt,
      now,
    });
  };

  const step = (reverse: boolean): boolean => {
    if (gestureRef.current) {
      const next = stepThreadSwitch(gestureRef.current, reverse);
      gestureRef.current = next;
      setGesture(next);
      return true;
    }
    const now = Date.now();
    const current = currentTarget();
    const currentKey = current === null ? null : switchTargetKey(current);
    // existence is checked against the clock and data of this moment, so a
    // memo that only changes on shell updates cannot keep expired entries.
    const history = pruneRecentEntries(getRecentEntries(), (target) =>
      resolveTarget(target, switchTargetKey(target) === currentKey),
    );
    setRecentEntries(history);
    const next = beginThreadSwitch(history, current, reverse, (entry) => isEligible(entry, now));
    if (!next) return false;
    priorFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    gestureRef.current = next;
    setGesture(next);
    return true;
  };

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
      serverConfigs={serverConfigs}
      remoteEnvironmentLabel={remoteEnvironmentLabel}
      providerEntriesByEnvironment={providerEntriesByEnvironment}
      onActivate={activate}
      onDismiss={cancel}
    />
  ) : null;
}
