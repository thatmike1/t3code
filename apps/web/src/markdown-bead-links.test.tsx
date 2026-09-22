import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vite-plus/test";

import {
  beadBoardHref,
  beadIdCandidate,
  remarkBeadAutolinks,
  shortBeadIdCandidate,
} from "./markdown-bead-links";

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
    const html = renderMarkdown("see ccChat-general-jrz2xabcd and ccChat-general-jrz2-old");

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

  it("links a child id whole, not just its parent", () => {
    const html = renderMarkdown("see ccChat-general-zye.6.");

    expect(html).toContain('data-bead-id="ccChat-general-zye.6"');
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

describe("shortBeadIdCandidate", () => {
  const known = new Set([
    "ccChat-general-qju",
    "ccChat-general-jrz2",
    "ccChat-general-zye.6",
  ]);

  it("resolves a short id bd-board knows to the full id", () => {
    expect(shortBeadIdCandidate("qju", known)).toBe("ccChat-general-qju");
    expect(shortBeadIdCandidate("jrz2", known)).toBe("ccChat-general-jrz2");
    expect(shortBeadIdCandidate(" zye.6 ", known)).toBe("ccChat-general-zye.6");
  });

  it("leaves an id-shaped span alone when no such bead exists", () => {
    expect(shortBeadIdCandidate("the", known)).toBeNull();
    expect(shortBeadIdCandidate("zye.7", known)).toBeNull();
    expect(shortBeadIdCandidate("qju", new Set())).toBeNull();
  });

  it("rejects spans that are not exactly a short id", () => {
    const loose = new Set([
      "ccChat-general-QJU",
      "ccChat-general-abcdefghi",
      "ccChat-general-qju.",
    ]);
    expect(shortBeadIdCandidate("QJU", loose)).toBeNull();
    expect(shortBeadIdCandidate("abcdefghi", loose)).toBeNull();
    expect(shortBeadIdCandidate("qju.", loose)).toBeNull();
    expect(shortBeadIdCandidate("bd show qju", known)).toBeNull();
  });
});
