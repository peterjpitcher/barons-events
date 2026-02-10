"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { upsertDebrief } from "@/lib/debriefs";
import { debriefSchema } from "@/lib/validation";
import { createSupabaseActionClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { sendPostEventDigestEmail } from "@/lib/notifications";
import { recordAuditLogEntry } from "@/lib/audit-log";

type ActionResult = {
  success: boolean;
  message?: string;
};

function normaliseText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function changedDebriefFields(previous: Record<string, unknown> | null, next: Record<string, unknown>): string[] {
  const fields: Array<[key: string, label: string]> = [
    ["attendance", "Attendance"],
    ["baseline_attendance", "Baseline attendance"],
    ["wet_takings", "Event wet takings"],
    ["food_takings", "Event food takings"],
    ["baseline_wet_takings", "Baseline wet takings"],
    ["baseline_food_takings", "Baseline food takings"],
    ["promo_effectiveness", "Promo effectiveness"],
    ["highlights", "Wins"],
    ["issues", "Issues"],
    ["guest_sentiment_notes", "Guest sentiment"],
    ["operational_notes", "Operational notes"],
    ["would_book_again", "Would book again"],
    ["next_time_actions", "Next-time actions"]
  ];
  const changes: string[] = [];
  fields.forEach(([key, label]) => {
    const previousValue = previous?.[key] ?? null;
    const nextValue = next[key] ?? null;
    if (previousValue !== nextValue) {
      changes.push(label);
    }
  });
  return changes;
}

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
    baselineAttendance: formData.get("baselineAttendance") ?? undefined,
    wetTakings: formData.get("wetTakings") ?? undefined,
    foodTakings: formData.get("foodTakings") ?? undefined,
    baselineWetTakings: formData.get("baselineWetTakings") ?? undefined,
    baselineFoodTakings: formData.get("baselineFoodTakings") ?? undefined,
    promoEffectiveness: formData.get("promoEffectiveness") ?? undefined,
    highlights: formData.get("highlights") ?? undefined,
    issues: formData.get("issues") ?? undefined,
    guestSentimentNotes: formData.get("guestSentimentNotes") ?? undefined,
    operationalNotes: formData.get("operationalNotes") ?? undefined,
    wouldBookAgain: formData.get("wouldBookAgain") ?? undefined,
    nextTimeActions: formData.get("nextTimeActions") ?? undefined
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

    const { data: previousDebriefData } = await supabase
      .from("debriefs")
      .select("*")
      .eq("event_id", values.eventId)
      .maybeSingle();

    const savedDebrief = await upsertDebrief({
      eventId: values.eventId,
      submittedBy: user.id,
      attendance: values.attendance ?? null,
      baselineAttendance: values.baselineAttendance ?? null,
      wetTakings: values.wetTakings ?? null,
      foodTakings: values.foodTakings ?? null,
      baselineWetTakings: values.baselineWetTakings ?? null,
      baselineFoodTakings: values.baselineFoodTakings ?? null,
      promoEffectiveness: values.promoEffectiveness ?? null,
      highlights: values.highlights ?? null,
      issues: values.issues ?? null,
      guestSentimentNotes: values.guestSentimentNotes ?? null,
      operationalNotes: values.operationalNotes ?? null,
      wouldBookAgain: values.wouldBookAgain ?? null,
      nextTimeActions: values.nextTimeActions ?? null
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

    const debriefMeta = {
      attendance: savedDebrief.attendance,
      baseline_attendance: savedDebrief.baseline_attendance,
      wet_takings: savedDebrief.wet_takings,
      food_takings: savedDebrief.food_takings,
      baseline_wet_takings: savedDebrief.baseline_wet_takings,
      baseline_food_takings: savedDebrief.baseline_food_takings,
      promo_effectiveness: savedDebrief.promo_effectiveness,
      highlights: normaliseText(savedDebrief.highlights),
      issues: normaliseText(savedDebrief.issues),
      guest_sentiment_notes: normaliseText(savedDebrief.guest_sentiment_notes),
      operational_notes: normaliseText(savedDebrief.operational_notes),
      would_book_again: savedDebrief.would_book_again,
      next_time_actions: normaliseText(savedDebrief.next_time_actions),
      sales_uplift_value: savedDebrief.sales_uplift_value,
      sales_uplift_percent: savedDebrief.sales_uplift_percent
    };
    const changedFields = changedDebriefFields(
      (previousDebriefData as Record<string, unknown> | null) ?? null,
      debriefMeta as Record<string, unknown>
    );

    await recordAuditLogEntry({
      entity: "event",
      entityId: values.eventId,
      action: "event.debrief_updated",
      actorId: user.id,
      meta: {
        changes: changedFields.length ? changedFields : ["Debrief"],
        salesUpliftValue: savedDebrief.sales_uplift_value,
        salesUpliftPercent: savedDebrief.sales_uplift_percent
      }
    });

    await sendPostEventDigestEmail(values.eventId);

    revalidatePath(`/events/${values.eventId}`);
    return { success: true, message: "Debrief saved." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not save the debrief." };
  }
}
