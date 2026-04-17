"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createVenue, deleteVenue, updateVenue } from "@/lib/venues";
import { getFieldErrors } from "@/lib/form-errors";
import type { ActionResult } from "@/lib/types";
import { recordAuditLogEntry } from "@/lib/audit-log";

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
    recordAuditLogEntry({
      entity: "venue",
      entityId: typeof created === "object" && created !== null && "id" in created ? (created as { id: string }).id : "unknown",
      action: "venue.created",
      actorId: user.id,
      meta: { name: parsed.data.name }
    }).catch(() => {});
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
      meta: { name: parsed.data.name }
    }).catch(() => {});
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
