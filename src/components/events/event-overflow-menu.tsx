"use client";

import Link from "next/link";
import { CalendarClock, MoreHorizontal } from "lucide-react";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { DeleteEventButton } from "@/components/events/delete-event-button";
import { RevertToDraftButton } from "@/components/events/revert-to-draft-button";

type EventOverflowMenuProps = {
  eventId: string;
  canReschedule: boolean;
  canDelete: boolean;
  canRevertToDraft: boolean;
};

/**
 * "More actions" dropdown for the event page header.
 * Houses destructive / infrequent actions (delete, revert to draft)
 * so they don't clutter the primary action bar.
 */
export function EventOverflowMenu({
  eventId,
  canReschedule,
  canDelete,
  canRevertToDraft,
}: EventOverflowMenuProps): React.ReactElement | null {
  if (!canReschedule && !canDelete && !canRevertToDraft) return null;

  return (
    <DropdownMenu
      trigger={
        <MoreHorizontal className="h-5 w-5" aria-label="More actions" />
      }
      align="right"
    >
      {/* Override child button styles to look like menu items:
          full-width, left-aligned, no border-radius/shadow/border */}
      <div
        className={[
          "[&_button]:w-full [&_button]:justify-start [&_button]:rounded-none",
          "[&_button]:border-0 [&_button]:shadow-none",
          "[&_button]:px-3 [&_button]:py-2 [&_button]:text-sm [&_button]:h-auto",
          "[&_button]:bg-transparent [&_button]:hover:bg-[var(--canvas-2)]",
          "[&_form]:w-full",
        ].join(" ")}
      >
        {canReschedule ? (
          <Link
            href={`/events/${eventId}/reschedule`}
            role="menuitem"
            className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--paper-tint)]"
          >
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            <span className="min-w-0">Reschedule</span>
          </Link>
        ) : null}
        {canRevertToDraft && <RevertToDraftButton eventId={eventId} />}
        {canDelete && (
          <div className="-mb-1 overflow-hidden rounded-b-lg [&_button]:!bg-red-600 [&_button]:!text-white [&_button]:hover:!bg-red-700">
            <DeleteEventButton eventId={eventId} />
          </div>
        )}
      </div>
    </DropdownMenu>
  );
}
