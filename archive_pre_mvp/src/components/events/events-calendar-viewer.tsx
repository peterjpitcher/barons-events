"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type CalendarEventRecord = {
  id: string;
  title: string;
  status: string;
  startAt: string | null;
  endAt: string | null;
  venueName: string | null;
};

type ViewMode = "month" | "week" | "list";

type EventsCalendarViewerProps = {
  events: CalendarEventRecord[];
};

type VenueFilter = {
  label: string;
  value: string;
};

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

const dayNumberFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
});

const weekdayFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

const formatTimeRange = (start: string | null, end: string | null) => {
  if (!start) {
    return "All day";
  }

  const startText = timeFormatter.format(new Date(start));
  if (!end) {
    return startText;
  }

  return `${startText} – ${timeFormatter.format(new Date(end))}`;
};

export function EventsCalendarViewer({ events }: EventsCalendarViewerProps) {
  const [view, setView] = useState<ViewMode>("month");
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [weekCursor, setWeekCursor] = useState(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  });

  const venues = useMemo<VenueFilter[]>(() => {
    const unique = new Set<string>();
    events.forEach((event) => {
      unique.add(event.venueName ?? "Unassigned");
    });
    return Array.from(unique)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  }, [events]);

  const [selectedVenues, setSelectedVenues] = useState(() =>
    new Set(venues.map((venue) => venue.value))
  );

  useEffect(() => {
    setSelectedVenues((prev) => {
      const next = new Set(prev);
      venues.forEach((venue) => next.add(venue.value));
      return next;
    });
  }, [venues]);

  const filteredEvents = useMemo(
    () =>
      events.filter((event) =>
        selectedVenues.has(event.venueName ?? "Unassigned")
      ),
    [events, selectedVenues]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <ViewToggleButton
            label="Month"
            active={view === "month"}
            onClick={() => setView("month")}
          />
          <ViewToggleButton
            label="7 days"
            active={view === "week"}
            onClick={() => setView("week")}
          />
          <ViewToggleButton
            label="List"
            active={view === "list"}
            onClick={() => setView("list")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {venues.map((venue) => {
            const isChecked = selectedVenues.has(venue.value);
            return (
              <label
                key={venue.value}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-primary-700)] shadow-soft hover:border-[var(--color-primary-500)]"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-[var(--color-border)] text-[var(--color-primary-700)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
                  checked={isChecked}
                  onChange={(event) => {
                    setSelectedVenues((prev) => {
                      const next = new Set(prev);
                      if (event.target.checked) {
                        next.add(venue.value);
                      } else {
                        next.delete(venue.value);
                      }
                      return next;
                    });
                  }}
                />
                <span>{venue.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {view === "month" ? (
        <MonthView
          events={filteredEvents}
          monthCursor={monthCursor}
          onPrevMonth={() =>
            setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
          }
          onNextMonth={() =>
            setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
          }
        />
      ) : null}

      {view === "week" ? (
        <WeekView
          events={filteredEvents}
          weekCursor={weekCursor}
          onPrevWeek={() =>
            setWeekCursor((prev) => {
              const next = new Date(prev);
              next.setDate(prev.getDate() - 7);
              return next;
            })
          }
          onNextWeek={() =>
            setWeekCursor((prev) => {
              const next = new Date(prev);
              next.setDate(prev.getDate() + 7);
              return next;
            })
          }
        />
      ) : null}

      {view === "list" ? <ListView events={filteredEvents} /> : null}
    </div>
  );
}

type MonthViewProps = {
  events: CalendarEventRecord[];
  monthCursor: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
};

const MonthView = ({ events, monthCursor, onPrevMonth, onNextMonth }: MonthViewProps) => {
  const weeks = useMemo(() => buildMonthWeeks(monthCursor, events), [monthCursor, events]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onPrevMonth}
          className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-sm font-semibold text-[var(--color-primary-700)] hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-900)]"
        >
          Previous
        </button>
        <div className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--color-primary-900)]">
          {monthFormatter.format(monthCursor)}
        </div>
        <button
          type="button"
          onClick={onNextMonth}
          className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-sm font-semibold text-[var(--color-primary-700)] hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-900)]"
        >
          Next
        </button>
      </div>
      <div className="grid gap-2">
        <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        {weeks.map((week, index) => (
          <div key={index} className="grid grid-cols-7 gap-2">
            {week.map((cell) => (
              <div
                key={cell.date.toISOString()}
                className={`min-h-[110px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white/90 p-2 shadow-soft ${
                  cell.isCurrentMonth ? "" : "opacity-50"
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold text-[var(--color-primary-900)]">
                  <span>{dayNumberFormatter.format(cell.date)}</span>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">
                    {weekdayFormatter.format(cell.date)}
                  </span>
                </div>
                <ul className="mt-2 space-y-1 text-[11px] text-[var(--color-text)]">
                  {cell.events.length === 0 ? (
                    <li className="text-[var(--color-text-subtle)]">—</li>
                  ) : (
                    cell.events.map((event) => (
                      <li key={event.id} className="rounded bg-white/80 px-2 py-1 shadow-soft">
                        <Link
                          href={`/events/${event.id}`}
                          className="font-semibold text-[var(--color-primary-800)] underline-offset-2 hover:text-[var(--color-primary-600)] hover:underline"
                        >
                          {event.title}
                        </Link>
                        <br />
                        <span className="text-[10px] text-[var(--color-text-subtle)]">
                          {formatTimeRange(event.startAt, event.endAt)}
                          {event.venueName ? ` · ${event.venueName}` : ""}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

type MonthCell = {
  date: Date;
  isCurrentMonth: boolean;
  events: CalendarEventRecord[];
};

const buildMonthWeeks = (monthCursor: Date, events: CalendarEventRecord[]): MonthCell[][] => {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);

  const start = new Date(firstOfMonth);
  const dayOfWeek = (start.getDay() + 6) % 7; // convert Sunday=0 to Monday=0
  start.setDate(start.getDate() - dayOfWeek);

  const end = new Date(lastOfMonth);
  const trailing = 6 - ((end.getDay() + 6) % 7);
  end.setDate(end.getDate() + trailing);

  const weeks: MonthCell[][] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const week: MonthCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const bucketKey = cursor.toDateString();
      const dayEvents = events.filter((event) => {
        if (!event.startAt) return false;
        const eventDate = new Date(event.startAt);
        eventDate.setHours(0, 0, 0, 0);
        return eventDate.toDateString() === bucketKey;
      });

      week.push({
        date: new Date(cursor),
        isCurrentMonth: cursor.getMonth() === month,
        events: dayEvents.sort((a, b) => {
          const aTime = a.startAt ? new Date(a.startAt).getTime() : 0;
          const bTime = b.startAt ? new Date(b.startAt).getTime() : 0;
          return aTime - bTime;
        }),
      });

      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  return weeks;
};

type WeekViewProps = {
  events: CalendarEventRecord[];
  weekCursor: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
};

const WeekView = ({ events, weekCursor, onPrevWeek, onNextWeek }: WeekViewProps) => {
  const days = useMemo(() => buildWeekDays(weekCursor, events), [weekCursor, events]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onPrevWeek}
          className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-sm font-semibold text-[var(--color-primary-700)] hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-900)]"
        >
          Previous
        </button>
        <div className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--color-primary-900)]">
          Week of {monthFormatter.format(weekCursor)}
        </div>
        <button
          type="button"
          onClick={onNextWeek}
          className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-sm font-semibold text-[var(--color-primary-700)] hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-900)]"
        >
          Next
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-7">
        {days.map((day) => (
          <div
            key={day.date.toISOString()}
            className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white/90 p-3 shadow-soft"
          >
            <div className="text-sm font-semibold text-[var(--color-primary-900)]">
              {day.label}
            </div>
            <ul className="mt-3 space-y-2 text-sm text-[var(--color-text)]">
              {day.events.length === 0 ? (
                <li className="text-xs text-[var(--color-text-subtle)]">No events</li>
              ) : (
                day.events.map((event) => (
                  <li
                    key={event.id}
                    className="rounded-[var(--radius-sm)] border border-[rgba(39,54,64,0.1)] bg-white/80 px-2 py-1"
                  >
                    <Link
                      href={`/events/${event.id}`}
                      className="font-semibold text-[var(--color-primary-900)] underline-offset-2 hover:text-[var(--color-primary-700)] hover:underline"
                    >
                      {event.title}
                    </Link>
                    <p className="text-xs text-[var(--color-text-subtle)]">
                      {formatTimeRange(event.startAt, event.endAt)}
                      {event.venueName ? ` · ${event.venueName}` : ""}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
};

type WeekDay = {
  date: Date;
  label: string;
  events: CalendarEventRecord[];
};

const buildWeekDays = (startDate: Date, events: CalendarEventRecord[]): WeekDay[] => {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const label = `${weekdayFormatter.format(date)} ${dayNumberFormatter.format(date)}`;
    const key = date.toDateString();
    const dayEvents = events.filter((event) => {
      if (!event.startAt) return false;
      const eventDate = new Date(event.startAt);
      eventDate.setHours(0, 0, 0, 0);
      return eventDate.toDateString() === key;
    });
    days.push({
      date,
      label,
      events: dayEvents.sort((a, b) => {
        const aTime = a.startAt ? new Date(a.startAt).getTime() : 0;
        const bTime = b.startAt ? new Date(b.startAt).getTime() : 0;
        return aTime - bTime;
      }),
    });
  }
  return days;
};

const ListView = ({ events }: { events: CalendarEventRecord[] }) => {
  const sorted = useMemo(() => {
    return [...events].sort((a, b) => {
      const aTime = a.startAt ? new Date(a.startAt).getTime() : 0;
      const bTime = b.startAt ? new Date(b.startAt).getTime() : 0;
      return aTime - bTime;
    });
  }, [events]);

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-white/95 shadow-soft">
      <table className="w-full text-left text-sm text-[var(--color-text)]">
        <thead className="bg-[var(--color-muted-surface)] text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">
          <tr>
            <th className="px-4 py-3">Event</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3">Venue</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((event) => (
            <tr key={event.id} className="border-t border-[var(--color-border)]">
              <td className="px-4 py-3 font-semibold text-[var(--color-primary-900)]">
                <Link
                  href={`/events/${event.id}`}
                  className="underline-offset-2 hover:text-[var(--color-primary-700)] hover:underline"
                >
                  {event.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-[var(--color-text-subtle)]">
                {event.startAt
                  ? new Date(event.startAt).toLocaleDateString("en-GB", {
                      dateStyle: "medium",
                    })
                  : "TBC"}
              </td>
              <td className="px-4 py-3 text-[var(--color-text-subtle)]">
                {formatTimeRange(event.startAt, event.endAt)}
              </td>
              <td className="px-4 py-3 text-[var(--color-text-subtle)]">
                {event.venueName ?? "Unassigned"}
              </td>
              <td className="px-4 py-3 text-[var(--color-text-subtle)]">
                {event.status}
              </td>
            </tr>
          ))}
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="px-4 py-6 text-center text-sm text-[var(--color-text-subtle)]"
              >
                No events to show with the selected filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
};

const ViewToggleButton = ({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full border px-4 py-1 text-sm font-semibold transition ${
      active
        ? "border-[var(--color-primary-500)] bg-[var(--color-primary-700)] text-white shadow-soft"
        : "border-[var(--color-border)] bg-white text-[var(--color-primary-700)] hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-900)]"
    }`}
  >
    {label}
  </button>
);
