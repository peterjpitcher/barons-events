import { redirect } from "next/navigation";
import { VenueForm } from "@/components/venues/venue-form";
import { getCurrentUserProfile } from "@/lib/profile";
import { PageHeader } from "@/components/ui/page-header";
import {
  Card,
  CardContent,
} from "@/components/ui/card";

export default async function NewVenuePage() {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "central_planner") {
    redirect("/venues");
  }

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[
          { label: "Venues", href: "/venues" },
          { label: "New venue" },
        ]}
        title="Create a venue"
        description="Share the key venue details so teams can assign reviewers, start drafts, and give venue managers the access they need."
      />

      <Card>
        <CardContent className="p-8">
          <VenueForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
