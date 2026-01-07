"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { appendEventVersion, createEventDraft, recordApproval, updateEventDraft, updateEventAssignee } from "@/lib/events";
import { eventFormSchema } from "@/lib/validation";
import { getFieldErrors, type FieldErrors } from "@/lib/form-errors";
import type { EventStatus } from "@/lib/types";
import { sendEventSubmittedEmail, sendReviewDecisionEmail } from "@/lib/notifications";
import { recordAuditLogEntry } from "@/lib/audit-log";

const reviewerFallback = z.string().uuid().optional();

type ActionResult = {
  success: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
};

function normaliseVenueSpacesField(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") {
    return "";
  }
  const entries = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return "";
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  entries.forEach((entry) => {
    const key = entry.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  });
  return unique.join(", ");
}

async function autoApproveEvent(params: {
  eventId: string;
  actorId: string;
  previousStatus: string | null;
  previousAssignee: string | null;
}) {
  const supabase = await createSupabaseActionClient();
  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("events")
    .update({
      status: "approved",
      assignee_id: null,
      submitted_at: nowIso
    })
    .eq("id", params.eventId);

  if (updateError) {
    throw updateError;
  }

  await recordApproval({
    eventId: params.eventId,
    reviewerId: params.actorId,
    decision: "approved"
  });

  const changes: string[] = [];
  if (params.previousStatus !== "approved") {
    changes.push("Status");
  }
  if ((params.previousAssignee ?? null) !== null) {
    changes.push("Assignee");
  }

  if (changes.length) {
    await recordAuditLogEntry({
      entity: "event",
      entityId: params.eventId,
      action: "event.status_changed",
      actorId: params.actorId,
      meta: {
        status: "approved",
        previousStatus: params.previousStatus,
        assigneeId: null,
        previousAssigneeId: params.previousAssignee,
        autoApproved: true,
        changes
      }
    });
  }

  await appendEventVersion(params.eventId, params.actorId, {
    status: "approved",
    submitted_at: nowIso,
    autoApproved: true
  });
}

export async function saveEventDraftAction(_: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const rawEventId = formData.get("eventId");
  const eventId = typeof rawEventId === "string" ? rawEventId.trim() || undefined : undefined;
  const venueIdValue = formData.get("venueId");
  const venueId = typeof venueIdValue === "string" ? venueIdValue : (user.venueId ?? "");
  const titleValue = formData.get("title");
  const title = typeof titleValue === "string" ? titleValue : "";
  const eventTypeValue = formData.get("eventType");
  const eventType = typeof eventTypeValue === "string" ? eventTypeValue : "";
  const startAtValue = formData.get("startAt");
  const startAt = typeof startAtValue === "string" ? startAtValue : "";
  const endAtValue = formData.get("endAt");
  const endAt = typeof endAtValue === "string" ? endAtValue : "";

  const parsed = eventFormSchema.safeParse({
    eventId,
    venueId,
    title,
    eventType,
    startAt,
    endAt,
    venueSpace: normaliseVenueSpacesField(formData.get("venueSpace")),
    expectedHeadcount: formData.get("expectedHeadcount") ?? undefined,
    wetPromo: formData.get("wetPromo") ?? undefined,
    foodPromo: formData.get("foodPromo") ?? undefined,
    goalFocus: formData.getAll("goalFocus").length
      ? formData.getAll("goalFocus").join(",")
      : formData.get("goalFocus") ?? undefined,
    costTotal: formData.get("costTotal") ?? undefined,
    costDetails: formData.get("costDetails") ?? undefined,
    notes: formData.get("notes") ?? undefined
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Check the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error)
    };
  }

  const values = parsed.data;

  if (!values.venueId) {
    return {
      success: false,
      message: "Choose a venue before saving.",
      fieldErrors: { venueId: "Choose a venue" }
    };
  }

  try {
    if (values.eventId) {
      const updated = await updateEventDraft(values.eventId, {
        venue_id: values.venueId,
        title: values.title,
        event_type: values.eventType,
        start_at: values.startAt,
        end_at: values.endAt,
        venue_space: values.venueSpace,
        expected_headcount: values.expectedHeadcount ?? null,
        wet_promo: values.wetPromo ?? null,
        food_promo: values.foodPromo ?? null,
        cost_total: values.costTotal ?? null,
        cost_details: values.costDetails ?? null,
        goal_focus: values.goalFocus ?? null,
        notes: values.notes ?? null
      }, user.id);
      await appendEventVersion(values.eventId, user.id, {
        ...values,
        status: updated.status
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
      costTotal: values.costTotal ?? null,
      costDetails: values.costDetails ?? null,
      goalFocus: values.goalFocus ?? null,
      notes: values.notes ?? null
    });

    if (user.role === "central_planner") {
      await autoApproveEvent({
        eventId: created.id,
        actorId: user.id,
        previousStatus: (created.status as string | null) ?? null,
        previousAssignee: (created.assignee_id as string | null) ?? null
      });
      revalidatePath(`/events/${created.id}`);
      revalidatePath("/reviews");
    }

    revalidatePath("/events");
    redirect(`/events/${created.id}`);
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not save the draft just now." };
  }
}

export async function submitEventForReviewAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const eventId = formData.get("eventId");
  const assigneeField = formData.get("assigneeId") ?? formData.get("assignedReviewerId") ?? undefined;
  const assigneeOverride = typeof assigneeField === "string" ? assigneeField : undefined;

  const rawEventId = typeof eventId === "string" ? eventId.trim() : "";
  let targetEventId: string | null = null;

  try {
    if (rawEventId) {
      const parsedId = z.string().uuid().safeParse(rawEventId);
      if (!parsedId.success) {
        return { success: false, message: "Missing event reference." };
      }
      targetEventId = parsedId.data;
    } else {
      const venueIdValue = formData.get("venueId");
      const venueId = typeof venueIdValue === "string" ? venueIdValue : (user.venueId ?? "");
      const titleValue = formData.get("title");
      const title = typeof titleValue === "string" ? titleValue : "";
      const eventTypeValue = formData.get("eventType");
      const eventType = typeof eventTypeValue === "string" ? eventTypeValue : "";
      const startAtValue = formData.get("startAt");
      const startAt = typeof startAtValue === "string" ? startAtValue : "";
      const endAtValue = formData.get("endAt");
      const endAt = typeof endAtValue === "string" ? endAtValue : "";

      const parsed = eventFormSchema
        .omit({ eventId: true })
        .safeParse({
          venueId,
          title,
          eventType,
          startAt,
          endAt,
          venueSpace: normaliseVenueSpacesField(formData.get("venueSpace")),
          expectedHeadcount: formData.get("expectedHeadcount") ?? undefined,
          wetPromo: formData.get("wetPromo") ?? undefined,
          foodPromo: formData.get("foodPromo") ?? undefined,
          goalFocus: formData.getAll("goalFocus").length
            ? formData.getAll("goalFocus").join(",")
            : formData.get("goalFocus") ?? undefined,
          costTotal: formData.get("costTotal") ?? undefined,
          costDetails: formData.get("costDetails") ?? undefined,
          notes: formData.get("notes") ?? undefined
        });

      if (!parsed.success) {
        return {
          success: false,
          message: "Check the highlighted fields.",
          fieldErrors: getFieldErrors(parsed.error)
        };
      }

      const values = parsed.data;
      if (!values.venueId) {
        return {
          success: false,
          message: "Choose a venue before submitting.",
          fieldErrors: { venueId: "Choose a venue" }
        };
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
        costTotal: values.costTotal ?? null,
        costDetails: values.costDetails ?? null,
        goalFocus: values.goalFocus ?? null,
        notes: values.notes ?? null
      });

      targetEventId = created.id;
    }

    if (!targetEventId) {
      return { success: false, message: "Missing event reference." };
    }

    const supabase = await createSupabaseActionClient();

    const { data: existingEvent, error: existingEventError } = await supabase
      .from("events")
      .select("status, assignee_id, venue_id, created_by")
      .eq("id", targetEventId)
      .single();

    if (existingEventError) {
      throw existingEventError;
    }

    if (user.role === "central_planner") {
      if (!existingEvent) {
        throw new Error("Event not found.");
      }

      if (existingEvent.status === "approved") {
        revalidatePath(`/events/${targetEventId}`);
        revalidatePath("/events");
        revalidatePath("/reviews");
        return { success: true, message: "Event already approved." };
      }

      await autoApproveEvent({
        eventId: targetEventId,
        actorId: user.id,
        previousStatus: (existingEvent.status as string | null) ?? null,
        previousAssignee: (existingEvent.assignee_id as string | null) ?? null
      });

      await sendReviewDecisionEmail(targetEventId, "approved");

      revalidatePath(`/events/${targetEventId}`);
      revalidatePath("/events");
      revalidatePath("/reviews");
      return { success: true, message: "Event approved instantly." };
    }

    async function resolveAssignee(): Promise<string | null> {
      const parsedAssignee = reviewerFallback.parse(assigneeOverride) ?? null;
      if (parsedAssignee) return parsedAssignee;

      const venueId = existingEvent?.venue_id ?? null;
      if (venueId) {
        const { data: venueRow, error: venueError } = await supabase
          .from("venues")
          .select("default_reviewer_id")
          .eq("id", venueId)
          .maybeSingle();

        if (venueError) {
          console.error("Could not load venue default reviewer", venueError);
        } else if (venueRow?.default_reviewer_id) {
          return venueRow.default_reviewer_id;
        }
      }

      const { data } = await supabase
        .from("users")
        .select("id")
        .eq("role", "reviewer")
        .order("full_name", { ascending: true })
        .limit(1)
        .maybeSingle();
      return data?.id ?? null;
    }

    const assigneeId = await resolveAssignee();
    const { error } = await supabase
      .from("events")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        assignee_id: assigneeId
      })
      .eq("id", targetEventId);

    if (error) {
      throw error;
    }

    const statusBefore = existingEvent?.status ?? null;
    const assigneeBefore = existingEvent?.assignee_id ?? null;
    const changes: string[] = [];
    if (statusBefore !== "submitted") {
      changes.push("Status");
    }
    if ((assigneeBefore ?? null) !== assigneeId) {
      changes.push("Assignee");
    }

    if (changes.length) {
      await recordAuditLogEntry({
        entity: "event",
        entityId: targetEventId,
        action: "event.status_submitted",
        actorId: user.id,
        meta: {
          status: "submitted",
          previousStatus: statusBefore,
          assigneeId: assigneeId ?? null,
          previousAssigneeId: assigneeBefore ?? null,
          changes
        }
      });
    }

    await appendEventVersion(targetEventId, user.id, {
      status: "submitted",
      submitted_at: new Date().toISOString()
    });

    await sendEventSubmittedEmail(targetEventId);

    revalidatePath(`/events/${targetEventId}`);
    revalidatePath("/events");
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

  const parsedId = z.string().uuid().safeParse(typeof eventId === "string" ? eventId : "");
  if (!parsedId.success) {
    return { success: false, message: "Decision could not be processed." };
  }

  const parsedDecision = z.enum(["approved", "needs_revisions", "rejected"]).safeParse(
    typeof decision === "string" ? decision : ""
  );
  if (!parsedDecision.success) {
    return {
      success: false,
      message: "Choose a decision before saving.",
      fieldErrors: { decision: "Choose a decision" }
    };
  }

  const newStatus = parsedDecision.data as EventStatus;
  const supabase = await createSupabaseActionClient();

  try {
    const { data: eventBeforeDecision, error: eventBeforeError } = await supabase
      .from("events")
      .select("status, assignee_id, created_by")
      .eq("id", parsedId.data)
      .single();

    if (eventBeforeError) {
      throw eventBeforeError;
    }

    const currentAssignee = eventBeforeDecision?.assignee_id ?? null;
    let nextAssignee: string | null = currentAssignee;

    if (newStatus === "needs_revisions" || newStatus === "rejected") {
      nextAssignee = eventBeforeDecision?.created_by ?? null;
    } else if (newStatus === "approved") {
      nextAssignee = null;
    }

    const { error } = await supabase
      .from("events")
      .update({ status: newStatus, assignee_id: nextAssignee })
      .eq("id", parsedId.data);

    if (error) {
      throw error;
    }

    const statusBefore = eventBeforeDecision?.status ?? null;
    const trimmedFeedback =
      typeof feedback === "string" && feedback.trim().length ? feedback.trim() : null;
    await recordApproval({
      eventId: parsedId.data,
      reviewerId: user.id,
      decision: newStatus,
      feedback: trimmedFeedback
    });

    const changes: string[] = [];
    if (statusBefore !== newStatus) {
      changes.push("Status");
    }
    if (trimmedFeedback) {
      changes.push("Feedback");
    }
    if ((currentAssignee ?? null) !== nextAssignee) {
      changes.push("Assignee");
    }

    if (changes.length) {
      await recordAuditLogEntry({
        entity: "event",
        entityId: parsedId.data,
        action: "event.status_changed",
        actorId: user.id,
        meta: {
          status: newStatus,
          previousStatus: statusBefore,
          feedback: trimmedFeedback,
          assigneeId: nextAssignee,
          previousAssigneeId: currentAssignee,
          changes
        }
      });
    }

    await appendEventVersion(parsedId.data, user.id, {
      status: newStatus,
      feedback: trimmedFeedback
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

export async function updateAssigneeAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "central_planner") {
    return { success: false, message: "Only planners can update assignees." };
  }

  const eventId = formData.get("eventId");
  const assigneeField = formData.get("assigneeId") ?? formData.get("reviewerId") ?? null;

  const parsedEvent = z.string().uuid().safeParse(eventId);
  const parsedAssignee = assigneeField ? z.string().uuid().safeParse(assigneeField) : { success: true, data: null };

  if (!parsedEvent.success || !parsedAssignee.success) {
    return { success: false, message: "Provide a valid user." };
  }

  try {
    const supabase = await createSupabaseActionClient();
    const { data: eventRow, error: eventFetchError } = await supabase
      .from("events")
      .select("assignee_id")
      .eq("id", parsedEvent.data)
      .single();

    if (eventFetchError) {
      throw eventFetchError;
    }

    const previousAssigneeId = eventRow?.assignee_id ?? null;
    const nextAssigneeId = parsedAssignee.data;

    if (previousAssigneeId === nextAssigneeId) {
      return { success: true, message: "Assignee unchanged." };
    }

    await updateEventAssignee(parsedEvent.data, nextAssigneeId);
    await recordAuditLogEntry({
      entity: "event",
      entityId: parsedEvent.data,
      action: "event.assignee_updated",
      actorId: user.id,
      meta: {
        assigneeId: nextAssigneeId,
        previousAssigneeId,
        changes: ["Assignee"]
      }
    });
    revalidatePath(`/events/${parsedEvent.data}`);
    revalidatePath("/reviews");
    return { success: true, message: "Assignee updated." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not update assignee." };
  }
}

export async function deleteEventAction(_: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const eventId = formData.get("eventId");
  const parsedEvent = z.string().uuid().safeParse(eventId);

  if (!parsedEvent.success) {
    return { success: false, message: "Invalid event reference." };
  }

  const supabase = await createSupabaseActionClient();

  try {
    const { data: event, error: fetchError } = await supabase
      .from("events")
      .select("id, created_by, status")
      .eq("id", parsedEvent.data)
      .single();

    if (fetchError || !event) {
      return { success: false, message: "Event not found." };
    }

    const canDelete =
      user.role === "central_planner" ||
      ((user.role === "venue_manager" && event.created_by === user.id) &&
        ["draft", "submitted", "needs_revisions"].includes(event.status));

    if (!canDelete) {
      return { success: false, message: "You don't have permission to delete this event." };
    }

    const { error: deleteError } = await supabase.from("events").delete().eq("id", event.id);

    if (deleteError) {
      throw deleteError;
    }

    revalidatePath("/events");
    revalidatePath("/reviews");
    redirect("/events");
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    console.error(error);
    return { success: false, message: "Could not delete the event." };
  }
}
