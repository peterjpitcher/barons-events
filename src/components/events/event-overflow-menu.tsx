"use client";

import { MoreHorizontal } from "lucide-react";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { DeleteEventButton } from "@/components/events/delete-event-button";
import { RevertToDraftButton } from "@/components/events/revert-to-draft-button";

type EventOverflowMenuProps = {
  eventId: string;
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
  canDelete,
  canRevertToDraft,
}: EventOverflowMenuProps): React.ReactElement | null {
  if (!canDelete && !canRevertToDraft) return null;

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
          "[&_button]:bg-transparent [&_button]:hover:bg-[var(--color-muted-surface)]",
          "[&_form]:w-full",
        ].join(" ")}
      >
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
