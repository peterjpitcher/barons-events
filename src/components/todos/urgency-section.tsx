"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Circle, Clock } from "lucide-react";
import type { TodoItem, TodoUrgency } from "./todo-item-types";
import { TodoRow } from "./todo-row";

type UrgencySectionProps = {
  urgency: TodoUrgency;
  items: TodoItem[];
  defaultCollapsed?: boolean;
  onToggle?: (planningTaskId: string) => void;
  onViewClick?: (planningItemId: string) => void;
  optimisticallyDone?: Set<string>;
  isPending?: boolean;
};

const MAX_VISIBLE = 10;

type UrgencyConfig = {
  label: string;
  icon: React.ReactNode;
  headerClass: string;
};

function getUrgencyConfig(urgency: TodoUrgency): UrgencyConfig {
  switch (urgency) {
    case "overdue":
      return {
        label: "Overdue",
        icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
        headerClass: "text-[var(--color-antique-burgundy)]",
      };
    case "due_soon":
      return {
        label: "Due This Week",
        icon: <Circle className="h-4 w-4 fill-current" aria-hidden="true" />,
        headerClass: "text-[var(--color-warning)]",
      };
    case "later":
      return {
        label: "Later",
        icon: <Clock className="h-4 w-4" aria-hidden="true" />,
        headerClass: "text-subtle",
      };
  }
}

export function UrgencySection({
  urgency,
  items,
  defaultCollapsed = false,
  onToggle,
  onViewClick,
  optimisticallyDone,
  isPending = false,
}: UrgencySectionProps): React.ReactNode {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [showAll, setShowAll] = useState(false);

  // Filter out optimistically done items for count purposes
  const visibleItems = items.filter(
    (item) => !optimisticallyDone?.has(item.id)
  );

  if (visibleItems.length === 0) {
    return null;
  }

  const config = getUrgencyConfig(urgency);
  const displayedItems = showAll ? visibleItems : visibleItems.slice(0, MAX_VISIBLE);
  const hiddenCount = visibleItems.length - MAX_VISIBLE;

  return (
    <section>
      <button
        type="button"
        onClick={() => setIsCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 py-2"
        role="heading"
        aria-level={3}
        aria-expanded={!isCollapsed}
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4 text-subtle" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-subtle" aria-hidden="true" />
        )}
        <span className={`flex items-center gap-1.5 text-sm font-semibold ${config.headerClass}`}>
          {config.icon}
          {config.label}
        </span>
        <span className="text-xs font-medium text-subtle">({visibleItems.length})</span>
      </button>

      {!isCollapsed && (
        <div className="space-y-1.5 pb-2">
          {displayedItems.map((item) => (
            <TodoRow
              key={item.id}
              item={item}
              onToggle={onToggle}
              onViewClick={onViewClick}
              isOptimisticallyDone={optimisticallyDone?.has(item.id)}
              isPending={isPending}
            />
          ))}
          {!showAll && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full rounded-lg py-1.5 text-center text-xs font-medium text-[var(--color-primary-700)] hover:bg-[var(--color-muted-surface)]"
            >
              Show {hiddenCount} more...
            </button>
          )}
        </div>
      )}
    </section>
  );
}
