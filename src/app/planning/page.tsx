import { redirect } from "next/navigation";
import { PlanningBoard } from "@/components/planning/planning-board";
import { getCurrentUser } from "@/lib/auth";
import { listPlanningBoardData } from "@/lib/planning";
import { listVenues } from "@/lib/venues";
import { canReviewEvents, canViewPlanning } from "@/lib/roles";

export const metadata = {
  title: "Planning · BaronsHub",
  description: "Manage operational planning in 30/60/90 windows with recurring templates and tasks."
};

export default async function PlanningPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (!canViewPlanning(user.role)) {
    redirect("/unauthorized");
  }

  const [venues, boardData, calendarData] = await Promise.all([
    listVenues(),
    listPlanningBoardData({
      today: new Date(),
      includeLater: true
    }),
    // Calendar view needs the full historic picture. Completed / cancelled
    // items are pulled too; the calendar UI hides them by default and
    // reveals them via a toggle.
    listPlanningBoardData({
      today: new Date(),
      unbounded: true,
      includeAllStatuses: true
    })
  ]);

  return (
    <PlanningBoard
      data={boardData}
      calendarData={calendarData}
      venues={venues.map((venue) => ({
        id: venue.id,
        name: venue.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        category: (venue as any).category === "cafe" ? "cafe" : "pub"
      }))}
      canApproveEvents={canReviewEvents(user.role)}
      userRole={user.role}
      currentUserId={user.id}
    />
  );
}
