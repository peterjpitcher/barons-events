import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatPill } from "@/components/ui/stat-pill";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  detectVenueConflicts,
  summariseStatusCounts,
  type EventSummary,
} from "@/lib/events/analytics";
import {
  EventsCalendarViewer,
  type CalendarEventRecord,
} from "@/components/events/events-calendar-viewer";
import { EventClonePanel } from "@/components/planning/event-clone-panel";

type EventRow = {
  id: string;
  title: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  created_by: string;
  venue_id: string | null;
  venue_space: string | null;
  venue?: {
    name: string | null;
  } | null;
};

const fallbackErrorHelper =
  "Run Supabase migrations (`npm run supabase:migrate`) to ensure the events/versions tables exist.";

const numberFormatter = new Intl.NumberFormat("en-GB");

async function fetchEvents(): Promise<{
  data: EventRow[];
  error: string | null;
}> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      `
        id,
        title,
        status,
        start_at,
        end_at,
        created_by,
        venue_id,
        venue_space,
        venue:venues!events_venue_id_fkey(name)
      `
    )
    .order("start_at", { ascending: true });

  if (error) {
    const message =
      error.code === "42P01"
        ? "The events table is missing."
        : error.message ?? "Unable to load events.";

    return {
      data: [],
      error: `${message} ${fallbackErrorHelper}`,
    };
  }

  type RawEvent = {
    venue?: { name: string | null } | { name: string | null }[] | null;
    [key: string]: unknown;
  };

  const normalized = (data ?? []).map((event) => {
    const raw = event as unknown as RawEvent;
    const venueValue = Array.isArray(raw.venue)
      ? raw.venue[0] ?? null
      : raw.venue ?? null;
    return {
      ...(raw as Record<string, unknown>),
      venue: venueValue,
    } as EventRow;
  });

  return {
    data: normalized as EventRow[],
    error: null,
  };
}

const formatDateTime = (input: string | null) => {
  if (!input) return "—";
  try {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  needs_revisions: "Needs revisions",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  completed: "Completed",
};

const successMessages: Record<string, string> = {
  created: "Event draft created successfully.",
  submitted: "Event submitted for review.",
};

type EventsPageProps = {
  searchParams?: Promise<Record<string, string | string[]>>;
};

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const resolvedSearchParams =
    (searchParams ? await searchParams : undefined) ?? {};

  const searchParamsRecord =
    resolvedSearchParams as Record<string, string | string[]>;

  const profile = await getCurrentUserProfile();
  const isCentralPlanner = profile?.role === "central_planner";

  const { data: events, error: eventError } = await fetchEvents();

  const eventSummaries: EventSummary[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    status: event.status,
    startAt: event.start_at,
    endAt: event.end_at,
    venueId: event.venue_id,
    venueName: event.venue?.name ?? null,
    venueSpace: event.venue_space ?? null,
  }));

  const statusCounts = summariseStatusCounts(eventSummaries);

  const calendarRecords: CalendarEventRecord[] = eventSummaries.map((event) => ({
    id: event.id,
    title: event.title,
    status: statusLabels[event.status] ?? event.status,
    startAt: event.startAt,
    endAt: event.endAt,
    venueName: event.venueName ?? "Unassigned",
  }));

  const statusSummaryCards = [
    {
      label: "Total events",
      value: numberFormatter.format(eventSummaries.length),
      trendLabel: "All records in Supabase",
      trendVariant: "flat" as const,
    },
    {
      label: "Drafts",
      value: numberFormatter.format(statusCounts.draft ?? 0),
      trendLabel: "Editable by venue managers",
      trendVariant: "flat" as const,
    },
    {
      label: "Submitted",
      value: numberFormatter.format(statusCounts.submitted ?? 0),
      trendLabel: "Awaiting reviewer assignment",
      trendVariant: "flat" as const,
    },
    {
      label: "Needs revisions",
      value: numberFormatter.format(statusCounts.needs_revisions ?? 0),
      trendLabel: "Returned for updates",
      trendVariant: "down" as const,
    },
    {
      label: "Approved",
      value: numberFormatter.format(statusCounts.approved ?? 0),
      trendLabel: "Cleared for publishing",
      trendVariant: "up" as const,
    },
  ];

  const conflictPairs = detectVenueConflicts(eventSummaries);
  const conflictDisplay = conflictPairs.slice(0, 5);

  const hasCloneableEvents = eventSummaries.some((event) =>
    ["draft", "submitted", "needs_revisions", "approved", "published"].includes(event.status)
  );

  const toastMessage = searchParamsRecord?.status && typeof searchParamsRecord.status === "string"
    ? successMessages[searchParamsRecord.status]
    : null;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Events"
        title="Event pipeline"
        description="Track event drafts from first idea to approval. Use this view to monitor status, spot conflicts, and help reviewers keep the pipeline moving."
        actions={
          <Button asChild variant="subtle">
            <Link href="/events/new">Create event</Link>
          </Button>
        }
      >
        {events.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {statusSummaryCards.map((card) => (
              <StatPill
                key={card.label}
                label={card.label}
                value={card.value}
                trendLabel={card.trendLabel}
                trendVariant={card.trendVariant}
                className="px-3 py-2"
              />
            ))}
          </div>
        ) : (
          <Alert
            variant="info"
            title="No events yet"
            description="Create your first draft below to populate the pipeline."
          />
        )}
      </PageHeader>

      {eventError ? (
        <Alert variant="danger" title="Unable to load events" description={eventError} />
      ) : null}

      {toastMessage ? (
        <Alert variant="success" title={toastMessage} />
      ) : null}

      {events.length > 0 ? (
        <Card className="bg-white/95">
          <CardHeader>
            <CardTitle>Calendar</CardTitle>
            <CardDescription>
              Switch between month, 7-day, or list views. All venues are selected by default—toggle them to focus on specific locations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <EventsCalendarViewer events={calendarRecords} />
          </CardContent>
        </Card>
      ) : null}

      {conflictDisplay.length > 0 ? (
        <Alert
          variant="warning"
          title={`Schedule conflicts detected (${conflictPairs.length})`}
        >
          <div className="mt-3 space-y-3 text-[var(--color-primary-900)]">
            {conflictDisplay.map((pair) => (
              <div
                key={pair.key}
                className="rounded-[var(--radius)] border border-[rgba(245,158,11,0.28)] bg-white/90 px-3 py-3 text-sm shadow-soft"
              >
                <div className="flex flex-col">
                  <span className="font-semibold">{pair.venueName}</span>
                  <span className="text-xs text-[var(--color-accent-warm-dark)]">
                    {pair.venueSpace}
                  </span>
                </div>
                <p className="mt-2 text-xs text-[var(--color-accent-warm-dark)]">
                  <Link
                    href={`/events/${pair.first.id}?source=conflict#timeline`}
                    className="font-semibold text-[var(--color-primary-900)] underline-offset-2 hover:text-[var(--color-primary-700)] hover:underline"
                  >
                    {pair.first.title}
                  </Link>{" "}
                  ({formatDateTime(pair.first.startAt)}) overlaps with{" "}
                  <Link
                    href={`/events/${pair.second.id}?source=conflict#timeline`}
                    className="font-semibold text-[var(--color-primary-900)] underline-offset-2 hover:text-[var(--color-primary-700)] hover:underline"
                  >
                    {pair.second.title}
                  </Link>{" "}
                  ({formatDateTime(pair.second.startAt)})
                </p>
              </div>
            ))}
            {conflictPairs.length > conflictDisplay.length ? (
              <p className="text-xs text-[var(--color-accent-warm-dark)]">
                {conflictPairs.length - conflictDisplay.length} additional potential conflict
                {conflictPairs.length - conflictDisplay.length === 1 ? "" : "s"} not shown.
              </p>
            ) : null}
          </div>
        </Alert>
      ) : null}

      {isCentralPlanner && hasCloneableEvents ? (
        <EventClonePanel events={eventSummaries} />
      ) : null}
    </div>
  );
}
