/**
 * Reading Sidebery's per-tab colours out of a Firefox session store.
 *
 * Sidebery keeps its tab state through `browser.sessions.setTabValue`, which
 * Firefox persists into the session file under each tab's `extData`, keyed by
 * the extension id. The value is a JSON string; its optional `customColor` is
 * the colour the user picked for that tab.
 *
 * @module firefoxSession
 */
import type { TabTintColor } from "@t3tools/contracts";

export const SIDEBERY_EXT_DATA_KEY = "extension:{3c078156-979c-498b-8990-85f7987dd929}:data";

/** Where the running profile keeps the session Firefox rewrites every ~15 s. */
export const SESSION_FILE_RELATIVE_PATH = "sessionstore-backups/recovery.jsonlz4";

const COLORS: ReadonlySet<string> = new Set<TabTintColor>([
  "blue",
  "turquoise",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
]);

export interface ColoredTab {
  readonly url: string;
  readonly color: TabTintColor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The URL the tab currently shows: `entries[index - 1]`, with `index` 1-based. */
function currentUrl(tab: Record<string, unknown>): string | null {
  const entries = tab.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const index = typeof tab.index === "number" ? tab.index : entries.length;
  const entry: unknown = entries[Math.min(Math.max(index, 1), entries.length) - 1];
  return isRecord(entry) && typeof entry.url === "string" ? entry.url : null;
}

function sideberyColor(tab: Record<string, unknown>): TabTintColor | null {
  const extData = tab.extData;
  if (!isRecord(extData)) return null;
  const raw = extData[SIDEBERY_EXT_DATA_KEY];
  if (typeof raw !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data.customColor !== "string") return null;
  return COLORS.has(data.customColor) ? (data.customColor as TabTintColor) : null;
}

/**
 * Every open tab Sidebery has a colour for, in window then tab order. Closed
 * windows are skipped, and so are Sidebery's own group pages
 * (`moz-extension://`), which no thread can have opened.
 */
export function extractColoredTabs(session: unknown): Array<ColoredTab> {
  if (!isRecord(session) || !Array.isArray(session.windows)) return [];
  const tabs: Array<ColoredTab> = [];
  for (const window of session.windows) {
    if (!isRecord(window) || !Array.isArray(window.tabs)) continue;
    for (const tab of window.tabs) {
      if (!isRecord(tab)) continue;
      const color = sideberyColor(tab);
      if (color === null) continue;
      const url = currentUrl(tab);
      if (url === null || url.startsWith("moz-extension:")) continue;
      tabs.push({ url, color });
    }
  }
  return tabs;
}

/**
 * The directory of the profile Firefox starts by default, from `profiles.ini`.
 * An `[Install…]` section's `Default=` is what current Firefox actually
 * launches, so it wins over the legacy `Default=1` flag on a `[Profile…]`
 * section. The result is relative to the Firefox directory unless it is an
 * absolute path (a profile created with `IsRelative=0`).
 */
export function defaultProfilePath(profilesIni: string): string | null {
  const sections: Array<{ name: string; values: Map<string, string> }> = [];
  for (const rawLine of profilesIni.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
    const header = /^\[(.+)\]$/u.exec(line);
    if (header) {
      sections.push({ name: header[1]!, values: new Map() });
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0 || sections.length === 0) continue;
    sections.at(-1)!.values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }

  const install = sections.find(
    (section) => section.name.startsWith("Install") && section.values.get("Default"),
  );
  if (install) return install.values.get("Default")!;

  const profiles = sections.filter((section) => section.name.startsWith("Profile"));
  const profile =
    profiles.find((section) => section.values.get("Default") === "1") ??
    (profiles.length === 1 ? profiles[0] : undefined);
  return profile?.values.get("Path") ?? null;
}
