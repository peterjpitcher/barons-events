"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { recordAuditLog } from "@/lib/audit";
import {
  sendReviewerAssignmentEmail,
  sendReviewerDecisionEmail,
} from "@/lib/notifications/reviewer-emails";

type ReviewerActionState = {
  error?: string;
};

const assignSchema = z.object({
  eventId: z.string().uuid("A valid event identifier is required."),
  reviewerId: z.string().uuid("Select a reviewer to assign."),
});

const formatSupabaseError = (message?: string | null) => {
  if (!message) {
    return "unknown Supabase error.";
  }
  const lowered = message.toLowerCase();
  if (lowered.includes("permission denied") || lowered.includes("rls")) {
    return "your account does not have permission to perform this action.";
  }
  return message;
};

export async function assignReviewerAction(
  formData: FormData
): Promise<ReviewerActionState | void> {
  const profile = await getCurrentUserProfile();

  if (!profile || !["hq_planner", "reviewer"].includes(profile.role ?? "")) {
    return {
      error: "You do not have permission to assign reviewers.",
    };
  }

  const parseResult = assignSchema.safeParse({
    eventId: formData.get("eventId"),
    reviewerId: formData.get("reviewerId"),
  });

  if (!parseResult.success) {
    return {
      error: "Please fix the highlighted fields before assigning.",
    };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.rpc("assign_reviewer", {
    p_event_id: parseResult.data.eventId,
    p_reviewer_id: parseResult.data.reviewerId,
  });

  if (error) {
    return {
      error: `Unable to assign reviewer: ${formatSupabaseError(error.message)}`,
    };
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "event.reviewer_assigned",
    entityType: "event",
    entityId: parseResult.data.eventId,
    details: {
      reviewer_id: parseResult.data.reviewerId,
    },
  });

  const [eventInfo, reviewerInfo] = await Promise.all([
    supabase
      .from("events")
      .select("title,start_at,venue:venues(name)")
      .eq("id", parseResult.data.eventId)
      .maybeSingle(),
    supabase
      .from("users")
      .select("email,full_name")
      .eq("id", parseResult.data.reviewerId)
      .maybeSingle(),
  ]);

  const reviewerEmail = reviewerInfo.data?.email ?? null;

  if (reviewerEmail) {
    const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/reviews`;
    const startAt = eventInfo.data?.start_at
      ? new Date(eventInfo.data.start_at).toLocaleString("en-GB", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Unscheduled";

    try {
      const venueRelation = eventInfo.data?.venue;
      let venueName: string | null = null;
      if (Array.isArray(venueRelation)) {
        const [firstVenue] = venueRelation as Array<{ name: string | null }>;
        venueName = firstVenue?.name ?? null;
      } else if (venueRelation && typeof venueRelation === "object") {
        const singleVenue = venueRelation as { name: string | null };
        venueName = singleVenue.name ?? null;
      }

      await sendReviewerAssignmentEmail({
        reviewerEmail,
        reviewerName: (reviewerInfo.data?.full_name as string | null) ?? null,
        eventTitle: (eventInfo.data?.title as string) ?? "Unknown event",
        venueName: venueName ?? "Unknown venue",
        startAt,
        dashboardUrl,
      });
    } catch (error) {
      console.error(
        "[reviews] Failed to send assignment email",
        JSON.stringify({
          eventId: parseResult.data.eventId,
          reviewerId: parseResult.data.reviewerId,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      );
    }
  }

  revalidatePath("/events");
  revalidatePath("/reviews");

  redirect("/reviews?flash=assigned");
}

const decisionSchema = z.object({
  eventId: z.string().uuid("A valid event identifier is required."),
  decision: z.enum(["approved", "needs_revisions", "rejected"]),
  note: z
    .string()
    .max(500, "Decision note must be 500 characters or fewer.")
    .optional()
    .or(z.literal("")),
});

export async function reviewerDecisionAction(
  formData: FormData
): Promise<ReviewerActionState | void> {
  const profile = await getCurrentUserProfile();

  if (!profile || !["reviewer", "hq_planner"].includes(profile.role ?? "")) {
    return {
      error: "You do not have permission to record a decision.",
    };
  }

  const parsed = decisionSchema.safeParse({
    eventId: formData.get("eventId"),
    decision: formData.get("decision"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return {
      error: "Please provide a valid decision before submitting.",
    };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data: eventRecord, error: eventError } = await supabase
    .from("events")
    .select("id,status,assigned_reviewer_id,created_by,title,start_at,venue:venues(name)")
    .eq("id", parsed.data.eventId)
    .single();

  if (eventError || !eventRecord) {
    const errorMessage = eventError?.message
      ? formatSupabaseError(eventError.message)
      : "We could not find the event you are deciding on.";
    return {
      error: errorMessage,
    };
  }

  const isReviewer = profile.role === "reviewer";
  const isAssignedReviewer =
    eventRecord.assigned_reviewer_id === profile.id || profile.role === "hq_planner";

  if (isReviewer && !isAssignedReviewer) {
    return {
      error:
        "You are not assigned to this event. Ask an HQ planner to reassign it before deciding.",
    };
  }

  if (!["submitted", "needs_revisions"].includes(eventRecord.status)) {
    return {
      error: "Only submitted drafts or revisions can receive a new decision.",
    };
  }

  const nextStatus = parsed.data.decision;

  const { data: latestVersion, error: versionFetchError } = await supabase
    .from("event_versions")
    .select("version")
    .eq("event_id", eventRecord.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionFetchError) {
    return {
      error: `Unable to load versions before decision: ${formatSupabaseError(versionFetchError.message)}`,
    };
  }

  const nextVersionNumber = (latestVersion?.version ?? 0) + 1;
  const decisionTimestamp = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("events")
    .update({
      status: nextStatus,
    })
    .eq("id", eventRecord.id);

  if (updateError) {
    return {
      error: `Unable to apply decision: ${formatSupabaseError(updateError.message)}`,
    };
  }

  const detailsPayload = {
    decision: nextStatus,
    note: parsed.data.note ?? "",
    decided_at: decisionTimestamp,
    decided_by: profile.id,
  };

  const { error: versionInsertError } = await supabase
    .from("event_versions")
    .insert({
      event_id: eventRecord.id,
      version: nextVersionNumber,
      payload: detailsPayload,
    });

  if (versionInsertError) {
    await supabase
      .from("events")
      .update({
        status: eventRecord.status,
      })
      .eq("id", eventRecord.id);

    return {
      error: `Decision applied but version snapshot failed: ${formatSupabaseError(versionInsertError.message)}`,
    };
  }

  const { error: approvalInsertError } = await supabase
    .from("approvals")
    .insert({
      event_id: eventRecord.id,
      decision: nextStatus,
      reviewer_id: profile.id,
      feedback_text: parsed.data.note ?? "",
      decided_at: decisionTimestamp,
    });

  if (approvalInsertError) {
    await supabase
      .from("events")
      .update({
        status: eventRecord.status,
      })
      .eq("id", eventRecord.id);

    await supabase
      .from("event_versions")
      .delete()
      .eq("event_id", eventRecord.id)
      .eq("version", nextVersionNumber);

    return {
      error: `Decision recorded but approval log failed: ${formatSupabaseError(approvalInsertError.message)}`,
    };
  }

  await recordAuditLog({
    actorId: profile.id,
    action: `event.${nextStatus}`,
    entityType: "event",
    entityId: eventRecord.id,
    details: detailsPayload,
  });

  const { data: eventOwner } = await supabase
    .from("users")
    .select("email,full_name")
    .eq("id", eventRecord.created_by)
    .maybeSingle();

  const ownerEmail = (eventOwner?.email as string | null) ?? null;

  if (ownerEmail) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    try {
      await sendReviewerDecisionEmail({
        recipientEmail: ownerEmail,
        recipientName: (eventOwner?.full_name as string | null) ?? null,
        eventTitle: (eventRecord.title as string) ?? "Event",
        decision: nextStatus,
        note: parsed.data.note ?? "",
        reviewerName: profile.full_name ?? profile.email ?? null,
        reviewsUrl: `${appUrl}/events/${eventRecord.id}`,
      });
    } catch (error) {
      console.error(
        "[reviews] Failed to send decision email",
        JSON.stringify({
          eventId: eventRecord.id,
          ownerId: eventRecord.created_by,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      );
    }
  }

  revalidatePath("/reviews");
  revalidatePath("/events");
  redirect("/reviews?flash=decided");
}
