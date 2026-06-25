import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/design-primitives";
import { EventOverflowMenu } from "@/components/events/event-overflow-menu";
import type { EventStatus } from "@/lib/types";

type EventPageHeaderProps = {
  title: string;
  mode: "create" | "edit" | "view";
  status?: EventStatus;
  eventId?: string;
  canReschedule?: boolean;
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
  cancelled: "danger",
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
  cancelled: "Cancelled",
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
  canReschedule = false,
  canDelete = false,
  canRevertToDraft = false,
}: EventPageHeaderProps): React.ReactElement {
  const isCreate = mode === "create";
  const displayTitle = isCreate ? "New Event" : title;

  return (
    <PageHeader
      eyebrow={
        <span className="inline-flex items-center gap-1">
          <Link href="/events" className="hover:text-[var(--ink)]">
            Events
          </Link>
          <span aria-hidden="true">/</span>
          <span>{isCreate ? "New" : mode === "edit" ? "Edit" : "Detail"}</span>
        </span>
      }
      title={displayTitle}
      description={isCreate ? "Create a new event draft with venue, timing, booking, and website details." : "Review event details, workflow state, and supporting actions."}
      actions={
        <>
        {!isCreate && status && (
          <Badge variant={STATUS_BADGE_VARIANT[status]}>
            {STATUS_LABEL[status]}
          </Badge>
        )}

        {mode === "edit" && eventId && (
          <EventOverflowMenu
            eventId={eventId}
            canReschedule={canReschedule}
            canDelete={canDelete}
            canRevertToDraft={canRevertToDraft}
          />
        )}
        </>
      }
    />
  );
}
