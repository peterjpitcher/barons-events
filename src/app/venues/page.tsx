import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listVenues } from "@/lib/venues";
import { listReviewers } from "@/lib/reviewers";
import { VenuesManager } from "@/components/venues/venues-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Venues · Barons Events",
  description: "Manage venues and reviewer defaults for the Barons events workspace."
};

export default async function VenuesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "central_planner") {
    redirect("/");
  }

  const [venues, reviewers] = await Promise.all([listVenues(), listReviewers()]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Venues</CardTitle>
          <CardDescription>Keep venue names and reviewer routing current in one table view.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-subtle">
            These details power event forms, reviewer assignments, and planning analytics. Venue space/area is now entered directly on each event.
          </p>
        </CardContent>
      </Card>
      <VenuesManager venues={venues} reviewers={reviewers} />
    </div>
  );
}
