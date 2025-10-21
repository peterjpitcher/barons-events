import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import type { AppUser, EventStatus } from "@/lib/types";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { parseVenueSpaces } from "@/lib/venue-spaces";

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type VenueRow = Database["public"]["Tables"]["venues"]["Row"];
type VersionRow = Database["public"]["Tables"]["event_versions"]["Row"];
type ApprovalRow = Database["public"]["Tables"]["approvals"]["Row"];
type DebriefRow = Database["public"]["Tables"]["debriefs"]["Row"];

type TrackedEventField =
  | "title"
  | "event_type"
  | "start_at"
  | "end_at"
  | "venue_id"
  | "venue_space"
  | "expected_headcount"
  | "wet_promo"
  | "food_promo"
  | "goal_focus"
  | "notes";

const EVENT_FIELD_LABELS: Record<TrackedEventField, string> = {
  title: "Title",
  event_type: "Type",
  start_at: "Start time",
  end_at: "End time",
  venue_id: "Venue",
  venue_space: "Space",
  expected_headcount: "Headcount",
  wet_promo: "Wet promotion",
  food_promo: "Food promotion",
  goal_focus: "Goals",
  notes: "Notes"
};

function labelsForInitialValues(record: EventRow): string[] {
  const labels: string[] = [];
  (Object.keys(EVENT_FIELD_LABELS) as TrackedEventField[]).forEach((field) => {
    const value = record[field];
    if (value !== null && value !== "" && value !== undefined) {
      labels.push(EVENT_FIELD_LABELS[field]);
    }
  });
  return labels;
}

function labelsForUpdatedValues(previous: EventRow, updates: Partial<EventRow>): string[] {
  const labels: string[] = [];
  (Object.keys(EVENT_FIELD_LABELS) as TrackedEventField[]).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(updates, field)) {
      return;
    }
    const nextValue = updates[field];
    if (previous[field] !== nextValue) {
      labels.push(EVENT_FIELD_LABELS[field]);
    }
  });
  return labels;
}

export type EventSummary = EventRow & {
  venue: Pick<VenueRow, "id" | "name">;
};

export type EventDetail = EventRow & {
  venue: VenueRow;
  versions: VersionRow[];
  approvals: ApprovalRow[];
  debrief: DebriefRow | null;
};

export async function listReviewQueue(user: AppUser): Promise<EventSummary[]> {
  const supabase = await createSupabaseReadonlyClient();

  let query = supabase
    .from("events")
    .select("*, venue:venues(id,name)")
    .in("status", ["submitted", "needs_revisions"])
    .order("start_at", { ascending: true });

  if (user.role === "reviewer") {
    query = query.eq("assignee_id", user.id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load review queue: ${error.message}`);
  }

  const rows = (data ?? []) as any[];

  return rows.map((item) => ({
    ...item,
    venue: Array.isArray(item.venue) ? item.venue[0] : (item.venue as EventSummary["venue"])
  }));
}

export async function listEventsForUser(user: AppUser): Promise<EventSummary[]> {
  const supabase = await createSupabaseReadonlyClient();

  let query = supabase
    .from("events")
    .select("*, venue:venues(id,name)")
    .order("start_at", { ascending: true });

  if (user.role === "central_planner") {
    // no extra filter
  } else if (user.role === "venue_manager") {
    query = query.eq("created_by", user.id);
  } else if (user.role === "reviewer") {
    query = query.eq("assignee_id", user.id);
  } else {
    query = query.limit(10);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load events: ${error.message}`);
  }

  const rows = (data ?? []) as any[];

  return rows.map((item) => ({
    ...item,
    venue: Array.isArray(item.venue) ? item.venue[0] : (item.venue as EventSummary["venue"])
  }));
}

export async function getEventDetail(eventId: string): Promise<EventDetail | null> {
  const supabase = await createSupabaseReadonlyClient();

  const { data, error } = await supabase
    .from("events")
    .select(
      `*,
      venue:venues(*),
      versions:event_versions(*),
      approvals(*),
      debrief:debriefs(*)
    `
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load event: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const record = data as any;

  return {
    ...record,
    venue: Array.isArray(record.venue) ? record.venue[0] : (record.venue as VenueRow),
    versions: Array.isArray(record.versions) ? record.versions : [],
    approvals: Array.isArray(record.approvals) ? record.approvals : [],
    debrief: Array.isArray(record.debrief) ? record.debrief[0] ?? null : (record.debrief as DebriefRow | null)
  };
}

export async function createEventDraft(payload: {
  venueId: string;
  createdBy: string;
  title: string;
  eventType: string;
  startAt: string;
  endAt: string;
  venueSpace: string;
  expectedHeadcount?: number | null;
  wetPromo?: string | null;
  foodPromo?: string | null;
  goalFocus?: string | null;
  notes?: string | null;
}): Promise<EventRow> {
  const supabase = await createSupabaseActionClient();

  const { data, error } = await supabase
    .from("events")
    .insert({
      venue_id: payload.venueId,
      created_by: payload.createdBy,
      title: payload.title,
      event_type: payload.eventType,
      status: "draft",
      start_at: payload.startAt,
      end_at: payload.endAt,
      venue_space: payload.venueSpace,
      expected_headcount: payload.expectedHeadcount ?? null,
      wet_promo: payload.wetPromo ?? null,
      food_promo: payload.foodPromo ?? null,
      goal_focus: payload.goalFocus ?? null,
      notes: payload.notes ?? null,
      assignee_id: payload.createdBy
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Could not create event: ${error.message}`);
  }

  await supabase.from("event_versions").insert({
    event_id: data.id,
    version: 1,
    payload: {
      title: data.title,
      event_type: data.event_type,
      start_at: data.start_at,
      end_at: data.end_at,
      venue_space: data.venue_space,
      expected_headcount: data.expected_headcount,
      wet_promo: data.wet_promo,
      food_promo: data.food_promo,
      goal_focus: data.goal_focus,
      notes: data.notes
    },
    submitted_by: payload.createdBy
  });

  await recordAuditLogEntry({
    entity: "event",
    entityId: data.id,
    action: "event.created",
    actorId: payload.createdBy,
    meta: {
      status: "draft",
      assigneeId: payload.createdBy,
      changes: labelsForInitialValues(data)
    }
  });

  return data;
}

export async function updateEventDraft(eventId: string, updates: Partial<EventRow>, actorId?: string | null) {
  const supabase = await createSupabaseActionClient();

  const { data: existing, error: fetchError } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (fetchError) {
    throw new Error(`Could not load event: ${fetchError.message}`);
  }

  const previous = existing as EventRow;

  const { data, error } = await supabase
    .from("events")
    .update(updates)
    .eq("id", eventId)
    .select()
    .single();

  if (error) {
    throw new Error(`Could not update event: ${error.message}`);
  }

  if (actorId) {
    const labels = labelsForUpdatedValues(previous, updates);
    if (labels.length) {
      await recordAuditLogEntry({
        entity: "event",
        entityId: eventId,
        action: "event.updated",
        actorId,
        meta: { changes: labels }
      });
    }
  }

  return data;
}

export async function appendEventVersion(eventId: string, actorId: string, versionData: Record<string, unknown>) {
  const supabase = await createSupabaseActionClient();

  const { data: latest } = await supabase
    .from("event_versions")
    .select("version")
    .eq("event_id", eventId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (latest?.version ?? 0) + 1;

  const statusValue = typeof versionData["status"] === "string" ? (versionData["status"] as string) : null;

  const { error } = await supabase.from("event_versions").insert({
    event_id: eventId,
    version: nextVersion,
    payload: versionData,
    submitted_at: statusValue === "submitted" ? new Date().toISOString() : null,
    submitted_by: actorId
  });

  if (error) {
    throw new Error(`Could not log event version: ${error.message}`);
  }
}

export async function recordApproval(params: {
  eventId: string;
  reviewerId: string;
  decision: EventStatus;
  feedback?: string | null;
}) {
  const supabase = await createSupabaseActionClient();

  const decision =
    params.decision === "needs_revisions" ? "needs_revisions" : params.decision === "rejected" ? "rejected" : "approved";

  const { error } = await supabase.from("approvals").insert({
    event_id: params.eventId,
    reviewer_id: params.reviewerId,
    decision,
    feedback_text: params.feedback ?? null
  });

  if (error) {
    throw new Error(`Could not record decision: ${error.message}`);
  }
}

export async function getStatusCounts(): Promise<Record<EventStatus, number>> {
  const supabase = await createSupabaseReadonlyClient();

  const { data, error } = await supabase.from("events").select("status");

  if (error) {
    throw new Error(`Could not load status counts: ${error.message}`);
  }

  const base: Record<EventStatus, number> = {
    draft: 0,
    submitted: 0,
    needs_revisions: 0,
    approved: 0,
    rejected: 0,
    completed: 0
  };

  for (const row of (data ?? []) as any[]) {
    const status = row.status as EventStatus;
    if (status in base) {
      base[status] += 1;
    }
  }

  return base;
}

export async function findConflicts(): Promise<Array<{ event: EventSummary; conflictingWith: EventSummary }>> {
  const supabase = await createSupabaseReadonlyClient();

  const { data, error } = await supabase
    .from("events")
    .select("*, venue:venues(id,name)")
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(`Could not load events for conflict check: ${error.message}`);
  }

  const events = ((data ?? []) as any[]).map((row) => ({
    ...row,
    venue: Array.isArray(row.venue) ? row.venue[0] : (row.venue as EventSummary["venue"])
  }));

  const conflicts: Array<{ event: EventSummary; conflictingWith: EventSummary }> = [];

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const first = events[i];
      const second = events[j];
      if (first.venue_id !== second.venue_id) {
        continue;
      }

      const firstSpaces = parseVenueSpaces(first.venue_space).map((space) => space.toLowerCase());
      const secondSpaces = parseVenueSpaces(second.venue_space).map((space) => space.toLowerCase());
      if (firstSpaces.length === 0 || secondSpaces.length === 0) {
        continue;
      }

      const firstSet = new Set(firstSpaces);
      const hasOverlap = secondSpaces.some((space) => firstSet.has(space));
      if (!hasOverlap) {
        continue;
      }

      const startsBeforeEnd = new Date(first.end_at) > new Date(second.start_at);
      const endsAfterStart = new Date(first.start_at) < new Date(second.end_at);

      if (startsBeforeEnd && endsAfterStart) {
        conflicts.push({ event: first, conflictingWith: second });
      }
    }
  }

  return conflicts;
}

export async function updateEventAssignee(eventId: string, assigneeId: string | null) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase
    .from("events")
    .update({ assignee_id: assigneeId })
    .eq("id", eventId);

  if (error) {
    throw new Error(`Could not update assignee: ${error.message}`);
  }
}
