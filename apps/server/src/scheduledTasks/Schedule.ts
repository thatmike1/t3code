import { MIN_SCHEDULED_TASK_INTERVAL_MS, type ScheduledTaskSchedule } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const MINUTE_MS = 60_000;

function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function nextScheduledRunAt(
  schedule: ScheduledTaskSchedule,
  from: DateTime.DateTime,
): DateTime.DateTime | null {
  if (schedule.type === "webhook") return null;
  if (schedule.type === "once") {
    const runAt = DateTime.make(schedule.runAt);
    return Option.isSome(runAt) &&
      DateTime.toEpochMillis(runAt.value) > DateTime.toEpochMillis(from)
      ? runAt.value
      : null;
  }
  if (schedule.type === "interval") {
    // Intervals advance elapsed time, including across daylight-saving changes.
    return DateTime.addDuration(from, Math.max(schedule.everyMs, MIN_SCHEDULED_TASK_INTERVAL_MS));
  }

  const time = parseTimeOfDay(schedule.timeOfDay);
  if (time === null) return null;
  const weekdays =
    schedule.weekdays && schedule.weekdays.length > 0 ? new Set(schedule.weekdays) : null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = DateTime.setParts(DateTime.add(from, { days: offset }), {
      hour: time.hour,
      minute: time.minute,
      second: 0,
      millisecond: 0,
    });
    if (DateTime.toEpochMillis(candidate) <= DateTime.toEpochMillis(from)) continue;
    if (weekdays !== null && !weekdays.has(DateTime.toParts(candidate).weekDay)) continue;
    return candidate;
  }
  return null;
}

type FixedTimeSchedule = Extract<ScheduledTaskSchedule, { type: "fixed_time" }>;

export function catchesUpToday(schedule: ScheduledTaskSchedule): schedule is FixedTimeSchedule {
  return schedule.type === "fixed_time" && schedule.catchUpToday === true;
}

function sameLocalDay(left: DateTime.DateTime, right: DateTime.DateTime): boolean {
  const zoned = DateTime.isZoned(right) ? DateTime.setZone(left, right.zone) : left;
  const a = DateTime.isZoned(right) ? DateTime.toParts(zoned) : DateTime.toPartsUtc(left);
  const b = DateTime.isZoned(right) ? DateTime.toParts(right) : DateTime.toPartsUtc(right);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function todaysSlot(schedule: FixedTimeSchedule, now: DateTime.DateTime): DateTime.DateTime | null {
  const time = parseTimeOfDay(schedule.timeOfDay);
  if (time === null) return null;
  const slot = DateTime.setParts(now, {
    hour: time.hour,
    minute: time.minute,
    second: 0,
    millisecond: 0,
  });
  const weekdays = schedule.weekdays ?? [];
  return weekdays.length === 0 || weekdays.includes(DateTime.toParts(slot).weekDay) ? slot : null;
}

/**
 * Next run of a fixed-time task that catches up a missed slot the same local
 * day. Any attempt today, scheduled or Run now, used or failed, uses up
 * today's slot; an unused slot already past is returned as is, so the task is
 * due at once. Yesterday's missed slot is never replayed.
 */
export function nextCatchUpRunAt(
  schedule: FixedTimeSchedule,
  now: DateTime.DateTime,
  lastRunAt: DateTime.DateTime | null,
): DateTime.DateTime | null {
  const slot = todaysSlot(schedule, now);
  const usedToday = lastRunAt !== null && sameLocalDay(lastRunAt, now);
  if (slot !== null && !usedToday) return slot;
  return nextScheduledRunAt(schedule, DateTime.endOf(now, "day"));
}

function weekdayKey(weekdays: ReadonlyArray<number> | undefined): string {
  const unique = [...new Set(weekdays ?? [])].toSorted((x, y) => x - y);
  if (unique.length === 0 || unique.length === 7) return "daily";
  return unique.join(",");
}

export function isSameSchedule(a: ScheduledTaskSchedule, b: ScheduledTaskSchedule): boolean {
  if (a.type === "interval") {
    return b.type === "interval" && a.everyMs === b.everyMs;
  }
  if (a.type === "webhook") return b.type === "webhook";
  if (a.type === "once") return b.type === "once" && Date.parse(a.runAt) === Date.parse(b.runAt);
  if (b.type !== "fixed_time") return false;
  // Compare parsed times so padded-hour edits do not reschedule pending runs.
  const aTime = parseTimeOfDay(a.timeOfDay);
  const bTime = parseTimeOfDay(b.timeOfDay);
  return (
    aTime !== null &&
    bTime !== null &&
    aTime.hour === bTime.hour &&
    aTime.minute === bTime.minute &&
    weekdayKey(a.weekdays) === weekdayKey(b.weekdays) &&
    (a.catchUpToday === true) === (b.catchUpToday === true)
  );
}

const MISSED_FIXED_TIME_GRACE_MS = 10 * MINUTE_MS;

export function isMissedFixedTimeRun(
  schedule: ScheduledTaskSchedule,
  dueAt: DateTime.DateTime,
  now: DateTime.DateTime,
): boolean {
  if (schedule.type !== "fixed_time") return false;
  return DateTime.toEpochMillis(now) - DateTime.toEpochMillis(dueAt) > MISSED_FIXED_TIME_GRACE_MS;
}
