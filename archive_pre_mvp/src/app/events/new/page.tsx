import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EventForm } from "@/components/events/event-form";
import { getCurrentUserProfile } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Create event draft · EventHub",
  description:
    "Capture a new event draft so reviewers can keep the calendar running smoothly.",
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

  return rows
    .filter((row): row is VenueRow & { name: string } => Boolean(row.id && row.name))
    .map((row) => ({
      id: row.id,
      name: row.name ?? "Unnamed venue",
      areas: (() => {
        const rawAreas = row.areas;
        const asArray = Array.isArray(rawAreas)
          ? rawAreas
          : rawAreas
            ? [rawAreas]
            : [];
        return asArray.map((area) => ({
          id: area.id,
          name: area.name ?? "Unnamed area",
          capacity: typeof area.capacity === "number" ? area.capacity : null,
        }));
      })(),
    }));
};

export default async function NewEventPage() {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Events"
          title="Sign in to create an event"
          description="Use your EventHub account to capture new ideas and keep the calendar in sync."
          actions={
            <Button asChild>
              <Link href="/login">Go to sign in</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const isAllowedCreator =
    profile.role === "venue_manager" || profile.role === "central_planner";

  if (!isAllowedCreator) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Events"
          title="Event creation unavailable"
          description="Only venue managers and Central planners can create new event drafts."
          actions={
            <Button asChild variant="subtle">
              <Link href="/events">Back to events</Link>
            </Button>
          }
        />
        <Alert
          variant="neutral"
          title="Need access?"
          description="Ask an Central planner to update your role if you should be creating events."
        />
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("venues")
    .select(
      `
        id,
        name,
        areas:venue_areas(id,name,capacity)
      `
    )
    .order("name", { ascending: true });

  const venues = formatVenues(data);

  const filteredVenues =
    profile.role === "venue_manager" && profile.venue_id
      ? venues.filter((venue) => venue.id === profile.venue_id)
      : venues;

  const hasAssignableVenue = filteredVenues.length > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Events"
        title="Create a new event draft"
        description="Share the essentials so reviewers can pick things up quickly. You can always return to add more detail before you submit."
        actions={
          <Button asChild variant="outline">
            <Link href="/events">Back to events</Link>
          </Button>
        }
      />

      {error ? (
        <Alert
          variant="danger"
          title="We couldn’t load the venue list"
          description="Refresh the page or contact central planning ops if the issue continues."
        />
      ) : null}

      {!hasAssignableVenue ? (
        <Alert
          variant="neutral"
          title="No venues available"
          description={
            profile.role === "venue_manager"
              ? "We couldn’t find a venue assigned to your profile yet. Ask central planning ops to confirm your venue before creating new drafts."
              : "Add venues first so you can assign ownership when you create drafts."
          }
        />
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-[rgba(42,79,168,0.18)] bg-white/95 p-8 shadow-soft">
          <EventForm venues={filteredVenues} reviewerQueueCount={0} />
        </div>
      )}
    </div>
  );
}
