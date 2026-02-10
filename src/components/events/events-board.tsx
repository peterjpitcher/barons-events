/** @jsxImportSource react */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Rows3,
  Search,
  List,
  SlidersHorizontal,
  X,
  ArrowDown,
  ArrowUp,
  ArrowUpDown
} from "lucide-react";
import type { EventSummary } from "@/lib/events";
import type { AppUser } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

dayjs.extend(advancedFormat);

type ViewMode = "month" | "matrix" | "list";
type ListSortKey = "date" | "time" | "event" | "venue" | "artist" | "space" | "status";
type ListSortDirection = "asc" | "desc";
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
    badge: "bg-[var(--color-primary-100)] text-[var(--color-primary-900)] border border-[var(--color-primary-400)]",
    dot: "bg-[var(--color-primary-700)]"
  },
  submitted: {
    badge: "bg-[var(--color-info)] text-white border border-[var(--color-accent-cool-dark)]",
    dot: "bg-white"
  },
  needs_revisions: {
    badge: "bg-[var(--color-warning)] text-[#2f230d] border border-[#9a6d2b]",
    dot: "bg-[#2f230d]"
  },
  approved: {
    badge: "bg-[var(--color-success)] text-white border border-[#355849]",
    dot: "bg-white"
  },
  rejected: {
    badge: "bg-[var(--color-danger)] text-white border border-[#6e3032]",
    dot: "bg-white"
  },
  completed: {
    badge: "bg-[#355849] text-white border border-[#284338]",
    dot: "bg-white"
  }
};

const statusSortOrder: Record<EventSummary["status"], number> = {
  draft: 0,
  submitted: 1,
  needs_revisions: 2,
  approved: 3,
  completed: 4,
  rejected: 5
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

function minutesAfterMidnight(value: dayjs.Dayjs): number {
  return value.diff(value.startOf("day"), "minute");
}

function endsInEarlyHoursNextDay(event: EventWithDates): boolean {
  const startDay = event.start.startOf("day");
  const endDay = event.end.startOf("day");
  if (endDay.diff(startDay, "day") !== 1) {
    return false;
  }
  return minutesAfterMidnight(event.end) <= 300;
}

function getEventArtistNames(event: EventSummary): string[] {
  if (!Array.isArray(event.artists)) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];
  event.artists.forEach((entry) => {
    const raw = entry?.artist?.name;
    if (typeof raw !== "string") return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(trimmed);
  });

  return names;
}

function getEventArtistLabel(event: EventSummary): string {
  const names = getEventArtistNames(event);
  return names.length ? names.join(", ") : "No artist";
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
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

  const [view, setView] = useState<ViewMode>(
    rawView === "matrix" || rawView === "list" ? rawView : "month"
  );
  const [selectedVenueId, setSelectedVenueId] = useState<string>(rawVenue);
  const [matrixStart, setMatrixStart] = useState<dayjs.Dayjs>(
    rawMatrixStart ? dayjs(rawMatrixStart) : dayjs().startOf("day")
  );
  const [monthCursor, setMonthCursor] = useState<dayjs.Dayjs>(dayjs().startOf("month"));
  const [venueSearch, setVenueSearch] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [eventSearch, setEventSearch] = useState("");
  const [artistSearch, setArtistSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const pendingVenueIdRef = useRef<string | null>(null);
  const monthLabel = useMemo(() => monthCursor.format("MMMM YYYY"), [monthCursor]);

  useEffect(() => {
    if (!rawView) {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem(localStorageKey) : null;
      if (stored === "month" || stored === "matrix" || stored === "list") {
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
    const pendingVenueId = pendingVenueIdRef.current;
    if (pendingVenueId !== null) {
      if (rawVenue === pendingVenueId) {
        pendingVenueIdRef.current = null;
      }
      return;
    }

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

  const venueFilteredEvents = useMemo(() => {
    if (!filteredVenueId) return eventDataset;
    return eventDataset.filter((event) => event.venue?.id === filteredVenueId);
  }, [eventDataset, filteredVenueId]);

  const startDateBoundary = useMemo(() => {
    if (!startDateFilter) return null;
    const parsed = dayjs(startDateFilter);
    return parsed.isValid() ? parsed.startOf("day") : null;
  }, [startDateFilter]);

  const endDateBoundary = useMemo(() => {
    if (!endDateFilter) return null;
    const parsed = dayjs(endDateFilter);
    return parsed.isValid() ? parsed.endOf("day") : null;
  }, [endDateFilter]);

  const filteredEvents = useMemo(() => {
    const textNeedle = eventSearch.trim().toLowerCase();
    const artistNeedle = artistSearch.trim().toLowerCase();

    return venueFilteredEvents.filter((event) => {
      if (statusFilter !== "all" && event.status !== statusFilter) {
        return false;
      }

      if (eventTypeFilter !== "all" && event.event_type !== eventTypeFilter) {
        return false;
      }

      if (startDateBoundary && event.end.isBefore(startDateBoundary)) {
        return false;
      }

      if (endDateBoundary && event.start.isAfter(endDateBoundary)) {
        return false;
      }

      if (textNeedle) {
        const statusLabel = (statusConfig[event.status] ?? statusConfig.draft).label;
        const haystack = [
          event.title,
          event.event_type,
          event.venue?.name ?? "",
          event.venue_space ?? "",
          event.notes ?? "",
          statusLabel
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(textNeedle)) {
          return false;
        }
      }

      if (artistNeedle) {
        const artistValue = getEventArtistLabel(event).toLowerCase();
        if (!artistValue.includes(artistNeedle)) {
          return false;
        }
      }

      return true;
    });
  }, [
    venueFilteredEvents,
    eventSearch,
    artistSearch,
    statusFilter,
    eventTypeFilter,
    startDateBoundary,
    endDateBoundary
  ]);

  const filteredVenuesForMatrix = useMemo(() => {
    if (!filteredVenueId) {
      return venuesList;
    }
    const match = venueMap.get(filteredVenueId);
    return match ? [match] : venuesList;
  }, [filteredVenueId, venuesList, venueMap]);

  const viewOptions: { mode: ViewMode; icon: typeof CalendarDays; label: string }[] = [
    { mode: "month", icon: CalendarDays, label: "Month" },
    { mode: "matrix", icon: Rows3, label: "7-day" },
    { mode: "list", icon: List, label: "List" }
  ];

  const legendItems = (Object.keys(statusConfig) as EventSummary["status"][]).map((status) => ({
    status,
    ...statusConfig[status]
  }));

  const eventTypeOptions = useMemo(() => {
    const unique = Array.from(
      new Set(eventDataset.map((event) => event.event_type).filter((value): value is string => Boolean(value)))
    );
    unique.sort((left, right) => compareText(left, right));
    return unique;
  }, [eventDataset]);

  const hasAdvancedFilters = Boolean(
    eventSearch.trim() ||
      artistSearch.trim() ||
      statusFilter !== "all" ||
      eventTypeFilter !== "all" ||
      startDateFilter ||
      endDateFilter
  );

  const clearAdvancedFilters = useCallback(() => {
    setEventSearch("");
    setArtistSearch("");
    setStatusFilter("all");
    setEventTypeFilter("all");
    setStartDateFilter("");
    setEndDateFilter("");
  }, []);

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
    pendingVenueIdRef.current = value;
    setSelectedVenueId(value);
  }, []);

  const heading = user.role === "venue_manager" ? "My events" : "Events overview";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">{heading}</h1>
          <p className="mt-1 text-subtle">
            Track programming across venues, pivot between month, week, and list views, and jump straight into new drafts.
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

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
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
            <Button
              type="button"
              variant={showAdvancedFilters || hasAdvancedFilters ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowAdvancedFilters((current) => !current)}
            >
              <SlidersHorizontal className="mr-1 h-4 w-4" />
              Advanced filters
            </Button>
            {hasAdvancedFilters ? (
              <Button type="button" variant="ghost" size="sm" onClick={clearAdvancedFilters}>
                <X className="mr-1 h-4 w-4" />
                Clear
              </Button>
            ) : null}
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
          ) : view === "month" ? (
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
          ) : (
            <div className="rounded-full border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-subtle">
              {filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"}
            </div>
          )}
        </div>

        {showAdvancedFilters || hasAdvancedFilters ? (
          <div className="grid gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-4 md:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="events-filter-search" className="text-xs font-semibold uppercase tracking-[0.1em] text-subtle">
                Event search
              </label>
              <Input
                id="events-filter-search"
                value={eventSearch}
                onChange={(event) => setEventSearch(event.target.value)}
                placeholder="Title, type, notes..."
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="events-filter-artist" className="text-xs font-semibold uppercase tracking-[0.1em] text-subtle">
                Artist
              </label>
              <Input
                id="events-filter-artist"
                value={artistSearch}
                onChange={(event) => setArtistSearch(event.target.value)}
                placeholder="Artist name"
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="events-filter-status" className="text-xs font-semibold uppercase tracking-[0.1em] text-subtle">
                Status
              </label>
              <Select
                id="events-filter-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-10"
              >
                <option value="all">All statuses</option>
                {(Object.keys(statusConfig) as EventSummary["status"][]).map((status) => (
                  <option key={status} value={status}>
                    {statusConfig[status].label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor="events-filter-type" className="text-xs font-semibold uppercase tracking-[0.1em] text-subtle">
                Event type
              </label>
              <Select
                id="events-filter-type"
                value={eventTypeFilter}
                onChange={(event) => setEventTypeFilter(event.target.value)}
                className="h-10"
              >
                <option value="all">All types</option>
                {eventTypeOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label
                htmlFor="events-filter-start-date"
                className="text-xs font-semibold uppercase tracking-[0.1em] text-subtle"
              >
                From date
              </label>
              <Input
                id="events-filter-start-date"
                type="date"
                value={startDateFilter}
                onChange={(event) => setStartDateFilter(event.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="events-filter-end-date" className="text-xs font-semibold uppercase tracking-[0.1em] text-subtle">
                To date
              </label>
              <Input
                id="events-filter-end-date"
                type="date"
                value={endDateFilter}
                onChange={(event) => setEndDateFilter(event.target.value)}
                className="h-10"
              />
            </div>
          </div>
        ) : null}
      </section>

      <StatusLegend legendItems={legendItems} />

      {view === "month" ? (
        <MonthCalendar
          events={filteredEvents}
          monthCursor={monthCursor}
          onChangeMonth={setMonthCursor}
          canCreate={
            canCreate &&
            (createScopeVenueId === undefined ||
              createScopeVenueId === null ||
              !filteredVenueId ||
              filteredVenueId === createScopeVenueId)
          }
          createVenueId={filteredVenueId ?? (typeof createScopeVenueId === "string" ? createScopeVenueId : undefined)}
        />
      ) : view === "matrix" ? (
        <SevenDayMatrix
          events={filteredEvents}
          venues={filteredVenuesForMatrix}
          rangeStart={matrixStart}
          onChangeStart={setMatrixStart}
          canCreate={canCreate}
          createScopeVenueId={createScopeVenueId}
        />
      ) : (
        <EventsListTable events={filteredEvents} />
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
      const endsEarlyNextDay = endsInEarlyHoursNextDay(event);
      const lastDay = endsEarlyNextDay ? cursor : event.end.startOf("day");
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
          const quickCreateHref = (() => {
            if (!canCreate) return null;
            const startAt = day.hour(19).minute(0).second(0).millisecond(0);
            const endAt = startAt.add(3, "hour");
            const params = new URLSearchParams();
            params.set("startAt", startAt.format("YYYY-MM-DDTHH:mm"));
            params.set("endAt", endAt.format("YYYY-MM-DDTHH:mm"));
            if (createVenueId) {
              params.set("venueId", createVenueId);
            }
            return `/events/new?${params.toString()}`;
          })();
          return (
            <div
              key={key}
              className="min-h-[7.5rem] bg-white p-2"
              aria-label={`${day.format("dddd D MMMM")}, ${dayEvents.length} events`}
            >
              <div className="flex items-center justify-between">
                {quickCreateHref ? (
                  <Link
                    href={quickCreateHref}
                    className={`rounded-full px-2 py-1 text-sm font-semibold transition ${
                      isCurrentMonth ? "text-[var(--color-text)] hover:bg-[var(--color-muted-surface)]" : "text-subtle"
                    } ${isToday ? "bg-[var(--color-primary-700)] text-white hover:bg-[var(--color-primary-800)]" : ""}`}
                  >
                    {day.format("D")}
                  </Link>
                ) : (
                  <span
                    className={`text-sm font-semibold ${
                      isCurrentMonth ? "text-[var(--color-text)]" : "text-subtle"
                    } ${isToday ? "rounded-full bg-[var(--color-primary-700)] px-2 py-1 text-white" : ""}`}
                  >
                    {day.format("D")}
                  </span>
                )}
                {quickCreateHref ? (
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-[var(--color-primary-700)]"
                  >
                    <Link href={quickCreateHref}>Add event</Link>
                  </Button>
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
              {dayEvents.length === 0 ? (
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
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.08em] ${accent.badge}`}
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

function EventsListTable({ events }: { events: EventWithDates[] }) {
  const [sortBy, setSortBy] = useState<{ key: ListSortKey; direction: ListSortDirection }>({
    key: "date",
    direction: "asc"
  });

  const toggleSort = useCallback((key: ListSortKey) => {
    setSortBy((current) => {
      if (current.key !== key) {
        return { key, direction: "asc" };
      }
      return { key, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  }, []);

  const sortedEvents = useMemo(() => {
    const sorted = [...events];
    sorted.sort((left, right) => {
      const leftArtistLabel = getEventArtistLabel(left);
      const rightArtistLabel = getEventArtistLabel(right);
      const result = (() => {
        switch (sortBy.key) {
          case "date":
            return left.start.startOf("day").valueOf() - right.start.startOf("day").valueOf();
          case "time":
            return minutesAfterMidnight(left.start) - minutesAfterMidnight(right.start);
          case "event":
            return compareText(left.title, right.title);
          case "venue":
            return compareText(left.venue?.name ?? "", right.venue?.name ?? "");
          case "artist":
            return compareText(leftArtistLabel, rightArtistLabel);
          case "space":
            return compareText(left.venue_space ?? "", right.venue_space ?? "");
          case "status":
            return (statusSortOrder[left.status] ?? 999) - (statusSortOrder[right.status] ?? 999);
          default:
            return 0;
        }
      })();

      if (result !== 0) {
        return sortBy.direction === "asc" ? result : -result;
      }

      const startTieBreaker = left.start.valueOf() - right.start.valueOf();
      if (startTieBreaker !== 0) {
        return sortBy.direction === "asc" ? startTieBreaker : -startTieBreaker;
      }

      return compareText(left.title, right.title);
    });
    return sorted;
  }, [events, sortBy]);

  const sortIcon = useCallback(
    (key: ListSortKey) => {
      if (sortBy.key !== key) {
        return <ArrowUpDown className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />;
      }
      return sortBy.direction === "asc" ? (
        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
      );
    },
    [sortBy]
  );

  const sortAriaValue = useCallback(
    (key: ListSortKey): "none" | "ascending" | "descending" => {
      if (sortBy.key !== key) return "none";
      return sortBy.direction === "asc" ? "ascending" : "descending";
    },
    [sortBy]
  );

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-soft">
        <thead>
          <tr className="bg-[var(--color-muted-surface)] text-left text-xs font-semibold uppercase tracking-[0.12em] text-subtle">
            <th className="px-4 py-3" aria-sort={sortAriaValue("date")}>
              <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("date")}>
                Date {sortIcon("date")}
              </button>
            </th>
            <th className="px-4 py-3" aria-sort={sortAriaValue("time")}>
              <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("time")}>
                Time {sortIcon("time")}
              </button>
            </th>
            <th className="px-4 py-3" aria-sort={sortAriaValue("event")}>
              <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("event")}>
                Event {sortIcon("event")}
              </button>
            </th>
            <th className="px-4 py-3" aria-sort={sortAriaValue("venue")}>
              <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("venue")}>
                Venue {sortIcon("venue")}
              </button>
            </th>
            <th className="px-4 py-3" aria-sort={sortAriaValue("artist")}>
              <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("artist")}>
                Artist {sortIcon("artist")}
              </button>
            </th>
            <th className="px-4 py-3" aria-sort={sortAriaValue("space")}>
              <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("space")}>
                Space {sortIcon("space")}
              </button>
            </th>
            <th className="px-4 py-3" aria-sort={sortAriaValue("status")}>
              <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort("status")}>
                Status {sortIcon("status")}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-6 py-10 text-center text-sm text-subtle">
                No events match this filter.
              </td>
            </tr>
          ) : (
            sortedEvents.map((event) => {
              const status = statusConfig[event.status] ?? statusConfig.draft;
              const venueName = event.venue?.name ?? "Unknown venue";
              const artistLabel = getEventArtistLabel(event);
              const spaceName = event.venue_space?.trim().length ? event.venue_space : "Space to be confirmed";
              return (
                <tr key={event.id} className="border-t border-[var(--color-border)] text-sm text-[var(--color-text)]">
                  <td className="px-4 py-3 whitespace-nowrap">{event.start.format("ddd D MMM YYYY")}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {event.start.format("HH:mm")} - {event.end.format("HH:mm")}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/events/${event.id}`}
                      className="font-semibold text-[var(--color-text)] transition-colors hover:text-[var(--color-primary-700)]"
                    >
                      {event.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{venueName}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`block max-w-[18rem] truncate ${artistLabel === "No artist" ? "text-subtle" : ""}`}
                      title={artistLabel}
                    >
                      {artistLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3">{spaceName}</td>
                  <td className="px-4 py-3">
                    <Badge variant={status.tone}>{status.label}</Badge>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
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
      .filter((event) => {
        if (!endsInEarlyHoursNextDay(event)) {
          return true;
        }
        const nextDayStart = event.start.startOf("day").add(1, "day");
        return !dayStartEdge.isSame(nextDayStart);
      })
      .map((event) => {
        const treatAsSameDay = endsInEarlyHoursNextDay(event) && dayStartEdge.isSame(event.start.startOf("day"));
        const displayStart = event.start.isBefore(dayStartEdge) ? dayStartEdge : event.start;
        let displayEnd = event.end.isAfter(dayEndEdge) ? dayEndEdge : event.end;
        return {
          event,
          displayStart,
          displayEnd: treatAsSameDay ? event.end : displayEnd,
          spansPrevious: event.start.isBefore(dayStartEdge),
          spansNext: treatAsSameDay ? false : event.end.isAfter(dayEndEdge)
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
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.08em] ${accent.badge}`}
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
