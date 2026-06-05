import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanningCreatePage } from "./planning-create-page";
import { PageHeader } from "@/components/ui/design-primitives";
import { getCurrentUser } from "@/lib/auth";
import { listPlanningUsers } from "@/lib/planning";
import { loadSopTemplate } from "@/lib/planning/sop";
import { londonDateString } from "@/lib/planning/utils";
import { canCreatePlanningItems } from "@/lib/roles";
import { listVenues } from "@/lib/venues";

export const metadata = {
  title: "New planning item · BaronsHub 1.1",
  description: "Create one-off planning work or recurring planning series."
};

export default async function NewPlanningPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (!canCreatePlanningItems(user.role, user.venueId)) {
    redirect("/unauthorized");
  }

  const [venues, users, sopTemplate] = await Promise.all([
    listVenues(),
    listPlanningUsers(),
    loadSopTemplate()
  ]);

  const visibleVenues =
    user.role === "manager" && user.venueId
      ? venues.filter((venue) => venue.id === user.venueId)
      : venues;

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1">
            <Link href="/planning" className="hover:text-[var(--ink)]">
              Planning
            </Link>
            <span aria-hidden="true">/</span>
            <span>New</span>
          </span>
        }
        title="New planning item"
        description="Create a one-off operational action or recurring planning series with venue, owner, target date, and SOP details."
      />
      <PlanningCreatePage
        today={londonDateString()}
        users={users}
        venues={visibleVenues.map((venue) => ({
          id: venue.id,
          name: venue.name,
           
          category: (venue as any).category === "cafe" ? "cafe" : "pub",
          isInternal: Boolean((venue as any).is_internal)
        }))}
        currentUserId={user.id}
        isAdministrator={user.role === "administrator"}
        sopTemplate={sopTemplate}
      />
    </div>
  );
}
