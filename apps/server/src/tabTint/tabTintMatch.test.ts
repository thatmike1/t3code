import { describe, expect, it } from "@effect/vitest";

import type { ColoredTab } from "./firefoxSession.ts";
import {
  commandFromActivityPayload,
  matchTabTints,
  type OpenClaim,
  openTargetsInCommand,
} from "./tabTintMatch.ts";

const HOME = "/home/mike";
const opens = (command: string, cwd: string | null = "/work/repo") =>
  openTargetsInCommand(command, cwd, HOME);

describe("openTargetsInCommand", () => {
  it("reads URLs and resolves paths against the command's directory", () => {
    expect(opens("xdg-open http://127.0.0.1:1346/")).toEqual(["http://127.0.0.1:1346/"]);
    expect(opens("xdg-open hubs/2026-09-29/index.html")).toEqual([
      "file:///work/repo/hubs/2026-09-29/index.html",
    ]);
    expect(opens("xdg-open ~/notes/a.html")).toEqual(["file:///home/mike/notes/a.html"]);
    expect(opens("xdg-open 'file:///tmp/x y.html'")).toEqual(["file:///tmp/x%20y.html"]);
  });

  it("follows a cd earlier in the same command", () => {
    expect(
      opens(
        "cd ~/git/site/skim && node build.mjs . | tail -1 && (xdg-open index.html >/dev/null 2>&1 &)",
      ),
    ).toEqual(["file:///home/mike/git/site/skim/index.html"]);
    expect(opens("cd sub; cd ../other && xdg-open page.html")).toEqual([
      "file:///work/repo/other/page.html",
    ]);
  });

  it("unwraps a shell -c script, as Codex reports its commands", () => {
    expect(opens(`/bin/bash -lc 'xdg-open http://127.0.0.1:1341 && curl -fsS x'`, "/p")).toEqual([
      "http://127.0.0.1:1341/",
    ]);
    expect(opens(`/bin/bash -lc "cd site && xdg-open 'a b.html'"`, "/p")).toEqual([
      "file:///p/site/a%20b.html",
    ]);
  });

  it("knows the other openers and skips their flags", () => {
    expect(opens("firefox --new-tab https://example.com/x")).toEqual(["https://example.com/x"]);
    expect(opens("gio open /tmp/report.html")).toEqual(["file:///tmp/report.html"]);
    expect(opens("nohup xdg-open http://localhost:3000/app &")).toEqual([
      "http://localhost:3000/app",
    ]);
  });

  it("ignores mentions that are not commands", () => {
    // arguments, quoted text and heredoc bodies only mention the opener
    expect(opens(`echo "xdg-open http://127.0.0.1:1/"`)).toEqual([]);
    expect(opens(`bd create x -d "run xdg-open http://127.0.0.1:2/ later"`)).toEqual([]);
    expect(
      opens(
        [
          `bd create x -d "$(cat <<'EOF'`,
          `xdg-open http://127.0.0.1:3/`,
          `EOF`,
          `)"`,
          `xdg-open http://127.0.0.1:4/`,
        ].join("\n"),
      ),
    ).toEqual(["http://127.0.0.1:4/"]);
    expect(opens("which zip xdg-open")).toEqual([]);
    expect(opens("# xdg-open http://127.0.0.1:5/")).toEqual([]);
  });

  it("skips targets it cannot know", () => {
    expect(opens("for d in a b; do xdg-open $d/index.html; done")).toEqual([]);
    expect(opens("xdg-open index.html", null)).toEqual([]);
    expect(opens("xdg-open mailto:someone@example.com")).toEqual([]);
    expect(opens("xdg-open")).toEqual([]);
  });
});

describe("commandFromActivityPayload", () => {
  it("reads Claude's and Codex's command shapes", () => {
    expect(
      commandFromActivityPayload({
        itemType: "command_execution",
        data: { toolName: "Bash", input: { command: "xdg-open a.html" } },
      }),
    ).toEqual({ command: "xdg-open a.html", cwd: null });
    expect(
      commandFromActivityPayload({
        itemType: "command_execution",
        data: { item: { command: "/bin/bash -lc 'xdg-open a.html'", cwd: "/p" } },
      }),
    ).toEqual({ command: "/bin/bash -lc 'xdg-open a.html'", cwd: "/p" });
  });

  it("ignores anything that is not a shell command", () => {
    expect(
      commandFromActivityPayload({
        itemType: "collab_agent_tool_call",
        data: { input: { command: "xdg-open http://127.0.0.1:1/" } },
      }),
    ).toBeNull();
    expect(commandFromActivityPayload("xdg-open x")).toBeNull();
    expect(commandFromActivityPayload({ itemType: "command_execution" })).toBeNull();
  });
});

describe("matchTabTints", () => {
  const T = (iso: string) => Date.parse(iso);
  const claim = (threadId: string, target: string, at: string): OpenClaim => ({
    threadId,
    target,
    openedAt: T(at),
  });
  const tab = (url: string, color: ColoredTab["color"]): ColoredTab => ({ url, color });
  const live = (...ids: Array<string>) => new Set(ids);

  it("claims the first path segment, never the site root", () => {
    const claims = [claim("proto", "http://127.0.0.1:1344/proto/x", "2026-09-29T10:00:00Z")];
    const tabs = [
      tab("http://127.0.0.1:1344/proto/y?q=1#h", "red"),
      tab("http://127.0.0.1:1344/", "blue"),
      tab("http://127.0.0.1:1344/protocol", "green"),
    ];
    expect(matchTabTints(tabs, claims, live("proto"))).toEqual([
      {
        threadId: "proto",
        color: "red",
        tabCount: 1,
        focusUrl: "http://127.0.0.1:1344/proto/y?q=1#h",
      },
    ]);
  });

  it("lets an opened root claim its whole origin, and treats localhost as 127.0.0.1", () => {
    const claims = [claim("t1", "http://localhost:1346/", "2026-09-29T10:00:00Z")];
    expect(
      matchTabTints([tab("http://127.0.0.1:1346/deep/page", "orange")], claims, live("t1")),
    ).toEqual([
      {
        threadId: "t1",
        color: "orange",
        tabCount: 1,
        focusUrl: "http://127.0.0.1:1346/deep/page",
      },
    ]);
    expect(matchTabTints([tab("http://127.0.0.1:1347/", "orange")], claims, live("t1"))).toEqual(
      [],
    );
  });

  it("matches file URLs on the exact path only", () => {
    const claims = [claim("t1", "file:///home/mike/site/index.html", "2026-09-29T10:00:00Z")];
    const tabs = [
      tab("file:///home/mike/site/index.html#top", "green"),
      tab("file:///home/mike/site/other.html", "red"),
    ];
    expect(matchTabTints(tabs, claims, live("t1"))).toEqual([
      {
        threadId: "t1",
        color: "green",
        tabCount: 1,
        focusUrl: "file:///home/mike/site/index.html#top",
      },
    ]);
  });

  it("gives a contested tab to the thread that opened it most recently", () => {
    const claims = [
      claim("old", "http://127.0.0.1:1344/proto/a", "2026-09-29T09:00:00Z"),
      claim("new", "http://127.0.0.1:1344/proto/a", "2026-09-29T11:00:00Z"),
    ];
    expect(
      matchTabTints([tab("http://127.0.0.1:1344/proto/a", "pink")], claims, live("old", "new")),
    ).toEqual([
      { threadId: "new", color: "pink", tabCount: 1, focusUrl: "http://127.0.0.1:1344/proto/a" },
    ]);
  });

  it("prefers the exact page, then the narrower claim, over a newer broad one", () => {
    const claims = [
      claim("page", "http://127.0.0.1:1344/proto/a", "2026-09-29T09:00:00Z"),
      claim("section", "http://127.0.0.1:1344/proto/b", "2026-09-29T10:00:00Z"),
      claim("root", "http://127.0.0.1:1344/", "2026-09-29T11:00:00Z"),
    ];
    const tabs = [
      tab("http://127.0.0.1:1344/proto/a", "red"),
      tab("http://127.0.0.1:1344/proto/c", "blue"),
      tab("http://127.0.0.1:1344/", "green"),
    ];
    expect(matchTabTints(tabs, claims, live("page", "section", "root"))).toEqual([
      { threadId: "page", color: "red", tabCount: 1, focusUrl: "http://127.0.0.1:1344/proto/a" },
      { threadId: "root", color: "green", tabCount: 1, focusUrl: "http://127.0.0.1:1344/" },
      {
        threadId: "section",
        color: "blue",
        tabCount: 1,
        focusUrl: "http://127.0.0.1:1344/proto/c",
      },
    ]);
  });

  it("skips archived threads, so the tab falls to a live claimant", () => {
    const claims = [
      claim("live", "http://127.0.0.1:1344/proto/a", "2026-09-29T09:00:00Z"),
      claim("archived", "http://127.0.0.1:1344/proto/a", "2026-09-29T11:00:00Z"),
    ];
    const tabs = [tab("http://127.0.0.1:1344/proto/a", "purple")];
    expect(matchTabTints(tabs, claims, live("live"))).toEqual([
      {
        threadId: "live",
        color: "purple",
        tabCount: 1,
        focusUrl: "http://127.0.0.1:1344/proto/a",
      },
    ]);
    expect(matchTabTints(tabs, claims.slice(1), live("live"))).toEqual([]);
  });

  it("shows the majority colour, ties going to Sidebery's palette order", () => {
    const claims = [claim("t1", "http://127.0.0.1:1344/", "2026-09-29T09:00:00Z")];
    expect(
      matchTabTints(
        [
          tab("http://127.0.0.1:1344/a", "red"),
          tab("http://127.0.0.1:1344/b", "red"),
          tab("http://127.0.0.1:1344/c", "blue"),
        ],
        claims,
        live("t1"),
      ),
    ).toEqual([{ threadId: "t1", color: "red", tabCount: 3, focusUrl: "http://127.0.0.1:1344/a" }]);
    expect(
      matchTabTints(
        [tab("http://127.0.0.1:1344/a", "purple"), tab("http://127.0.0.1:1344/b", "green")],
        claims,
        live("t1"),
      ),
    ).toEqual([
      { threadId: "t1", color: "green", tabCount: 2, focusUrl: "http://127.0.0.1:1344/b" },
    ]);
  });

  it("focuses the shown colour's tab the thread opened most recently", () => {
    const claims = [
      claim("t1", "http://127.0.0.1:1344/old", "2026-09-29T09:00:00Z"),
      claim("t1", "file:///home/mike/hub/index.html", "2026-09-29T11:00:00Z"),
      claim("t1", "http://127.0.0.1:1350/newest", "2026-09-29T12:00:00Z"),
    ];
    const tabs = [
      tab("http://127.0.0.1:1344/old", "red"),
      tab("file:///home/mike/hub/index.html", "red"),
      // opened last, but not in the colour the thread shows
      tab("http://127.0.0.1:1350/newest", "blue"),
    ];
    expect(matchTabTints(tabs, claims, live("t1"))).toEqual([
      { threadId: "t1", color: "red", tabCount: 3, focusUrl: "file:///home/mike/hub/index.html" },
    ]);
  });

  it("uses the tab's current URL, not the one the command opened", () => {
    const claims = [claim("t1", "http://localhost:1344/proto/x", "2026-09-29T09:00:00Z")];
    expect(
      matchTabTints([tab("http://127.0.0.1:1344/proto/y?q=1#h", "red")], claims, live("t1")),
    ).toEqual([
      {
        threadId: "t1",
        color: "red",
        tabCount: 1,
        focusUrl: "http://127.0.0.1:1344/proto/y?q=1#h",
      },
    ]);
  });

  it("breaks an opened-at tie by URL, whatever order the browser lists the tabs in", () => {
    const claims = [claim("t1", "http://127.0.0.1:1344/", "2026-09-29T09:00:00Z")];
    const tabs = [tab("http://127.0.0.1:1344/b", "red"), tab("http://127.0.0.1:1344/a", "red")];
    const expected = [
      { threadId: "t1", color: "red", tabCount: 2, focusUrl: "http://127.0.0.1:1344/a" },
    ];
    expect(matchTabTints(tabs, claims, live("t1"))).toEqual(expected);
    expect(matchTabTints(tabs.toReversed(), claims, live("t1"))).toEqual(expected);
  });

  it("ignores coloured tabs no thread opened", () => {
    expect(
      matchTabTints(
        [tab("https://mattermost.example/", "blue")],
        [claim("t1", "http://127.0.0.1:1344/", "2026-09-29T09:00:00Z")],
        live("t1"),
      ),
    ).toEqual([]);
  });
});
