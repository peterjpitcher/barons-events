"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { appendEventVersion, assignReviewer, createEventDraft, recordApproval, updateEventDraft } from "@/lib/events";
import { eventFormSchema } from "@/lib/validation";
import type { EventStatus } from "@/lib/types";
import { sendEventSubmittedEmail, sendReviewDecisionEmail } from "@/lib/notifications";

const reviewerFallback = z.string().uuid().optional();

type ActionResult = {
  success: boolean;
  message?: string;
};

export async function saveDraftAction(_: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const parsed = eventFormSchema.safeParse({
    eventId: formData.get("eventId") ?? undefined,
    venueId: formData.get("venueId") ?? user.venueId,
    title: formData.get("title"),
    eventType: formData.get("eventType"),
    startAt: formData.get("startAt"),
    endAt: formData.get("endAt"),
    venueSpace: formData.get("venueSpace"),
    expectedHeadcount: formData.get("expectedHeadcount") ?? undefined,
    wetPromo: formData.get("wetPromo") ?? undefined,
    foodPromo: formData.get("foodPromo") ?? undefined,
    goalFocus: formData.getAll("goalFocus").length
      ? formData.getAll("goalFocus").join(",")
      : formData.get("goalFocus") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    assignedReviewerId: formData.get("assignedReviewerId") ?? undefined
  });

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Check the form and try again."
    };
  }

  const values = parsed.data;

  if (!values.venueId) {
    return { success: false, message: "Choose a venue before saving." };
  }

  try {
    if (values.eventId) {
      await updateEventDraft(values.eventId, {
        venue_id: values.venueId,
        title: values.title,
        event_type: values.eventType,
        start_at: values.startAt,
        end_at: values.endAt,
        venue_space: values.venueSpace,
        expected_headcount: values.expectedHeadcount ?? null,
        wet_promo: values.wetPromo ?? null,
        food_promo: values.foodPromo ?? null,
        goal_focus: values.goalFocus ?? null,
        notes: values.notes ?? null,
        assigned_reviewer_id: reviewerFallback.parse(values.assignedReviewerId) ?? null
      });
      await appendEventVersion(values.eventId, user.id, {
        ...values,
        status: "draft"
      });
      revalidatePath(`/events/${values.eventId}`);
      return { success: true, message: "Draft updated." };
    }

    const created = await createEventDraft({
      venueId: values.venueId,
      createdBy: user.id,
      title: values.title,
      eventType: values.eventType,
      startAt: values.startAt,
      endAt: values.endAt,
      venueSpace: values.venueSpace,
      expectedHeadcount: values.expectedHeadcount ?? null,
      wetPromo: values.wetPromo ?? null,
      foodPromo: values.foodPromo ?? null,
      goalFocus: values.goalFocus ?? null,
      notes: values.notes ?? null
    });

    if (values.assignedReviewerId) {
      await assignReviewer(created.id, reviewerFallback.parse(values.assignedReviewerId) ?? null);
    }

    revalidatePath("/events");
    redirect(`/events/${created.id}`);
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not save the draft just now." };
  }
}

export async function submitEventAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const eventId = formData.get("eventId");
  const reviewerId = formData.get("assignedReviewerId") ?? undefined;

  const parsedId = z.string().uuid().safeParse(eventId);
  if (!parsedId.success) {
    return { success: false, message: "Missing event reference." };
  }

  const supabase = await createSupabaseActionClient();

  async function resolveReviewer(): Promise<string | null> {
    const parsedReviewer = reviewerFallback.parse(reviewerId) ?? null;
    if (parsedReviewer) return parsedReviewer;

    const { data } = await supabase
      .from("users")
      .select("id")
      .eq("role", "reviewer")
      .order("full_name", { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.id ?? null;
  }

  try {
    const reviewerToAssign = await resolveReviewer();
    const { error } = await supabase
      .from("events")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        assigned_reviewer_id: reviewerToAssign
      })
      .eq("id", parsedId.data);

    if (error) {
      throw error;
    }

    await appendEventVersion(parsedId.data, user.id, {
      status: "submitted",
      submitted_at: new Date().toISOString()
    });

    await sendEventSubmittedEmail(parsedId.data);

    revalidatePath(`/events/${parsedId.data}`);
    revalidatePath("/reviews");
    return { success: true, message: "Sent to review." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not submit right now." };
  }
}

export async function reviewerDecisionAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const decision = formData.get("decision");
  const eventId = formData.get("eventId");
  const feedback = formData.get("feedback") ?? undefined;

  const parsedDecision = z.enum(["approved", "needs_revisions", "rejected"]).safeParse(decision);
  const parsedId = z.string().uuid().safeParse(eventId);

  if (!parsedDecision.success || !parsedId.success) {
    return { success: false, message: "Decision could not be processed." };
  }

  const newStatus = parsedDecision.data as EventStatus;
  const supabase = await createSupabaseActionClient();

  try {
    const { error } = await supabase
      .from("events")
      .update({ status: newStatus })
      .eq("id", parsedId.data);

    if (error) {
      throw error;
    }

    await recordApproval({
      eventId: parsedId.data,
      reviewerId: user.id,
      decision: newStatus,
      feedback: typeof feedback === "string" ? feedback : null
    });

    await appendEventVersion(parsedId.data, user.id, {
      status: newStatus,
      feedback
    });

    await sendReviewDecisionEmail(parsedId.data, newStatus);

    revalidatePath(`/events/${parsedId.data}`);
    revalidatePath("/reviews");
    return { success: true, message: "Decision recorded." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not save the decision." };
  }
}

export async function reassignReviewerAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "central_planner") {
    return { success: false, message: "Only planners can reassign reviewers." };
  }

  const eventId = formData.get("eventId");
  const reviewerId = formData.get("reviewerId") ?? null;

  const parsedEvent = z.string().uuid().safeParse(eventId);
  const parsedReviewer = reviewerId ? z.string().uuid().safeParse(reviewerId) : { success: true, data: null };

  if (!parsedEvent.success || !parsedReviewer.success) {
    return { success: false, message: "Provide a valid reviewer." };
  }

  try {
    await assignReviewer(parsedEvent.data, parsedReviewer.data);
    revalidatePath(`/events/${parsedEvent.data}`);
    revalidatePath("/reviews");
    return { success: true, message: "Reviewer updated." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not update reviewer." };
  }
}
