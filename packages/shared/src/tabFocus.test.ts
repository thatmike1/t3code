import { describe, expect, it } from "vite-plus/test";

import {
  appendTabFocusMarker,
  isTabFocusUrl,
  stripTabFocusMarker,
  tabFocusLabel,
} from "./tabFocus.ts";

const HUB = "file:///home/thatmike1/git/ccChat-general/hubs/2026-09-30/index.html";

describe("appendTabFocusMarker", () => {
  it("adds a fragment when the URL has none", () => {
    expect(appendTabFocusMarker(HUB)).toBe(`${HUB}#t3-focus`);
    expect(appendTabFocusMarker("http://127.0.0.1:1344/proto/a?x=1")).toBe(
      "http://127.0.0.1:1344/proto/a?x=1#t3-focus",
    );
  });

  it("extends a fragment the URL already has", () => {
    expect(appendTabFocusMarker("http://127.0.0.1:1338/#ccChat-general-652g")).toBe(
      "http://127.0.0.1:1338/#ccChat-general-652g&t3-focus",
    );
    expect(appendTabFocusMarker("http://127.0.0.1:1338/#")).toBe(
      "http://127.0.0.1:1338/#&t3-focus",
    );
  });

  it("leaves the rest of the URL byte for byte as given", () => {
    const odd = "http://LOCALHOST:1344/a b/%7Ex?q=|";
    expect(appendTabFocusMarker(odd).slice(0, odd.length)).toBe(odd);
  });
});

describe("stripTabFocusMarker", () => {
  it("round-trips what appendTabFocusMarker produced", () => {
    for (const url of [HUB, "http://127.0.0.1:1338/#bead", "http://127.0.0.1:1338/#"]) {
      expect(stripTabFocusMarker(appendTabFocusMarker(url))).toBe(url);
    }
  });

  it("returns null without a well-formed trailing marker", () => {
    expect(stripTabFocusMarker(HUB)).toBeNull();
    expect(stripTabFocusMarker("http://a.test/#t3-focus-not")).toBeNull();
    expect(stripTabFocusMarker("http://a.test/?x&t3-focus")).toBeNull();
    expect(stripTabFocusMarker("http://a.test/#x#t3-focus")).toBeNull();
  });
});

describe("isTabFocusUrl", () => {
  it("accepts marked web and file URLs", () => {
    expect(isTabFocusUrl(`${HUB}#t3-focus`)).toBe(true);
    expect(isTabFocusUrl("http://127.0.0.1:1344/#t3-focus")).toBe(true);
    expect(isTabFocusUrl("https://example.com/a#top&t3-focus")).toBe(true);
  });

  it("refuses anything unmarked, remote file hosts and other schemes", () => {
    expect(isTabFocusUrl(HUB)).toBe(false);
    expect(isTabFocusUrl("https://example.com/")).toBe(false);
    expect(isTabFocusUrl("file://server/share/x.html#t3-focus")).toBe(false);
    expect(isTabFocusUrl("javascript:alert(1)#t3-focus")).toBe(false);
    expect(isTabFocusUrl("vscode://x/y#t3-focus")).toBe(false);
    expect(isTabFocusUrl("not a url#t3-focus")).toBe(false);
    expect(isTabFocusUrl(undefined)).toBe(false);
  });
});

describe("tabFocusLabel", () => {
  it("names a file by its last two path segments", () => {
    expect(tabFocusLabel(HUB)).toBe("2026-09-30/index.html");
    expect(tabFocusLabel("file:///tmp/my%20page.html")).toBe("tmp/my page.html");
  });

  it("names a web page by host and path", () => {
    expect(tabFocusLabel("http://127.0.0.1:1344/proto/a/?x=1#y")).toBe("127.0.0.1:1344/proto/a");
    expect(tabFocusLabel("https://example.com/")).toBe("example.com");
  });

  it("falls back to the raw string", () => {
    expect(tabFocusLabel("nonsense")).toBe("nonsense");
  });
});
