import { describe, expect, it } from "@effect/vitest";

import { defaultProfilePath, extractColoredTabs, SIDEBERY_EXT_DATA_KEY } from "./firefoxSession.ts";

const sidebery = (data: Record<string, unknown>) => ({
  [SIDEBERY_EXT_DATA_KEY]: JSON.stringify(data),
});

describe("extractColoredTabs", () => {
  it("reads each coloured tab's current entry and skips the rest", () => {
    const session = {
      windows: [
        {
          tabs: [
            {
              // index is 1-based: the tab shows its second history entry
              entries: [
                { url: "http://127.0.0.1:1344/" },
                { url: "http://127.0.0.1:1344/proto/a" },
              ],
              index: 2,
              extData: sidebery({ id: 1, customColor: "red" }),
            },
            { entries: [{ url: "https://example.com/" }], index: 1, extData: sidebery({ id: 2 }) },
            { entries: [{ url: "https://no-sidebery.test/" }], index: 1 },
            {
              entries: [{ url: "moz-extension://abc/sidebery/group.html#G" }],
              index: 1,
              extData: sidebery({ customColor: "blue" }),
            },
            {
              entries: [{ url: "https://odd-colour.test/" }],
              index: 1,
              extData: sidebery({ customColor: "chartreuse" }),
            },
            {
              entries: [{ url: "https://broken.test/" }],
              index: 1,
              extData: { [SIDEBERY_EXT_DATA_KEY]: "{not json" },
            },
          ],
        },
        {
          tabs: [
            {
              entries: [{ url: "file:///home/mike/site/index.html" }],
              index: 1,
              extData: sidebery({ customColor: "green" }),
            },
          ],
        },
      ],
      _closedWindows: [
        {
          tabs: [
            {
              entries: [{ url: "http://127.0.0.1:9/closed" }],
              index: 1,
              extData: sidebery({ customColor: "pink" }),
            },
          ],
        },
      ],
    };

    expect(extractColoredTabs(session)).toEqual([
      { url: "http://127.0.0.1:1344/proto/a", color: "red" },
      { url: "file:///home/mike/site/index.html", color: "green" },
    ]);
  });

  it("clamps an index past the history to its last entry", () => {
    const session = {
      windows: [
        {
          tabs: [
            {
              entries: [{ url: "https://a.test/" }, { url: "https://b.test/" }],
              index: 9,
              extData: sidebery({ customColor: "yellow" }),
            },
          ],
        },
      ],
    };
    expect(extractColoredTabs(session)).toEqual([{ url: "https://b.test/", color: "yellow" }]);
  });

  it("returns nothing for input that is not a session", () => {
    expect(extractColoredTabs(null)).toEqual([]);
    expect(extractColoredTabs({ windows: "nope" })).toEqual([]);
    expect(extractColoredTabs([1, 2, 3])).toEqual([]);
  });
});

describe("defaultProfilePath", () => {
  it("prefers the install section's Default over the legacy profile flag", () => {
    const ini = [
      "[Install4F96D1932A9F858E]",
      "Default=8citq6d6.default",
      "Locked=1",
      "",
      "[Profile1]",
      "Name=other",
      "IsRelative=1",
      "Path=6ebz59gj.other",
      "Default=1",
      "",
      "[Profile0]",
      "Name=default",
      "IsRelative=1",
      "Path=8citq6d6.default",
      "",
      "[General]",
      "StartWithLastProfile=1",
    ].join("\n");
    expect(defaultProfilePath(ini)).toBe("8citq6d6.default");
  });

  it("falls back to the profile marked Default=1", () => {
    const ini = "[Profile0]\nPath=a.one\n\n[Profile1]\nPath=b.two\nDefault=1\n";
    expect(defaultProfilePath(ini)).toBe("b.two");
  });

  it("takes a lone profile even without a Default flag", () => {
    expect(defaultProfilePath("[Profile0]\r\nPath=only.one\r\n")).toBe("only.one");
  });

  it("returns null when it cannot tell which profile is the default", () => {
    expect(defaultProfilePath("")).toBeNull();
    expect(defaultProfilePath("[Profile0]\nPath=a\n[Profile1]\nPath=b\n")).toBeNull();
  });
});
