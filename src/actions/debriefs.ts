"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { upsertDebrief } from "@/lib/debriefs";
import { debriefSchema } from "@/lib/validation";
import { createSupabaseActionClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { sendPostEventDigestEmail } from "@/lib/notifications";

type ActionResult = {
  success: boolean;
  message?: string;
};

export async function submitDebriefAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "central_planner" && user.role !== "venue_manager") {
    return { success: false, message: "Only planners or venue managers can submit debriefs." };
  }

  const parsed = debriefSchema.safeParse({
    eventId: formData.get("eventId"),
    attendance: formData.get("attendance") ?? undefined,
    wetTakings: formData.get("wetTakings") ?? undefined,
    foodTakings: formData.get("foodTakings") ?? undefined,
    promoEffectiveness: formData.get("promoEffectiveness") ?? undefined,
    highlights: formData.get("highlights") ?? undefined,
    issues: formData.get("issues") ?? undefined
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  try {
    const values = parsed.data;
    const supabase = await createSupabaseActionClient();
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, created_by, status")
      .eq("id", values.eventId)
      .maybeSingle();

    if (eventError) {
      throw eventError;
    }
    if (!event) {
      return { success: false, message: "Event not found." };
    }

    if (user.role === "venue_manager" && event.created_by !== user.id) {
      return { success: false, message: "You can only submit debriefs for your own events." };
    }

    if (!["approved", "completed"].includes(event.status)) {
      return { success: false, message: "Debriefs are available after an event is approved." };
    }

    await upsertDebrief({
      eventId: values.eventId,
      submittedBy: user.id,
      attendance: values.attendance ?? null,
      wetTakings: values.wetTakings ?? null,
      foodTakings: values.foodTakings ?? null,
      promoEffectiveness: values.promoEffectiveness ?? null,
      highlights: values.highlights ?? null,
      issues: values.issues ?? null
    });

    let statusUpdated = false;

    try {
      const admin = createSupabaseServiceRoleClient();
      let updateQuery = admin.from("events").update({ status: "completed" }).eq("id", values.eventId);
      if (user.role === "venue_manager") {
        updateQuery = updateQuery.eq("created_by", user.id);
      }
      const { error: adminError } = await updateQuery;
      if (!adminError) {
        statusUpdated = true;
      } else {
        console.warn("Service-role status update failed; retrying with user client", adminError);
      }
    } catch (error) {
      console.warn("Service-role status update unavailable; retrying with user client", error);
    }

    if (!statusUpdated) {
      const { error: statusError } = await supabase
        .from("events")
        .update({ status: "completed" })
        .eq("id", values.eventId);

      if (statusError) {
        throw statusError;
      }
    }

    await sendPostEventDigestEmail(values.eventId);

    revalidatePath(`/events/${values.eventId}`);
    return { success: true, message: "Debrief saved." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not save the debrief." };
  }
}
