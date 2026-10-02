import { DEFAULT_BEAD_BOARDS, type ClientSettings } from "@t3tools/contracts/settings";
import {
  findAndReplaceText,
  type MarkdownNode,
  type TextMatch,
} from "~/vendor/mdast-find-and-replace";

/**
 * beads issue ids in chat text become links into configured beadside boards.
 *
 * in prose only the full `<prefix>-<suffix>` form is recognised. The bare
 * suffix (`oup`) is three to eight lowercase alphanumerics, which is also `the`, `out`
 * and `app`; nothing in the text separates one from the other. The prefix
 * configuration is there for the same reason: an unconstrained `<word>-<3 chars>`
 * pattern also matches `front-end`, `one-off` and `sign-off`.
 *
 * inline code is the exception: agents write `oup` in backticks, so a code
 * span that is exactly a short id links when beadside knows that id.
 */

type BeadBoards = ClientSettings["beadBoards"];

function beadIdSource(boards: BeadBoards): string {
  return `(?:${boards.map((board) => escapeRegExp(board.prefix)).join("|") || "(?!)"})-[0-9a-z]{3,8}(?:\\.[0-9]+)?`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const suffixIndexes = new WeakMap<ReadonlySet<string>, Map<string, string | null>>();
const SHORT_BEAD_ID_PATTERN = /^[0-9a-z]{3,8}(?:\.[0-9]+)?$/u;
/** a hyphen counts, so a longer id is never clipped down to a valid one. */
const BEAD_ID_BOUNDARY_PATTERN = /[A-Za-z0-9_-]/u;
const BEAD_AUTOLINK_IGNORED_TYPES = new Set(["link", "linkReference"]);

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

/** bead ids written in prose, never inside code or an authored link. */
export function remarkBeadAutolinks(boards: BeadBoards = DEFAULT_BEAD_BOARDS) {
  const pattern = new RegExp(beadIdSource(boards), "gu");
  return (tree: MarkdownNode) => {
    findAndReplaceText(
      tree,
      pattern,
      (matched: string, match: TextMatch) => {
        const before = match.input[match.index - 1];
        const after = match.input[match.index + matched.length];
        if (
          (before !== undefined && BEAD_ID_BOUNDARY_PATTERN.test(before)) ||
          (after !== undefined && BEAD_ID_BOUNDARY_PATTERN.test(after))
        ) {
          return false;
        }
        const url = beadBoardHref(matched, boards);
        if (!url) return false;
        return {
          type: "link",
          url,
          data: { hProperties: { dataBeadId: matched } },
          children: [{ type: "text", value: matched }],
        };
      },
      BEAD_AUTOLINK_IGNORED_TYPES,
    );
  };
}
