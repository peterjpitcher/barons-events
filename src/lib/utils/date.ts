import type dayjs from "dayjs";

/**
 * Events ending at or before this many minutes after midnight are treated
 * as belonging to the previous calendar day (e.g. a gig ending at 2 AM).
 */
export const EARLY_HOURS_THRESHOLD_MINUTES = 300;

// ---------------------------------------------------------------------------
// dayjs-based helpers (used by event-calendar.tsx, events-board.tsx)
// ---------------------------------------------------------------------------

/** Return the Monday (ISO start) of the week containing `date`. */
export function startOfIsoWeek(date: dayjs.Dayjs): dayjs.Dayjs {
  const day = date.day();
  const diff = (day + 6) % 7;
  return date.subtract(diff, "day").startOf("day");
}

/** Return end-of-Sunday for the week containing `date`. */
export function endOfIsoWeek(date: dayjs.Dayjs): dayjs.Dayjs {
  return startOfIsoWeek(date).add(6, "day").endOf("day");
}

/** Minutes elapsed since midnight for the given dayjs value. */
export function minutesAfterMidnight(value: dayjs.Dayjs): number {
  return value.diff(value.startOf("day"), "minute");
}

/**
 * True when an event spans exactly into the early hours of the next day
 * (e.g. 8 PM–2 AM). Used to visually keep such events on the start day.
 */
export function endsInEarlyHoursNextDay(event: { start: dayjs.Dayjs; end: dayjs.Dayjs }): boolean {
  const startDay = event.start.startOf("day");
  const endDay = event.end.startOf("day");
  if (endDay.diff(startDay, "day") !== 1) {
    return false;
  }
  return minutesAfterMidnight(event.end) <= EARLY_HOURS_THRESHOLD_MINUTES;
}

// ---------------------------------------------------------------------------
// Native Date helpers (used by overrides-calendar.tsx)
// ---------------------------------------------------------------------------

/** Return the Monday (ISO start) of the week containing `date` (native Date). */
export function startOfIsoWeekNative(date: Date): Date {
  const day = date.getDay(); // 0=Sun … 6=Sat
  const diff = (day + 6) % 7; // shift so Mon=0
  const monday = new Date(date);
  monday.setDate(date.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
