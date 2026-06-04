"use client";

import { MoreHorizontal } from "lucide-react";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { DeletePlanningItemButton } from "@/components/planning/delete-planning-item-button";

type PlanningOverflowMenuProps = {
  itemId: string;
  canDelete: boolean;
};

export function PlanningOverflowMenu({
  itemId,
  canDelete
}: PlanningOverflowMenuProps): React.ReactElement | null {
  if (!canDelete) return null;

  return (
    <DropdownMenu
      trigger={
        <MoreHorizontal className="h-5 w-5" aria-label="More actions" />
      }
      align="right"
    >
      <div
        className={[
          "[&_button]:w-full [&_button]:justify-start [&_button]:rounded-none",
          "[&_button]:border-0 [&_button]:shadow-none",
          "[&_button]:px-3 [&_button]:py-2 [&_button]:text-sm [&_button]:h-auto",
          "[&_button]:bg-transparent [&_button]:hover:bg-[var(--canvas-2)]",
          "[&_form]:w-full"
        ].join(" ")}
      >
        <div className="-mb-1 overflow-hidden rounded-b-lg [&_button]:!bg-red-600 [&_button]:!text-white [&_button]:hover:!bg-red-700">
          <DeletePlanningItemButton itemId={itemId} />
        </div>
      </div>
    </DropdownMenu>
  );
}
