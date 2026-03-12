"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarRange, Filter, LayoutGrid, List, MoveHorizontal, Plus, Users } from "lucide-react";
import { movePlanningItemDateAction, refreshInspirationItemsAction } from "@/actions/planning";
import { PlanningAlertStrip } from "@/components/planning/planning-alert-strip";
import { PlanningCalendarView } from "@/components/planning/planning-calendar-view";
import { PlanningItemCard, EventOverlayCard, InspirationItemCard } from "@/components/planning/planning-item-card";
import { PlanningItemEditor } from "@/components/planning/planning-item-editor";
import { PlanningListView } from "@/components/planning/planning-list-view";
import { PlanningModal } from "@/components/planning/planning-modal";
import { PlanningTodosByPersonView } from "@/components/planning/planning-todos-by-person-view";
import type { PlanningViewEntry } from "@/components/planning/view-types";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type {
  PlanningBoardData,
  PlanningBucketKey,
  PlanningEventOverlay,
  PlanningInspirationItem,
  PlanningItem,
  PlanningVenueOption
} from "@/lib/planning/types";
import { bucketForDayOffset, daysBetween } from "@/lib/planning/utils";

type PlanningBoardProps = {
  data: PlanningBoardData;
  venues: PlanningVenueOption[];
  canApproveEvents?: boolean;
  userRole?: string;
};

type BucketConfig = {
  key: PlanningBucketKey;
  label: string;
  helper: string;
};

const BUCKETS: BucketConfig[] = [
  { key: "0_30", label: "0–30 days", helper: "Immediate priorities" },
  { key: "31_60", label: "31–60 days", helper: "Mid-horizon actions" },
  { key: "61_90", label: "61–90 days", helper: "Forward planning" },
  { key: "later", label: "90+ days", helper: "Long-range backlog" }
];

function bucketForPlanningOffset(dayOffset: number): PlanningBucketKey {
  if (dayOffset < 0) {
    return "0_30";
  }
  return bucketForDayOffset(dayOffset);
}

function sortByDateThenTitle<T extends { targetDate: string; title: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    if (left.targetDate !== right.targetDate) {
      return left.targetDate.localeCompare(right.targetDate);
    }
    return left.title.localeCompare(right.title);
  });
}

type ViewMode = "board" | "calendar" | "list" | "todos_by_person";

function RefreshInspirationButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleRefresh() {
    setLoading(true);
    setMessage(null);
    const result = await refreshInspirationItemsAction();
    setMessage(result.message ?? (result.success ? 'Done.' : 'Failed.'));
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleRefresh}
        disabled={loading}
        title="Refresh inspiration items"
      >
        <span>{loading ? '⏳' : '✨'}</span>
        <span>{loading ? 'Refreshing…' : 'Refresh inspiration'}</span>
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}

export function PlanningBoard({ data, venues, canApproveEvents, userRole }: PlanningBoardProps) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);
  const [search, setSearch] = useState("");
  const [venueFilter, setVenueFilter] = useState("");
  const [eventVisibility, setEventVisibility] = useState<"with_events" | "planning_only">("with_events");
  const [isPending, startTransition] = useTransition();

  const filteredPlanningItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.planningItems.filter((item) => {
      if (venueFilter && item.venueId !== venueFilter) {
        return false;
      }

      if (!needle.length) {
        return true;
      }

      const taskValue = item.tasks.map((task) => task.title).join(" ").toLowerCase();
      const haystack = [item.title, item.typeLabel, item.description ?? "", item.ownerName ?? "", taskValue]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [data.planningItems, search, venueFilter]);

  const filteredEvents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.events.filter((event) => {
      if (venueFilter && event.venueId !== venueFilter) {
        return false;
      }

      if (!needle.length) {
        return true;
      }

      const haystack = [event.title, event.venueName ?? "", event.venueSpace ?? "", event.status].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [data.events, search, venueFilter]);

  const visibleEvents = useMemo(
    () => (eventVisibility === "with_events" ? filteredEvents : []),
    [eventVisibility, filteredEvents]
  );

  const planningByBucket = useMemo(() => {
    const grouped: Record<PlanningBucketKey, PlanningItem[]> = {
      "0_30": [],
      "31_60": [],
      "61_90": [],
      later: []
    };

    filteredPlanningItems.forEach((item) => {
      const offset = daysBetween(data.today, item.targetDate);
      const bucket = bucketForPlanningOffset(offset);
      grouped[bucket].push(item);
    });

    return {
      "0_30": sortByDateThenTitle(grouped["0_30"]),
      "31_60": sortByDateThenTitle(grouped["31_60"]),
      "61_90": sortByDateThenTitle(grouped["61_90"]),
      later: sortByDateThenTitle(grouped.later)
    };
  }, [data.today, filteredPlanningItems]);

  const eventsByBucket = useMemo(() => {
    const grouped: Record<PlanningBucketKey, PlanningEventOverlay[]> = {
      "0_30": [],
      "31_60": [],
      "61_90": [],
      later: []
    };

    visibleEvents.forEach((event) => {
      const offset = daysBetween(data.today, event.targetDate);
      const bucket = bucketForPlanningOffset(offset);
      grouped[bucket].push(event);
    });

    return {
      "0_30": sortByDateThenTitle(grouped["0_30"]),
      "31_60": sortByDateThenTitle(grouped["31_60"]),
      "61_90": sortByDateThenTitle(grouped["61_90"]),
      later: sortByDateThenTitle(grouped.later)
    };
  }, [data.today, visibleEvents]);

  const inspirationByBucket = useMemo(() => {
    const map: Record<PlanningBucketKey, PlanningInspirationItem[]> = {
      '0_30': [], '31_60': [], '61_90': [], later: [],
    };
    for (const item of data.inspirationItems) {
      const offset = daysBetween(data.today, item.eventDate);
      const bucket = bucketForPlanningOffset(offset);
      map[bucket].push(item);
    }
    return map;
  }, [data.inspirationItems, data.today]);

  const combinedByBucket = useMemo(() => {
    const typeOrder: Record<string, number> = { planning: 0, event: 1, inspiration: 2 };
    const result: Record<PlanningBucketKey, Array<
      | { type: "planning"; item: PlanningItem }
      | { type: "event"; event: PlanningEventOverlay }
      | { type: "inspiration"; item: PlanningInspirationItem }
    >> = { "0_30": [], "31_60": [], "61_90": [], later: [] };

    for (const key of ["0_30", "31_60", "61_90", "later"] as PlanningBucketKey[]) {
      const merged = [
        ...planningByBucket[key].map((item) => ({ type: "planning" as const, item, targetDate: item.targetDate, title: item.title })),
        ...eventsByBucket[key].map((event) => ({ type: "event" as const, event, targetDate: event.targetDate, title: event.title })),
        ...inspirationByBucket[key].map((item) => ({ type: "inspiration" as const, item, targetDate: item.eventDate, title: item.eventName }))
      ];
      merged.sort((left, right) => {
        if (left.targetDate !== right.targetDate) return left.targetDate.localeCompare(right.targetDate);
        const lo = typeOrder[left.type] ?? 3;
        const ro = typeOrder[right.type] ?? 3;
        if (lo !== ro) return lo - ro;
        return left.title.localeCompare(right.title);
      });
      result[key] = merged;
    }

    return result;
  }, [planningByBucket, eventsByBucket, inspirationByBucket]);

  const visibleBuckets = showLater ? BUCKETS : BUCKETS.slice(0, 3);
  const activeItem = useMemo(
    () => data.planningItems.find((item) => item.id === activeItemId) ?? null,
    [activeItemId, data.planningItems]
  );

  const combinedEntries = useMemo<PlanningViewEntry[]>(() => {
    const sourceOrder: Record<string, number> = { planning: 0, event: 1, inspiration: 2 };

    const planningEntries: PlanningViewEntry[] = filteredPlanningItems.map((item) => ({
      id: `planning-${item.id}`,
      source: "planning",
      targetDate: item.targetDate,
      title: item.title,
      status: item.status,
      venueLabel: item.venueName ?? "Global",
      planningItem: item
    }));

    const eventEntries: PlanningViewEntry[] = visibleEvents.map((event) => ({
      id: `event-${event.eventId}`,
      source: "event",
      targetDate: event.targetDate,
      title: event.title,
      status: event.status,
      venueLabel: `${event.venueName ?? "Unknown venue"}${event.venueSpace ? ` · ${event.venueSpace}` : ""}`,
      eventId: event.eventId,
      startAt: event.startAt
    }));

    const inspirationEntries: PlanningViewEntry[] = data.inspirationItems.map((item) => ({
      id: `inspiration-${item.id}`,
      source: "inspiration",
      targetDate: item.eventDate,
      title: item.eventName,
      inspirationItem: item
    }));

    return [...planningEntries, ...eventEntries, ...inspirationEntries].sort((left, right) => {
      if (left.targetDate !== right.targetDate) return left.targetDate.localeCompare(right.targetDate);
      const lo = sourceOrder[left.source] ?? 3;
      const ro = sourceOrder[right.source] ?? 3;
      if (lo !== ro) return lo - ro;
      return left.title.localeCompare(right.title);
    });
  }, [filteredPlanningItems, visibleEvents, data.inspirationItems]);

  useEffect(() => {
    if (activeItemId && !activeItem) {
      setActiveItemId(null);
    }
  }, [activeItem, activeItemId]);

  function refreshBoard() {
    router.refresh();
  }

  function movePlanningItemInCalendar(itemId: string, targetDate: string) {
    startTransition(async () => {
      const result = await movePlanningItemDateAction({
        itemId,
        targetDate
      });

      if (!result.success) {
        toast.error(result.message ?? "Could not move planning item.");
        return;
      }

      toast.success(`Moved to ${targetDate}.`);
      refreshBoard();
    });
  }

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">Planning Workspace</h1>
            <p className="max-w-3xl text-subtle">
              Track operational actions and launches in a rolling 30/60/90 planner, with recurring templates and task ownership.
            </p>
            {userRole === 'central_planner' && <RefreshInspirationButton />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => setCreateModalOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add planning item
            </Button>
            <div className="flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white p-1">
              <Button
                type="button"
                size="sm"
                variant={viewMode === "board" ? "secondary" : "ghost"}
                onClick={() => setViewMode("board")}
              >
                <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Board
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "calendar" ? "secondary" : "ghost"}
                onClick={() => setViewMode("calendar")}
              >
                <CalendarRange className="h-4 w-4" aria-hidden="true" /> Calendar
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "list" ? "secondary" : "ghost"}
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" aria-hidden="true" /> List
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "todos_by_person" ? "secondary" : "ghost"}
                onClick={() => setViewMode("todos_by_person")}
              >
                <Users className="h-4 w-4" aria-hidden="true" /> Todos by person
              </Button>
            </div>
          </div>
        </div>
      </header>

      <PlanningAlertStrip alerts={data.alerts} />

      <section className="space-y-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-3 shadow-soft">
        <div className="flex flex-wrap items-center gap-1.5">
          <Filter className="h-4 w-4 text-subtle" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search planning and events"
            className="h-10 w-full md:w-80"
          />
          <Select value={venueFilter} onChange={(event) => setVenueFilter(event.target.value)} className="h-10 w-full md:w-72">
            <option value="">All venues</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </Select>
          <Select
            value={eventVisibility}
            onChange={(event) => setEventVisibility(event.target.value as "with_events" | "planning_only")}
            className="h-10 w-full md:w-64"
          >
            <option value="with_events">Planning + events</option>
            <option value="planning_only">Planning only</option>
          </Select>
          {viewMode === "board" ? (
            <Button type="button" variant={showLater ? "secondary" : "ghost"} size="sm" onClick={() => setShowLater((current) => !current)}>
              <MoveHorizontal className="mr-1 h-4 w-4" aria-hidden="true" />
              {showLater ? "Hide 90+" : "Show 90+"}
            </Button>
          ) : null}
        </div>
      </section>

      {viewMode === "board" ? (
        <section className={`grid gap-4 ${showLater ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
          {visibleBuckets.map((bucket) => {
            const rows = combinedByBucket[bucket.key];
            return (
              <article
                key={bucket.key}
                className="flex min-h-[18rem] flex-col gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-2.5 shadow-soft"
              >
                <header className="border-b border-[var(--color-border)] pb-1.5">
                  <h2 className="text-lg font-semibold text-[var(--color-primary-700)]">{bucket.label}</h2>
                  <p className="text-xs text-subtle">{bucket.helper}</p>
                </header>

                <div className="space-y-2">
                  {rows.map((row) => {
                    if (row.type === "planning") {
                      return (
                        <PlanningItemCard
                          key={row.item.id}
                          item={row.item}
                          users={data.users}
                          venues={venues}
                          onChanged={refreshBoard}
                          compact
                          onOpenDetails={(planningItem) => setActiveItemId(planningItem.id)}
                        />
                      );
                    }
                    if (row.type === "inspiration") {
                      return <InspirationItemCard key={row.item.id} item={row.item} />;
                    }
                    return <EventOverlayCard key={row.event.id} event={row.event} canApprove={canApproveEvents} />;
                  })}
                </div>

                {rows.length === 0 ? (
                  <p className="mt-auto text-sm text-subtle">No items in this window.</p>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}

      {viewMode === "calendar" ? (
        <PlanningCalendarView
          today={data.today}
          entries={combinedEntries}
          onOpenPlanningItem={(item) => setActiveItemId(item.id)}
          onMovePlanningItem={movePlanningItemInCalendar}
        />
      ) : null}

      {viewMode === "list" ? (
        <PlanningListView
          today={data.today}
          entries={combinedEntries}
          onOpenPlanningItem={(item) => setActiveItemId(item.id)}
        />
      ) : null}

      {viewMode === "todos_by_person" ? (
        <PlanningTodosByPersonView
          items={filteredPlanningItems}
          onOpenPlanningItem={(item) => setActiveItemId(item.id)}
        />
      ) : null}

      <PlanningModal
        open={isCreateModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create planning work"
        description="Add one-off actions or recurring series without crowding the board."
      >
        <PlanningItemEditor
          today={data.today}
          users={data.users}
          venues={venues.map((venue) => ({ id: venue.id, name: venue.name }))}
          onChanged={() => {
            setCreateModalOpen(false);
            refreshBoard();
          }}
        />
      </PlanningModal>

      <PlanningModal
        open={Boolean(activeItem)}
        onClose={() => setActiveItemId(null)}
        title={activeItem ? activeItem.title : "Planning item"}
        description="Edit details, move dates, and manage todo tasks."
      >
        {activeItem ? (
          <PlanningItemCard
            item={activeItem}
            users={data.users}
            venues={venues}
            onChanged={refreshBoard}
          />
        ) : null}
      </PlanningModal>

      {isPending ? <p className="text-sm text-subtle">Saving planning updates…</p> : null}
    </div>
  );
}
