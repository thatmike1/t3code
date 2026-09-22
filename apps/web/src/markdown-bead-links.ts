import {
  findAndReplaceText,
  type MarkdownNode,
  type TextMatch,
} from "~/vendor/mdast-find-and-replace";

/**
 * Beads issue ids in chat text become links into the local bd-board.
 *
 * In prose only the full `<prefix>-<suffix>` form is recognised. The bare
 * suffix (`oup`) is three lowercase alphanumerics, which is also `the`, `out`
 * and `app`; nothing in the text separates one from the other. The prefix
 * allowlist is there for the same reason: an unconstrained `<word>-<3 chars>`
 * pattern also matches `front-end`, `one-off` and `sign-off`.
 *
 * Inline code is the exception: agents write `oup` in backticks, so a code
 * span that is exactly a short id links when bd-board knows that id.
 */

/** bd-board serves one repository, whichever it was launched in. */
export const BEAD_BOARD_ORIGIN = "http://127.0.0.1:1338";

/** Add a repository's issue prefix here to link its ids too. */
const BEAD_ID_PREFIXES = ["ccChat-general"] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const BEAD_ID_SOURCE = `(?:${BEAD_ID_PREFIXES.map(escapeRegExp).join("|")})-[0-9a-z]{3,8}(?:\\.[0-9]+)?`;
/** A bare suffix with an optional child suffix: `oup`, `jrz2`, `zye.6`. */
const SHORT_BEAD_ID_PATTERN = /^[0-9a-z]{3,8}(?:\.[0-9]+)?$/u;
const BEAD_ID_PATTERN = new RegExp(BEAD_ID_SOURCE, "gu");
const BEAD_ID_EXACT_PATTERN = new RegExp(`^${BEAD_ID_SOURCE}$`, "u");
/** A hyphen counts, so a longer id is never clipped down to a valid one. */
const BEAD_ID_BOUNDARY_PATTERN = /[A-Za-z0-9_-]/u;
const BEAD_AUTOLINK_IGNORED_TYPES = new Set(["link", "linkReference"]);

/** The board resolves either the full id or the bare suffix from the hash. */
export function beadBoardHref(id: string): string {
  return `${BEAD_BOARD_ORIGIN}/#${id}`;
}

/** Inline code that is exactly one bead id, for the inline code renderer. */
export function beadIdCandidate(codeText: string): string | null {
  const trimmed = codeText.trim();
  return BEAD_ID_EXACT_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Inline code that is exactly one short id, resolved to the full id bd-board
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
  for (const prefix of BEAD_ID_PREFIXES) {
    const id = `${prefix}-${trimmed}`;
    if (knownIds.has(id)) {
      return id;
    }
  }
  return null;
}

/** Bead ids written in prose, never inside code or an authored link. */
export function remarkBeadAutolinks() {
  return (tree: MarkdownNode) => {
    findAndReplaceText(
      tree,
      BEAD_ID_PATTERN,
      (matched: string, match: TextMatch) => {
        const before = match.input[match.index - 1];
        const after = match.input[match.index + matched.length];
        if (
          (before !== undefined && BEAD_ID_BOUNDARY_PATTERN.test(before)) ||
          (after !== undefined && BEAD_ID_BOUNDARY_PATTERN.test(after))
        ) {
          return false;
        }
        return {
          type: "link",
          url: beadBoardHref(matched),
          data: { hProperties: { dataBeadId: matched } },
          children: [{ type: "text", value: matched }],
        };
      },
      BEAD_AUTOLINK_IGNORED_TYPES,
    );
  };
}
