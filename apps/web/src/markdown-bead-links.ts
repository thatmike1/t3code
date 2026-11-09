import { DEFAULT_BEAD_BOARDS, type ClientSettings } from "@t3tools/contracts/settings";
import {
  findAndReplaceText,
  type MarkdownNode,
  type TextMatch,
} from "~/vendor/mdast-find-and-replace";

/**
 * a full id links through its configured prefix (a bare `<word>-<3 chars>` is also `sign-off`)
 * and, once that board answered, only if it knows the id (`nexiflow-audit` is a folder name).
 * A bare suffix links when it names exactly one known id; word or number suffixes link only
 * in inline code, where agents write them on purpose.
 */

type BeadBoards = ClientSettings["beadBoards"];

function beadIdSource(boards: BeadBoards): string {
  return `(?:${boards.map((board) => escapeRegExp(board.prefix)).join("|") || "(?!)"})-[0-9a-z]{3,8}(?:\\.[0-9]+)?`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const EMPTY_IDS: ReadonlySet<string> = new Set();
const suffixIndexes = new WeakMap<ReadonlySet<string>, Map<string, string | null>>();
const SHORT_BEAD_ID_PATTERN = /^[0-9a-z]{3,8}(?:\.[0-9]+)?$/u;
const SHORT_BEAD_ID_SOURCE = "[0-9a-z]{3,8}(?:\\.[0-9]+)?";
/** a hyphen counts, so a longer id is never clipped down to a valid one; a slash marks a path. */
const BEAD_ID_BOUNDARY_PATTERN = /[A-Za-z0-9_\-/\\]/u;
const WORD_CHARACTER_PATTERN = /[A-Za-z0-9_]/u;
const BEAD_AUTOLINK_IGNORED_TYPES = new Set(["link", "linkReference"]);

/**
 * bare suffixes that read as words in prose: the first six collide with live ids (checked
 * against /usr/share/dict/words, Nov 2026), the rest are common short words. Backticked, they
 * still link.
 */
const PROSE_SHORT_ID_DENYLIST: ReadonlySet<string> = new Set(
  `afc ava cpi fit oat tent
  the and for are but not you all any can had her was one our out day get has him his how man
  new now old see two way who boy did its let put say she too use yes yet via per off own few
  why try ask big end top run set add fix bug log app api cli css url npm git sql env ssh dns
  tmp src lib bin dev doc pdf png svg jpg mp3 mp4 wip todo also back been both came come done
  each even from good have here into just keep know last like long look made make many more
  most much must next only open over same some such sure take test than that them then they
  this time very want well went were what when will with work your file code line page step
  note plan ale jak tak pro jen aby kde tam nic asi`.split(/\s+/u),
);

/**
 * an entry the id store adds for every board that answered, ids or not: `<prefix>-` can never be
 * a real id (a suffix has 3+ characters), so a board that answered with no ids still vouches
 * for its prefix, and a change in which boards answered changes the set.
 */
export function boardAnsweredMarker(prefix: string): string {
  return `${prefix}-`;
}

const answeredPrefixCache = new WeakMap<ReadonlySet<string>, ReadonlySet<string>>();

/** prefixes (with their hyphen) of the boards that answered: their markers, or any id they gave. */
function answeredPrefixes(knownIds: ReadonlySet<string>): ReadonlySet<string> {
  let prefixes = answeredPrefixCache.get(knownIds);
  if (!prefixes) {
    prefixes = new Set([...knownIds].map((id) => id.slice(0, id.lastIndexOf("-") + 1)));
    answeredPrefixCache.set(knownIds, prefixes);
  }
  return prefixes;
}

/**
 * a full id passes when its board did not answer (prefix-only, as before the id store) or
 * answered and knows it. Prose and inline code both go through here.
 */
export function knownFullBeadId(
  id: string,
  boards: BeadBoards,
  knownIds: ReadonlySet<string>,
): string | null {
  const board = boards.find((candidate) => id.startsWith(`${candidate.prefix}-`));
  if (!board) return null;
  const answered = answeredPrefixes(knownIds).has(boardAnsweredMarker(board.prefix));
  return !answered || knownIds.has(id) ? id : null;
}

/** resolves full ids only through their explicitly configured project prefix. */
export function beadBoardHref(id: string, boards: BeadBoards = DEFAULT_BEAD_BOARDS): string | null {
  const matches = boards.filter((board) => new RegExp(`^${beadIdSource([board])}$`, "u").test(id));
  const origins = new Set(matches.map((board) => board.origin.replace(/\/+$/, "")));
  if (origins.size !== 1) return null;
  const origin = origins.values().next().value;
  return origin ? `${origin}/#${id}` : null;
}

/** inline code that is exactly one bead id, for the inline code renderer. */
export function beadIdCandidate(
  codeText: string,
  boards: BeadBoards = DEFAULT_BEAD_BOARDS,
): string | null {
  const trimmed = codeText.trim();
  return new RegExp(`^${beadIdSource(boards)}$`, "u").test(trimmed) ? trimmed : null;
}

/**
 * inline code that is exactly one short id, resolved to the full id beadside
 * knows. Null when the span is not id-shaped or no known id matches.
 */
export function shortBeadIdCandidate(
  codeText: string,
  knownIds: ReadonlySet<string>,
): string | null {
  const trimmed = codeText.trim();
  if (!SHORT_BEAD_ID_PATTERN.test(trimmed)) {
    return null;
  }
  let index = suffixIndexes.get(knownIds);
  if (!index) {
    index = new Map();
    for (const id of knownIds) {
      const suffix = id.slice(id.lastIndexOf("-") + 1);
      index.set(suffix, index.has(suffix) ? null : id);
    }
    suffixIndexes.set(knownIds, index);
  }
  return index.get(trimmed) ?? null;
}

/** a bare suffix in prose, which also has to read as something other than a word or a number. */
function proseShortBeadId(token: string, knownIds: ReadonlySet<string>): string | null {
  const base = token.split(".", 1)[0] ?? token;
  if (/^[0-9]+$/u.test(base) || PROSE_SHORT_ID_DENYLIST.has(base)) return null;
  return shortBeadIdCandidate(token, knownIds);
}

function isStandaloneToken(matched: string, match: TextMatch): boolean {
  const before = match.input[match.index - 1];
  const afterIndex = match.index + matched.length;
  const after = match.input[afterIndex];
  if (before !== undefined && (BEAD_ID_BOUNDARY_PATTERN.test(before) || before === ".")) {
    return false;
  }
  if (after === undefined) return true;
  if (BEAD_ID_BOUNDARY_PATTERN.test(after)) return false;
  // `qju.md` is a file name, `qju.` ends a sentence
  const next = match.input[afterIndex + 1];
  return !(after === "." && next !== undefined && WORD_CHARACTER_PATTERN.test(next));
}

/**
 * bead ids written in prose, never inside code or an authored link. `knownIds` is the set
 * beadside reported; it has to keep its identity while unchanged, since the plugin list and
 * every parse cached under it are keyed on it.
 */
export function remarkBeadAutolinks(
  boards: BeadBoards = DEFAULT_BEAD_BOARDS,
  knownIds: ReadonlySet<string> = EMPTY_IDS,
) {
  const pattern = new RegExp(
    `(?:${beadIdSource(boards)})${knownIds.size > 0 ? `|${SHORT_BEAD_ID_SOURCE}` : ""}`,
    "gu",
  );
  const fullIdPattern = new RegExp(`^${beadIdSource(boards)}$`, "u");
  return (tree: MarkdownNode) => {
    findAndReplaceText(
      tree,
      pattern,
      (matched: string, match: TextMatch) => {
        if (!isStandaloneToken(matched, match)) return false;
        const id = fullIdPattern.test(matched)
          ? knownFullBeadId(matched, boards, knownIds)
          : proseShortBeadId(matched, knownIds);
        const url = id ? beadBoardHref(id, boards) : null;
        if (!id || !url) return false;
        return {
          type: "link",
          url,
          data: { hProperties: { dataBeadId: id, dataBeadLabel: matched } },
          children: [{ type: "text", value: matched }],
        };
      },
      BEAD_AUTOLINK_IGNORED_TYPES,
    );
  };
}
