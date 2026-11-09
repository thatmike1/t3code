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
const PROSE_PATH_PATTERN = new RegExp(
  String.raw`(?:~(?:/${SEGMENT})+|(?:/${SEGMENT}){2,})(?::\d+(?::\d+)?)?`,
  "gu",
);
/** a path starts a word: `and/or`, `km/h`, `x.com/a/b` and `https://x/y` are not paths. */
const NOT_A_PATH_START_PATTERN = /[\p{L}\p{M}\p{N}_.\-/\\:~@]/u;
const PATH_AUTOLINK_IGNORED_TYPES = new Set(["link", "linkReference"]);

function count(value: string, character: string): number {
  return value.split(character).length - 1;
}

/** sentence punctuation after a path, and a closing bracket that has no opening one inside it. */
function trimTrailingPunctuation(token: string): string {
  let path = token;
  while (path.length > 0) {
    const last = path.at(-1);
    if (last === ".") path = path.slice(0, -1);
    else if (last === ")" && count(path, ")") > count(path, "(")) path = path.slice(0, -1);
    else if (last === "]" && count(path, "]") > count(path, "[")) path = path.slice(0, -1);
    else break;
  }
  return path;
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
