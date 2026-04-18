"use client";

import { useRouter } from "next/navigation";
import { PlanningItemCard } from "@/components/planning/planning-item-card";
import type { PlanningItem, PlanningPerson, PlanningVenueOption } from "@/lib/planning/types";

type PlanningItemEditorShellProps = {
  item: PlanningItem;
  users: PlanningPerson[];
  venues: PlanningVenueOption[];
  currentUserId: string;
};

/**
 * Client-side shell that hosts the full PlanningItemCard editor on the
 * /planning/[id] detail page. Previously this lived inside the
 * PlanningModal; the modal was removed (issue 04) and the page now owns the
 * edit experience. `onChanged` maps to router.refresh so saves flow back
 * through the server-rendered surrounding panels (audit trail, attachments
 * roll-up, SOP checklist).
 */
export function PlanningItemEditorShell({
  item,
  users,
  venues,
  currentUserId
}: PlanningItemEditorShellProps) {
  const router = useRouter();
  return (
    <PlanningItemCard
      item={item}
      users={users}
      venues={venues}
      onChanged={() => router.refresh()}
      currentUserId={currentUserId}
    />
  );
}
