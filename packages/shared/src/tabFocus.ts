/**
 * Tab focus: asking the browser to bring an already open tab forward.
 *
 * Nothing outside Firefox can select one of its tabs, so the request is a new
 * tab whose URL carries a marker. A hook in the browser's startup script sees
 * the marker, switches to the open tab with the same URL and closes the new
 * one. The marker format is a contract with that hook: it strips exactly a
 * trailing `#t3-focus` or `&t3-focus` before comparing URLs, so the rest of
 * the string has to stay byte for byte what the browser reported.
 *
 * @module tabFocus
 */

export const TAB_FOCUS_MARKER = "t3-focus";

/**
 * The URL with the focus marker on its end: `#t3-focus` when it has no
 * fragment, `&t3-focus` appended to the fragment it already has.
 */
export function appendTabFocusMarker(url: string): string {
  return `${url}${url.includes("#") ? "&" : "#"}${TAB_FOCUS_MARKER}`;
}

/** The URL with a trailing focus marker removed, or null when it carries none. */
export function stripTabFocusMarker(url: string): string | null {
  const hash = `#${TAB_FOCUS_MARKER}`;
  if (url.endsWith(hash)) {
    const stripped = url.slice(0, -hash.length);
    return stripped.includes("#") ? null : stripped;
  }
  const amp = `&${TAB_FOCUS_MARKER}`;
  if (url.endsWith(amp)) {
    const stripped = url.slice(0, -amp.length);
    return stripped.includes("#") ? stripped : null;
  }
  return null;
}

/**
 * Whether a string is a focus request the desktop shell may hand to the
 * system browser: a web page or a local file, and only with the marker on it.
 * The marker is what keeps this from being a general way to open `file:`
 * URLs, which the ordinary external-link route refuses.
 */
export function isTabFocusUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || stripTabFocusMarker(raw) === null) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "file:") return url.host === "";
  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * A short name for the page a tab shows, for a tooltip: host and path for a
 * web page, the last two path segments for a file.
 */
export function tabFocusLabel(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  const segments = path.split("/").filter((segment) => segment !== "");
  if (url.protocol === "file:") {
    return segments.length === 0 ? "/" : segments.slice(-2).join("/");
  }
  return segments.length === 0 ? url.host : `${url.host}/${segments.join("/")}`;
}
