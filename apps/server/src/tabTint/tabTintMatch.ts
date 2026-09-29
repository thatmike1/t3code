// @effect-diagnostics nodeBuiltinImport:off - pure string and URL helpers, no I/O.
/**
 * Which thread opened which browser tab, and so which thread a coloured tab
 * belongs to.
 *
 * The evidence is the thread's own tool activity: a command such as
 * `xdg-open http://127.0.0.1:1346/` or `cd site && xdg-open index.html` is an
 * open. Commands are read with a small shell lexer rather than a regex so a
 * `cd` earlier in the same command moves the directory a relative path
 * resolves against, and so text that merely mentions `xdg-open` (a heredoc
 * body, a quoted argument) does not count.
 *
 * @module tabTintMatch
 */
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { TabTintColor, ThreadTabTint } from "@t3tools/contracts";
import { ThreadId } from "@t3tools/contracts";

import type { ColoredTab } from "./firefoxSession.ts";

// ---------------------------------------------------------------------------
// shell lexing

interface ShellWord {
  readonly text: string;
  /** the word contains a `$` expansion or a glob, so its value is unknowable here */
  readonly dynamic: boolean;
}

/**
 * Splits a shell command into simple commands, each a list of words. Quotes
 * and backslashes are honoured, `;` `&` `|` newlines, parentheses and
 * backticks separate commands, redirections and their targets are dropped,
 * comments and heredoc bodies are skipped. It is not a full shell parser; it
 * only has to find the commands that open things and the `cd`s before them.
 */
export function lexShell(command: string): Array<Array<ShellWord>> {
  const commands: Array<Array<ShellWord>> = [];
  let words: Array<ShellWord> = [];
  let text = "";
  let inWord = false;
  let dynamic = false;
  let dropNextWord = false;
  const pendingHeredocs: Array<string> = [];

  const flushWord = () => {
    if (!inWord) return;
    if (dropNextWord) dropNextWord = false;
    else words.push({ text, dynamic });
    text = "";
    inWord = false;
    dynamic = false;
  };
  const endCommand = () => {
    flushWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };

  let i = 0;
  while (i < command.length) {
    const ch = command[i]!;

    if (ch === "\\") {
      if (command[i + 1] === "\n") {
        i += 2;
        continue;
      }
      text += command[i + 1] ?? "";
      inWord = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      const close = end === -1 ? command.length : end;
      text += command.slice(i + 1, close);
      inWord = true;
      i = close + 1;
      continue;
    }
    if (ch === '"') {
      inWord = true;
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === "\\" && i + 1 < command.length && '"\\$`'.includes(command[i + 1]!)) {
          text += command[i + 1];
          i += 2;
          continue;
        }
        if (command[i] === "$" || command[i] === "`") dynamic = true;
        text += command[i];
        i++;
      }
      i++;
      continue;
    }
    if (ch === "#" && !inWord) {
      while (i < command.length && command[i] !== "\n") i++;
      continue;
    }
    if (ch === "\n") {
      endCommand();
      i++;
      // Heredoc bodies start on the line after their operator and run to a
      // line holding only the delimiter; none of it is a command.
      while (pendingHeredocs.length > 0) {
        const delimiter = pendingHeredocs.shift()!;
        while (i < command.length) {
          const lineEnd = command.indexOf("\n", i);
          const stop = lineEnd === -1 ? command.length : lineEnd;
          const line = command.slice(i, stop).trim();
          i = stop + 1;
          if (line === delimiter) break;
        }
      }
      continue;
    }
    if (ch === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      flushWord();
      i += 2;
      if (command[i] === "-") i++;
      while (command[i] === " " || command[i] === "\t") i++;
      const match = /^(['"]?)([A-Za-z0-9_.-]+)\1/u.exec(command.slice(i));
      if (match) {
        pendingHeredocs.push(match[2]!);
        i += match[0].length;
      }
      continue;
    }
    if (ch === ";" || ch === "&" || ch === "|" || ch === "(" || ch === ")" || ch === "`") {
      endCommand();
      i++;
      continue;
    }
    if (ch === ">" || ch === "<") {
      // `2>&1`, `>/dev/null`: the fd number before and the target after are not arguments.
      if (inWord && /^\d+$/u.test(text)) {
        text = "";
        inWord = false;
      } else {
        flushWord();
      }
      i++;
      if (command[i] === ">" || command[i] === "<") i++;
      if (command[i] === "&") {
        i++;
        while (i < command.length && /[0-9-]/u.test(command[i]!)) i++;
        continue;
      }
      dropNextWord = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      flushWord();
      i++;
      continue;
    }
    if (ch === "$" || ch === "*" || ch === "?") dynamic = true;
    text += ch;
    inWord = true;
    i++;
  }
  endCommand();
  return commands;
}

// ---------------------------------------------------------------------------
// finding opens in a command

const OPENERS = new Set([
  "xdg-open",
  "firefox",
  "firefox-esr",
  "sensible-browser",
  "x-www-browser",
  "www-browser",
]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
const WRAPPERS = new Set(["nohup", "setsid", "exec", "command", "env", "time"]);

function expandHome(target: string, home: string): string {
  if (target === "~") return home;
  if (target.startsWith("~/")) return NodePath.posix.join(home, target.slice(2));
  return target;
}

/**
 * What an opener argument refers to, as a URL string: `http(s)` and `file`
 * URLs as given, a path resolved against `cwd` and turned into a `file://`
 * URL. Anything else (another scheme, a relative path with no known
 * directory, an unparseable URL) is null.
 */
export function normalizeOpenTarget(
  target: string,
  cwd: string | null,
  home: string,
): string | null {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) {
    try {
      const url = new URL(target);
      return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:"
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
  const expanded = expandHome(target, home);
  if (!NodePath.posix.isAbsolute(expanded) && cwd === null) return null;
  const absolute = NodePath.posix.resolve(cwd ?? "/", expanded);
  return NodeURL.pathToFileURL(absolute).href;
}

/**
 * Every browser target a command opens, in the order it opens them. `cwd` is
 * the directory the command started in; a `cd` inside the command moves it
 * for the commands after it.
 */
export function openTargetsInCommand(
  command: string,
  cwd: string | null,
  home: string,
  depth = 0,
): Array<string> {
  const targets: Array<string> = [];
  let directory = cwd;
  for (const words of lexShell(command)) {
    let start = 0;
    while (
      start < words.length &&
      (WRAPPERS.has(words[start]!.text) || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[start]!.text))
    ) {
      start++;
    }
    const head = words[start];
    if (head === undefined || head.dynamic) continue;
    const name = NodePath.posix.basename(head.text);
    const args = words.slice(start + 1);

    if (name === "cd" || name === "pushd") {
      const target = args.find((word) => !word.text.startsWith("-"));
      if (target === undefined) directory = home;
      else if (target.dynamic) directory = null;
      else {
        const expanded = expandHome(target.text, home);
        if (NodePath.posix.isAbsolute(expanded)) directory = NodePath.posix.normalize(expanded);
        else if (directory !== null) directory = NodePath.posix.resolve(directory, expanded);
      }
      continue;
    }

    if (SHELLS.has(name) && depth < 2) {
      const flagIndex = args.findIndex((word) => /^-[a-z]*c[a-z]*$/u.test(word.text));
      const script = flagIndex === -1 ? undefined : args[flagIndex + 1];
      if (script !== undefined) {
        targets.push(...openTargetsInCommand(script.text, directory, home, depth + 1));
      }
      continue;
    }

    const isGioOpen = name === "gio" && args[0]?.text === "open";
    if (!OPENERS.has(name) && !isGioOpen) continue;
    const target = args.slice(isGioOpen ? 1 : 0).find((word) => !word.text.startsWith("-"));
    if (target === undefined || target.dynamic) continue;
    const normalized = normalizeOpenTarget(target.text, directory, home);
    if (normalized !== null) targets.push(normalized);
  }
  return targets;
}

// ---------------------------------------------------------------------------
// reading commands out of stored activity

export interface ActivityCommand {
  readonly command: string;
  /** the directory the provider reports it ran in, when it reports one */
  readonly cwd: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The shell command a tool activity ran, from either provider's payload:
 * Claude keeps it at `data.input.command` with no directory, Codex at
 * `data.item.command` (wrapped in `bash -lc`) with `data.item.cwd`.
 */
export function commandFromActivityPayload(payload: unknown): ActivityCommand | null {
  if (!isRecord(payload) || payload.itemType !== "command_execution") return null;
  const data = payload.data;
  if (!isRecord(data)) return null;
  const item = data.item;
  if (isRecord(item) && typeof item.command === "string") {
    return { command: item.command, cwd: typeof item.cwd === "string" ? item.cwd : null };
  }
  const input = data.input;
  if (isRecord(input) && typeof input.command === "string") {
    return { command: input.command, cwd: typeof input.cwd === "string" ? input.cwd : null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// matching tabs to threads

export interface OpenClaim {
  readonly threadId: string;
  /** a URL string as produced by `normalizeOpenTarget` */
  readonly target: string;
  /** when the thread opened it, as epoch milliseconds */
  readonly openedAt: number;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/** Sidebery's palette order, the tie-break when one thread's tabs disagree. */
const COLOR_ORDER: ReadonlyArray<TabTintColor> = [
  "blue",
  "turquoise",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
];

interface ParsedUrl {
  /** scheme, loopback-folded host and port; empty for files */
  readonly origin: string;
  readonly path: string;
  readonly isFile: boolean;
}

function parseUrl(raw: string): ParsedUrl | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === "file:") {
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      path = url.pathname;
    }
    return { origin: "", path, isFile: true };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = LOOPBACK_HOSTS.has(url.hostname) ? "127.0.0.1" : url.hostname;
  return {
    origin: `${url.protocol}//${host}:${url.port}`,
    path: url.pathname === "" ? "/" : url.pathname,
    isFile: false,
  };
}

/** `/proto/x/` and `/proto/x` are the same page for matching purposes. */
function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * How strongly an opened URL claims a tab, or null when it does not.
 *
 * An exact page match is strongest. Otherwise an http(s) open claims the
 * whole first path segment it sits under, so opening `/proto/x` claims every
 * tab under `/proto/`, but not the site root; only opening the root itself
 * claims the whole origin. A longer claimed prefix beats a shorter one. File
 * URLs only ever match exactly.
 */
function claimStrength(opened: ParsedUrl, tab: ParsedUrl): number | null {
  if (opened.isFile !== tab.isFile || opened.origin !== tab.origin) return null;
  const openedPath = trimTrailingSlash(opened.path);
  const tabPath = trimTrailingSlash(tab.path);
  if (openedPath === tabPath) return Number.MAX_SAFE_INTEGER;
  if (opened.isFile) return null;
  const segment = openedPath.split("/")[1] ?? "";
  if (segment === "") return 1;
  const scope = `/${segment}`;
  return tabPath === scope || tabPath.startsWith(`${scope}/`) ? scope.length + 1 : null;
}

/**
 * The tint each live thread earns from the coloured tabs.
 *
 * Each tab goes to the claim that matches it most strongly (see
 * `claimStrength`), and among equally strong claims to the thread that opened
 * it most recently. Claims from threads not in `liveThreadIds` (archived or
 * deleted) are ignored before that contest, so a live thread still gets a tab
 * an archived one also opened. A thread whose tabs carry several colours
 * shows the colour most of them carry, ties going to Sidebery's palette
 * order. Tabs no live thread claims are ignored.
 */
export function matchTabTints(
  tabs: ReadonlyArray<ColoredTab>,
  claims: ReadonlyArray<OpenClaim>,
  liveThreadIds: ReadonlySet<string>,
): Array<ThreadTabTint> {
  const parsedClaims = claims.flatMap((claim) => {
    if (!liveThreadIds.has(claim.threadId)) return [];
    const parsed = parseUrl(claim.target);
    return parsed === null ? [] : [{ claim, parsed }];
  });

  const colorsByThread = new Map<string, Map<TabTintColor, number>>();
  for (const tab of tabs) {
    const parsedTab = parseUrl(tab.url);
    if (parsedTab === null) continue;
    let best: { threadId: string; strength: number; openedAt: number } | null = null;
    for (const { claim, parsed } of parsedClaims) {
      const strength = claimStrength(parsed, parsedTab);
      if (strength === null) continue;
      if (
        best === null ||
        strength > best.strength ||
        (strength === best.strength && claim.openedAt > best.openedAt) ||
        (strength === best.strength &&
          claim.openedAt === best.openedAt &&
          claim.threadId < best.threadId)
      ) {
        best = { threadId: claim.threadId, strength, openedAt: claim.openedAt };
      }
    }
    if (best === null) continue;
    const counts = colorsByThread.get(best.threadId) ?? new Map<TabTintColor, number>();
    counts.set(tab.color, (counts.get(tab.color) ?? 0) + 1);
    colorsByThread.set(best.threadId, counts);
  }

  const tints: Array<ThreadTabTint> = [];
  for (const [threadId, counts] of colorsByThread) {
    let color: TabTintColor = COLOR_ORDER[0]!;
    let top = 0;
    let tabCount = 0;
    for (const candidate of COLOR_ORDER) {
      const count = counts.get(candidate) ?? 0;
      tabCount += count;
      if (count > top) {
        top = count;
        color = candidate;
      }
    }
    tints.push({ threadId: ThreadId.make(threadId), color, tabCount });
  }
  return tints.toSorted((left, right) =>
    left.threadId < right.threadId ? -1 : left.threadId > right.threadId ? 1 : 0,
  );
}
