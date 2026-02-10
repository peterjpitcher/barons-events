"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createVenue, deleteVenue, updateVenue } from "@/lib/venues";
import { getFieldErrors, type FieldErrors } from "@/lib/form-errors";

type ActionResult = {
  success: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
};

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
  defaultReviewerId: uuidOrUndefined
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
    name: typeof formData.get("name") === "string" ? formData.get("name") : "",
    defaultReviewerId: typeof formData.get("defaultReviewerId") === "string" ? formData.get("defaultReviewerId") : ""
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Check the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error)
    };
  }

  try {
    await createVenue({
      name: parsed.data.name,
      defaultReviewerId: parsed.data.defaultReviewerId ?? null
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
    name: typeof formData.get("name") === "string" ? formData.get("name") : "",
    defaultReviewerId: typeof formData.get("defaultReviewerId") === "string" ? formData.get("defaultReviewerId") : ""
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
      defaultReviewerId: parsed.data.defaultReviewerId ?? null
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
