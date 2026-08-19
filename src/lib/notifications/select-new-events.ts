/**
 * Pure selection for the Tuesday update's "new events added" section.
 *
 * Deliberately free of Supabase and Resend so the rules that matter, the time
 * window, venue scoping, the status filter and the counting, can be tested
 * against real values. The digest's own test mock resolves every query chain to
 * the same rows regardless of .gte / .is / .order, so filter logic exercised
 * only through that mock proves nothing.
 *
 * See docs/superpowers/specs/2026-08-19-event-email-changes-scope.md.
 */

/** Labels mirror src/lib/dashboard.ts:182 so the email and the app agree. */
export const NEW_EVENT_STATUS_LABELS: Record<string, string> = {
  pending_approval: "Proposal awaiting approval",
  approved_pending_details: "Approved, needs details",
  draft: "Draft",
  submitted: "Waiting review",
  needs_revisions: "Needs tweaks",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  completed: "Completed"
};

/**
 * Product decision 2026-08-19: every status is news except rejected. A rejected
 * event is not worth reporting and listing it invites someone to act on it.
 */
export const EXCLUDED_NEW_EVENT_STATUSES = ["rejected"] as const;

/**
 * Never reach further back than this, whatever the cursor says. Without it a
 * new joiner, or a recovery after a long outage, would receive every event
 * since the beginning of time in one email.
 */
export const NEW_EVENT_MAX_LOOKBACK_DAYS = 14;

/** Matches the debrief section's cap. */
export const NEW_EVENT_EMAIL_LIMIT = 20;

type Relation<T> = T | T[] | null | undefined;

export type NewEventRow = {
  id: string;
  title: string | null;
  status: string | null;
  created_at: string;
  start_at: string | null;
  venue_id: string | null;
  venue: Relation<{ name: string | null }>;
  event_venues?: Array<{
    venue_id: string | null;
    venue: Relation<{ name: string | null }>;
  }> | null;
};

export type NewEventItem = {
  title: string;
  detail: string;
};

export type NewEventSelection = {
  /** Every matching event, not just the ones that fit in the email. */
  total: number;
  items: NewEventItem[];
  overflowCount: number;
};

function firstRelation<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

/**
 * Where a recipient's content window starts.
 *
 * `max(lastSentAt, runCutoff - maxLookbackDays)`. A null cursor, an unparseable
 * one, or one somehow in the future all fall back to the floor, so a bad value
 * can only narrow the window, never widen it past the floor.
 */
export function resolveNewEventWindowStart(
  lastSentAt: string | null | undefined,
  runCutoff: string,
  maxLookbackDays: number = NEW_EVENT_MAX_LOOKBACK_DAYS
): string {
  const cutoffMs = Date.parse(runCutoff);
  const floorMs = cutoffMs - maxLookbackDays * 24 * 60 * 60 * 1000;
  if (!lastSentAt) return new Date(floorMs).toISOString();

  const lastMs = Date.parse(lastSentAt);
  if (!Number.isFinite(lastMs)) return new Date(floorMs).toISOString();

  return new Date(Math.min(Math.max(lastMs, floorMs), cutoffMs)).toISOString();
}

/**
 * The venues an event belongs to, for scoping.
 *
 * event_venues is the source of truth (migration 20260418120000). events.venue_id
 * is a denormalised primary venue and is used ONLY when an event has no links at
 * all, which is true of 18 legacy rows. Unioning the two instead would let a
 * stale legacy venue_id show an event to a manager at an unrelated venue.
 */
export function newEventVenueIds(row: NewEventRow): string[] {
  const linked = (row.event_venues ?? [])
    .map((link) => link.venue_id)
    .filter((id): id is string => Boolean(id));

  if (linked.length > 0) return Array.from(new Set(linked));
  return row.venue_id ? [row.venue_id] : [];
}

/**
 * Every venue the event runs at, so a manager included through a secondary link
 * can see why the row is in their email. 10 live events are multi-venue.
 */
export function newEventVenueLabel(row: NewEventRow): string {
  const linkedNames = (row.event_venues ?? [])
    .map((link) => firstRelation(link.venue)?.name)
    .filter((name): name is string => Boolean(name));

  const names = linkedNames.length > 0
    ? linkedNames
    : [firstRelation(row.venue)?.name].filter((name): name is string => Boolean(name));

  const unique = Array.from(new Set(names));
  return unique.length > 0 ? unique.join(", ") : "Unknown venue";
}

export function newEventStatusLabel(status: string | null): string {
  if (!status) return "Unknown status";
  return NEW_EVENT_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function isReportableNewEventStatus(status: string | null): boolean {
  return !EXCLUDED_NEW_EVENT_STATUSES.includes(status as (typeof EXCLUDED_NEW_EVENT_STATUSES)[number]);
}

export type SelectNewEventsInput = {
  /** The shared row set, already bounded by the earliest window across users. */
  rows: NewEventRow[];
  windowStart: string;
  runCutoff: string;
  /** Null means the recipient works across all venues and sees everything. */
  userVenueId: string | null;
  /** Formats the event's start date for display. */
  formatDate: (startAt: string | null) => string;
  limit?: number;
};

/**
 * Narrows the shared row set to one recipient, then counts before capping so
 * the summary tile and the "and N more" line cannot disagree.
 */
export function selectNewEventsForUser({
  rows,
  windowStart,
  runCutoff,
  userVenueId,
  formatDate,
  limit = NEW_EVENT_EMAIL_LIMIT
}: SelectNewEventsInput): NewEventSelection {
  const startMs = Date.parse(windowStart);
  const cutoffMs = Date.parse(runCutoff);

  const matching = rows
    .filter((row) => {
      if (!isReportableNewEventStatus(row.status)) return false;

      // Start inclusive, cutoff exclusive. An event created while the send loop
      // is running belongs to next week rather than being counted twice.
      const createdMs = Date.parse(row.created_at);
      if (!Number.isFinite(createdMs) || createdMs < startMs || createdMs >= cutoffMs) return false;

      if (!userVenueId) return true;
      return newEventVenueIds(row).includes(userVenueId);
    })
    // id breaks ties so equal timestamps order deterministically.
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));

  const items = matching.slice(0, limit).map((row) => ({
    title: row.title ?? "Untitled event",
    detail: `${formatDate(row.start_at)} · ${newEventVenueLabel(row)} · ${newEventStatusLabel(row.status)}`
  }));

  return {
    total: matching.length,
    items,
    overflowCount: Math.max(0, matching.length - items.length)
  };
}
