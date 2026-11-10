/** the open thread leads the title so window watchers (ActivityWatch) can tell threads apart. */
let appName = "";
let threadLabel: string | null = null;

export function composeDocumentTitle(app: string, label: string | null): string {
  return label ? `${label} · ${app}` : app;
}

function applyDocumentTitle(): void {
  document.title = composeDocumentTitle(appName, threadLabel);
}

export function setDocumentAppName(name: string): void {
  appName = name;
  applyDocumentTitle();
}

export function setDocumentThreadLabel(label: string | null): void {
  threadLabel = label;
  applyDocumentTitle();
}

export function threadTitleLabel(threadTitle: string | null, projectTitle: string | null) {
  const thread = threadTitle?.trim();
  if (!thread) return null;
  const project = projectTitle?.trim();
  return project ? `${thread} · ${project}` : thread;
}
