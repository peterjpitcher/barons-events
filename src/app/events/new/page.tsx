import { redirect } from "next/navigation";
import { EventForm } from "@/components/events/event-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { listVenues } from "@/lib/venues";
import { listEventTypes } from "@/lib/event-types";
import { listArtists } from "@/lib/artists";

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

function parseDateParam(value?: string | string[]): string | undefined {
  if (!value) return undefined;
  const stringValue = Array.isArray(value) ? value[0] : value;
  if (!stringValue) return undefined;
  const parsed = new Date(stringValue);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function parseStringParam(value?: string | string[]): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] ?? undefined : value;
}

export default async function NewEventPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (user.role === "reviewer" || user.role === "executive") {
    redirect("/");
  }

  const searchParamsPromise =
    searchParams?.then((params) => params as SearchParams).catch(() => ({} as SearchParams)) ??
    Promise.resolve({} as SearchParams);

  const [resolvedSearchParams, venues, eventTypes, artists] = await Promise.all([
    searchParamsPromise,
    listVenues(),
    listEventTypes(),
    listArtists()
  ]);
  const availableVenues = user.role === "venue_manager" ? venues.filter((venue) => venue.id === user.venueId) : venues;
  const initialStartAt = parseDateParam(resolvedSearchParams.startAt);
  const initialEndAt =
    parseDateParam(resolvedSearchParams.endAt) ??
    (initialStartAt ? new Date(new Date(initialStartAt).getTime() + 3 * 60 * 60 * 1000).toISOString() : undefined);
  const requestedVenueId = parseStringParam(resolvedSearchParams.venueId);
  const initialVenueId = availableVenues.some((venue) => venue.id === requestedVenueId) ? requestedVenueId : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create a new event draft</CardTitle>
          <CardDescription>
            Share the essentials so reviewers can respond quickly—keep the language simple and cover timings, space, and any promos.
          </CardDescription>
        </CardHeader>
      </Card>
      <EventForm
        mode="create"
        venues={availableVenues}
        artists={artists}
        eventTypes={eventTypes.map((type) => type.label)}
        role={user.role}
        userVenueId={user.venueId}
        initialStartAt={initialStartAt}
        initialEndAt={initialEndAt}
        initialVenueId={initialVenueId}
      />
    </div>
  );
}
