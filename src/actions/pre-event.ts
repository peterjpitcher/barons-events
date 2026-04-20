"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { canProposeEvents } from "@/lib/roles";
import { recordAuditLogEntry } from "@/lib/audit-log";
import type { ActionResult } from "@/lib/types";

/**
 * Wave 3 — pre-event approval server actions.
 *
 * proposeEventAction: venue manager (or administrator) submits a
 * bare-bones proposal for multiple venues. Calls
 * create_multi_venue_event_proposals RPC. No event_type / venue_space /
 * end_at required; no SOP generated until approval.
 *
 * preApproveEventAction: administrator only. Calls
 * pre_approve_event_proposal RPC (transitional status, planning item
 * creation + SOP generation).
 *
 * preRejectEventAction: administrator only. Records rejection with
 * reason in approvals and transitions status to 'rejected'.
 */

const proposalSchema = z.object({
  title: z.string().min(1, "Add a title").max(200),
  startAt: z.string().min(1, "Pick a start date & time"),
  notes: z.string().min(1, "Add a short description").max(2000),
  venueIds: z
    .array(z.string().uuid())
    .min(1, "Pick at least one venue")
    .max(20, "Too many venues selected")
});

export async function proposeEventAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const venueIds = formData.getAll("venueIds").filter((v): v is string => typeof v === "string" && v.length > 0);
  const parsed = proposalSchema.safeParse({
    title: formData.get("title"),
    startAt: formData.get("startAt"),
    notes: formData.get("notes"),
    venueIds
  });

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Check the highlighted fields."
    };
  }

  if (!canProposeEvents(user.role)) {
    return { success: false, message: "You don't have permission to propose events." };
  }

  // WF-003 v3.1: pre-validate venue IDs with explicit error handling so a DB
  // outage surfaces as a retryable failure rather than a user-facing "venue
  // not available" message.
  const supabase = await createSupabaseActionClient();
  const { data: validVenues, error: venueErr } = await supabase
    .from("venues")
    .select("id")
    .in("id", parsed.data.venueIds)
    .is("deleted_at", null);
  if (venueErr) {
    console.error("proposeEventAction: venue validation query failed", { error: venueErr });
    return { success: false, message: "We couldn't verify venues right now. Please try again." };
  }
  const validIds = new Set((validVenues ?? []).map((v) => v.id));
  if (parsed.data.venueIds.some((id) => !validIds.has(id))) {
    return { success: false, message: "One or more selected venues are not available." };
  }

  const idempotencyKey = (formData.get("idempotencyKey") as string) || randomUUID();
  const db = createSupabaseAdminClient();

  const { data, error } = await (db as any).rpc("create_multi_venue_event_proposals", {
    p_payload: {
      // SEC-001 v3.1: authoritative created_by from the authenticated session;
      // never trust a client-supplied value, even if the RPC later checks role.
      created_by: user.id,
      venue_ids: parsed.data.venueIds,
      title: parsed.data.title,
      start_at: parsed.data.startAt,
      notes: parsed.data.notes
    },
    p_idempotency_key: idempotencyKey
  });

  if (error) {
    console.error("proposeEventAction RPC failed:", error);
    return { success: false, message: error.message ?? "Could not submit the proposal." };
  }

  revalidatePath("/events");
  const venueCount = parsed.data.venueIds.length;
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
