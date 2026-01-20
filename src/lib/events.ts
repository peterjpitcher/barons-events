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
  | "cost_total"
  | "cost_details"
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
  cost_total: "Total cost",
  cost_details: "Cost details",
  goal_focus: "Goals",
  notes: "Notes"
};

function extractMissingColumn(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error) return null;
  if (error.code && error.code !== "PGRST204") return null;
  const message = error.message ?? "";
  const match = message.match(/Could not find the '([^']+)' column/i);
  return match?.[1] ?? null;
}

function normaliseOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normaliseOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

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

  const versions: any[] = Array.isArray(record.versions) ? record.versions : [];

  const latestVersion = versions.reduce((current: any | null, candidate: any) => {
    if (!candidate) return current;
    const candidateVersion = typeof candidate.version === "number" ? candidate.version : Number(candidate.version);
    if (!Number.isFinite(candidateVersion)) return current;
    if (!current) return candidate;
    const currentVersion = typeof current.version === "number" ? current.version : Number(current.version);
    if (!Number.isFinite(currentVersion)) return candidate;
    return candidateVersion > currentVersion ? candidate : current;
  }, null);

  const latestPayload =
    latestVersion && typeof latestVersion.payload === "object" && latestVersion.payload && !Array.isArray(latestVersion.payload)
      ? (latestVersion.payload as Record<string, unknown>)
      : null;

  const hasCostTotal = Object.prototype.hasOwnProperty.call(record, "cost_total");
  const hasCostDetails = Object.prototype.hasOwnProperty.call(record, "cost_details");

  const costTotal = hasCostTotal
    ? normaliseOptionalNumber(record.cost_total)
    : normaliseOptionalNumber(latestPayload?.cost_total) ?? normaliseOptionalNumber(latestPayload?.costTotal);

  const costDetails = hasCostDetails
    ? normaliseOptionalText(record.cost_details)
    : normaliseOptionalText(latestPayload?.cost_details as any) ?? normaliseOptionalText(latestPayload?.costDetails as any);

  return {
    ...record,
    venue: Array.isArray(record.venue) ? record.venue[0] : (record.venue as VenueRow),
    versions,
    approvals: Array.isArray(record.approvals) ? record.approvals : [],
    debrief: Array.isArray(record.debrief) ? record.debrief[0] ?? null : (record.debrief as DebriefRow | null),
    cost_total: costTotal,
    cost_details: costDetails
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
  costTotal?: number | null;
  costDetails?: string | null;
  goalFocus?: string | null;
  notes?: string | null;
  publicTitle?: string | null;
  publicTeaser?: string | null;
  publicDescription?: string | null;
  bookingUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoSlug?: string | null;
}): Promise<EventRow> {
  const supabase = await createSupabaseActionClient();

  const costDetails = normaliseOptionalText(payload.costDetails);

  const insertPayload: Record<string, unknown> = {
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
    public_title: payload.publicTitle ?? null,
    public_teaser: payload.publicTeaser ?? null,
    public_description: payload.publicDescription ?? null,
    booking_url: payload.bookingUrl ?? null,
    seo_title: payload.seoTitle ?? null,
    seo_description: payload.seoDescription ?? null,
    seo_slug: payload.seoSlug ?? null,
    assignee_id: payload.createdBy
  };

  if (payload.costTotal !== null && payload.costTotal !== undefined) {
    insertPayload["cost_total"] = payload.costTotal;
  }

  if (costDetails) {
    insertPayload["cost_details"] = costDetails;
  }

  let data: EventRow | null = null;
  let insertError: { code?: string; message: string } | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await supabase.from("events").insert(insertPayload as any).select().single();
    if (!result.error) {
      data = result.data as EventRow;
      insertError = null;
      break;
    }

    insertError = result.error;
    const missingColumn = extractMissingColumn(result.error);
    if (!missingColumn || !(missingColumn in insertPayload)) {
      break;
    }

    delete insertPayload[missingColumn];
  }

  if (!data || insertError) {
    throw new Error(`Could not create event: ${insertError?.message ?? "Unknown error"}`);
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
      cost_total: payload.costTotal ?? data.cost_total ?? null,
      cost_details: costDetails ?? data.cost_details ?? null,
      public_title: payload.publicTitle ?? data.public_title ?? null,
      public_teaser: payload.publicTeaser ?? data.public_teaser ?? null,
      public_description: payload.publicDescription ?? data.public_description ?? null,
      booking_url: payload.bookingUrl ?? data.booking_url ?? null,
      seo_title: payload.seoTitle ?? data.seo_title ?? null,
      seo_description: payload.seoDescription ?? data.seo_description ?? null,
      seo_slug: payload.seoSlug ?? data.seo_slug ?? null,
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

  const updatePayload: Record<string, unknown> = { ...updates };

  if ("cost_details" in updatePayload) {
    const normalised = normaliseOptionalText(updatePayload["cost_details"] as any);
    updatePayload["cost_details"] = normalised;
  }

  let data: EventRow | null = null;
  let updateError: { code?: string; message: string } | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await supabase
      .from("events")
      .update(updatePayload as any)
      .eq("id", eventId)
      .select()
      .single();

    if (!result.error) {
      data = result.data as EventRow;
      updateError = null;
      break;
    }

    updateError = result.error;
    const missingColumn = extractMissingColumn(result.error);
    if (!missingColumn || !(missingColumn in updatePayload)) {
      break;
    }

    delete updatePayload[missingColumn];
  }

  if (!data || updateError) {
    throw new Error(`Could not update event: ${updateError?.message ?? "Unknown error"}`);
  }

  if (actorId) {
    const labels = labelsForUpdatedValues(previous, updatePayload as Partial<EventRow>);
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
