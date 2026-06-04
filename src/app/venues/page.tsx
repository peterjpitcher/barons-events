import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listVenues } from "@/lib/venues";
import { listReviewers } from "@/lib/reviewers";
import { listAssignableUsers } from "@/lib/users";
import { VenuesManager } from "@/components/venues/venues-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/design-primitives";

export const metadata = {
  title: "Venues · BaronsHub 1.1",
  description: "Manage venues and reviewer defaults for the Barons events workspace."
};

export default async function VenuesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const canEdit = user.role === "administrator";

  const [venues, reviewers, assignableUsers] = await Promise.all([
    listVenues(),
    listReviewers(),
    listAssignableUsers()
  ]);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Estate"
        title="Venues"
        description="Keep venue names, reviewer routing, and operational defaults current."
        meta={<span>{venues.length} venue{venues.length === 1 ? "" : "s"}</span>}
      />
      <Card>
        <CardHeader>
          <CardTitle>Venue routing</CardTitle>
          <CardDescription>These details power event forms, reviewer assignments, and planning analytics.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-subtle">
            These details power event forms, reviewer assignments, and planning analytics. Venue space/area is now entered directly on each event.
          </p>
        </CardContent>
      </Card>
      <VenuesManager
        venues={venues}
        reviewers={reviewers}
        users={assignableUsers.map((u) => ({ id: u.id, name: u.name }))}
        canEdit={canEdit}
      />
    </div>
  );
}
