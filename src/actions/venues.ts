"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  createVenue,
  updateVenue,
  deleteVenue,
  createVenueArea,
  updateVenueArea,
  deleteVenueArea
} from "@/lib/venues";

type ActionResult = {
  success: boolean;
  message?: string;
};

const venueSchema = z.object({
  venueId: z.string().uuid().optional(),
  name: z.string().min(2, "Add a venue name"),
  address: z.string().max(240).optional()
});

export async function createVenueAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can create venues." };
  }

  const parsed = venueSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address")
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  try {
    await createVenue({
      name: parsed.data.name,
      address: parsed.data.address ?? null
    });
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
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can update venues." };
  }

  const parsed = venueSchema.safeParse({
    venueId: formData.get("venueId"),
    name: formData.get("name"),
    address: formData.get("address")
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  if (!parsed.data.venueId) {
    return { success: false, message: "Missing venue reference." };
  }

  try {
    await updateVenue(parsed.data.venueId, {
      name: parsed.data.name,
      address: parsed.data.address ?? null
    });
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
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can delete venues." };
  }

  const parsed = deleteSchema.safeParse({
    venueId: formData.get("venueId")
  });

  if (!parsed.success) {
    return { success: false, message: "Missing venue reference." };
  }

  try {
    await deleteVenue(parsed.data.venueId);
    revalidatePath("/venues");
    return { success: true, message: "Venue removed." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not delete the venue right now." };
  }
}

const areaSchema = z.object({
  areaId: z.string().uuid().optional(),
  venueId: z.string().uuid(),
  name: z.string().min(2, "Add an area name"),
  capacity: z.union([z.coerce.number().int().min(0).max(10000), z.undefined(), z.null()]).optional()
});

export async function createVenueAreaAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can create areas." };
  }

  const parsed = areaSchema.safeParse({
    venueId: formData.get("venueId"),
    name: formData.get("name"),
    capacity: formData.get("capacity")
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  try {
    await createVenueArea({
      venueId: parsed.data.venueId,
      name: parsed.data.name,
      capacity: parsed.data.capacity ?? null
    });
    revalidatePath("/venues");
    return { success: true, message: "Area added." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not create the area right now." };
  }
}

export async function updateVenueAreaAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can update areas." };
  }

  const parsed = areaSchema.safeParse({
    areaId: formData.get("areaId"),
    venueId: formData.get("venueId"),
    name: formData.get("name"),
    capacity: formData.get("capacity")
  });

  if (!parsed.success || !parsed.data.areaId) {
    return { success: false, message: parsed.success ? "Missing area reference." : parsed.error.issues[0]?.message ?? "Check the details." };
  }

  try {
    await updateVenueArea(parsed.data.areaId, {
      name: parsed.data.name,
      capacity: parsed.data.capacity ?? null
    });
    revalidatePath("/venues");
    return { success: true, message: "Area updated." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not update the area right now." };
  }
}

const deleteAreaSchema = z.object({
  areaId: z.string().uuid()
});

export async function deleteVenueAreaAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can delete areas." };
  }

  const parsed = deleteAreaSchema.safeParse({
    areaId: formData.get("areaId")
  });

  if (!parsed.success) {
    return { success: false, message: "Missing area reference." };
  }

  try {
    await deleteVenueArea(parsed.data.areaId);
    revalidatePath("/venues");
    return { success: true, message: "Area removed." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not delete the area right now." };
  }
}
