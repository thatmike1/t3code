import { describe, expect, it } from "vite-plus/test";

import {
  isWidgetStale,
  sortWidgets,
  widgetNowSeconds,
  widgetTooltipText,
} from "./SidebarWidgets.logic";

const NOW = 1_700_000_000;

describe("isWidgetStale", () => {
  it("treats a widget without a write time as always fresh", () => {
    expect(isWidgetStale({}, NOW)).toBe(false);
    expect(isWidgetStale({ staleAfterSeconds: 1 }, NOW)).toBe(false);
  });

  it("falls back to the 120 second window", () => {
    expect(isWidgetStale({ updatedAt: NOW - 120 }, NOW)).toBe(false);
    expect(isWidgetStale({ updatedAt: NOW - 121 }, NOW)).toBe(true);
  });

  it("honours the widget's own window", () => {
    expect(isWidgetStale({ updatedAt: NOW - 121, staleAfterSeconds: 600 }, NOW)).toBe(false);
    expect(isWidgetStale({ updatedAt: NOW - 11, staleAfterSeconds: 10 }, NOW)).toBe(true);
  });

  it("does not call a clock skewed write time stale", () => {
    expect(isWidgetStale({ updatedAt: NOW + 5_000 }, NOW)).toBe(false);
  });
});

describe("widgetNowSeconds", () => {
  it("reads the minute clock as UTC", () => {
    expect(widgetNowSeconds("2023-11-14T22:13")).toBe(Date.UTC(2023, 10, 14, 22, 13) / 1000);
  });
});

describe("widgetTooltipText", () => {
  it("falls back to the id and marks stale widgets", () => {
    expect(widgetTooltipText({ id: "mic" }, false)).toBe("mic");
    expect(widgetTooltipText({ id: "mic", tooltip: "Mic muted" }, true)).toBe("Mic muted (stale)");
  });
});

describe("sortWidgets", () => {
  it("sorts on order then id", () => {
    const widget = (id: string, order: number) =>
      ({ id, order, state: "ok", icon: "circle", rows: [] }) as const;
    expect(
      sortWidgets([widget("b", 1), widget("a", 2), widget("a", 1)]).map((entry) => entry.id),
    ).toEqual(["a", "b", "a"]);
  });
});
