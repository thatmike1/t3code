import { scopeProjectRef } from "@t3tools/client-runtime/environment";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { getProjectOrderKey } from "../logicalProject";
import { resolveHomeProject } from "../sidebarProjectPreferences";
import { useProjects } from "../state/entities";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "../state/environments";
import { useUiStateStore } from "../uiStateStore";
import { useNewThreadHandler } from "./useHandleNewThread";

// Independent of the open thread and the sidebar filters: the home project is
// one exact checkout, chosen once from the sidebar's project filter.
export function useStartHomeThread() {
  const home = useUiStateStore((store) => store.homeProject);
  const projects = useProjects();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const environments = useEnvironmentIdentities();
  const handleNewThread = useNewThreadHandler();
  const resolution = resolveHomeProject({
    home,
    projects,
    projectKey: getProjectOrderKey,
    connectedEnvironmentIds,
  });

  const startHomeThread = async () => {
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
        const machine =
          environments.find(
            (environment) => environment.environmentId === resolution.project.environmentId,
          )?.label ?? "Its machine";
        toastManager.add({
          type: "error",
          title: "Home project is offline",
          description: `${machine} is not connected. Reconnect it to start a thread in ${resolution.project.title}.`,
        });
        return;
      }
      case "ready":
        await handleNewThread(
          scopeProjectRef(resolution.project.environmentId, resolution.project.id),
        ).catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not start a thread in the home project",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        });
    }
  };

  return {
    homeProject: resolution.status === "unset" ? null : resolution,
    startHomeThread,
  };
}
