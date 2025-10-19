"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { UpcomingEvent } from "@/lib/events/upcoming";

type VenueSummary = {
  id: string;
  name: string;
};

type WeekCalendarProps = {
  events: UpcomingEvent[];
  venues: VenueSummary[];
};

type DayInfo = {
  date: Date;
  label: string;
  key: string;
};

type VenueScheduleRow = {
  id: string;
  name: string;
  dayEvents: UpcomingEvent[][];
};

const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

const UNASSIGNED_KEY = "__unassigned__";

export function WeekCalendar({ events, venues }: WeekCalendarProps) {
  const days = useMemo(() => buildWeekDays(), []);
  const schedule = useMemo(
    () => buildVenueSchedule(events, venues, days),
    [events, venues, days]
  );

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-y-4 text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
            <th className="whitespace-nowrap px-3 text-left">Venue</th>
            {days.map((day) => (
              <th key={day.key} className="whitespace-nowrap px-3 text-left">
                {day.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {schedule.map((row) => (
            <tr key={row.id} className="align-top text-[var(--color-primary-900)]">
              <th
                scope="row"
                className="whitespace-nowrap px-3 text-left text-sm font-semibold text-[var(--color-primary-900)]"
              >
                {row.name}
              </th>
              {row.dayEvents.map((dayEvents, index) => (
                <td key={`${row.id}-${days[index]!.key}`} className="px-3">
                  {dayEvents.length === 0 ? (
                    <span className="text-xs text-[var(--color-text-subtle)]">
                      No events
                    </span>
                  ) : (
                    <ul className="space-y-2">
                      {dayEvents.map((event) => (
                        <li
                          key={event.id}
                          className="rounded-[var(--radius-sm)] border border-[rgba(39,54,64,0.12)] bg-white/90 px-3 py-2 shadow-soft"
                        >
                          <Link
                            href={`/events/${event.id}`}
                            className="font-medium leading-snug text-[var(--color-primary-900)] underline-offset-2 hover:text-[var(--color-primary-700)] hover:underline"
                          >
                            {event.title}
                          </Link>
                          <p className="text-xs text-[var(--color-text-subtle)]">
                            {formatTimeRange(event.startAt, event.endAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const buildWeekDays = (): DayInfo[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results: DayInfo[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    results.push({
      date,
      label: dayFormatter.format(date),
      key: date.toISOString(),
    });
  }

  return results;
};

const buildVenueSchedule = (
  events: UpcomingEvent[],
  venues: VenueSummary[],
  days: DayInfo[]
): VenueScheduleRow[] => {
  const rows: VenueScheduleRow[] = venues
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((venue) => ({
      id: venue.id,
      name: venue.name,
      dayEvents: days.map(() => []),
    }));

  const rowLookup = new Map<string, VenueScheduleRow>();
  for (const row of rows) {
    rowLookup.set(row.id, row);
  }

  const dayIndexLookup = new Map<string, number>();
  days.forEach((day, index) => dayIndexLookup.set(day.key, index));

  for (const event of events) {
    if (!event.startAt) continue;
    const eventDay = new Date(event.startAt);
    eventDay.setHours(0, 0, 0, 0);
    const dayKey = eventDay.toISOString();
    const dayIndex = dayIndexLookup.get(dayKey);
    if (dayIndex === undefined) continue;

    const venueKey = event.venueId ?? UNASSIGNED_KEY;
    let row = rowLookup.get(venueKey);

    if (!row) {
      row = {
        id: venueKey,
        name: event.venueName ?? "Unassigned events",
        dayEvents: days.map(() => []),
      };
      rowLookup.set(venueKey, row);
      rows.push(row);
    }

    row.dayEvents[dayIndex]!.push(event);
  }

  for (const row of rows) {
    row.dayEvents = row.dayEvents.map((dayEvents) =>
      dayEvents.sort((a, b) => {
        const aTime = a.startAt ? new Date(a.startAt).getTime() : 0;
        const bTime = b.startAt ? new Date(b.startAt).getTime() : 0;
        return aTime - bTime;
      })
    );
  }

  return rows;
};

const formatTimeRange = (start: string | null, end: string | null) => {
  if (!start) {
    return "All day";
  }

  const startLabel = timeFormatter.format(new Date(start));
  if (!end) {
    return startLabel;
  }

  return `${startLabel} – ${timeFormatter.format(new Date(end))}`;
};
