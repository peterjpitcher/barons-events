"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { appendEventVersion, createEventDraft, recordApproval, updateEventDraft, updateEventAssignee } from "@/lib/events";
import { eventFormSchema } from "@/lib/validation";
import type { EventStatus } from "@/lib/types";
import { sendEventSubmittedEmail, sendReviewDecisionEmail } from "@/lib/notifications";
import { recordAuditLogEntry } from "@/lib/audit-log";

const reviewerFallback = z.string().uuid().optional();

type ActionResult = {
  success: boolean;
  message?: string;
};

export async function saveEventDraftAction(_: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
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
    notes: formData.get("notes") ?? undefined
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
        notes: values.notes ?? null
      }, user.id);
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
      const parsed = eventFormSchema
        .omit({ eventId: true })
        .safeParse({
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
          notes: formData.get("notes") ?? undefined
        });

      if (!parsed.success) {
        return {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Check the form and try again."
        };
      }

      const values = parsed.data;
      if (!values.venueId) {
        return { success: false, message: "Choose a venue before submitting." };
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

  const parsedDecision = z.enum(["approved", "needs_revisions", "rejected"]).safeParse(decision);
  const parsedId = z.string().uuid().safeParse(eventId);

  if (!parsedDecision.success || !parsedId.success) {
    return { success: false, message: "Decision could not be processed." };
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
