import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useEffect } from "react";

import { setDocumentThreadLabel, threadTitleLabel } from "../documentTitle";
import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";
import { useProject, useThreadShell } from "../state/entities";

/** puts the open thread's title into the window title; renders nothing. */
export function DocumentThreadTitle() {
  const threadRef = useThreadRouteRef();
  const shell = useThreadShell(threadRef);
  const project = useProject(shell ? scopeProjectRef(shell.environmentId, shell.projectId) : null);
  const label = threadTitleLabel(shell?.title ?? null, project?.title ?? null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document.title lives outside react
  useEffect(() => {
    setDocumentThreadLabel(label);
    return () => setDocumentThreadLabel(null);
  }, [label]);
  return null;
}
