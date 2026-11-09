import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vite-plus/test";

import { remarkPathAutolinks } from "./markdown-path-links";

function linkedPaths(markdown: string): string[] {
  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkPathAutolinks]}>{markdown}</ReactMarkdown>,
  );
  return [...html.matchAll(/data-path-link="([^"]+)"/gu)].map((match) => match[1] ?? "");
}

describe("remarkPathAutolinks", () => {
  it("links an absolute path written in prose", () => {
    expect(
      linkedPaths("Here it is: /home/thatmike1/.local/state/foldrunner-council/visual/round2.html"),
    ).toEqual(["/home/thatmike1/.local/state/foldrunner-council/visual/round2.html"]);
  });

  it("leaves sentence punctuation, closing quotes and brackets outside the link", () => {
    expect(
      linkedPaths(
        'See /home/me/a.md. Or (/home/me/b.md), "/home/me/c.md" and /home/me/(group)/page.tsx!',
      ),
    ).toEqual(["/home/me/a.md", "/home/me/b.md", "/home/me/c.md", "/home/me/(group)/page.tsx"]);
  });

  it("keeps a line and column suffix", () => {
    expect(linkedPaths("broken at /home/me/src/a.ts:12:3, and /home/me/b.ts:7.")).toEqual([
      "/home/me/src/a.ts:12:3",
      "/home/me/b.ts:7",
    ]);
  });

  it("links home-relative paths and folders under a known root", () => {
    expect(linkedPaths("~/notes/todo.md and /home/me/git/some-folder")).toEqual([
      "~/notes/todo.md",
      "/home/me/git/some-folder",
    ]);
  });

  it("leaves slashes inside words, URLs and routes alone", () => {
    expect(
      linkedPaths(
        "and/or at 30 km/h, https://example.com/docs/a.md, example.com/a/b.md, /api/issue-ids, /hub",
      ),
    ).toEqual([]);
  });

  it("leaves code and authored links to their own renderers", () => {
    expect(
      linkedPaths("`/home/me/a.md`\n\n```\n/home/me/b.md\n```\n\n[/home/me/c.md](https://x.dev)"),
    ).toEqual([]);
  });

  it("handles long slash runs and long runs of closing brackets", () => {
    // both took about a second when every rejected position rescanned the rest of the token;
    // the start boundary now sits in the pattern and brackets are counted once
    expect(linkedPaths(`a${"/aa".repeat(16000)}`)).toEqual([]);
    expect(linkedPaths(`/home/me/a${")".repeat(16000)}`)).toEqual(["/home/me/a"]);
  });
});
