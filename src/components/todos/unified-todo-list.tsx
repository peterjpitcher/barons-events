"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, User, Users } from "lucide-react";
import { togglePlanningTaskStatusAction } from "@/actions/planning";
import type { PlanningPerson, TodoAlertFilter } from "@/lib/planning/types";
import type { TodoItem, TodoSource, TodoUrgency } from "./todo-item-types";
import { UrgencySection } from "./urgency-section";
import { FilterTabs, type FilterTab } from "./filter-tabs";
import { TodoRow } from "./todo-row";

// ---------------------------------------------------------------------------
// Props (discriminated union)
// ---------------------------------------------------------------------------

type DashboardTodoListProps = {
  mode: "dashboard";
  items: TodoItem[];
  currentUserId: string;
  failedSources?: TodoSource[];
};

type PlanningTodoListProps = {
  mode: "planning";
  items: TodoItem[];
  currentUserId: string;
  users: PlanningPerson[];
  alertFilter?: TodoAlertFilter | null;
  onOpenPlanningItemId?: (planningItemId: string) => void;
};

type UnifiedTodoListProps = DashboardTodoListProps | PlanningTodoListProps;

// ---------------------------------------------------------------------------
// Source label map
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<TodoSource | "all", string> = {
  all: "All",
  planning: "Planning",
  review: "Reviews",
  debrief: "Debriefs",
  sop: "SOP",
  revision: "Revisions",
};

// ---------------------------------------------------------------------------
// Urgency order for sorting
// ---------------------------------------------------------------------------

const URGENCY_ORDER: Record<TodoUrgency, number> = {
  overdue: 0,
  due_soon: 1,
  later: 2,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UnifiedTodoList(props: UnifiedTodoListProps): React.ReactNode {
  const { mode, items, currentUserId } = props;

  if (mode === "dashboard") {
    return (
      <DashboardMode
        items={items}
        currentUserId={currentUserId}
        failedSources={props.failedSources}
      />
    );
  }

  return (
    <PlanningMode
      items={items}
      currentUserId={currentUserId}
      users={props.users}
      alertFilter={props.alertFilter}
      onOpenPlanningItemId={props.onOpenPlanningItemId}
    />
  );
}

// ---------------------------------------------------------------------------
// Dashboard Mode
// ---------------------------------------------------------------------------

function DashboardMode({
  items,
  currentUserId,
  failedSources,
}: {
  items: TodoItem[];
  currentUserId: string;
  failedSources?: TodoSource[];
}): React.ReactNode {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticallyDone, setOptimisticallyDone] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TodoSource | "all">("all");

  // Filter by source
  const filteredItems = useMemo(() => {
    if (activeTab === "all") return items;
    return items.filter((item) => item.source === activeTab);
  }, [items, activeTab]);

  // Group by urgency
  const grouped = useMemo(() => {
    const overdue: TodoItem[] = [];
    const dueSoon: TodoItem[] = [];
    const later: TodoItem[] = [];

    for (const item of filteredItems) {
      if (optimisticallyDone.has(item.id)) continue;
      switch (item.urgency) {
        case "overdue":
          overdue.push(item);
          break;
        case "due_soon":
          dueSoon.push(item);
          break;
        case "later":
          later.push(item);
          break;
      }
    }

    return { overdue, dueSoon, later };
  }, [filteredItems, optimisticallyDone]);

  // Build filter tabs with counts
  const tabs = useMemo((): FilterTab[] => {
    const counts: Record<TodoSource | "all", number> = {
      all: items.filter((i) => !optimisticallyDone.has(i.id)).length,
      planning: 0,
      sop: 0,
      review: 0,
      revision: 0,
      debrief: 0,
    };
    for (const item of items) {
      if (optimisticallyDone.has(item.id)) continue;
      counts[item.source]++;
    }
    return (Object.keys(SOURCE_LABELS) as Array<TodoSource | "all">).map((key) => ({
      key,
      label: SOURCE_LABELS[key],
      count: counts[key],
    }));
  }, [items, optimisticallyDone]);

  function handleToggle(planningTaskId: string): void {
    // Find the item to optimistically hide
    const item = items.find((i) => i.planningTaskId === planningTaskId);
    if (!item) return;

    setOptimisticallyDone((current) => new Set(current).add(item.id));

    startTransition(async () => {
      try {
        const result = await togglePlanningTaskStatusAction({ taskId: planningTaskId, status: "done" });
        if (!result.success) {
          setOptimisticallyDone((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
          toast.error(result.message ?? "Could not mark task as done.");
          return;
        }
        router.refresh();
      } catch {
        setOptimisticallyDone((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
        toast.error("Could not mark task as done.");
      }
    });
  }

  const totalVisible =
    grouped.overdue.length + grouped.dueSoon.length + grouped.later.length;

  return (
    <section className="space-y-3 rounded-xl border border-[rgba(39,54,64,0.12)] bg-white p-4 shadow-soft">
      <header className="space-y-3 border-b border-[rgba(39,54,64,0.12)] pb-3">
        <h2 className="text-lg font-semibold text-[var(--color-primary-700)]">My Todos</h2>
        <FilterTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
      </header>

      {totalVisible === 0 ? (
        <div className="py-8 text-center">
          {activeTab !== "all" ? (
            <p className="text-sm text-subtle">
              No {SOURCE_LABELS[activeTab].toLowerCase()} tasks right now.{" "}
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                className="font-semibold text-[var(--color-primary-700)] hover:underline"
              >
                Show all
              </button>
            </p>
          ) : (
            <p className="text-sm text-subtle">You&apos;re all caught up</p>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <UrgencySection
            urgency="overdue"
            items={grouped.overdue}
            onToggle={handleToggle}
            optimisticallyDone={optimisticallyDone}
            isPending={isPending}
          />
          <UrgencySection
            urgency="due_soon"
            items={grouped.dueSoon}
            onToggle={handleToggle}
            optimisticallyDone={optimisticallyDone}
            isPending={isPending}
          />
          <UrgencySection
            urgency="later"
            items={grouped.later}
            defaultCollapsed
            onToggle={handleToggle}
            optimisticallyDone={optimisticallyDone}
            isPending={isPending}
          />
        </div>
      )}

      {failedSources && failedSources.length > 0 && (
        <p className="text-xs text-subtle">
          Some data could not be loaded: {failedSources.map((s) => SOURCE_LABELS[s]).join(", ")}.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Planning Mode
// ---------------------------------------------------------------------------

type PersonGroup = {
  key: string;
  label: string;
  items: TodoItem[];
};

function PlanningMode({
  items,
  currentUserId,
  users,
  alertFilter,
  onOpenPlanningItemId,
}: {
  items: TodoItem[];
  currentUserId: string;
  users: PlanningPerson[];
  alertFilter?: TodoAlertFilter | null;
  onOpenPlanningItemId?: (planningItemId: string) => void;
}): React.ReactNode {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticallyDone, setOptimisticallyDone] = useState<Set<string>>(new Set());
  const [showEveryone, setShowEveryone] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Show everyone when alert filter is active
  const effectiveShowEveryone = showEveryone || Boolean(alertFilter);

  // Group items by assignee
  const grouped = useMemo((): PersonGroup[] => {
    const map = new Map<string, PersonGroup>();

    for (const item of items) {
      if (optimisticallyDone.has(item.id)) continue;

      const key = item.assigneeId ?? "tbd";
      const label = item.assigneeName || "To be determined";

      const bucket = map.get(key) ?? { key, label, items: [] };
      bucket.items.push(item);
      map.set(key, bucket);
    }

    return Array.from(map.values())
      .filter((group) => group.items.length > 0)
      .sort((left, right) => {
        // Current user first
        if (left.key === currentUserId) return -1;
        if (right.key === currentUserId) return 1;
        // TBD last
        if (left.key === "tbd") return 1;
        if (right.key === "tbd") return -1;
        // Alphabetical
        return left.label.localeCompare(right.label);
      });
  }, [items, currentUserId, optimisticallyDone]);

  // Filter to current user when not showing everyone
  const visibleGroups = useMemo(() => {
    if (effectiveShowEveryone || !currentUserId) return grouped;
    return grouped.filter((group) => group.key === currentUserId);
  }, [grouped, effectiveShowEveryone, currentUserId]);

  const totalOpen = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);
  const allTotalOpen = grouped.reduce((sum, group) => sum + group.items.length, 0);

  function getFilterDescription(): string {
    switch (alertFilter) {
      case "overdue_items":
        return "Tasks from overdue planning items";
      case "overdue_tasks":
        return "Overdue tasks only";
      case "due_soon_items":
        return "Tasks from planning items due in the next 7 days";
      case "due_soon_tasks":
        return "Tasks due in the next 7 days";
      default:
        return "Open tasks due today or overdue, grouped by assignee. Tick to complete.";
    }
  }

  function toggleSection(key: string): void {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleToggle(planningTaskId: string): void {
    const item = items.find((i) => i.planningTaskId === planningTaskId);
    if (!item) return;

    setOptimisticallyDone((current) => new Set(current).add(item.id));

    startTransition(async () => {
      try {
        const result = await togglePlanningTaskStatusAction({ taskId: planningTaskId, status: "done" });
        if (!result.success) {
          setOptimisticallyDone((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
          toast.error(result.message ?? "Could not mark task as done.");
          return;
        }
        router.refresh();
      } catch {
        setOptimisticallyDone((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
        toast.error("Could not mark task as done.");
      }
    });
  }

  function handleViewClick(planningItemId: string): void {
    if (onOpenPlanningItemId) {
      onOpenPlanningItemId(planningItemId);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-white p-3 shadow-soft">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-primary-700)]">Todos by person</h2>
          <p className="text-sm text-subtle">{getFilterDescription()}</p>
        </div>
        <div className="flex items-center gap-3">
          {currentUserId && !alertFilter && (
            <button
              type="button"
              onClick={() => setShowEveryone((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-semibold transition-colors hover:bg-[var(--color-muted-surface)]"
            >
              {showEveryone ? (
                <>
                  <User className="h-3.5 w-3.5" aria-hidden="true" />
                  Show my tasks
                </>
              ) : (
                <>
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  Show everyone ({allTotalOpen})
                </>
              )}
            </button>
          )}
          <p className="text-sm font-semibold text-[var(--color-text)]">
            {totalOpen} open task{totalOpen === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      {visibleGroups.length === 0 ? (
        <p className="text-sm text-subtle">
          {!effectiveShowEveryone && currentUserId && allTotalOpen > 0
            ? "No open tasks assigned to you. Click \"Show everyone\" to see all tasks."
            : "No open tasks found for the current filters."}
        </p>
      ) : (
        <div className="space-y-3">
          {visibleGroups.map((group) => {
            const isCollapsed = collapsedSections.has(group.key);
            const isCurrentUser = group.key === currentUserId;

            // Sort items within group: by urgency then dueDate
            const sortedItems = [...group.items].sort((a, b) => {
              const urgencyDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
              if (urgencyDiff !== 0) return urgencyDiff;
              if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
              if (a.dueDate) return -1;
              if (b.dueDate) return 1;
              return a.title.localeCompare(b.title);
            });

            return (
              <article
                key={group.key}
                className={`rounded-lg border bg-[var(--color-muted-surface)] p-2.5 ${
                  isCurrentUser
                    ? "border-[var(--color-primary-300)]"
                    : "border-[var(--color-border)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSection(group.key)}
                  className="flex w-full items-center justify-between gap-2 border-b border-[var(--color-border)] pb-1.5"
                  aria-expanded={!isCollapsed}
                >
                  <span className="flex items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-subtle" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-subtle" aria-hidden="true" />
                    )}
                    <h3 className="text-base font-semibold text-[var(--color-text)]">
                      {group.label}
                      {isCurrentUser && (
                        <span className="ml-1.5 text-xs font-normal text-subtle">(you)</span>
                      )}
                    </h3>
                  </span>
                  <p className="text-xs font-medium text-subtle">{group.items.length} open</p>
                </button>

                {!isCollapsed && (
                  <div className="mt-1.5 space-y-1.5">
                    {sortedItems.map((item) => (
                      <TodoRow
                        key={item.id}
                        item={item}
                        onToggle={handleToggle}
                        onViewClick={onOpenPlanningItemId ? handleViewClick : undefined}
                        isOptimisticallyDone={optimisticallyDone.has(item.id)}
                        isPending={isPending}
                      />
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
