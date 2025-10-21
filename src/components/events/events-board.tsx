/** @jsxImportSource react */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import { ChevronLeft, ChevronRight, CalendarDays, Rows3, Search } from "lucide-react";
import type { EventSummary } from "@/lib/events";
import type { AppUser } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

dayjs.extend(advancedFormat);

type ViewMode = "month" | "matrix";
type EventWithDates = EventSummary & {
  start: dayjs.Dayjs;
  end: dayjs.Dayjs;
};

type VenueOption = {
  id: string;
  name: string;
};

type EventsBoardProps = {
  user: AppUser;
  events: EventSummary[];
  venues: VenueOption[];
};

const statusConfig: Record<
  EventSummary["status"],
  { label: string; tone: Parameters<typeof Badge>[0]["variant"] }
> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Waiting review", tone: "info" },
  needs_revisions: { label: "Needs tweaks", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  completed: { label: "Completed", tone: "success" }
};

const statusAccentStyles: Record<
  EventSummary["status"],
  { badge: string; dot: string }
> = {
  draft: {
    badge: "bg-[rgba(39,54,64,0.08)] text-[var(--color-text-subtle)] border border-[rgba(39,54,64,0.18)]",
    dot: "bg-[rgba(39,54,64,0.45)]"
  },
  submitted: {
    badge: "bg-[rgba(95,124,145,0.22)] text-[var(--color-info)] border border-[rgba(95,124,145,0.4)]",
    dot: "bg-[var(--color-info)]"
  },
  needs_revisions: {
    badge: "bg-[rgba(192,139,60,0.2)] text-[var(--color-warning)] border border-[rgba(192,139,60,0.45)]",
    dot: "bg-[var(--color-warning)]"
  },
  approved: {
    badge: "bg-[rgba(79,122,105,0.22)] text-[var(--color-success)] border border-[rgba(79,122,105,0.45)]",
    dot: "bg-[var(--color-success)]"
  },
  rejected: {
    badge: "bg-[rgba(177,91,96,0.24)] text-[var(--color-danger)] border border-[rgba(177,91,96,0.45)]",
    dot: "bg-[var(--color-danger)]"
  },
  completed: {
    badge: "bg-[rgba(79,122,105,0.28)] text-[var(--color-success)] border border-[rgba(79,122,105,0.5)]",
    dot: "bg-[var(--color-success)]"
  }
};

const localStorageKey = "events-board-view";

function startOfIsoWeek(date: dayjs.Dayjs) {
  const day = date.day(); // 0 (Sun) - 6 (Sat)
  const diff = (day + 6) % 7;
  return date.subtract(diff, "day").startOf("day");
}

function endOfIsoWeek(date: dayjs.Dayjs) {
  return startOfIsoWeek(date).add(6, "day").endOf("day");
}

function normaliseEvents(events: EventSummary[]): EventWithDates[] {
  return events
    .map((event) => ({
      ...event,
      start: dayjs(event.start_at),
      end: dayjs(event.end_at)
    }))
    .sort((a, b) => a.start.valueOf() - b.start.valueOf());
}

export function EventsBoard({ user, events, venues }: EventsBoardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawView = (searchParams.get("view") ?? "") as ViewMode | "";
  const rawVenue = searchParams.get("venueId") ?? "all";
  const rawMatrixStart = searchParams.get("start");
  const myVenueId = user.venueId ?? null;
  const createScopeVenueId =
    user.role === "central_planner" ? undefined : user.role === "venue_manager" ? myVenueId ?? null : null;
  const canCreate =
    user.role === "central_planner" || (user.role === "venue_manager" && typeof createScopeVenueId === "string");

  const [view, setView] = useState<ViewMode>(rawView === "matrix" ? "matrix" : "month");
  const [selectedVenueId, setSelectedVenueId] = useState<string>(rawVenue);
  const [matrixStart, setMatrixStart] = useState<dayjs.Dayjs>(
    rawMatrixStart ? dayjs(rawMatrixStart) : dayjs().startOf("day")
  );
  const [monthCursor, setMonthCursor] = useState<dayjs.Dayjs>(dayjs().startOf("month"));
  const [venueSearch, setVenueSearch] = useState("");
  const monthLabel = useMemo(() => monthCursor.format("MMMM YYYY"), [monthCursor]);

  useEffect(() => {
    if (!rawView) {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem(localStorageKey) : null;
      if (stored === "month" || stored === "matrix") {
        setView(stored);
      }
    }
  }, [rawView]);

  useEffect(() => {
    if (view === "matrix" && rawMatrixStart) {
      const parsed = dayjs(rawMatrixStart);
      if (parsed.isValid()) {
        setMatrixStart(parsed.startOf("day"));
      }
    }
  }, [rawMatrixStart, view]);

  useEffect(() => {
    if (rawVenue !== selectedVenueId) {
      setSelectedVenueId(rawVenue);
    }
  }, [rawVenue, selectedVenueId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(localStorageKey, view);
    }
  }, [view]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== "month") params.set("view", view);
    if (selectedVenueId && selectedVenueId !== "all") params.set("venueId", selectedVenueId);
    if (view === "matrix" && matrixStart.isValid()) {
      params.set("start", matrixStart.format("YYYY-MM-DD"));
    }
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }, [view, selectedVenueId, matrixStart, pathname, router]);

  const eventDataset = useMemo(() => normaliseEvents(events), [events]);

  const venueMap = useMemo(() => {
    const map = new Map<string, VenueOption>();
    venues.forEach((venue) => {
      map.set(venue.id, venue);
    });
    eventDataset.forEach((event) => {
      if (event.venue?.id && !map.has(event.venue.id)) {
        map.set(event.venue.id, { id: event.venue.id, name: event.venue.name ?? "Unknown venue" });
      }
    });
    return map;
  }, [venues, eventDataset]);

  const venuesList = useMemo(() => Array.from(venueMap.values()).sort((a, b) => a.name.localeCompare(b.name)), [venueMap]);

  useEffect(() => {
    if (selectedVenueId === "my" && !myVenueId) {
      setSelectedVenueId("all");
      return;
    }
    if (selectedVenueId !== "all" && selectedVenueId !== "my") {
      const exists = venuesList.some((venue) => venue.id === selectedVenueId);
      if (!exists) {
        setSelectedVenueId("all");
      }
    }
  }, [selectedVenueId, venuesList, myVenueId]);

  const filteredVenueId =
    selectedVenueId === "my" ? myVenueId ?? undefined : selectedVenueId === "all" ? undefined : selectedVenueId;

  const filteredEvents = useMemo(() => {
    if (!filteredVenueId) return eventDataset;
    return eventDataset.filter((event) => event.venue?.id === filteredVenueId);
  }, [eventDataset, filteredVenueId]);

  const filteredVenuesForMatrix = useMemo(() => {
    if (!filteredVenueId) {
      return venuesList;
    }
    const match = venueMap.get(filteredVenueId);
    return match ? [match] : venuesList;
  }, [filteredVenueId, venuesList, venueMap]);

  const viewOptions: { mode: ViewMode; icon: typeof CalendarDays; label: string }[] = [
    { mode: "month", icon: CalendarDays, label: "Month" },
    { mode: "matrix", icon: Rows3, label: "7-day" }
  ];

  const legendItems = (Object.keys(statusConfig) as EventSummary["status"][]).map((status) => ({
    status,
    ...statusConfig[status]
  }));

  const venueOptions = useMemo(() => {
    const baseOptions: { value: string; label: string }[] = [
      { value: "all", label: "All venues" }
    ];
    if (myVenueId) {
      const myVenue = venueMap.get(myVenueId);
      const name = myVenue?.name ?? "My venue";
      baseOptions.push({ value: "my", label: `My venue (${name})` });
    }
    const filtered = venuesList.filter((venue) =>
      venue.name.toLowerCase().includes(venueSearch.trim().toLowerCase())
    );

    const options = [...baseOptions, ...filtered.map((venue) => ({ value: venue.id, label: venue.name }))];

    if (selectedVenueId && selectedVenueId !== "all" && selectedVenueId !== "my") {
      const alreadyIncluded = options.some((option) => option.value === selectedVenueId);
      if (!alreadyIncluded) {
        const match = venueMap.get(selectedVenueId);
        if (match) {
          options.push({ value: match.id, label: match.name });
        }
      }
    }

    return options;
  }, [venuesList, venueMap, venueSearch, myVenueId, selectedVenueId]);

  const handleViewChange = useCallback(
    (next: ViewMode) => {
      setView(next);
      if (next === "matrix" && !matrixStart.isValid()) {
        setMatrixStart(dayjs().startOf("day"));
      }
    },
    [matrixStart]
  );

  const handleVenueChange = useCallback((value: string) => {
    setSelectedVenueId(value);
  }, []);

  const heading = user.role === "venue_manager" ? "My events" : "Events overview";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">{heading}</h1>
          <p className="mt-1 text-subtle">
            Track programming across venues, pivot between month and week views, and jump straight into new drafts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate ? (
            <Button asChild variant="primary">
              <Link href="/events/new">New event</Link>
            </Button>
          ) : null}
          <div className="flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white p-1">
            {viewOptions.map(({ mode, icon: Icon, label }) => (
              <Button
                key={mode}
                type="button"
                variant={view === mode ? "primary" : "ghost"}
                size="sm"
                onClick={() => handleViewChange(mode)}
              >
                <Icon className="mr-1 h-4 w-4" /> {label}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <section className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5">
            <Search className="h-4 w-4 text-subtle" aria-hidden="true" />
            <Input
              aria-label="Search venues"
              value={venueSearch}
              onChange={(event) => setVenueSearch(event.target.value)}
              placeholder="Search venues"
              className="h-8 w-40 border-0 bg-transparent p-0 text-sm focus-visible:ring-0"
            />
          </div>
          <Select
            value={selectedVenueId}
            onChange={(event) => handleVenueChange(event.target.value)}
            aria-label="Filter events by venue"
            className="h-10 w-48"
          >
            {venueOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        {view === "matrix" ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMatrixStart(matrixStart.subtract(7, "day"))}
            >
              Previous 7 days
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMatrixStart(dayjs().startOf("day"))}
              disabled={matrixStart.startOf("day").isSame(dayjs().startOf("day"))}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMatrixStart(matrixStart.add(7, "day"))}
            >
              Next 7 days
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMonthCursor(monthCursor.subtract(1, "month"))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous month
            </Button>
            <span className="px-2 text-sm font-semibold text-[var(--color-text)]">{monthLabel}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMonthCursor(dayjs().startOf("month"))}>
              Today
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMonthCursor(monthCursor.add(1, "month"))}
            >
              Next month <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        )}
      </section>

      <StatusLegend legendItems={legendItems} />

      {view === "month" ? (
        <MonthCalendar
          events={filteredEvents}
          monthCursor={monthCursor}
          onChangeMonth={setMonthCursor}
          canCreate={
            canCreate &&
            Boolean(filteredVenueId) &&
            (createScopeVenueId === undefined || filteredVenueId === createScopeVenueId)
          }
          createVenueId={filteredVenueId}
        />
      ) : (
        <SevenDayMatrix
          events={filteredEvents}
          venues={filteredVenuesForMatrix}
          rangeStart={matrixStart}
          onChangeStart={setMatrixStart}
          canCreate={canCreate}
          createScopeVenueId={createScopeVenueId}
        />
      )}
    </div>
  );
}

function StatusLegend({
  legendItems
}: {
  legendItems: { status: EventSummary["status"]; label: string; tone: Parameters<typeof Badge>[0]["variant"] }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-white px-4 py-2 text-xs text-subtle">
      <span className="font-medium text-[var(--color-text)]">Legend:</span>
      {legendItems.map((item) => (
        <Badge key={item.status} variant={item.tone}>
          {item.label}
        </Badge>
      ))}
    </div>
  );
}

type MonthCalendarProps = {
  events: EventWithDates[];
  monthCursor: dayjs.Dayjs;
  onChangeMonth: (cursor: dayjs.Dayjs) => void;
  canCreate: boolean;
  createVenueId?: string;
};

function MonthCalendar({ events, monthCursor, onChangeMonth, canCreate, createVenueId }: MonthCalendarProps) {
  const start = useMemo(() => startOfIsoWeek(monthCursor.startOf("month")), [monthCursor]);
  const end = useMemo(() => endOfIsoWeek(monthCursor.endOf("month")), [monthCursor]);

  const days = useMemo(() => {
    const totalDays = end.diff(start, "day") + 1;
    return Array.from({ length: totalDays }, (_, index) => start.add(index, "day"));
  }, [start, end]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, EventWithDates[]>();
    events.forEach((event) => {
      const cursor = event.start.startOf("day");
      const lastDay = event.end.startOf("day");
      const length = lastDay.diff(cursor, "day");
      for (let i = 0; i <= length; i += 1) {
        const dayKey = cursor.add(i, "day").format("YYYY-MM-DD");
        const bucket = map.get(dayKey) ?? [];
        bucket.push(event);
        map.set(dayKey, bucket);
      }
    });

    map.forEach((bucket) => {
      bucket.sort((a, b) => a.start.valueOf() - b.start.valueOf());
    });

    return map;
  }, [events]);

  const todayKey = dayjs().format("YYYY-MM-DD");

  useEffect(() => {
    if (!monthCursor.isValid()) {
      onChangeMonth(dayjs().startOf("month"));
    }
  }, [monthCursor, onChangeMonth]);

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-soft">
      <div className="grid grid-cols-7 border-b border-[var(--color-border)] bg-[var(--color-muted-surface)] text-center text-xs font-semibold uppercase tracking-[0.12em] text-subtle">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <div key={label} className="px-3 py-2">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-[var(--color-border)]">
        {days.map((day) => {
          const key = day.format("YYYY-MM-DD");
          const isCurrentMonth = day.month() === monthCursor.month();
          const isToday = key === todayKey;
          const dayEvents = eventsByDate.get(key) ?? [];
          const allowQuickCreate = canCreate && dayEvents.length === 0;
          return (
            <div
              key={key}
              className="min-h-[7.5rem] bg-white p-2"
              aria-label={`${day.format("dddd D MMMM")}, ${dayEvents.length} events`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-sm font-semibold ${
                    isCurrentMonth ? "text-[var(--color-text)]" : "text-subtle"
                  } ${isToday ? "rounded-full bg-[var(--color-primary-700)] px-2 py-1 text-white" : ""}`}
                >
                  {day.format("D")}
                </span>
                {allowQuickCreate ? (
                  (() => {
                    const startAt = day.hour(19).minute(0).second(0).millisecond(0);
                    const endAt = startAt.add(3, "hour");
                    const params = new URLSearchParams();
                    params.set("startAt", startAt.format("YYYY-MM-DDTHH:mm"));
                    params.set("endAt", endAt.format("YYYY-MM-DDTHH:mm"));
                    if (createVenueId) {
                      params.set("venueId", createVenueId);
                    }
                    const href = `/events/new?${params.toString()}`;
                    return (
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-[var(--color-primary-700)]"
                      >
                        <Link href={href}>Add event</Link>
                      </Button>
                    );
                  })()
                ) : null}
              </div>
              <ul className="mt-2 space-y-1 md:space-y-0 md:divide-y md:divide-[var(--color-border)]">
                {dayEvents.slice(0, 3).map((event) => (
                  <EventListItem key={event.id} event={event} />
                ))}
                {dayEvents.length > 3 ? (
                  <OverflowList events={dayEvents.slice(3)} />
                ) : null}
              </ul>
              {dayEvents.length === 0 && !canCreate ? (
                <p className="mt-2 text-xs text-subtle">No events</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventListItem({ event }: { event: EventWithDates }) {
  const status = statusConfig[event.status] ?? statusConfig.draft;
  const accent = statusAccentStyles[event.status] ?? statusAccentStyles.draft;
  const venueName = event.venue?.name ?? "Unknown venue";
  const spacesLabel = event.venue_space?.trim().length ? event.venue_space : "Space to be confirmed";
  const timeRange = `${event.start.format("HH:mm")} → ${event.end.format("HH:mm")}`;
  const hoverDetails = [
    `Venue: ${venueName}`,
    `Spaces: ${spacesLabel}`,
    `Starts: ${event.start.format("dddd D MMMM, HH:mm")}`,
    `Ends: ${event.end.format("dddd D MMMM, HH:mm")}`
  ].join("\n");

  return (
    <li
      title={hoverDetails}
      className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[rgba(39,54,64,0.12)] bg-white p-2 text-xs text-[var(--color-text)] shadow-soft"
    >
      <Link
        href={`/events/${event.id}`}
        className="truncate text-sm font-semibold text-[var(--color-text)] transition-colors hover:text-[var(--color-primary-700)]"
      >
        {event.title}
      </Link>
      <div className="flex flex-col gap-0.5 text-[0.7rem] text-subtle">
        <span className="truncate">{venueName}</span>
        <span className="truncate">{spacesLabel}</span>
        <span>{timeRange}</span>
      </div>
      <div className="mt-auto border-t border-[rgba(39,54,64,0.12)] pt-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.14em] ${accent.badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} aria-hidden="true" />
          {status.label}
        </span>
      </div>
    </li>
  );
}

function OverflowList({ events }: { events: EventWithDates[] }) {
  const [expanded, setExpanded] = useState(false);

  if (events.length === 0) return null;

  return (
    <li className="space-y-1">
      {!expanded ? (
        <Button
          type="button"
          variant="subtle"
          size="sm"
          className="h-7 w-full text-xs"
          onClick={() => setExpanded(true)}
        >
          Show {events.length} more
        </Button>
      ) : null}
      {expanded ? events.map((event) => <EventListItem key={event.id} event={event} />) : null}
    </li>
  );
}

type SevenDayMatrixProps = {
  events: EventWithDates[];
  venues: VenueOption[];
  rangeStart: dayjs.Dayjs;
  onChangeStart: (value: dayjs.Dayjs) => void;
  canCreate: boolean;
  createScopeVenueId: string | null | undefined;
};

function SevenDayMatrix({
  events,
  venues,
  rangeStart,
  onChangeStart,
  canCreate,
  createScopeVenueId
}: SevenDayMatrixProps) {
  const safeStart = rangeStart.isValid() ? rangeStart.startOf("day") : dayjs().startOf("day");
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => safeStart.add(index, "day")), [safeStart]);
  const rangeEnd = days[days.length - 1].endOf("day");

  useEffect(() => {
    if (!rangeStart.isValid()) {
      onChangeStart(dayjs().startOf("day"));
    }
  }, [rangeStart, onChangeStart]);

  const eventsByVenue = useMemo(() => {
    return venues.map((venue) => {
      const venueEvents = events.filter(
        (event) =>
          event.venue?.id === venue.id &&
          (event.start.isBefore(rangeEnd) || event.start.isSame(rangeEnd)) &&
          (event.end.isAfter(safeStart) || event.end.isSame(safeStart))
      );
      return { venue, events: venueEvents };
    });
  }, [events, venues, rangeEnd, safeStart]);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-soft">
        <thead>
          <tr className="bg-[var(--color-muted-surface)] text-xs font-semibold uppercase tracking-[0.12em] text-subtle">
            <th className="w-48 px-4 py-3 text-left">Venue</th>
            {days.map((day) => (
              <th key={day.toISOString()} className="min-w-[9rem] border-l border-[var(--color-border)] px-4 py-3 text-left">
                <div className="flex flex-col">
                  <span className="text-[0.7rem]">{day.format("ddd")}</span>
                  <span className="text-sm text-[var(--color-text)]">{day.format("D MMM")}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {venues.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-6 py-12 text-center text-subtle">
                No venues match this filter yet.
              </td>
            </tr>
          ) : (
            eventsByVenue.map(({ venue, events: venueEvents }) => (
              <VenueMatrixRow
                key={venue.id}
                venue={venue}
                events={venueEvents}
                days={days}
                canCreate={
                  canCreate &&
                  (createScopeVenueId === undefined || createScopeVenueId === venue.id)
                }
                createVenueId={
                  createScopeVenueId === undefined ? venue.id : createScopeVenueId ?? undefined
                }
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

type VenueMatrixRowProps = {
  venue: VenueOption;
  events: EventWithDates[];
  days: dayjs.Dayjs[];
  canCreate: boolean;
  createVenueId?: string;
};

function VenueMatrixRow({ venue, events, days, canCreate, createVenueId }: VenueMatrixRowProps) {
  const eventsByDay = days.map((day) => {
    const dayStartEdge = day.startOf("day");
    const dayEndEdge = day.endOf("day");
    return events
      .filter(
        (event) =>
          (event.start.isBefore(dayEndEdge) || event.start.isSame(dayEndEdge)) &&
          (event.end.isAfter(dayStartEdge) || event.end.isSame(dayStartEdge))
      )
      .map((event) => {
        const displayStart = event.start.isBefore(dayStartEdge) ? dayStartEdge : event.start;
        const displayEnd = event.end.isAfter(dayEndEdge) ? dayEndEdge : event.end;
        return {
          event,
          displayStart,
          displayEnd,
          spansPrevious: event.start.isBefore(dayStartEdge),
          spansNext: event.end.isAfter(dayEndEdge)
        };
      });
  });

  return (
    <tr className="border-t border-[var(--color-border)]">
      <th className="border-r border-[var(--color-border)] px-4 py-3 text-left align-top text-sm text-[var(--color-text)]">
        <div className="font-semibold">{venue.name}</div>
        <div className="text-xs text-subtle">{events.length} event{events.length === 1 ? "" : "s"}</div>
      </th>
      <td colSpan={7} className="p-0">
        <div className="grid grid-cols-7 gap-0 border border-[var(--color-border)] bg-white">
          {days.map((day, index) => (
            <div
              key={day.toISOString()}
              className="relative flex min-h-[6.5rem] flex-col gap-2 border border-[var(--color-border)] bg-white p-2"
              style={{
                borderLeftWidth: index === 0 ? undefined : 0,
                borderTopWidth: 0,
                borderBottomWidth: 0
              }}
            >
              {eventsByDay[index].map(({ event, displayStart, displayEnd, spansPrevious, spansNext }) => {
                const status = statusConfig[event.status] ?? statusConfig.draft;
                const accent = statusAccentStyles[event.status] ?? statusAccentStyles.draft;
                const spaceDisplay = event.venue_space?.trim().length
                  ? event.venue_space
                  : "Space to be confirmed";
                return (
                  <div
                    key={`${event.id}-${day.format("YYYY-MM-DD")}`}
                    className="flex h-full flex-col rounded-[var(--radius-sm)] border border-[rgba(39,54,64,0.12)] bg-white p-2 text-xs text-[var(--color-text)] shadow-soft"
                  >
                    <Link
                      href={`/events/${event.id}`}
                      className="truncate text-sm font-semibold text-[var(--color-text)] transition-colors hover:text-[var(--color-primary-700)]"
                    >
                      {event.title}
                    </Link>
                    <div className="mt-1 flex flex-col gap-1 text-[0.7rem] text-subtle">
                      <span className="truncate">{spaceDisplay}</span>
                      <span>
                        {spansPrevious ? "from prev · " : ""}
                        {displayStart.format("HH:mm")} → {displayEnd.format("HH:mm")}
                        {spansNext ? " · continues" : ""}
                      </span>
                    </div>
                    <div className="mt-auto border-t border-[rgba(39,54,64,0.12)] pt-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.14em] ${accent.badge}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} aria-hidden="true" />
                        {status.label}
                      </span>
                    </div>
                  </div>
                );
              })}
              {canCreate ? (
                (() => {
                  const startAt = day.hour(19).minute(0).second(0).millisecond(0);
                  const endAt = startAt.add(3, "hour");
                  const params = new URLSearchParams();
                  params.set("startAt", startAt.format("YYYY-MM-DDTHH:mm"));
                  params.set("endAt", endAt.format("YYYY-MM-DDTHH:mm"));
                  params.set("venueId", createVenueId ?? venue.id);
                  const href = `/events/new?${params.toString()}`;
                  return (
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="h-6 self-start px-2 text-[0.7rem] text-[var(--color-primary-700)]"
                    >
                      <Link href={href}>Add</Link>
                    </Button>
                  );
                })()
              ) : null}
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}
