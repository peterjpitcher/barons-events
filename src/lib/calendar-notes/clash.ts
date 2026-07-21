import { DISPLAY_TIMEZONE } from "@/lib/datetime";
import { addDays, londonDateString } from "@/lib/planning/utils";

/** Event statuses that occupy a venue for clash purposes (excludes terminal states). */
export const CLASHING_EVENT_STATUSES: readonly string[] = [
  "pending_approval",
  "approved_pending_details",
  "draft",
  "submitted",
  "needs_revisions",
  "approved",
];

/** Events ending at or before this many minutes past midnight count for the previous day. */
const EARLY_HOURS_THRESHOLD_MINUTES = 300;

export type ClashEventInput = {
  id: string;
  title: string;
  status: string;
  /** ISO UTC start timestamp. */
  startAt: string;
  /** ISO UTC end timestamp, or null (some proposals have no end). */
  endAt: string | null;
  /** Resolved venue set: event_venues venue ids, falling back to events.venue_id. */
  venueIds: string[];
};

export type ClashNoteInput = {
  id: string;
  venueId: string;
  title: string;
  /** London calendar date, YYYY-MM-DD. */
  startDate: string;
  /** Inclusive end date, YYYY-MM-DD, or null for a single day. */
  endDate: string | null;
};

export type NoteClash = { event: ClashEventInput; note: ClashNoteInput };

const londonTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIMEZONE,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

/** London wall-clock minutes-after-midnight for an ISO UTC timestamp. */
function londonMinutesAfterMidnight(iso: string): number {
  const parts = londonTimeFormatter.formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** All London calendar dates a note occupies, inclusive. */
export function noteOccupiedDates(note: ClashNoteInput): string[] {
  const end = note.endDate ?? note.startDate;
  const dates: string[] = [];
  let cursor = note.startDate;
  // Range length is validated to <= 31 days at write time; guard anyway.
  for (let i = 0; i <= 366 && cursor <= end; i++) {
    dates.push(cursor);
    if (cursor === end) break;
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/** All London calendar dates an event occupies, applying the early-hours rule. */
export function eventOccupiedLondonDates(startAt: string, endAt: string | null): string[] {
  const startDate = londonDateString(new Date(startAt));
  if (!endAt) return [startDate];

  const endDate = londonDateString(new Date(endAt));
  if (endDate <= startDate) return [startDate];

  // Ends in the early hours of the very next day, so counts for the start day only.
  if (endDate === addDays(startDate, 1) && londonMinutesAfterMidnight(endAt) <= EARLY_HOURS_THRESHOLD_MINUTES) {
    return [startDate];
  }

  const dates: string[] = [];
  let cursor = startDate;
  for (let i = 0; i <= 366 && cursor <= endDate; i++) {
    dates.push(cursor);
    if (cursor === endDate) break;
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/** Detect event-vs-note clashes. Pure: no I/O. One row per pair, ordered by clash date then event title. */
export function detectNoteClashes(events: ClashEventInput[], notes: ClashNoteInput[]): NoteClash[] {
  const clashes: Array<NoteClash & { clashDate: string }> = [];
  for (const event of events) {
    if (!CLASHING_EVENT_STATUSES.includes(event.status)) continue;
    const occupied = new Set(eventOccupiedLondonDates(event.startAt, event.endAt));
    for (const note of notes) {
      if (!event.venueIds.includes(note.venueId)) continue;
      const overlap = noteOccupiedDates(note).filter((d) => occupied.has(d));
      if (overlap.length > 0) {
        clashes.push({ event, note, clashDate: overlap[0] });
      }
    }
  }
  clashes.sort((a, b) => {
    if (a.clashDate !== b.clashDate) return a.clashDate.localeCompare(b.clashDate);
    return a.event.title.localeCompare(b.event.title);
  });
  return clashes.map(({ event, note }) => ({ event, note }));
}
