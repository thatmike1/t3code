/*
 * Adapted from mdast-util-find-and-replace:
 * https://github.com/syntax-tree/mdast-util-find-and-replace/blob/main/lib/index.js
 *
 * The MIT License
 *
 * Copyright (c) Titus Wormer <tituswormer@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// fork: walks hast since upstream's Words renderer replaced remark (0.1.12); skipped elements
// (links, code) come from the caller instead of a set of mdast node types

export type MarkdownNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
  position?: unknown;
};

export type TextMatch = {
  index: number;
  input: string;
};

export function findAndReplaceText(
  tree: MarkdownNode,
  find: RegExp,
  replace: (
    matched: string,
    match: TextMatch,
  ) => MarkdownNode | ReadonlyArray<MarkdownNode> | false,
  ignoredTagNames: ReadonlySet<string>,
): void {
  visit(tree);

  function visit(node: MarkdownNode): void {
    if (node.children === undefined) return;
    for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
      const child = node.children[childIndex]!;
      if (child.type === "element" && ignoredTagNames.has(child.tagName ?? "")) continue;
      if (child.type !== "text" || child.value === undefined) {
        visit(child);
        continue;
      }

      const replacements: MarkdownNode[] = [];
      let start = 0;
      let changed = false;
      find.lastIndex = 0;
      let match = find.exec(child.value);
      while (match !== null) {
        const position = match.index;
        const replacement = replace(match[0], { index: position, input: match.input });
        if (replacement === false) {
          find.lastIndex = position + 1;
        } else {
          if (start < position) {
            replacements.push({ type: "text", value: child.value.slice(start, position) });
          }
          // fork: an array replaces the match with several nodes, e.g. a link and trimmed text
          if (Array.isArray(replacement)) replacements.push(...replacement);
          else replacements.push(replacement as MarkdownNode);
          start = position + match[0].length;
          changed = true;
        }
        if (!find.global) break;
        match = find.exec(child.value);
      }

      if (!changed) continue;
      if (start < child.value.length) {
        replacements.push({ type: "text", value: child.value.slice(start) });
      }
      node.children.splice(childIndex, 1, ...replacements);
      childIndex += replacements.length - 1;
    }
  }
}
