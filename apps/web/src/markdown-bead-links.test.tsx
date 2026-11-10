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
import { remarkPathAutolinks } from "./markdown-path-links";

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

  it("leaves an id-shaped path segment alone", () => {
    const html = renderMarkdown(
      "open /home/me/git/ccChat-general/projects/ccChat-general-abc/x.html or a\\ccChat-general-4y6",
    );

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

describe("shortBeadIdCandidate", () => {
  const known = new Set(["ccChat-general-qju", "ccChat-general-jrz2", "ccChat-general-zye.6"]);

  it("resolves a short id beadside knows to the full id", () => {
    expect(shortBeadIdCandidate("qju", known)).toBe("ccChat-general-qju");
    expect(shortBeadIdCandidate("jrz2", known)).toBe("ccChat-general-jrz2");
    expect(shortBeadIdCandidate(" zye.6 ", known)).toBe("ccChat-general-zye.6");
  });

  it("resolves a word-like or numeric suffix when it is backticked", () => {
    const words = new Set(["ccChat-general-tent", "ccChat-general-552"]);
    expect(shortBeadIdCandidate("tent", words)).toBe("ccChat-general-tent");
    expect(shortBeadIdCandidate("552", words)).toBe("ccChat-general-552");
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

it("recognizes configured project prefixes in prose and inline code", () => {
  const boards = [{ prefix: "nexiflow", origin: "http://localhost:1339" }];
  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[[remarkBeadAutolinks, boards]]}>
      {"nexiflow-ab12 and ccChat-general-ab12"}
    </ReactMarkdown>,
  );
  expect(html).toContain('href="http://localhost:1339/#nexiflow-ab12"');
  expect(html).not.toContain('data-bead-id="ccChat-general-ab12"');
  expect(beadIdCandidate("nexiflow-ab12", boards)).toBe("nexiflow-ab12");
});

const BOARDS = [
  { prefix: "ccChat-general", origin: "http://127.0.0.1:1338" },
  { prefix: "nexiflow", origin: "http://127.0.0.1:1358" },
];
const KNOWN = new Set([
  "ccChat-general-odlk",
  "ccChat-general-fuww",
  "ccChat-general-ovo",
  "ccChat-general-tent",
  "ccChat-general-552",
  "ccChat-general-zye.6",
  "nexiflow-ift",
  "nexiflow-ab12",
]);

function renderWithKnownIds(markdown: string, known: ReadonlySet<string> = KNOWN): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkPathAutolinks, [remarkBeadAutolinks, BOARDS, known]]}
    >
      {markdown}
    </ReactMarkdown>,
  );
}

const linkedIds = (html: string) =>
  [...html.matchAll(/data-bead-id="([^"]+)"/gu)].map((match) => match[1]);

describe("remarkBeadAutolinks with known ids", () => {
  it("links a full id in prose only when its answered board knows it", () => {
    expect(linkedIds(renderWithKnownIds("nexiflow-audit and nexiflow-ab12"))).toEqual([
      "nexiflow-ab12",
    ]);
  });

  it("keeps prefix-only links for a board that did not answer, or when none did", () => {
    const generalOnly = new Set(["ccChat-general-odlk"]);
    expect(linkedIds(renderWithKnownIds("nexiflow-audit", generalOnly))).toEqual([
      "nexiflow-audit",
    ]);
    expect(linkedIds(renderWithKnownIds("nexiflow-audit", new Set()))).toEqual(["nexiflow-audit"]);
  });

  it("links short ids written in prose to the one id they name", () => {
    const html = renderWithKnownIds("done (odlk), then **fuww** (ovo and ift); zye.6 too.");

    expect(linkedIds(html)).toEqual([
      "ccChat-general-odlk",
      "ccChat-general-fuww",
      "ccChat-general-ovo",
      "nexiflow-ift",
      "ccChat-general-zye.6",
    ]);
    expect(html).toContain(">odlk<");
  });

  it("leaves words, numbers and file names alone in prose", () => {
    const html = renderWithKnownIds("a tent, 552 tests, odlk.md, xodlk, odlk-2 and the end");

    expect(html).not.toContain("data-bead-id");
  });

  it("leaves contractions alone, straight or curly apostrophe", () => {
    const html = renderWithKnownIds("it odlk't matter, fuww’s fine, d'odlk; but 'odlk' links");

    expect(linkedIds(html)).toEqual(["ccChat-general-odlk"]);
  });

  it("leaves short ids in code, links and paths to their own renderers", () => {
    const html = renderWithKnownIds("`odlk` [odlk](https://example.com) see /home/me/odlk/a.md");

    expect(html).not.toContain("data-bead-id");
  });

  it("links a real id beside a path whose segment looks like one", () => {
    const html = renderWithKnownIds(
      "plan at /home/me/git/ccChat-general/projects/nexiflow-audit/redesign-plan/dummies.html for nexiflow-ab12.",
    );

    expect(linkedIds(html)).toEqual(["nexiflow-ab12"]);
    expect(html).toContain(
      'data-path-link="/home/me/git/ccChat-general/projects/nexiflow-audit/redesign-plan/dummies.html"',
    );
  });
});
