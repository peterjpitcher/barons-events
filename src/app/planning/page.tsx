import { redirect } from "next/navigation";
import { PlanningBoard } from "@/components/planning/planning-board";
import { getCurrentUser } from "@/lib/auth";
import { listPlanningBoardData } from "@/lib/planning";
import { listVenues } from "@/lib/venues";
import { canReviewEvents } from "@/lib/roles";

export const metadata = {
  title: "Planning · EventHub",
  description: "Manage operational planning in 30/60/90 windows with recurring templates and tasks."
};

export default async function PlanningPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [venues, boardData] = await Promise.all([
    listVenues(),
    listPlanningBoardData({
      today: new Date(),
      includeLater: true
    })
  ]);

  return (
    <PlanningBoard
      data={boardData}
      venues={venues.map((venue) => ({
        id: venue.id,
        name: venue.name
      }))}
      canApproveEvents={canReviewEvents(user.role)}
      userRole={user.role}
    />
  );
}
