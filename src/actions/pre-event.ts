"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { canProposeEvents, canProposeForVenues } from "@/lib/roles";
import { recordAuditLogEntry } from "@/lib/audit-log";
import type { ActionResult } from "@/lib/types";
import { callProposeEventDraftRpc } from "@/lib/events/save-rpc";
import { logEventAction } from "@/lib/observability/event-action-log";
import { normaliseEventDateTimeForStorage } from "@/lib/datetime";
import { sendProposalSubmittedEmailOnce } from "@/lib/notifications";

/**
 * Wave 3 — pre-event approval server actions.
 *
 * proposeEventAction: submits a bare-bones proposal for multiple venues. Calls
 * create_multi_venue_event_proposals RPC. No event_type / venue_space required;
 * no SOP generated until approval. end_at IS required as of 2026-08-25, so the
 * proposal carries a real finish time rather than one invented at approval.
 *
 * preApproveEventAction: administrator only. Calls
 * pre_approve_event_proposal RPC (transitional status, planning item
 * creation + SOP generation).
 *
 * preRejectEventAction: administrator only. Records rejection with
 * reason in approvals and transitions status to 'rejected'.
 */

const proposalSchema = z
  .object({
    title: z.string().min(1, "Add a title").max(200),
    startAt: z.string().min(1, "Pick a start date & time"),
    endAt: z.string().min(1, "Pick an end date & time"),
    notes: z.string().min(1, "Add a short description").max(2000),
    venueIds: z
      .array(z.string().uuid())
      .min(1, "Pick at least one venue")
      .max(20, "Too many venues selected")
  })
  .superRefine((values, ctx) => {
    // Mirrors the events_end_after_start CHECK constraint exactly: strictly
    // greater, not >=. A looser rule here would let the database reject the row
    // instead, and both proposal paths surface raw Postgres text to the user.
    // Compared as datetime-local strings, which sort correctly because they are
    // fixed-width and share a timezone.
    if (values.endAt <= values.startAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The end time must be after the start time",
        path: ["endAt"]
      });
    }
  });

function shouldUseSaveEventRpc(): boolean {
  return process.env.EVENT_SAVE_USE_RPC === "true";
}

function readOperationId(formData: FormData): string {
  const raw = formData.get("operation_id");
  if (typeof raw === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return raw;
  }
  return randomUUID();
}

function readProposalIdempotencyKey(formData: FormData): string {
  const raw = formData.get("idempotency_key") ?? formData.get("idempotencyKey");
  if (typeof raw === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return raw;
  }
  return randomUUID();
}

function proposalEventIdFromRpcResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const eventId = (data as { event_id?: unknown }).event_id;
  return typeof eventId === "string" ? eventId : null;
}

export async function proposeEventAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const startedAt = Date.now();
  const operationId = readOperationId(formData);
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in.", operationId };

  // Deduplicated: event_venues has a composite primary key, so a repeated id
  // would reach Postgres and come back as a raw constraint violation.
  const venueIds = Array.from(
    new Set(formData.getAll("venueIds").filter((v): v is string => typeof v === "string" && v.length > 0))
  );
  const parsed = proposalSchema.safeParse({
    title: formData.get("title"),
    startAt: formData.get("startAt"),
    endAt: formData.get("endAt"),
    notes: formData.get("notes"),
    venueIds
  });

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Check the highlighted fields.",
      operationId
    };
  }

  if (!canProposeEvents(user.role)) {
    return { success: false, message: "You don't have permission to propose events.", operationId };
  }

  // WF-003 v3.1: pre-validate venue IDs with explicit error handling so a DB
  // outage surfaces as a retryable failure rather than a user-facing "venue
  // not available" message.
  const supabase = await createSupabaseActionClient();
  // is_internal is selected too, because the venue rule below has to know
  // whether a requested venue is a head-office row. Filtering the picker alone
  // is not authorisation: this action is reachable directly.
  const { data: validVenues, error: venueErr } = await supabase
    .from("venues")
    .select("id, is_internal")
    .in("id", parsed.data.venueIds);
  if (venueErr) {
    console.error(`[event-propose:${operationId.slice(0, 8)}] Venue validation query failed`, { error: venueErr });
    return { success: false, message: "We couldn't verify venues right now. Please try again.", operationId };
  }
  const validIds = new Set((validVenues ?? []).map((v) => v.id));
  if (parsed.data.venueIds.some((id) => !validIds.has(id))) {
    return { success: false, message: "One or more selected venues are not available.", operationId };
  }

  // The live proposal path calls the RPC with the service-role key, which
  // bypasses RLS and the events write trigger, so this is the only place the
  // venue rule is actually enforced for it.
  const venueOptions = (validVenues ?? []).map((v) => ({
    id: v.id,
    isInternal: Boolean((v as { is_internal?: boolean }).is_internal)
  }));
  if (!canProposeForVenues(user.role, user.venueId, parsed.data.venueIds, venueOptions)) {
    return {
      success: false,
      message: user.venueId
        ? "You can only propose events for your assigned venue."
        : "One or more selected venues are not available.",
      operationId
    };
  }

  const idempotencyKey = readProposalIdempotencyKey(formData);

  // normaliseEventDateTimeForStorage throws on a daylight-saving spring-forward
  // gap time (a wall clock that never happens). Uncaught, that surfaced as a
  // server-action crash rather than a field error.
  let startAtIso: string;
  let endAtIso: string;
  try {
    startAtIso = normaliseEventDateTimeForStorage(parsed.data.startAt);
    endAtIso = normaliseEventDateTimeForStorage(parsed.data.endAt);
  } catch (error) {
    console.error(`[event-propose:${operationId.slice(0, 8)}] Date normalisation failed`, error);
    return {
      success: false,
      message: "That date and time does not exist, the clocks change that night. Pick another time.",
      operationId
    };
  }

  if (shouldUseSaveEventRpc()) {
    const result = await callProposeEventDraftRpc({
      payload: {
        venue_ids: parsed.data.venueIds,
        title: parsed.data.title,
        start_at: startAtIso,
        end_at: endAtIso,
        notes: parsed.data.notes
      },
      idempotencyKey,
      operationId
    });

    if (result.success) {
      revalidatePath("/events");
      if (result.eventId) {
        sendProposalSubmittedEmailOnce({
          eventId: result.eventId,
          idempotencyKey,
          userId: user.id
        }).catch((notificationError) => {
          console.warn(`[event-propose:${operationId.slice(0, 8)}] Proposal notification failed`, notificationError);
        });
      }
    }

    logEventAction({
      operation_id: result.operationId ?? operationId,
      user_id: user.id,
      action: "propose_event_draft",
      duration_ms: Date.now() - startedAt,
      outcome: result.success ? "success" : "failure",
      warning_count: result.warnings?.length ?? 0
    });

    return result;
  }

  const db = createSupabaseAdminClient();

  const { data, error } = await db.rpc("create_multi_venue_event_proposals", {
    p_payload: {
      // SEC-001 v3.1: authoritative created_by from the authenticated session;
      // never trust a client-supplied value, even if the RPC later checks role.
      created_by: user.id,
      venue_ids: parsed.data.venueIds,
      title: parsed.data.title,
      start_at: startAtIso,
      end_at: endAtIso,
      notes: parsed.data.notes
    },
    p_idempotency_key: idempotencyKey
  });

  if (error) {
    // Log the detail, show a sentence. The RPC raises exceptions whose text is
    // raw Postgres, which is meaningless to the user and leaks schema detail.
    console.error(`[event-propose:${operationId.slice(0, 8)}] create_multi_venue_event_proposals RPC failed:`, error);
    return { success: false, message: "Could not submit the proposal. Please try again.", operationId };
  }

  revalidatePath("/events");
  const venueCount = parsed.data.venueIds.length;
  const eventId = proposalEventIdFromRpcResponse(data);
  if (eventId) {
    sendProposalSubmittedEmailOnce({
      eventId,
      idempotencyKey,
      userId: user.id
    }).catch((notificationError) => {
      console.warn(`[event-propose:${operationId.slice(0, 8)}] Proposal notification failed`, notificationError);
    });
  }
  return {
    success: true,
    message:
      venueCount === 1
        ? "Proposal submitted."
        : `Proposal submitted for ${venueCount} venues.`,
    // Expose batch data for UI use if needed. We omit it from the type for
    // simplicity — the toast + redirect is the primary success signal.
    ...(data ? { meta: data } : {})
  } as ActionResult;
}

const approveSchema = z.object({
  eventId: z.string().uuid()
});

export async function preApproveEventAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can approve proposals." };
  }

  const parsed = approveSchema.safeParse({ eventId: formData.get("eventId") });
  if (!parsed.success) {
    return { success: false, message: "Missing event reference." };
  }

  const db = createSupabaseAdminClient();
   
  const { error } = await (db as any).rpc("pre_approve_event_proposal", {
    p_event_id: parsed.data.eventId,
    p_admin_id: user.id
  });

  if (error) {
    console.error("preApproveEventAction RPC failed:", error);
    return { success: false, message: error.message ?? "Could not approve the proposal." };
  }

  revalidatePath("/events");
  revalidatePath(`/events/${parsed.data.eventId}`);
  return { success: true, message: "Proposal approved. The creator can now complete the details." };
}

const rejectSchema = z.object({
  eventId: z.string().uuid(),
  reason: z.string().min(1, "Give a reason").max(1000)
});

export async function preRejectEventAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can reject proposals." };
  }

  const parsed = rejectSchema.safeParse({
    eventId: formData.get("eventId"),
    reason: formData.get("reason")
  });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the rejection reason." };
  }

  const db = createSupabaseAdminClient();

  // Atomic: the reject_event_proposal RPC inserts the approvals row and
  // transitions the event status in a single transaction, validating the
  // admin role server-side.

  const { error } = await (db as any).rpc("reject_event_proposal", {
    p_event_id: parsed.data.eventId,
    p_admin_id: user.id,
    p_reason: parsed.data.reason
  });
  if (error) {
    console.error("preRejectEventAction RPC failed:", error);
    return { success: false, message: error.message ?? "Could not reject the proposal." };
  }

  await recordAuditLogEntry({
    entity: "event",
    entityId: parsed.data.eventId,
    action: "event.pre_rejected",
    actorId: user.id,
    meta: { reason: parsed.data.reason }
  });

  revalidatePath("/events");
  revalidatePath(`/events/${parsed.data.eventId}`);
  return { success: true, message: "Proposal rejected." };
}
