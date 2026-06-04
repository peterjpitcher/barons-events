"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadEventEditContext } from "@/lib/events/edit-context";
import { canEditEvent } from "@/lib/roles";
import { canEditVenueLinkedPlanning } from "@/lib/visibility";
import { recordAuditLogEntry } from "@/lib/audit-log";
import type { ActionResult } from "@/lib/types";

const addInternalNoteSchema = z.object({
  parentType: z.enum(["event", "planning_item"]),
  parentId: z.string().uuid(),
  body: z.string().trim().min(1, "Add a note").max(5000, "Keep notes under 5000 characters")
});

async function canAddPlanningNote(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, parentId: string): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { data } = await (db as any)
    .from("planning_items")
    .select("id, venue_id, planning_item_venues(venue_id)")
    .eq("id", parentId)
    .maybeSingle();

  if (!data) return false;
  return canEditVenueLinkedPlanning(user, {
    venue_id: data.venue_id,
    planning_item_venues: data.planning_item_venues ?? []
  });
}

export async function addInternalNoteAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "You must be signed in." };
  }

  const parsed = addInternalNoteSchema.safeParse({
    parentType: formData.get("parentType"),
    parentId: formData.get("parentId"),
    body: formData.get("body")
  });

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Check the note."
    };
  }

  const { parentType, parentId, body } = parsed.data;

  if (parentType === "event") {
    const context = await loadEventEditContext(parentId);
    if (!context || !canEditEvent(user.role, user.id, user.venueId, context)) {
      return { success: false, message: "You don't have permission to add notes to this event." };
    }
  } else if (!(await canAddPlanningNote(user, parentId))) {
    return { success: false, message: "You don't have permission to add notes to this planning item." };
  }

  const db = createSupabaseAdminClient();
  const { error } = await (db as any)
    .from("internal_notes")
    .insert({
      parent_type: parentType,
      parent_id: parentId,
      body,
      created_by: user.id
    });

  if (error) {
    console.error("addInternalNoteAction failed:", error);
    return { success: false, message: "Could not add the note." };
  }

  const auditEntity = parentType === "event" ? "event" : "planning";
  await recordAuditLogEntry({
    entity: auditEntity,
    entityId: parentId,
    action: "note.created",
    actorId: user.id,
    meta: { parent_type: parentType }
  });

  if (parentType === "event") {
    revalidatePath(`/events/${parentId}`);
    revalidatePath("/events");
  } else {
    revalidatePath(`/planning/${parentId}`);
    revalidatePath("/planning");
  }

  return { success: true, message: "Note added." };
}
