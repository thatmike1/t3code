import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vite-plus/test";

import { beadBoardHref, beadIdCandidate, remarkBeadAutolinks } from "./markdown-bead-links";

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBeadAutolinks]}>{markdown}</ReactMarkdown>,
  );
}

describe("remarkBeadAutolinks", () => {
  it("links a bead id written in prose", () => {
    const html = renderMarkdown("filed as ccChat-general-4y6 with the notes");

    expect(html).toContain(`href="${beadBoardHref("ccChat-general-4y6")}"`);
    expect(html).toContain('data-bead-id="ccChat-general-4y6"');
  });

  it("leaves a longer identifier that merely starts with an id alone", () => {
    const html = renderMarkdown("see ccChat-general-4y6x and ccChat-general-4y6-old");

    expect(html).not.toContain("data-bead-id");
  });

  it("leaves hyphenated prose alone", () => {
    const html = renderMarkdown("the front-end one-off sign-off was a trade-off");

    expect(html).not.toContain("data-bead-id");
  });

  it("leaves inline code and fenced code to the code renderer", () => {
    const html = renderMarkdown("`ccChat-general-4y6`\n\n```\nccChat-general-4y6\n```");

    expect(html).not.toContain("data-bead-id");
  });

  it("does not rewrite an authored link", () => {
    const html = renderMarkdown("[ccChat-general-4y6](https://example.com/x)");

    expect(html).toContain('href="https://example.com/x"');
    expect(html).not.toContain("data-bead-id");
  });

  it("links every id in a sentence", () => {
    const html = renderMarkdown("ccChat-general-4y6 relates to ccChat-general-qpo.");

    expect(html).toContain('data-bead-id="ccChat-general-4y6"');
    expect(html).toContain('data-bead-id="ccChat-general-qpo"');
  });
});

describe("beadIdCandidate", () => {
  it("accepts inline code that is exactly one id", () => {
    expect(beadIdCandidate(" ccChat-general-4y6 ")).toBe("ccChat-general-4y6");
  });

  it("rejects a bare suffix and an unknown prefix", () => {
    expect(beadIdCandidate("4y6")).toBeNull();
    expect(beadIdCandidate("messscribe-159")).toBeNull();
  });

  it("rejects inline code that only contains an id", () => {
    expect(beadIdCandidate("bd show ccChat-general-4y6")).toBeNull();
  });
});
