import { inlineCodeFilePathCandidate, parseMarkdownFileLink } from "@t3tools/shared/markdownLinks";
import {
  findAndReplaceText,
  type MarkdownNode,
  type TextMatch,
} from "~/vendor/mdast-find-and-replace";

/**
 * absolute and `~/` paths written in prose become the same file link an inline code path gets.
 * The renderer resolves the link from the `dataPathLink` text, exactly as it does a code span.
 */

const SEGMENT = String.raw`[\p{L}\p{M}\p{N}._~+@$=()[\]-]+`;
/** a path starts a word: `and/or`, `km/h`, `x.com/a/b` and `https://x/y` are not paths. */
const NOT_A_PATH_START = String.raw`[\p{L}\p{M}\p{N}_.\-/\\:~@]`;
const NOT_A_PATH_START_PATTERN = new RegExp(NOT_A_PATH_START, "u");
/**
 * the start boundary sits in the pattern itself, so the engine rejects every position inside a
 * long slash-separated token in constant time instead of rescanning the rest of it from each one.
 */
const PROSE_PATH_PATTERN = new RegExp(
  String.raw`(?<!${NOT_A_PATH_START})(?:~(?:/${SEGMENT})+|(?:/${SEGMENT}){2,})(?::\d+(?::\d+)?)?`,
  "gu",
);
const PATH_AUTOLINK_IGNORED_TYPES = new Set(["link", "linkReference"]);

/**
 * sentence punctuation after a path, and a closing bracket that has no opening one inside it.
 * bracket balances are counted once and updated as characters come off, so a long run of
 * closing brackets trims in one pass.
 */
function trimTrailingPunctuation(token: string): string {
  let parens = 0;
  let squares = 0;
  for (const character of token) {
    if (character === "(") parens -= 1;
    else if (character === ")") parens += 1;
    else if (character === "[") squares -= 1;
    else if (character === "]") squares += 1;
  }
  let end = token.length;
  while (end > 0) {
    const last = token[end - 1];
    if (last === ".") end -= 1;
    else if (last === ")" && parens > 0) {
      parens -= 1;
      end -= 1;
    } else if (last === "]" && squares > 0) {
      squares -= 1;
      end -= 1;
    } else break;
  }
  return token.slice(0, end);
}

/** the path a prose token links to, or null when it is not one. */
function prosePathLinkCandidate(token: string): string | null {
  const candidate = inlineCodeFilePathCandidate(token);
  return candidate !== null && parseMarkdownFileLink(candidate) !== null ? candidate : null;
}

export function remarkPathAutolinks() {
  return (tree: MarkdownNode) => {
    findAndReplaceText(
      tree,
      PROSE_PATH_PATTERN,
      (matched: string, match: TextMatch) => {
        const before = match.input[match.index - 1];
        if (before !== undefined && NOT_A_PATH_START_PATTERN.test(before)) return false;
        const path = trimTrailingPunctuation(matched);
        const target = path.includes("/", 1) || path.startsWith("~/") ? path : null;
        if (target === null || prosePathLinkCandidate(target) === null) return false;
        const link: MarkdownNode = {
          type: "link",
          url: target,
          data: { hProperties: { dataPathLink: target } },
          children: [{ type: "text", value: target }],
        };
        const rest = matched.slice(path.length);
        return rest ? [link, { type: "text", value: rest }] : link;
      },
      PATH_AUTOLINK_IGNORED_TYPES,
    );
  };
}
