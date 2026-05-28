"use client";

import { useRouter } from "next/navigation";
import { PlanningItemEditor } from "@/components/planning/planning-item-editor";
import type { PlanningPerson, PlanningVenueOption } from "@/lib/planning/types";
import type { SopTemplateTree } from "@/lib/planning/sop-types";

type PlanningCreatePageProps = {
  today: string;
  users: PlanningPerson[];
  venues: PlanningVenueOption[];
  currentUserId: string;
  isAdministrator: boolean;
  sopTemplate: SopTemplateTree;
};

export function PlanningCreatePage({
  today,
  users,
  venues,
  currentUserId,
  isAdministrator,
  sopTemplate,
}: PlanningCreatePageProps) {
  const router = useRouter();

  return (
    <PlanningItemEditor
      today={today}
      users={users}
      venues={venues}
      currentUserId={currentUserId}
      isAdministrator={isAdministrator}
      sopTemplate={sopTemplate}
      onChanged={() => {
        router.push("/planning");
        router.refresh();
      }}
    />
  );
}
