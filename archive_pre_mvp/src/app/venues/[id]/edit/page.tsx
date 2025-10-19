import { notFound, redirect } from "next/navigation";
import { VenueForm } from "@/components/venues/venue-form";
import { getCurrentUserProfile } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { VenueAreasManager } from "@/components/venues/venue-areas-manager";
import { VenueDefaultReviewersManager } from "@/components/venues/venue-default-reviewers-manager";

type EditVenuePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditVenuePage({ params }: EditVenuePageProps) {
  const resolvedParams = await params;
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "central_planner") {
    redirect("/venues");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("venues")
    .select(
      `
        id,
        name,
        address,
        areas:venue_areas(id,name,capacity)
      `
    )
    .eq("id", resolvedParams.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load venue: ${error.message}`);
  }

  if (!data) {
    notFound();
  }

  const areaRows = Array.isArray(data.areas)
    ? data.areas
    : data.areas
      ? [data.areas]
      : [];

  const areas = areaRows.map((area) => {
    const raw = area as {
      id: string;
      name: string | null;
      capacity: number | null;
    };

    return {
      id: raw.id,
      name: raw.name ?? "Unnamed area",
      capacity: typeof raw.capacity === "number" ? raw.capacity : null,
    };
  });

  const { data: reviewerRows, error: reviewerError } = await supabase
    .from("venue_default_reviewers")
    .select(
      `
        id,
        reviewer:users(id,full_name,email)
      `
    )
    .eq("venue_id", resolvedParams.id)
    .order("created_at", { ascending: true });

  if (reviewerError) {
    throw new Error(`Unable to load default reviewers: ${reviewerError.message}`);
  }

  const assignedReviewers = (reviewerRows ?? [])
    .map((row) => {
      const raw = row as {
        id: string;
        reviewer?:
          | { id: string; full_name: string | null; email: string | null }
          | Array<{ id: string; full_name: string | null; email: string | null }>
          | null;
      };

      const reviewerRelation = Array.isArray(raw.reviewer)
        ? raw.reviewer[0] ?? null
        : raw.reviewer ?? null;

      if (!reviewerRelation || typeof reviewerRelation.id !== "string") {
        return null;
      }

      const name =
        reviewerRelation.full_name?.trim().length
          ? reviewerRelation.full_name
          : reviewerRelation.email?.trim().length
            ? reviewerRelation.email
            : "Unnamed reviewer";

      return {
        mappingId: raw.id,
        reviewerId: reviewerRelation.id,
        name,
        email: reviewerRelation.email ?? null,
      };
    })
    .filter(
      (
        entry
      ): entry is {
        mappingId: string;
        reviewerId: string;
        name: string;
        email: string | null;
      } => Boolean(entry)
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const { data: plannerRows, error: plannerError } = await supabase
    .from("users")
    .select("id,full_name,email")
    .eq("role", "central_planner")
    .order("full_name", { ascending: true });

  if (plannerError) {
    throw new Error(`Unable to load Central planners: ${plannerError.message}`);
  }

  const reviewerOptions = (plannerRows ?? [])
    .map((row) => {
      const profile = row as { id: string; full_name: string | null; email: string | null };
      const name =
        profile.full_name?.trim().length
          ? profile.full_name
          : profile.email?.trim().length
            ? profile.email
            : "Unnamed reviewer";

      return {
        id: profile.id,
        name,
        email: profile.email ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[
          { label: "Venues", href: "/venues" },
          { label: data.name ?? "Venue" },
          { label: "Edit" },
        ]}
        title="Edit venue"
        description="Keep reviewer assignments and area details accurate. Updates immediately flow through planning analytics and reviewer triage."
      />

      <Card>
        <CardContent className="p-8">
          <VenueForm
            mode="edit"
            initialValues={{
              venueId: data.id,
              name: data.name ?? "",
              address: data.address ?? "",
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-8">
          <VenueDefaultReviewersManager
            venueId={data.id}
            reviewers={reviewerOptions}
            assignedReviewers={assignedReviewers}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-8">
          <VenueAreasManager venueId={data.id} areas={areas} />
        </CardContent>
      </Card>
    </div>
  );
}
