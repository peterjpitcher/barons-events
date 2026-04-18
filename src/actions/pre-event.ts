"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

  const idempotencyKey = (formData.get("idempotencyKey") as string) || randomUUID();
  const db = createSupabaseAdminClient();
   
  const { data, error } = await (db as any).rpc("create_multi_venue_event_proposals", {
    p_payload: {
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

  // Insert the approvals row with the decision + reason, then transition status.
   
  await (db as any).from("approvals").insert({
    event_id: parsed.data.eventId,
    reviewer_id: user.id,
    decision: "rejected",
    feedback_text: parsed.data.reason
  });

   
  const { error: statusError } = await (db as any)
    .from("events")
    .update({ status: "rejected" })
    .eq("id", parsed.data.eventId)
    .eq("status", "pending_approval");

  if (statusError) {
    console.error("preRejectEventAction status update failed:", statusError);
    return { success: false, message: "Could not reject the proposal." };
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
