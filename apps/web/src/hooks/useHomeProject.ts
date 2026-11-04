import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { getProjectOrderKey } from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentId } from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  type HomeProjectPreference,
  type HomeProjectResolution,
  resolveHomeProject,
} from "../sidebarProjectPreferences";
import { readProjects, useProjects } from "../state/entities";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "../state/environments";
import { environmentSummaries } from "../state/presentation";
import { useUiStateStore } from "../uiStateStore";
import { type NewThreadHandler, useNewThreadHandler } from "./useHandleNewThread";

type HomeProject = ReturnType<typeof readProjects>[number];

function resolveHome(input: {
  home: HomeProjectPreference | null;
  projects: readonly HomeProject[];
  connectedEnvironmentIds: ReadonlyArray<EnvironmentId>;
}): HomeProjectResolution<HomeProject> {
  return resolveHomeProject({ ...input, projectKey: getProjectOrderKey });
}

async function startThreadInHome(input: {
  resolution: HomeProjectResolution<HomeProject>;
  environmentLabel: (environmentId: EnvironmentId) => string | null;
  handleNewThread: NewThreadHandler;
}): Promise<void> {
  const { resolution } = input;
  switch (resolution.status) {
    case "unset":
      toastManager.add({
        type: "info",
        title: "No home project yet",
        description:
          "Right-click a project in the sidebar's project filter and choose Set as home project.",
      });
      return;
    case "missing":
      toastManager.add({
        type: "error",
        title: "Home project not found",
        description: `${resolution.label} is not available. Choose another home project from the sidebar's project filter.`,
      });
      return;
    case "offline": {
      const machine = input.environmentLabel(resolution.project.environmentId) ?? "Its machine";
      toastManager.add({
        type: "error",
        title: "Home project is offline",
        description: `${machine} is not connected. Reconnect it to start a thread in ${resolution.project.title}.`,
      });
      return;
    }
    case "ready":
      await input
        .handleNewThread(scopeProjectRef(resolution.project.environmentId, resolution.project.id))
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not start a thread in the home project",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        });
  }
}

// reads everything at call time, for the chat route's shortcut scope.
export function startHomeThreadNow(handleNewThread: NewThreadHandler): Promise<void> {
  const identities = appAtomRegistry.get(environmentSummaries.identitiesAtom);
  return startThreadInHome({
    resolution: resolveHome({
      home: useUiStateStore.getState().homeProject,
      projects: readProjects(),
      connectedEnvironmentIds: appAtomRegistry.get(
        environmentSummaries.connectedEnvironmentIdsAtom,
      ),
    }),
    environmentLabel: (environmentId) =>
      identities.find((environment) => environment.environmentId === environmentId)?.label ?? null,
    handleNewThread,
  });
}

// Independent of the open thread and the sidebar filters: the home project is
// one exact checkout, chosen once from the sidebar's project menu.
export function useStartHomeThread() {
  const home = useUiStateStore((store) => store.homeProject);
  const projects = useProjects();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const environments = useEnvironmentIdentities();
  const handleNewThread = useNewThreadHandler();
  const resolution = resolveHome({ home, projects, connectedEnvironmentIds });

  const startHomeThread = () =>
    startThreadInHome({
      resolution,
      environmentLabel: (environmentId) =>
        environments.find((environment) => environment.environmentId === environmentId)?.label ??
        null,
      handleNewThread,
    });

  return {
    homeProject: resolution.status === "unset" ? null : resolution,
    startHomeThread,
  };
}
