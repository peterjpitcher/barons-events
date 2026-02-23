/** @jsxImportSource react */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import type { EventSummary } from "@/lib/events";
import type { AppUser } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EventCalendar, type CalendarEvent } from "@/components/events/event-calendar";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

dayjs.extend(advancedFormat);

type EventWithDates = CalendarEvent;

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

function normaliseEvents(events: EventSummary[]): EventWithDates[] {
  return events
    .map((event) => ({
      ...event,
      start: dayjs(event.start_at),
      end: dayjs(event.end_at)
    }))
    .sort((a, b) => a.start.valueOf() - b.start.valueOf());
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
  const rawVenue = searchParams.get("venueId") ?? "all";
  const myVenueId = user.venueId ?? null;
  const createScopeVenueId =
    user.role === "central_planner" ? undefined : user.role === "venue_manager" ? myVenueId ?? null : null;
  const canCreate =
    user.role === "central_planner" || (user.role === "venue_manager" && typeof createScopeVenueId === "string");

  const [selectedVenueId, setSelectedVenueId] = useState<string>(rawVenue);
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
    const currentParams = new URLSearchParams(searchParams.toString());
    currentParams.delete("view");
    currentParams.delete("start");

    if (selectedVenueId && selectedVenueId !== "all") {
      currentParams.set("venueId", selectedVenueId);
    } else {
      currentParams.delete("venueId");
    }

    const nextSearch = currentParams.toString();
    const existingSearch = searchParams.toString();
    if (nextSearch !== existingSearch) {
      router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, { scroll: false });
    }
  }, [selectedVenueId, pathname, router, searchParams]);

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

  const venuesList = useMemo(
    () => Array.from(venueMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [venueMap]
  );

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
    const baseOptions: { value: string; label: string }[] = [{ value: "all", label: "All venues" }];
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
            Track programming across venues in a monthly calendar and jump straight into new drafts.
          </p>
        </div>
        {canCreate ? (
          <Button asChild variant="primary">
            <Link href="/events/new">New event</Link>
          </Button>
        ) : null}
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

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setMonthCursor(monthCursor.subtract(1, "month"))}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous month
            </Button>
            <span className="px-2 text-sm font-semibold text-[var(--color-text)]">{monthLabel}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMonthCursor(dayjs().startOf("month"))}>
              Today
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setMonthCursor(monthCursor.add(1, "month"))}>
              Next month <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
            <div className="rounded-full border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-subtle">
              {filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"}
            </div>
          </div>
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

      <EventCalendar
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
        getStatusLabel={(status) => (statusConfig[status] ?? statusConfig.draft).label}
        getStatusAccent={(status) => statusAccentStyles[status] ?? statusAccentStyles.draft}
      />
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
