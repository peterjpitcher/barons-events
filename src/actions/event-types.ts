"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createEventType, updateEventType, deleteEventType } from "@/lib/event-types";

type ActionResult = {
  success: boolean;
  message?: string;
};

const baseSchema = z.object({
  label: z.string().min(2, "Add an event type name").max(120)
});

export async function createEventTypeAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can create event types." };
  }

  const parsed = baseSchema.safeParse({
    label: formData.get("label")
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  try {
    await createEventType(parsed.data.label);
    revalidatePath("/settings");
    return { success: true, message: "Event type added." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not create the event type." };
  }
}

const updateSchema = baseSchema.extend({
  typeId: z.string().uuid()
});

export async function updateEventTypeAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can update event types." };
  }

  const parsed = updateSchema.safeParse({
    typeId: formData.get("typeId"),
    label: formData.get("label")
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  try {
    await updateEventType(parsed.data.typeId, parsed.data.label);
    revalidatePath("/settings");
    return { success: true, message: "Event type updated." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not update the event type." };
  }
}

const deleteSchema = z.object({
  typeId: z.string().uuid()
});

export async function deleteEventTypeAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can delete event types." };
  }

  const parsed = deleteSchema.safeParse({
    typeId: formData.get("typeId")
  });

  if (!parsed.success) {
    return { success: false, message: "Missing event type reference." };
  }

  try {
    await deleteEventType(parsed.data.typeId);
    revalidatePath("/settings");
    return { success: true, message: "Event type removed." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not delete the event type." };
  }
}
