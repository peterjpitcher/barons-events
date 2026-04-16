"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, Circle } from "lucide-react";
import type { TodoItem, TodoUrgency } from "./todo-item-types";

type TodoRowProps = {
  item: TodoItem;
  onToggle?: (planningTaskId: string) => void;
  onViewClick?: (planningItemId: string) => void;
  isOptimisticallyDone?: boolean;
  isPending?: boolean;
};

function UrgencyBadge({ urgency }: { urgency: TodoUrgency }): React.ReactNode {
  if (urgency === "overdue") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(110,60,61,0.1)] px-2 py-0.5 text-xs font-semibold text-[var(--color-antique-burgundy)]">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Overdue
      </span>
    );
  }
  if (urgency === "due_soon") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(192,139,60,0.1)] px-2 py-0.5 text-xs font-semibold text-[var(--color-warning)]">
        <Circle className="h-3 w-3 fill-current" aria-hidden="true" />
        Due soon
      </span>
    );
  }
  return null;
}

export function TodoRow({
  item,
  onToggle,
  onViewClick,
  isOptimisticallyDone = false,
  isPending = false,
}: TodoRowProps): React.ReactNode {
  const [isExpanded, setIsExpanded] = useState(false);

  if (isOptimisticallyDone) {
    return null;
  }

  const hasDetails = item.parentTitle || item.eventDate || item.venueName;
  const showCheckbox = item.canToggle && item.planningTaskId;

  function handleRowClick(): void {
    if (hasDetails) {
      setIsExpanded((v) => !v);
    }
  }

  function handleViewClick(e: React.MouseEvent): void {
    e.stopPropagation();
    if (onViewClick && item.planningItemId) {
      e.preventDefault();
      onViewClick(item.planningItemId);
    }
  }

  return (
    <div
      className="rounded-lg border border-[rgba(39,54,64,0.12)] bg-white"
    >
      <div
        className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer"
        onClick={handleRowClick}
        role={hasDetails ? "button" : undefined}
        aria-expanded={hasDetails ? isExpanded : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        onKeyDown={hasDetails ? (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded((v) => !v);
          }
        } : undefined}
      >
        {showCheckbox && (
          <button
            type="button"
            disabled={isPending}
            onClick={(e) => {
              e.stopPropagation();
              if (item.planningTaskId && onToggle) {
                onToggle(item.planningTaskId);
              }
            }}
            aria-label={`Mark "${item.title}" as done`}
            className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 border-[var(--color-primary-400)] bg-white hover:bg-[var(--color-primary-50)] disabled:opacity-50"
          />
        )}

        {hasDetails && (
          <span className="mt-0.5 flex-shrink-0 text-subtle">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[var(--color-text)]">{item.title}</p>
            <UrgencyBadge urgency={item.urgency} />
          </div>
          <p className="text-xs text-subtle">{item.subtitle}</p>
        </div>

        <Link
          href={item.linkHref}
          onClick={handleViewClick}
          className="flex-shrink-0 text-xs font-semibold text-[var(--color-primary-700)] hover:underline"
        >
          View →
        </Link>
      </div>

      {isExpanded && hasDetails && (
        <div className="border-t border-[rgba(39,54,64,0.08)] px-3 py-2 text-xs text-subtle">
          {item.parentTitle && (
            <p>
              <span className="font-medium">Parent:</span> {item.parentTitle}
            </p>
          )}
          {item.venueName && (
            <p>
              <span className="font-medium">Venue:</span> {item.venueName}
            </p>
          )}
          {item.eventDate && (
            <p>
              <span className="font-medium">Event date:</span> {item.eventDate}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
