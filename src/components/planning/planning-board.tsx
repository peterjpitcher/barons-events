"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarRange, Check, ClipboardList, LayoutGrid, List, MoveHorizontal, Pin, PinOff, Plus, RefreshCw, Search, Users } from "lucide-react";
import { movePlanningItemDateAction, refreshInspirationItemsAction, togglePlanningTaskStatusAction } from "@/actions/planning";
import { setUserPinPreferenceAction } from "@/actions/user-preferences";
import { PlanningAlertStrip } from "@/components/planning/planning-alert-strip";
import { PlanningCalendarView } from "@/components/planning/planning-calendar-view";
import { PlanningItemCard, EventOverlayCard, InspirationItemCard } from "@/components/planning/planning-item-card";
import { PlanningListView } from "@/components/planning/planning-list-view";
import { UnifiedTodoList } from "@/components/todos/unified-todo-list";
import type { PlanningViewEntry } from "@/components/planning/view-types";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Avatar, Kbd, PageHeader } from "@/components/ui/design-primitives";
import type { TodoItem, TodoUrgency } from "@/components/todos/todo-item-types";
import type {
  PlanningBoardData,
  PlanningBucketKey,
  PlanningEventOverlay,
  PlanningInspirationItem,
  PlanningItem,
  PlanningVenueOption,
  TodoAlertFilter
} from "@/lib/planning/types";
import { bucketForDayOffset, daysBetween, planningItemsToTodoItems } from "@/lib/planning/utils";
import { canCreatePlanningItems, canManageAllPlanning } from "@/lib/roles";
import type { UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";

type PlanningBoardProps = {
  data: PlanningBoardData;
  /** Separate, unbounded dataset for the Calendar tab — includes historic
   * items and completed/cancelled statuses. Falls back to `data` when
   * omitted so older callers keep working. */
  calendarData?: PlanningBoardData;
  venues: PlanningVenueOption[];
  canApproveEvents?: boolean;
  userRole?: UserRole;
  currentUserId?: string;
  currentUserVenueId?: string | null;
  queueItems?: TodoItem[];
  queueInitiallyPinned?: boolean;
};

type BucketConfig = {
  key: PlanningBucketKey;
  label: string;
  helper: string;
};

const BUCKETS: BucketConfig[] = [
  { key: "past", label: "Past / Overdue", helper: "Target date has passed" },
  { key: "0_30", label: "0–30 days", helper: "Immediate priorities" },
  { key: "31_60", label: "31–60 days", helper: "Mid-horizon actions" },
  { key: "61_90", label: "61–90 days", helper: "Forward planning" },
  { key: "later", label: "90+ days", helper: "Long-range backlog" }
];

function bucketForPlanningOffset(dayOffset: number): PlanningBucketKey {
  if (dayOffset < 0) {
    return "past";
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
type StatusScope = "open" | "closed" | "all";

function isClosedPlanningStatus(status: PlanningItem["status"]): boolean {
  return status === "done" || status === "cancelled";
}

function isClosedEventStatus(status: string): boolean {
  return status === "completed" || status === "rejected" || status === "cancelled";
}

function matchesStatusScope(isClosed: boolean, scope: StatusScope): boolean {
  if (scope === "all") return true;
  return scope === "closed" ? isClosed : !isClosed;
}

const BUCKET_TONE_CLASS: Record<PlanningBucketKey, string> = {
  past: "bg-[var(--burgundy)]",
  "0_30": "bg-[var(--mustard)]",
  "31_60": "bg-[var(--slate)]",
  "61_90": "bg-[var(--sage)]",
  later: "bg-[var(--hair-strong)]",
};

const QUEUE_GROUPS: Array<{
  key: TodoUrgency;
  label: string;
  colorClass: string;
  dotClass: string;
  bgClass: string;
}> = [
  {
    key: "overdue",
    label: "Overdue",
    colorClass: "text-[var(--burgundy)]",
    dotClass: "bg-[var(--burgundy)]",
    bgClass: "bg-[var(--burgundy-tint)]",
  },
  {
    key: "due_soon",
    label: "This week",
    colorClass: "text-[var(--mustard-dark)]",
    dotClass: "bg-[var(--mustard)]",
    bgClass: "bg-[var(--mustard-tint)]",
  },
  {
    key: "later",
    label: "Later",
    colorClass: "text-[var(--slate)]",
    dotClass: "bg-[var(--slate)]",
    bgClass: "bg-[var(--slate-tint)]",
  },
];

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
        <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden="true" />
        <span>{loading ? 'Refreshing…' : 'Refresh inspiration'}</span>
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}

function TodoQueueRail({
  items,
  onToggle,
  onOpen,
  initiallyPinned = false,
}: {
  items: TodoItem[];
  onToggle: (item: TodoItem) => void;
  onOpen: (item: TodoItem) => void;
  initiallyPinned?: boolean;
}) {
  const router = useRouter();
  const [optimisticallyDone, setOptimisticallyDone] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(initiallyPinned);
  const originalBodyPaddingRef = useRef<string | null>(null);
  const originalDrawerOffsetRef = useRef<string | null>(null);
  const visibleItems = items.filter((item) => !optimisticallyDone.has(item.id));
  const doneCount = items.length - visibleItems.length;
  const expanded = pinned || open || hovered || focused;

  useEffect(() => {
    if (originalBodyPaddingRef.current === null) {
      originalBodyPaddingRef.current = document.body.style.paddingRight;
    }
    if (originalDrawerOffsetRef.current === null) {
      originalDrawerOffsetRef.current = document.documentElement.style.getPropertyValue("--planning-queue-drawer-reserved-width");
    }

    const media = window.matchMedia("(min-width: 1024px)");
    function syncBodyPadding(): void {
      const reservedWidth = pinned && media.matches ? "22rem" : "3rem";
      document.body.style.paddingRight = reservedWidth;
      document.documentElement.style.setProperty("--planning-queue-drawer-reserved-width", reservedWidth);
    }

    syncBodyPadding();
    media.addEventListener("change", syncBodyPadding);

    return () => {
      media.removeEventListener("change", syncBodyPadding);
      if (originalBodyPaddingRef.current !== null) {
        document.body.style.paddingRight = originalBodyPaddingRef.current;
      }
      if (originalDrawerOffsetRef.current) {
        document.documentElement.style.setProperty("--planning-queue-drawer-reserved-width", originalDrawerOffsetRef.current);
      } else {
        document.documentElement.style.removeProperty("--planning-queue-drawer-reserved-width");
      }
    };
  }, [pinned]);

  function handleToggle(item: TodoItem) {
    if (!item.canToggle || !item.planningTaskId) {
      onOpen(item);
      return;
    }
    setOptimisticallyDone((current) => new Set(current).add(item.id));
    onToggle(item);
  }

  async function setPinnedPreference(nextPinned: boolean): Promise<void> {
    setPinned(nextPinned);
    setOpen(nextPinned);
    const result = await setUserPinPreferenceAction({
      preference: "planning_queue_pinned",
      value: nextPinned
    });
    if (!result.success) {
      setPinned(!nextPinned);
      toast.error(result.message ?? "Could not save queue preference.");
    } else {
      router.refresh();
    }
  }

  return (
    <aside
      className={cn(
        "fixed bottom-0 right-0 top-0 z-40 flex flex-col border-l bg-[var(--paper)] shadow-card transition-[width] duration-200 ease-out",
        expanded ? "w-[min(22rem,calc(100vw-3rem))] border-[var(--hair)]" : "w-12 border-[var(--mustard-dark)]"
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        if (!pinned) setOpen(false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
          if (!pinned) setOpen(false);
        }
      }}
      aria-label="MY TODO ITEMS drawer"
    >
      <div className="flex min-h-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "flex w-12 flex-none flex-col items-center justify-between gap-3 px-2 py-5 text-white transition-colors",
            expanded ? "bg-[var(--navy)] hover:bg-[var(--navy-700)]" : "bg-[var(--mustard)] hover:bg-[var(--mustard-dark)]"
          )}
          aria-label={`Open MY TODO ITEMS - ${visibleItems.length} open`}
        >
          <ClipboardList className="h-5 w-5 flex-none" aria-hidden="true" />
          <span
            className="min-h-0 flex-1 text-sm font-semibold tracking-[0.08em] text-white"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            MY TODO ITEMS
          </span>
          <span className="rounded-full bg-[var(--paper)]/80 px-1.5 py-0.5 text-xs font-semibold text-[var(--navy)]">
            {visibleItems.length}
          </span>
        </button>

        <div
          className={`min-w-0 flex-1 overflow-hidden transition-opacity duration-150 ${
            expanded ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={!expanded}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--hair)] bg-[var(--navy)] px-5 py-3 text-white">
              <div className="flex min-w-0 items-center gap-2">
                <ClipboardList className="h-4 w-4 text-white" aria-hidden="true" />
                <h2 className="truncate text-sm font-semibold tracking-wider">MY TODO ITEMS</h2>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold text-white">
                  {visibleItems.length} open
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10 hover:text-white focus-visible:outline-white"
                onClick={() => void setPinnedPreference(!pinned)}
                aria-label={pinned ? "Unpin todo drawer" : "Pin todo drawer"}
                aria-pressed={pinned}
              >
                {pinned ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-2 font-brand-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--ink-soft)]">
                <span>{doneCount}/{items.length} done</span>
                <span>{items.length} assigned</span>
              </div>

              {items.length === 0 ? (
                <p className="rounded-[8px] border border-[var(--hair)] bg-[var(--paper-tint)] px-3 py-6 text-center text-sm text-[var(--ink-muted)]">
                  No assigned todos right now.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {QUEUE_GROUPS.map((group) => {
                    const rows = visibleItems.filter((item) => item.urgency === group.key).slice(0, group.key === "later" ? 4 : 8);
                    if (rows.length === 0) return null;
                    return (
                      <section key={group.key}>
                        <div className={`mb-1.5 flex items-center gap-2 font-brand-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] ${group.colorClass}`}>
                          <span className={`h-2 w-2 rounded-full ${group.dotClass}`} />
                          <span>{group.label}</span>
                          <span className={`ml-auto rounded-full px-1.5 py-0.5 ${group.bgClass}`}>{rows.length}</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {rows.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-start gap-2 rounded-[6px] border border-[var(--hair)] bg-[var(--canvas-2)] px-2 py-1.5"
                            >
                              <button
                                type="button"
                                aria-label={item.canToggle ? `Mark ${item.title} done` : `Open ${item.title}`}
                                className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-[var(--hair-strong)] bg-[var(--paper)] text-white hover:border-[var(--sage)] hover:bg-[var(--sage)]"
                                onClick={() => handleToggle(item)}
                              >
                                <Check className="h-2.5 w-2.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
                                onClick={() => onOpen(item)}
                              >
                                <span className="block text-xs leading-snug text-[var(--ink)]">{item.title}</span>
                                <span className="mt-1 flex min-w-0 items-center gap-1.5 font-brand-mono text-[0.58rem] uppercase tracking-[0.04em] text-[var(--ink-muted)]">
                                  <Avatar name={item.assigneeName ?? item.venueName ?? item.source} size={14} />
                                  <span>{item.source}</span>
                                  <span className="text-[var(--hair-strong)]">.</span>
                                  <span className="truncate">{item.parentTitle ?? item.venueName ?? item.subtitle}</span>
                                </span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function PlanningBoard({ data, calendarData, venues, canApproveEvents, userRole, currentUserId, currentUserVenueId, queueItems = [], queueInitiallyPinned = false }: PlanningBoardProps) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [showLater, setShowLater] = useState(false);
  const [statusScope, setStatusScope] = useState<StatusScope>("open");
  const [search, setSearch] = useState("");
  const [venueFilter, setVenueFilter] = useState("");
  const [eventVisibility, setEventVisibility] = useState<"with_events" | "planning_only">("with_events");
  const [todoAlertFilter, setTodoAlertFilter] = useState<TodoAlertFilter | null>(null);
  const [isPending, startTransition] = useTransition();
  const scopeData = statusScope === "open" ? data : calendarData ?? data;

  const filteredPlanningItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return scopeData.planningItems.filter((item) => {
      if (item.eventId) {
        return false;
      }
      if (!matchesStatusScope(isClosedPlanningStatus(item.status), statusScope)) {
        return false;
      }
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
  }, [scopeData.planningItems, search, statusScope, venueFilter]);

  const filteredEvents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return scopeData.events.filter((event) => {
      if (!matchesStatusScope(isClosedEventStatus(event.status), statusScope)) {
        return false;
      }
      if (venueFilter && event.venueId !== venueFilter) {
        return false;
      }

      if (!needle.length) {
        return true;
      }

      const haystack = [event.title, event.venueName ?? "", event.venueSpace ?? "", event.status].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [scopeData.events, search, statusScope, venueFilter]);

  const visibleInspirationItems = useMemo(
    () => (statusScope === "closed" ? [] : data.inspirationItems),
    [data.inspirationItems, statusScope]
  );

  const visibleEvents = useMemo(
    () => (eventVisibility === "with_events" ? filteredEvents : []),
    [eventVisibility, filteredEvents]
  );

  const planningByBucket = useMemo(() => {
    const grouped: Record<PlanningBucketKey, PlanningItem[]> = {
      past: [],
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
      past: sortByDateThenTitle(grouped.past),
      "0_30": sortByDateThenTitle(grouped["0_30"]),
      "31_60": sortByDateThenTitle(grouped["31_60"]),
      "61_90": sortByDateThenTitle(grouped["61_90"]),
      later: sortByDateThenTitle(grouped.later)
    };
  }, [data.today, filteredPlanningItems]);

  const eventsByBucket = useMemo(() => {
    const grouped: Record<PlanningBucketKey, PlanningEventOverlay[]> = {
      past: [],
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
      past: sortByDateThenTitle(grouped.past),
      "0_30": sortByDateThenTitle(grouped["0_30"]),
      "31_60": sortByDateThenTitle(grouped["31_60"]),
      "61_90": sortByDateThenTitle(grouped["61_90"]),
      later: sortByDateThenTitle(grouped.later)
    };
  }, [data.today, visibleEvents]);

  const inspirationByBucket = useMemo(() => {
    const map: Record<PlanningBucketKey, PlanningInspirationItem[]> = {
      past: [], '0_30': [], '31_60': [], '61_90': [], later: [],
    };
    for (const item of visibleInspirationItems) {
      const offset = daysBetween(data.today, item.eventDate);
      const bucket = bucketForPlanningOffset(offset);
      map[bucket].push(item);
    }
    return map;
  }, [data.today, visibleInspirationItems]);

  const combinedByBucket = useMemo(() => {
    const typeOrder: Record<string, number> = { planning: 0, event: 1, inspiration: 2 };
    const result: Record<PlanningBucketKey, Array<
      | { type: "planning"; item: PlanningItem }
      | { type: "event"; event: PlanningEventOverlay }
      | { type: "inspiration"; item: PlanningInspirationItem }
    >> = { past: [], "0_30": [], "31_60": [], "61_90": [], later: [] };

    for (const key of ["past", "0_30", "31_60", "61_90", "later"] as PlanningBucketKey[]) {
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

  // Core buckets: past (if non-empty) + 0-30 + 31-60 + 61-90. "Later" toggled separately.
  const CORE_BUCKETS = BUCKETS.slice(0, 4); // past, 0_30, 31_60, 61_90
  const hasPastItems = combinedByBucket.past.length > 0;
  const baseBuckets = hasPastItems ? CORE_BUCKETS : CORE_BUCKETS.slice(1);
  const visibleBuckets = showLater ? [...baseBuckets, BUCKETS[4]] : baseBuckets;

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

    const inspirationEntries: PlanningViewEntry[] = visibleInspirationItems.map((item) => ({
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
  }, [filteredPlanningItems, visibleEvents, visibleInspirationItems]);

  // ─── Calendar dataset ─────────────────────────────────────────────────────
  // The calendar view needs historic activity that's trimmed out of the
  // default board dataset. We use the separate `calendarData` fetched on the
  // server when it's available; otherwise fall back to `data` so older
  // callers still work.
  const calendarSource = calendarData ?? data;

  const calendarCombinedEntries = useMemo<PlanningViewEntry[]>(() => {
    const sourceOrder: Record<string, number> = { planning: 0, event: 1, inspiration: 2 };
    const needle = search.trim().toLowerCase();

    const matchesSearch = (haystack: string): boolean =>
      !needle.length || haystack.toLowerCase().includes(needle);

    const planningEntries: PlanningViewEntry[] = calendarSource.planningItems
      .filter((item) => {
        if (item.eventId) return false;
        if (venueFilter && item.venueId !== venueFilter) return false;
        if (!matchesStatusScope(isClosedPlanningStatus(item.status), statusScope)) return false;
        const taskValue = item.tasks.map((task) => task.title).join(" ");
        return matchesSearch(
          [item.title, item.typeLabel, item.description ?? "", item.ownerName ?? "", taskValue].join(" ")
        );
      })
      .map((item) => ({
        id: `planning-${item.id}`,
        source: "planning" as const,
        targetDate: item.targetDate,
        title: item.title,
        status: item.status,
        venueLabel: item.venueName ?? "Global",
        planningItem: item
      }));

    const eventEntries: PlanningViewEntry[] =
      eventVisibility === "with_events"
        ? calendarSource.events
            .filter((event) => {
              if (venueFilter && event.venueId !== venueFilter) return false;
              if (!matchesStatusScope(isClosedEventStatus(event.status), statusScope)) return false;
              return matchesSearch(
                [event.title, event.venueName ?? "", event.venueSpace ?? "", event.status].join(" ")
              );
            })
            .map((event) => ({
              id: `event-${event.eventId}`,
              source: "event" as const,
              targetDate: event.targetDate,
              title: event.title,
              status: event.status,
              venueLabel: `${event.venueName ?? "Unknown venue"}${event.venueSpace ? ` · ${event.venueSpace}` : ""}`,
              eventId: event.eventId,
              startAt: event.startAt
            }))
        : [];

    return [...planningEntries, ...eventEntries].sort((left, right) => {
      if (left.targetDate !== right.targetDate) return left.targetDate.localeCompare(right.targetDate);
      const lo = sourceOrder[left.source] ?? 3;
      const ro = sourceOrder[right.source] ?? 3;
      if (lo !== ro) return lo - ro;
      return left.title.localeCompare(right.title);
    });
  }, [calendarSource, search, venueFilter, eventVisibility, statusScope]);

  function switchView(mode: ViewMode): void {
    setViewMode(mode);
    if (mode !== "todos_by_person") {
      setTodoAlertFilter(null);
    }
  }

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

  function toggleQueueItem(item: TodoItem) {
    if (!item.planningTaskId) return;
    startTransition(async () => {
      const result = await togglePlanningTaskStatusAction({
        taskId: item.planningTaskId,
        status: "done",
      });

      if (!result.success) {
        toast.error(result.message ?? "Could not mark task as done.");
        return;
      }

      toast.success("Task marked done.");
      refreshBoard();
    });
  }

  function openQueueItem(item: TodoItem) {
    if (item.planningItemId) {
      router.push(`/planning/${item.planningItemId}`);
      return;
    }
    router.push(item.linkHref);
  }

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="30 / 60 / 90 planner"
        title="Planning workspace"
        description="Operational actions and launches on a rolling horizon, with recurring templates and task ownership."
        meta={
          <>
            <span>{filteredPlanningItems.length} items</span>
            <span className="h-1 w-1 rounded-full bg-[var(--hair-strong)]" />
            <span>{visibleEvents.length} events</span>
            <span className="h-1 w-1 rounded-full bg-[var(--hair-strong)]" />
            <span>{visibleInspirationItems.length} inspiration</span>
            <span className="h-1 w-1 rounded-full bg-[var(--hair-strong)]" />
            <span className="text-[var(--ink-soft)]">Updated now</span>
          </>
        }
        actions={
          <>
            {userRole && canCreatePlanningItems(userRole, currentUserVenueId) && (
              <Button asChild>
                <Link href="/planning/new">
                  <Plus className="h-4 w-4" aria-hidden="true" /> New item
                </Link>
              </Button>
            )}
            <div className="inline-flex h-8 items-center rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] p-1">
              <Button
                type="button"
                size="sm"
                variant={viewMode === "board" ? "primary" : "ghost"}
                onClick={() => switchView("board")}
              >
                <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Board
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "calendar" ? "primary" : "ghost"}
                onClick={() => switchView("calendar")}
              >
                <CalendarRange className="h-4 w-4" aria-hidden="true" /> Calendar
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "list" ? "primary" : "ghost"}
                onClick={() => switchView("list")}
              >
                <List className="h-4 w-4" aria-hidden="true" /> List
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "todos_by_person" ? "primary" : "ghost"}
                onClick={() => switchView("todos_by_person")}
              >
                <Users className="h-4 w-4" aria-hidden="true" /> Todos by person
              </Button>
            </div>
          </>
        }
      />

      {userRole === 'administrator' && <RefreshInspirationButton />}

      <PlanningAlertStrip
        alerts={data.alerts}
        activeFilter={viewMode === "todos_by_person" ? todoAlertFilter : null}
        onFilterClick={(filter) => {
          const toggling = todoAlertFilter === filter;
          setTodoAlertFilter(toggling ? null : filter);
          if (!toggling) {
            // Clear search/venue filters so counts match the alert strip numbers
            setSearch("");
            setVenueFilter("");
            setStatusScope("open");
          }
          if (viewMode !== "todos_by_person") {
            setViewMode("todos_by_person");
          }
        }}
      />

      <section className="flex flex-wrap items-center gap-2">
        <div className="flex h-8 w-full items-center md:w-44">
          <Select
            value={statusScope}
            onChange={(event) => setStatusScope(event.target.value as StatusScope)}
            className="h-8 w-full py-0 text-xs leading-4"
            aria-label="Item status scope"
          >
            <option value="open">All open items</option>
            <option value="closed">Completed / cancelled</option>
            <option value="all">All items</option>
          </Select>
        </div>
        <div className="h-6 w-px bg-[var(--hair)]" />
        <div className="relative h-8 w-full md:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-soft)]" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            className="h-8 w-full pl-8 pr-9 text-xs"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
            <Kbd>/</Kbd>
          </span>
        </div>
        <div className="h-6 w-px bg-[var(--hair)]" />
        <div className="flex h-8 w-full items-center md:w-56">
          <Select value={venueFilter} onChange={(event) => setVenueFilter(event.target.value)} className="h-8 w-full py-0 text-xs leading-4">
            <option value="">All venues</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex h-8 w-full items-center md:w-48">
          <Select
            value={eventVisibility}
            onChange={(event) => setEventVisibility(event.target.value as "with_events" | "planning_only")}
            className="h-8 w-full py-0 text-xs leading-4"
          >
            <option value="with_events">Planning + events</option>
            <option value="planning_only">Planning only</option>
          </Select>
        </div>
        {viewMode === "board" ? (
          <Button type="button" variant={showLater ? "secondary" : "ghost"} size="sm" onClick={() => setShowLater((current) => !current)}>
            <MoveHorizontal className="mr-1 h-4 w-4" aria-hidden="true" />
            {showLater ? "Hide 90+" : "Show 90+"}
          </Button>
        ) : null}
        <span className="ml-auto font-brand-mono text-[0.625rem] uppercase tracking-[0.05em] text-[var(--ink-soft)]">
          {combinedEntries.length} shown
        </span>
      </section>

      {viewMode === "board" ? (
        <section>
          <div className={`grid gap-3 ${
            visibleBuckets.length === 5 ? "2xl:grid-cols-5" :
            visibleBuckets.length === 4 ? "2xl:grid-cols-4" :
            "2xl:grid-cols-3"
          }`}>
            {visibleBuckets.map((bucket) => {
              const rows = combinedByBucket[bucket.key];
              return (
                <article
                  key={bucket.key}
                  className="flex min-h-[18rem] min-w-0 flex-col gap-2"
                >
                  <header className="flex items-start justify-between gap-2 border-b border-[var(--hair)] px-1 pb-2">
                    <div className="min-w-0">
                      <h2 className="relative pl-3 font-brand-serif text-[15px] font-medium text-[var(--navy)]">
                        <span className={`absolute left-0 top-1 bottom-1 w-[3px] rounded-full ${BUCKET_TONE_CLASS[bucket.key]}`} />
                        {bucket.label}
                      </h2>
                      <p className="mt-0.5 pl-3 font-brand-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--ink-soft)]">{bucket.helper}</p>
                    </div>
                    <span className="rounded-full bg-[var(--canvas-2)] px-2 py-0.5 font-brand-mono text-[0.65rem] text-[var(--ink-muted)]">
                      {rows.length}
                    </span>
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
                            onOpenDetails={(planningItem) => router.push(`/planning/${planningItem.id}`)}
                            currentUserId={currentUserId}
                          />
                        );
                      }
                      if (row.type === "inspiration") {
                        return <InspirationItemCard key={row.item.id} item={row.item} />;
                      }
                      return (
                        <EventOverlayCard
                          key={row.event.id}
                          event={row.event}
                          canApprove={canApproveEvents}
                          onChanged={refreshBoard}
                        />
                      );
                    })}
                  </div>

                  {rows.length === 0 ? (
                    <p className="rounded-[8px] border border-dashed border-[var(--hair)] px-3 py-5 text-center text-sm text-[var(--ink-soft)]">No items match your filter</p>
              ) : null}
            </article>
          );
        })}
          </div>
        </section>
      ) : null}

      {viewMode === "calendar" ? (
        <div className="space-y-2">
          <div className="rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] p-2 shadow-card">
            <p className="text-xs text-[var(--ink-muted)]">
              Calendar follows the status, venue, source, and search filters above across the full historic dataset.
            </p>
          </div>
          <PlanningCalendarView
            today={data.today}
            entries={calendarCombinedEntries}
            onOpenPlanningItem={(item) => router.push(`/planning/${item.id}`)}
            onMovePlanningItem={userRole && canCreatePlanningItems(userRole, currentUserVenueId)
              ? movePlanningItemInCalendar
              : undefined}
          />
        </div>
      ) : null}

      {viewMode === "list" ? (
        <PlanningListView
          today={data.today}
          entries={combinedEntries}
          onOpenPlanningItem={(item) => router.push(`/planning/${item.id}`)}
        />
      ) : null}

      {viewMode === "todos_by_person" ? (
        <UnifiedTodoList
          mode="planning"
          items={planningItemsToTodoItems(
            filteredPlanningItems,
            data.today,
            userRole ? canManageAllPlanning(userRole) : false,
            currentUserId ?? "",
            todoAlertFilter
          )}
          currentUserId={currentUserId ?? ""}
          users={data.users}
          alertFilter={todoAlertFilter}
          onOpenPlanningItemId={(id) => router.push(`/planning/${id}`)}
        />
      ) : null}

      <TodoQueueRail
        items={queueItems}
        onToggle={toggleQueueItem}
        onOpen={openQueueItem}
        initiallyPinned={queueInitiallyPinned}
      />

      {isPending ? <p className="text-sm text-subtle">Saving planning updates…</p> : null}
    </div>
  );
}
