import { redirect } from "next/navigation";
import { EventForm } from "@/components/events/event-form";
import { EventPageHeader } from "@/components/events/event-page-header";
import { getCurrentUser } from "@/lib/auth";
import { canProposeEvents } from "@/lib/roles";
import { listVenues } from "@/lib/venues";
import { listEventTypes } from "@/lib/event-types";
import { listArtists } from "@/lib/artists";
import { listAssignableUsers } from "@/lib/users";

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

  if (!canProposeEvents(user.role)) {
    redirect("/unauthorized");
  }

  const searchParamsPromise =
    searchParams?.then((params) => params as SearchParams).catch(() => ({} as SearchParams)) ??
    Promise.resolve({} as SearchParams);

  const [resolvedSearchParams, venues, eventTypes, artists, assignableUsers] = await Promise.all([
    searchParamsPromise,
    listVenues(),
    listEventTypes(),
    listArtists(),
    listAssignableUsers()
  ]);
  const eventVenues =
    user.role === "office_worker" && user.venueId
      ? venues.filter((venue) => venue.id === user.venueId)
      : venues;
  const initialStartAt = parseDateParam(resolvedSearchParams.startAt);
  const initialEndAt =
    parseDateParam(resolvedSearchParams.endAt) ??
    (initialStartAt ? new Date(new Date(initialStartAt).getTime() + 3 * 60 * 60 * 1000).toISOString() : undefined);
  const requestedVenueId = parseStringParam(resolvedSearchParams.venueId);
  // Pre-select only when the caller explicitly supplies a valid venue. A direct
  // "New event" must start blank so events are not accidentally filed to the
  // wrong site.
  const initialVenueId =
    user.role === "office_worker" && user.venueId
      ? user.venueId
      : requestedVenueId && eventVenues.some((venue) => venue.id === requestedVenueId)
        ? requestedVenueId
        : undefined;

  return (
    <div className="app-page">
      <EventPageHeader title="New Event" mode="create" />
      <EventForm
        key="new"
        mode="create"
        venues={eventVenues}
        artists={artists}
        eventTypes={eventTypes.map((type) => type.label)}
        role={user.role}
        userVenueId={user.venueId}
        initialStartAt={initialStartAt}
        initialEndAt={initialEndAt}
        initialVenueId={initialVenueId}
        users={assignableUsers.map((u) => ({ id: u.id, name: u.name }))}
      />
    </div>
  );
}
