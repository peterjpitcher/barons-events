"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createVenue, deleteVenue, updateVenue } from "@/lib/venues";
import { getFieldErrors } from "@/lib/form-errors";
import type { ActionResult } from "@/lib/types";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Queue a cascade backfill row so open per-venue SOP masters get a child
 * spawned for this venue. Called on venue create and on category change.
 * Safe to call even when an unprocessed row already exists — the partial
 * unique index prevents duplicates.
 */
async function queueCascadeBackfill(venueId: string): Promise<void> {
  try {
    const db = createSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any)
      .from("pending_cascade_backfill")
      .insert({ venue_id: venueId });
    if (error && error.code !== "23505") {
      console.warn("queueCascadeBackfill failed", venueId, error);
    }
  } catch (err) {
    console.warn("queueCascadeBackfill threw", venueId, err);
  }
}

const uuidOrUndefined = z.preprocess(
  (value) => {
    if (typeof value === "string" && value.trim().length === 0) {
      return undefined;
    }
    return value;
  },
  z.string().uuid().optional()
);

const venueSchema = z.object({
  venueId: z.string().uuid().optional(),
  name: z.string().min(2, "Add a venue name"),
  defaultApproverId: uuidOrUndefined,
  defaultManagerResponsibleId: uuidOrUndefined,
  googleReviewUrl: z.string().url("Enter a valid URL").optional().or(z.literal("")),
  category: z.enum(["pub", "cafe"]).optional()
});

export async function createVenueAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can create venues." };
  }

  const parsed = venueSchema.safeParse({
    name: typeof formData.get("name") === "string" ? formData.get("name") : "",
    defaultApproverId: typeof formData.get("defaultApproverId") === "string" ? formData.get("defaultApproverId") : "",
    defaultManagerResponsibleId: typeof formData.get("defaultManagerResponsibleId") === "string" ? formData.get("defaultManagerResponsibleId") : "",
    category: typeof formData.get("category") === "string" ? formData.get("category") : "pub"
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Check the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error)
    };
  }

  try {
    const created = await createVenue({
      name: parsed.data.name,
      defaultApproverId: parsed.data.defaultApproverId ?? null,
      defaultManagerResponsibleId: parsed.data.defaultManagerResponsibleId || null,
      category: parsed.data.category ?? "pub"
    });
    const newVenueId =
      typeof created === "object" && created !== null && "id" in created
        ? (created as { id: string }).id
        : "unknown";
    recordAuditLogEntry({
      entity: "venue",
      entityId: newVenueId,
      action: "venue.created",
      actorId: user.id,
      meta: { name: parsed.data.name, category: parsed.data.category ?? "pub" }
    }).catch(() => {});
    if (newVenueId !== "unknown") {
      await queueCascadeBackfill(newVenueId);
    }
    revalidatePath("/venues");
    return { success: true, message: "Venue added." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not save the venue right now." };
  }
}

export async function updateVenueAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can update venues." };
  }

  const parsed = venueSchema.safeParse({
    venueId: formData.get("venueId"),
    name: typeof formData.get("name") === "string" ? formData.get("name") : "",
    defaultApproverId: typeof formData.get("defaultApproverId") === "string" ? formData.get("defaultApproverId") : "",
    defaultManagerResponsibleId: typeof formData.get("defaultManagerResponsibleId") === "string" ? formData.get("defaultManagerResponsibleId") : "",
    googleReviewUrl: typeof formData.get("googleReviewUrl") === "string" ? formData.get("googleReviewUrl") : "",
    category: typeof formData.get("category") === "string" ? formData.get("category") : undefined
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Check the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error)
    };
  }
  if (!parsed.data.venueId) {
    return { success: false, message: "Missing venue reference." };
  }

  try {
    // Read existing category so we can detect a transition.
    const adminClient = createSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (adminClient as any)
      .from("venues")
      .select("category")
      .eq("id", parsed.data.venueId)
      .maybeSingle();
    const previousCategory: string | null = existing?.category ?? null;

    await updateVenue(parsed.data.venueId, {
      name: parsed.data.name,
      defaultApproverId: parsed.data.defaultApproverId ?? null,
      defaultManagerResponsibleId: parsed.data.defaultManagerResponsibleId || null,
      googleReviewUrl: parsed.data.googleReviewUrl || null,
      category: parsed.data.category
    });
    recordAuditLogEntry({
      entity: "venue",
      entityId: parsed.data.venueId,
      action: "venue.updated",
      actorId: user.id,
      meta: { name: parsed.data.name, category: parsed.data.category ?? previousCategory }
    }).catch(() => {});

    // Log category change + queue a cascade backfill so newly matching
    // per-venue masters pick up this venue.
    if (parsed.data.category && previousCategory && parsed.data.category !== previousCategory) {
      recordAuditLogEntry({
        entity: "venue",
        entityId: parsed.data.venueId,
        action: "venue.category_changed",
        actorId: user.id,
        meta: { from: previousCategory, to: parsed.data.category }
      }).catch(() => {});
      await queueCascadeBackfill(parsed.data.venueId);
    }

    revalidatePath("/venues");
    return { success: true, message: "Venue updated." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not update the venue right now." };
  }
}

const deleteSchema = z.object({
  venueId: z.string().uuid()
});

export async function deleteVenueAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can delete venues." };
  }

  const parsed = deleteSchema.safeParse({
    venueId: formData.get("venueId")
  });

  if (!parsed.success) {
    return { success: false, message: "Missing venue reference." };
  }

  try {
    await deleteVenue(parsed.data.venueId);
    recordAuditLogEntry({
      entity: "venue",
      entityId: parsed.data.venueId,
      action: "venue.deleted",
      actorId: user.id,
      meta: {}
    }).catch(() => {});
    revalidatePath("/venues");
    return { success: true, message: "Venue removed." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not delete the venue right now." };
  }
}
