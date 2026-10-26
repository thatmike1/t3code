import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { isSameSchedule, nextCatchUpRunAt, nextScheduledRunAt } from "./Schedule.ts";

const PRAGUE = "Europe/Prague";

function prague(day: number, hour: number, minute = 0) {
  return DateTime.makeZonedUnsafe(
    { year: 2026, month: 10, day, hour, minute, second: 0, millisecond: 0 },
    { timeZone: PRAGUE, adjustForTimeZone: true },
  );
}

function local(value: DateTime.DateTime | null) {
  if (value === null) return null;
  const parts = DateTime.toParts(DateTime.setZone(value, DateTime.zoneMakeNamedUnsafe(PRAGUE)));
  return `${parts.day} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

describe("scheduled task schedule calculation", () => {
  it("skips to the next matching fixed-time weekday", () => {
    const next = nextScheduledRunAt(
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
      DateTime.makeZonedUnsafe(
        {
          year: 2026,
          month: 7,
          day: 3,
          hour: 10,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        { timeZone: "America/Los_Angeles", adjustForTimeZone: true },
      ),
    );
    const parts = next ? DateTime.toParts(next) : null;
    expect(parts?.weekDay).toBe(1);
    expect(parts?.hour).toBe(9);
    expect(parts?.minute).toBe(0);
  });

  it("compares schedules structurally", () => {
    expect(
      isSameSchedule(
        { type: "once", runAt: "2026-11-01T03:00:00-05:00" },
        { type: "once", runAt: "2026-11-01T08:00:00.000Z" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 60_000 }),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 30_000 }),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [5, 1] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 5, 5] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [] },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3] },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:30" },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "interval", everyMs: 60_000 },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(false);
  });
});

describe("catching up a missed fixed-time slot today", () => {
  // 26 Oct 2026 is a Monday; the 25th is the Sunday the clocks went back.
  const weekdays9 = {
    type: "fixed_time" as const,
    timeOfDay: "09:00",
    weekdays: [1, 2, 3, 4, 5],
    catchUpToday: true,
  };

  it("schedules today's slot before it comes", () => {
    expect(local(nextCatchUpRunAt(weekdays9, prague(26, 7, 52), prague(23, 9)))).toBe("26 09:00");
  });

  it("keeps today's slot due after it passed, long after the ten-minute grace", () => {
    expect(local(nextCatchUpRunAt(weekdays9, prague(26, 9, 47), prague(23, 9)))).toBe("26 09:00");
  });

  it("treats an earlier run today, even Run now before the slot, as today's run", () => {
    expect(local(nextCatchUpRunAt(weekdays9, prague(26, 8, 5), prague(26, 8)))).toBe("27 09:00");
    expect(local(nextCatchUpRunAt(weekdays9, prague(26, 11), prague(26, 9, 47)))).toBe("27 09:00");
  });

  it("never replays a missed day, and skips excluded weekdays", () => {
    // friday's slot was missed; saturday morning waits for monday.
    expect(local(nextCatchUpRunAt(weekdays9, prague(31, 10), prague(29, 9)))).toBe("2 09:00");
  });

  it("compares days in the server's zone, not UTC", () => {
    // 00:30 in Prague is still the previous day in UTC; a run at 23:30 local
    // yesterday must not use up today's slot.
    const lastRun = prague(26, 23, 30);
    expect(local(nextCatchUpRunAt(weekdays9, prague(27, 0, 30), lastRun))).toBe("27 09:00");
  });

  it("handles the day the clocks go back", () => {
    const daily = { type: "fixed_time" as const, timeOfDay: "09:00", catchUpToday: true };
    expect(local(nextCatchUpRunAt(daily, prague(25, 10), prague(24, 9)))).toBe("25 09:00");
    expect(local(nextCatchUpRunAt(daily, prague(25, 10), prague(25, 9, 30)))).toBe("26 09:00");
  });

  it("counts the catch-up flag as part of the schedule", () => {
    const plain = { type: "fixed_time" as const, timeOfDay: "09:00" };
    expect(isSameSchedule(plain, { ...plain, catchUpToday: false })).toBe(true);
    expect(isSameSchedule(plain, { ...plain, catchUpToday: true })).toBe(false);
  });
});
