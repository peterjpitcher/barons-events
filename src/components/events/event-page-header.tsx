import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EventOverflowMenu } from "@/components/events/event-overflow-menu";
import type { EventStatus } from "@/lib/types";

type EventPageHeaderProps = {
  title: string;
  mode: "create" | "edit" | "view";
  status?: EventStatus;
  eventId?: string;
  canDelete?: boolean;
  canRevertToDraft?: boolean;
};

const STATUS_BADGE_VARIANT: Record<
  EventStatus,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  pending_approval: "warning",
  approved_pending_details: "info",
  draft: "neutral",
  submitted: "info",
  needs_revisions: "warning",
  approved: "success",
  rejected: "danger",
  completed: "neutral",
};

const STATUS_LABEL: Record<EventStatus, string> = {
  pending_approval: "Pending Approval",
  approved_pending_details: "Approved — Pending Details",
  draft: "Draft",
  submitted: "Submitted",
  needs_revisions: "Needs Revisions",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
};

/**
 * Page header for event create / edit / view pages.
 * Renders breadcrumbs, title, status badge, and an overflow menu (edit mode only).
 */
export function EventPageHeader({
  title,
  mode,
  status,
  eventId,
  canDelete = false,
  canRevertToDraft = false,
}: EventPageHeaderProps): React.ReactElement {
  const isCreate = mode === "create";
  const displayTitle = isCreate ? "New Event" : title;

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      {/* Left: breadcrumbs + title */}
      <div className="min-w-0">
        <nav
          aria-label="Breadcrumb"
          className="mb-1 text-sm text-[var(--color-text-muted)]"
        >
          <ol className="flex items-center gap-1">
            <li>
              <Link
                href="/events"
                className="hover:text-[var(--color-text)] transition-colors"
              >
                Events
              </Link>
            </li>
            <li aria-hidden="true">&gt;</li>
            <li className="truncate font-medium text-[var(--color-text)]">
              {displayTitle}
            </li>
          </ol>
        </nav>

        <h1 className="truncate text-2xl font-bold text-[var(--color-text)]">
          {displayTitle}
        </h1>
      </div>

      {/* Right: status badge + overflow menu */}
      <div className="flex shrink-0 items-center gap-3 mt-2 sm:mt-0">
        {!isCreate && status && (
          <Badge variant={STATUS_BADGE_VARIANT[status]}>
            {STATUS_LABEL[status]}
          </Badge>
        )}

        {mode === "edit" && eventId && (
          <EventOverflowMenu
            eventId={eventId}
            canDelete={canDelete}
            canRevertToDraft={canRevertToDraft}
          />
        )}
      </div>
    </div>
  );
}
