import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EventForm } from "@/components/events/event-form";
import { getCurrentUserProfile } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PageParams = {
  params: Promise<{ eventId: string }>;
};

type VenueRow = {
  id: string;
  name: string | null;
  areas:
    | null
    | Array<{ id: string; name: string | null; capacity: number | null }>
    | { id: string; name: string | null; capacity: number | null };
};

const formatVenues = (
  rows: VenueRow[] | null | undefined
): Array<{ id: string; name: string; areas: Array<{ id: string; name: string; capacity: number | null }> }> => {
  if (!rows) {
    return [];
  }

  return rows.map((row) => {
    const rawAreas = row.areas;
    const areaArray = Array.isArray(rawAreas)
      ? rawAreas
      : rawAreas
        ? [rawAreas]
        : [];

    return {
      id: row.id,
      name: row.name ?? "Untitled venue",
      areas: areaArray.map((area) => ({
        id: area.id,
        name: area.name ?? "Unnamed area",
        capacity: typeof area.capacity === "number" ? area.capacity : null,
      })),
    };
  });
};

export default async function EditEventPage({ params }: PageParams) {
  const { eventId } = await params;
  const profile = await getCurrentUserProfile();

  if (!profile) {
    redirect("/events");
  }

  const supabase = await createSupabaseServerClient();
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select(
      `
        id,
        title,
        status,
        start_at,
        end_at,
        venue_id,
        created_by,
        assigned_reviewer_id,
        areas:event_areas(
          venue_area:venue_areas(id,name,capacity)
        )
      `
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    throw new Error(`Unable to load event: ${eventError.message}`);
  }

  if (!event) {
    notFound();
  }

  const isCentralPlanner = profile.role === "central_planner";
  const isVenueManager = profile.role === "venue_manager";
  const isOwner = profile.id === event.created_by;
  const canEdit = isCentralPlanner || (isVenueManager && isOwner);

  if (!canEdit) {
    redirect(`/events/${eventId}`);
  }

  if (!["draft", "needs_revisions"].includes(event.status ?? "")) {
    redirect(`/events/${eventId}`);
  }

  const areaEntries = Array.isArray(event.areas)
    ? event.areas
    : event.areas
      ? [event.areas]
      : [];

  const initialAreaIds = areaEntries
    .map((entry) => {
      const relation = Array.isArray(entry.venue_area)
        ? entry.venue_area[0] ?? null
        : entry.venue_area ?? null;

      return relation?.id ?? null;
    })
    .filter((value): value is string => Boolean(value));

  const { data: venueRows, error: venuesError } = await supabase
    .from("venues")
    .select("id,name,areas:venue_areas(id,name,capacity)")
    .order("name", { ascending: true });

  const formattedVenues = formatVenues(venueRows);

  const filteredVenues =
    isCentralPlanner || !profile.venue_id
      ? formattedVenues
      : formattedVenues.filter((venue) => venue.id === profile.venue_id);

  const initialValues = {
    title: event.title ?? "",
    venueId: event.venue_id,
    startAt: event.start_at,
    endAt: event.end_at,
    areaIds: initialAreaIds,
  };

  const hasAssignableVenue =
    filteredVenues.length > 0 || formattedVenues.some((venue) => venue.id === event.venue_id);

  const venueList =
    filteredVenues.length > 0
      ? filteredVenues
      : formattedVenues.filter((venue) => venue.id === event.venue_id);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Events"
        breadcrumbs={[
          { label: "Events", href: "/events" },
          { label: event.title ?? "Event detail", href: `/events/${event.id}` },
          { label: "Edit draft" },
        ]}
        title="Edit event draft"
        description="Keep the draft aligned with the latest plan, then resubmit when you’re ready for review."
        actions={
          <Button asChild variant="outline">
            <Link href={`/events/${event.id}`}>Back to event</Link>
          </Button>
        }
      />

      {venuesError ? (
        <Alert
          variant="danger"
          title="We couldn’t load the venue list"
          description={venuesError.message}
        />
      ) : null}

      {!hasAssignableVenue ? (
        <Alert
          variant="warning"
          title="No venues available"
          description="We couldn’t find an accessible venue for this draft. Check with a Central planner to restore venue access."
        />
      ) : null}

      <Card>
        <CardContent className="p-8">
          <EventForm
            mode="edit"
            eventId={event.id}
            initialValues={initialValues}
            venues={venueList}
            reviewerQueueCount={0}
          />
        </CardContent>
      </Card>
    </div>
  );
}
