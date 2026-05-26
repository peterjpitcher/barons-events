import { redirect } from "next/navigation";
import { PlanningBoard } from "@/components/planning/planning-board";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardTodoItems } from "@/lib/dashboard";
import { listPlanningBoardData } from "@/lib/planning";
import { londonDateString } from "@/lib/planning/utils";
import { listVenues } from "@/lib/venues";
import { canReviewEvents, canViewPlanning } from "@/lib/roles";

export const metadata = {
  title: "Planning · BaronsHub 1.1",
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

  const [venues, boardData, calendarData, queueResult] = await Promise.all([
    listVenues(),
    listPlanningBoardData({
      user,
      today: new Date(),
      includeLater: true
    }),
    // Calendar view needs the full historic picture. Completed / cancelled
    // items are pulled too; the calendar UI hides them by default and
    // reveals them via a toggle.
    listPlanningBoardData({
      user,
      today: new Date(),
      unbounded: true,
      includeAllStatuses: true
    }),
    getDashboardTodoItems(user, londonDateString()).catch(() => ({ items: [], errors: [] }))
  ]);
  const visibleVenues =
    user.role === "office_worker" && user.venueId
      ? venues.filter((venue) => venue.id === user.venueId)
      : venues;

  return (
    <PlanningBoard
      data={boardData}
      calendarData={calendarData}
      venues={visibleVenues.map((venue) => ({
        id: venue.id,
        name: venue.name,
         
        category: (venue as any).category === "cafe" ? "cafe" : "pub",
        isInternal: Boolean((venue as any).is_internal)
      }))}
      canApproveEvents={canReviewEvents(user.role)}
      userRole={user.role}
      currentUserId={user.id}
      currentUserVenueId={user.venueId}
      queueItems={queueResult.items}
    />
  );
}
