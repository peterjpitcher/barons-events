const DEFAULT_EVENT_DURATION_MS = 1000 * 60 * 60 * 2;

export type EventSummary = {
  id: string;
  title: string;
  status: string;
  startAt: string | null;
  endAt: string | null;
  venueId: string | null;
  venueName: string | null;
  venueSpace: string | null;
  assignedReviewerId?: string | null;
  assignedReviewerName?: string | null;
  assignedReviewerEmail?: string | null;
  areas?: Array<{ id: string; name: string | null; capacity: number | null }>;
};

export type EventConflict = {
  key: string;
  venueName: string;
  venueSpace: string;
  first: EventSummary;
  second: EventSummary;
};

const toTimestamp = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

export type EventBounds = {
  startMs: number | null;
  endMs: number | null;
};

export const computeEventBounds = (event: EventSummary): EventBounds => {
  const startMs = toTimestamp(event.startAt);
  if (startMs === null) {
    return { startMs: null, endMs: null };
  }

  const endMsCandidate = toTimestamp(event.endAt);
  const endMs =
    endMsCandidate !== null && endMsCandidate >= startMs
      ? endMsCandidate
      : startMs + DEFAULT_EVENT_DURATION_MS;

  return { startMs, endMs };
};

export const summariseStatusCounts = (
  events: EventSummary[]
): Record<string, number> => {
  return events.reduce<Record<string, number>>((acc, event) => {
    acc[event.status] = (acc[event.status] ?? 0) + 1;
    return acc;
  }, {});
};

export const detectVenueConflicts = (
  events: EventSummary[]
): EventConflict[] => {
  const conflicts: EventConflict[] = [];
  const eventsByVenue = new Map<
    string,
    {
      venueName: string;
      venueSpace: string;
      events: (EventSummary & { startMs: number | null; endMs: number | null })[];
    }
  >();

  for (const event of events) {
    const buckets =
      event.areas && event.areas.length > 0
        ? event.areas.map((area) => ({
            key: `area::${area.id}`,
            venueName: event.venueName ?? "Unknown venue",
            space: area.name ?? "Specific area",
          }))
        : [
            {
              key: `${event.venueId ?? event.venueName ?? "unknown"}::${
                event.venueSpace ?? "general"
              }`,
              venueName: event.venueName ?? "Unknown venue",
              space: event.venueSpace ?? "General space",
            },
          ];

    const bounds = computeEventBounds(event);

    for (const bucket of buckets) {
      const existing = eventsByVenue.get(bucket.key);

      if (existing) {
        existing.events.push({
          ...event,
          startMs: bounds.startMs,
          endMs: bounds.endMs,
        });
      } else {
        eventsByVenue.set(bucket.key, {
          venueName: bucket.venueName,
          venueSpace: bucket.space,
          events: [
            {
              ...event,
              startMs: bounds.startMs,
              endMs: bounds.endMs,
            },
          ],
        });
      }
    }
  }

  for (const [key, group] of eventsByVenue.entries()) {
    const sorted = group.events
      .filter((event) => event.startMs !== null && event.endMs !== null)
      .sort((a, b) => (a.startMs! - b.startMs!));

    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i];
      for (let j = i + 1; j < sorted.length; j += 1) {
        const comparison = sorted[j];

        if (current.endMs! < comparison.startMs!) {
          break;
        }

        const overlaps =
          current.startMs! <= comparison.endMs! &&
          comparison.startMs! <= current.endMs!;

        if (overlaps) {
          conflicts.push({
            key: `${key}-${current.id}-${comparison.id}`,
            venueName: group.venueName,
            venueSpace: group.venueSpace,
            first: current,
            second: comparison,
          });
        }
      }
    }
  }

  return conflicts;
};

export const buildPlanningFeed = (
  events: EventSummary[],
  limit = 5
): EventSummary[] => {
  return events
    .map((event) => ({
      event,
      startMs: toTimestamp(event.startAt),
    }))
    .filter((item) => item.startMs !== null)
    .sort((a, b) => (a.startMs! - b.startMs!))
    .slice(0, limit)
    .map((item) => item.event);
};

export type CalendarEvent = {
  id: string;
  title: string;
  status: string;
  startAt: string;
  endAt: string;
  venueName: string | null;
  venueSpace: string | null;
  conflict: boolean;
  assignedReviewerId: string | null;
  assignedReviewerName: string | null;
};

export const buildCalendarEvents = (
  events: EventSummary[],
  conflictEventIds: Set<string> = new Set()
): CalendarEvent[] => {
  return events
    .map((event) => {
      const { startMs, endMs } = computeEventBounds(event);
      if (startMs === null || endMs === null) {
        return null;
      }

      return {
        id: event.id,
        title: event.title,
        status: event.status,
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(endMs).toISOString(),
        venueName: event.venueName ?? null,
        venueSpace: event.venueSpace ?? null,
        conflict: conflictEventIds.has(event.id),
        assignedReviewerId: event.assignedReviewerId ?? null,
        assignedReviewerName: event.assignedReviewerName ?? null,
      } satisfies CalendarEvent;
    })
    .filter((event): event is CalendarEvent => event !== null);
};

export type ReviewerSlaSnapshot = {
  reviewerId: string;
  reviewerName: string | null;
  totalAssigned: number;
  onTrack: number;
  warning: number;
  overdue: number;
  nextDueAt: string | null;
};

const MS_IN_DAY = 1000 * 60 * 60 * 24;

const allocateSlaBucket = (
  startMs: number,
  nowMs: number
): "onTrack" | "warning" | "overdue" => {
  const diffDays = Math.ceil((startMs - nowMs) / MS_IN_DAY);

  if (diffDays >= 3) {
    return "onTrack";
  }

  if (diffDays >= 0) {
    return "warning";
  }

  return "overdue";
};

export const summariseReviewerSla = (
  events: EventSummary[],
  now: Date = new Date()
): ReviewerSlaSnapshot[] => {
  const nowMs = now.getTime();
  const buckets = new Map<
    string,
    ReviewerSlaSnapshot & { nextDueAtMs: number | null }
  >();

  for (const event of events) {
    if (
      event.status !== "submitted" ||
      !event.assignedReviewerId ||
      !event.startAt
    ) {
      continue;
    }

    const startMs = toTimestamp(event.startAt);
    if (startMs === null) {
      continue;
    }

    const bucket =
      buckets.get(event.assignedReviewerId) ??
      {
        reviewerId: event.assignedReviewerId,
        reviewerName: event.assignedReviewerName ?? null,
        totalAssigned: 0,
        onTrack: 0,
        warning: 0,
        overdue: 0,
        nextDueAt: null,
        nextDueAtMs: null,
      };

    bucket.totalAssigned += 1;

    const slaBucket = allocateSlaBucket(startMs, nowMs);
    bucket[slaBucket] += 1;

    if (bucket.nextDueAtMs === null || startMs < bucket.nextDueAtMs) {
      bucket.nextDueAtMs = startMs;
      bucket.nextDueAt = new Date(startMs).toISOString();
    }

    buckets.set(event.assignedReviewerId, bucket);
  }

  return Array.from(buckets.values())
    .map((value) => {
      const { nextDueAtMs, ...snapshot } = value;
      void nextDueAtMs;
      return snapshot;
    })
    .sort((a, b) => {
      if (b.overdue !== a.overdue) {
        return b.overdue - a.overdue;
      }

      if (b.warning !== a.warning) {
        return b.warning - a.warning;
      }

      return (a.nextDueAt ?? "").localeCompare(b.nextDueAt ?? "");
    });
};
