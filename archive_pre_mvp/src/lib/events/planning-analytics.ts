import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cache } from "react";
import {
  buildCalendarEvents,
  buildPlanningFeed,
  detectVenueConflicts,
  summariseReviewerSla,
  summariseStatusCounts,
  type CalendarEvent,
  type EventSummary,
  type ReviewerSlaSnapshot,
} from "@/lib/events/analytics";

type PlanningEventRow = {
  id: string;
  title: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  venue_id: string | null;
  venue_space: string | null;
  assigned_reviewer_id: string | null;
  assigned_reviewer?:
    | { full_name: string | null }
    | Array<{ full_name: string | null }>
    | null;
  venue?:
    | { name: string | null }
    | Array<{ name: string | null }>
    | null;
  areas?:
    | {
        venue_area?:
          | { id: string; name: string | null; capacity: number | null }
          | Array<{ id: string; name: string | null; capacity: number | null }>
          | null;
      }
    | Array<{
        venue_area?:
          | { id: string; name: string | null; capacity: number | null }
          | Array<{ id: string; name: string | null; capacity: number | null }>
          | null;
      }>
    | null;
};

type NormalizedEventRow = Omit<PlanningEventRow, "venue" | "assigned_reviewer" | "areas"> & {
  venue: { name: string | null } | null;
  assigned_reviewer: { full_name: string | null } | null;
  areas: Array<{ id: string; name: string | null; capacity: number | null }>;
};

export type PlanningAnalytics = {
  summaries: EventSummary[];
  statusCounts: Record<string, number>;
  conflicts: ReturnType<typeof detectVenueConflicts>;
  upcoming: EventSummary[];
  awaitingReviewer: EventSummary[];
  totalEvents: number;
  calendarEvents: CalendarEvent[];
  reviewerSla: ReviewerSlaSnapshot[];
  slaWarningQueued: number;
};

export const fetchPlanningAnalytics = cache(async (): Promise<PlanningAnalytics> => {
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
        venue_id,
        venue_space,
        assigned_reviewer_id,
        assigned_reviewer:users!events_assigned_reviewer_id_fkey(full_name),
        venue:venues(name),
        areas:event_areas(
          venue_area:venue_areas(id,name,capacity)
        )
      `
    )
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  type RawEvent = PlanningEventRow & {
    venue?:
      | { name: string | null }
      | Array<{ name: string | null }>
      | null;
    [key: string]: unknown;
  };

  const normalized: NormalizedEventRow[] = (data ?? []).map((event) => {
    const raw = event as unknown as RawEvent;
    const venueValue = Array.isArray(raw.venue)
      ? raw.venue[0] ?? null
      : raw.venue ?? null;
    const reviewerValue = Array.isArray(raw.assigned_reviewer)
      ? raw.assigned_reviewer[0] ?? null
      : raw.assigned_reviewer ?? null;
    const areaValue = Array.isArray(raw.areas)
      ? raw.areas
      : raw.areas
        ? [raw.areas]
        : [];

    const mappedAreas = areaValue
      .map((entry) => {
        const relation = Array.isArray(entry.venue_area)
          ? entry.venue_area[0] ?? null
          : entry.venue_area ?? null;

        if (!relation) {
          return null;
        }

        return {
          id: relation.id,
          name: relation.name ?? null,
          capacity: typeof relation.capacity === "number" ? relation.capacity : null,
        };
      })
      .filter((area): area is { id: string; name: string | null; capacity: number | null } => Boolean(area));

    return {
      ...raw,
      venue: venueValue,
      assigned_reviewer: reviewerValue,
      areas: mappedAreas,
    };
  });

  const summaries: EventSummary[] = normalized.map((event) => ({
    id: event.id,
    title: event.title,
    status: event.status,
    startAt: event.start_at,
    endAt: event.end_at,
    venueId: event.venue_id,
    venueName: event.venue?.name ?? null,
    venueSpace: event.venue_space ?? null,
    assignedReviewerId: event.assigned_reviewer_id ?? null,
    assignedReviewerName: event.assigned_reviewer?.full_name ?? null,
    areas: event.areas,
  }));

  const statusCounts = summariseStatusCounts(summaries);
  const conflicts = detectVenueConflicts(summaries);
  const upcoming = buildPlanningFeed(summaries, 12);
  const awaitingReviewer = summaries.filter(
    (event) => event.status === "submitted" && !event.assignedReviewerId
  );
  const conflictEventIds = new Set<string>();
  for (const pair of conflicts) {
    conflictEventIds.add(pair.first.id);
    conflictEventIds.add(pair.second.id);
  }

  const calendarEvents = buildCalendarEvents(summaries, conflictEventIds);
  const reviewerSla = summariseReviewerSla(summaries);

  const { count: queuedSlaCount, error: queuedSlaError } = await supabase
    .from("notifications")
    .select("id", { head: true, count: "exact" })
    .eq("type", "sla_warning")
    .eq("status", "queued");

  if (queuedSlaError) {
    throw new Error(queuedSlaError.message);
  }

  return {
    summaries,
    statusCounts,
    conflicts,
    upcoming,
    awaitingReviewer,
    totalEvents: summaries.length,
    calendarEvents,
    reviewerSla,
    slaWarningQueued: queuedSlaCount ?? 0,
  };
});
