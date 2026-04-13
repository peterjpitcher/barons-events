"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  createServiceType,
  updateServiceType,
  deleteServiceType,
  upsertVenueOpeningHours,
  createOpeningOverride,
  updateOpeningOverride,
  deleteOpeningOverride,
  type UpsertHoursInput
} from "@/lib/opening-hours";
import { getFieldErrors } from "@/lib/form-errors";
import type { ActionResult } from "@/lib/types";

// ─── Service Types ────────────────────────────────────────────────────────────

const serviceTypeSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80, "Name must be 80 characters or fewer")
});

export async function createServiceTypeAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can manage service types." };
  }

  const parsed = serviceTypeSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { success: false, message: "Check the highlighted fields.", fieldErrors: getFieldErrors(parsed.error) };
  }

  try {
    await createServiceType(parsed.data.name);
    revalidatePath("/settings");
    revalidatePath("/venues");
    return { success: true, message: "Service type added." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not save the service type right now." };
  }
}

export async function updateServiceTypeAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can manage service types." };
  }

  const id = formData.get("typeId");
  if (typeof id !== "string" || !id) {
    return { success: false, message: "Missing service type reference." };
  }

  const parsed = serviceTypeSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { success: false, message: "Check the highlighted fields.", fieldErrors: getFieldErrors(parsed.error) };
  }

  try {
    await updateServiceType(id, parsed.data.name);
    revalidatePath("/settings");
    revalidatePath("/venues");
    return { success: true, message: "Service type updated." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not update the service type right now." };
  }
}

export async function deleteServiceTypeAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can manage service types." };
  }

  const id = formData.get("typeId");
  if (typeof id !== "string" || !id) {
    return { success: false, message: "Missing service type reference." };
  }

  try {
    await deleteServiceType(id);
    revalidatePath("/settings");
    revalidatePath("/venues");
    return { success: true, message: "Service type removed." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not remove the service type right now." };
  }
}

// ─── Weekly Hours ─────────────────────────────────────────────────────────────

export async function upsertVenueOpeningHoursAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can manage opening hours." };
  }

  const venueId = formData.get("venueId");
  if (typeof venueId !== "string" || !venueId) {
    return { success: false, message: "Missing venue reference." };
  }

  // Parse rows encoded as JSON in a single hidden field
  const rowsRaw = formData.get("rows");
  if (typeof rowsRaw !== "string") {
    return { success: false, message: "Invalid data format." };
  }

  let rows: UpsertHoursInput[];
  try {
    rows = JSON.parse(rowsRaw) as UpsertHoursInput[];
  } catch {
    return { success: false, message: "Could not parse opening hours data." };
  }

  try {
    await upsertVenueOpeningHours(venueId, rows);
    revalidatePath(`/venues/${venueId}/opening-hours`);
    return { success: true, message: "Opening hours saved." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not save opening hours right now." };
  }
}

export async function upsertMultiVenueOpeningHoursAction(
  venueIds: string[],
  rows: UpsertHoursInput[]
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can manage opening hours." };
  }

  if (venueIds.length === 0) {
    return { success: false, message: "Select at least one venue." };
  }

  try {
    await Promise.all(venueIds.map((venueId) => upsertVenueOpeningHours(venueId, rows)));
    venueIds.forEach((venueId) => revalidatePath(`/venues/${venueId}/opening-hours`));
    revalidatePath("/opening-hours");
    return {
      success: true,
      message: venueIds.length > 1 ? `Opening hours saved for ${venueIds.length} venues.` : "Opening hours saved."
    };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not save opening hours right now." };
  }
}

// ─── Overrides ────────────────────────────────────────────────────────────────

const overrideSchema = z.object({
  override_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
  service_type_id: z.string().uuid("Invalid service type"),
  open_time: z.string().nullable().optional(),
  close_time: z.string().nullable().optional(),
  is_closed: z.boolean(),
  note: z.string().max(500).nullable().optional(),
  venue_ids: z.array(z.string().uuid()).min(1, "Select at least one venue")
});

export async function createOpeningOverrideAction(payload: {
  override_date: string;
  service_type_id: string;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
  note: string | null;
  venue_ids: string[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can manage opening overrides." };
  }

  const parsed = overrideSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, message: "Check the highlighted fields.", fieldErrors: getFieldErrors(parsed.error) };
  }

  try {
    await createOpeningOverride({ ...parsed.data, created_by: user.id, note: parsed.data.note ?? null, open_time: parsed.data.open_time ?? null, close_time: parsed.data.close_time ?? null });
    revalidatePath("/venues");
    revalidatePath("/opening-hours");
    return { success: true, message: "Override added." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not save the override right now." };
  }
}

export async function updateOpeningOverrideAction(
  id: string,
  payload: {
    override_date: string;
    service_type_id: string;
    open_time: string | null;
    close_time: string | null;
    is_closed: boolean;
    note: string | null;
    venue_ids: string[];
  }
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can manage opening overrides." };
  }

  const parsed = overrideSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, message: "Check the highlighted fields.", fieldErrors: getFieldErrors(parsed.error) };
  }

  try {
    await updateOpeningOverride(id, { ...parsed.data, note: parsed.data.note ?? null, open_time: parsed.data.open_time ?? null, close_time: parsed.data.close_time ?? null });
    revalidatePath("/venues");
    revalidatePath("/opening-hours");
    return { success: true, message: "Override updated." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not update the override right now." };
  }
}

export async function deleteOpeningOverrideAction(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can manage opening overrides." };
  }

  try {
    await deleteOpeningOverride(id);
    revalidatePath("/venues");
    revalidatePath("/opening-hours");
    return { success: true, message: "Override removed." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not remove the override right now." };
  }
}
