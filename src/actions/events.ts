"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { recordAuditLog } from "@/lib/audit";

type EventFormState = {
  error?: string;
  fieldErrors?: Partial<Record<keyof EventDraftInput, string>>;
};

const eventSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .min(3, "Title must be at least 3 characters")
    .max(150, "Title should be under 150 characters"),
  venueId: z.string().uuid("Select a venue before creating a draft."),
  startAt: z
    .string()
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      "Start date/time must be valid"
    ),
  endAt: z
    .string()
    .optional()
    .refine(
      (value) => !value || !Number.isNaN(Date.parse(value)),
      "End date/time must be valid"
    ),
});

type EventDraftInput = z.infer<typeof eventSchema>;

export async function createEventDraftAction(
  formData: FormData
): Promise<EventFormState | void> {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    return {
      error: "You must be signed in to create an event.",
    };
  }

  if (
    !["venue_manager", "hq_planner"].includes(profile.role ?? "")
  ) {
    return {
      error: "You do not have permission to create event drafts.",
    };
  }

  const parseResult = eventSchema.safeParse({
    title: formData.get("title"),
    venueId: formData.get("venueId"),
    startAt: formData.get("startAt"),
    endAt: formData.get("endAt"),
  });

  if (!parseResult.success) {
    const fieldErrors: EventFormState["fieldErrors"] = {};
    Object.entries(parseResult.error.flatten().fieldErrors).forEach(
      ([key, messages]) => {
        if (messages && messages.length) {
          fieldErrors[key as keyof EventDraftInput] = messages[0];
        }
      }
    );

    return {
      fieldErrors,
      error: "Please fix the highlighted fields before submitting.",
    };
  }

  if (
    profile.role === "venue_manager" &&
    profile.venue_id &&
    profile.venue_id !== parseResult.data.venueId
  ) {
    return {
      error: "You can only create drafts for your assigned venue.",
    };
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase
    .from("events")
    .insert({
      title: parseResult.data.title,
      venue_id: parseResult.data.venueId,
      start_at: new Date(parseResult.data.startAt).toISOString(),
      end_at: parseResult.data.endAt
        ? new Date(parseResult.data.endAt).toISOString()
        : null,
      created_by: profile.id,
      status: "draft",
    })
    .select("id, title, start_at, end_at, venue_id")
    .single();

  if (error) {
    return {
      error: `Unable to create event draft: ${error.message}`,
    };
  }

  const eventId = data?.id;

  if (!eventId) {
    return {
      error: "Event draft created without identifier. Please retry.",
    };
  }

  const versionPayload = {
    title: parseResult.data.title,
    start_at: parseResult.data.startAt,
    end_at: parseResult.data.endAt ?? null,
    venue_id: parseResult.data.venueId,
  };

  const { error: versionError } = await supabase
    .from("event_versions")
    .insert({
      event_id: eventId,
      version: 1,
      payload: versionPayload,
    });

  if (versionError) {
    await supabase.from("events").delete().eq("id", eventId);

    return {
      error: `Draft created but version snapshot failed: ${versionError.message}`,
    };
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "event.draft_created",
    entityType: "event",
    entityId: eventId,
    details: {
      title: parseResult.data.title,
      venue_id: parseResult.data.venueId,
      start_at: parseResult.data.startAt,
      end_at: parseResult.data.endAt ?? null,
      version: 1,
    },
  });

  revalidatePath("/events");
  redirect("/events?status=created");
}

const submitSchema = z.object({
  eventId: z.string().uuid("Invalid event identifier."),
});

export async function submitEventDraftAction(
  formData: FormData
): Promise<void> {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    throw new Error("You must be signed in to submit an event draft.");
  }

  const parse = submitSchema.safeParse({
    eventId: formData.get("eventId"),
  });

  if (!parse.success) {
    throw new Error("Select a valid draft before submitting.");
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data: eventRecord, error: fetchError } = await supabase
    .from("events")
    .select("id, status, created_by")
    .eq("id", parse.data.eventId)
    .single();

  if (fetchError || !eventRecord) {
    throw new Error(
      fetchError?.message ?? "We could not find that draft. Please try again."
    );
  }

  const isHQPlanner = profile.role === "hq_planner";
  const isOwner = eventRecord.created_by === profile.id;

  if (!isHQPlanner && !(profile.role === "venue_manager" && isOwner)) {
    throw new Error("You do not have permission to submit this draft.");
  }

  if (!["draft", "needs_revisions"].includes(eventRecord.status)) {
    throw new Error("Only drafts or revisions can be submitted.");
  }

  const { data: latestVersion, error: versionFetchError } = await supabase
    .from("event_versions")
    .select("version")
    .eq("event_id", eventRecord.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionFetchError) {
    throw new Error(
      `Unable to load draft versions: ${versionFetchError.message}`
    );
  }

  const nextVersionNumber = (latestVersion?.version ?? 0) + 1;
  const submittedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("events")
    .update({
      status: "submitted",
    })
    .eq("id", eventRecord.id);

  if (updateError) {
    throw new Error(`Unable to submit draft: ${updateError.message}`);
  }

  const { error: versionError } = await supabase
    .from("event_versions")
    .insert({
      event_id: eventRecord.id,
      version: nextVersionNumber,
      payload: {
        status: "submitted",
      },
      submitted_at: submittedAt,
      submitted_by: profile.id,
    });

  if (versionError) {
    throw new Error(
      `Draft submitted but version snapshot failed: ${versionError.message}`
    );
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "event.submitted",
    entityType: "event",
    entityId: eventRecord.id,
    details: {
      version: nextVersionNumber,
      submitted_at: submittedAt,
    },
  });

  revalidatePath("/events");
  revalidatePath("/reviews");
  redirect("/events?status=submitted");
}

export type CloneEventState = {
  error?: string;
};

const cloneSchema = z.object({
  eventId: z.string().uuid("Select an event to clone."),
});

export async function cloneEventAction(
  formData: FormData
): Promise<CloneEventState | void> {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "hq_planner") {
    return {
      error: "Only HQ planners can clone events.",
    };
  }

  const parsed = cloneSchema.safeParse({
    eventId: formData.get("eventId"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Select an event to clone.",
    };
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data: sourceEvent, error: fetchError } = await supabase
    .from("events")
    .select(
      "id,title,venue_id,status,start_at,end_at,venue_space,expected_headcount,estimated_takings_band,goal_id,promo_tags,created_by"
    )
    .eq("id", parsed.data.eventId)
    .single();

  if (fetchError || !sourceEvent) {
    return {
      error:
        fetchError?.message ?? "We could not find the event you are cloning.",
    };
  }

  const { data: latestVersion, error: versionError } = await supabase
    .from("event_versions")
    .select("payload")
    .eq("event_id", sourceEvent.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionError) {
    return {
      error: `Unable to load source version: ${versionError.message}`,
    };
  }

  const draftTitle = `${sourceEvent.title} (Copy)`;
  const now = new Date().toISOString();

  const { data: draftResult, error: insertError } = await supabase
    .from("events")
    .insert({
      title: draftTitle,
      venue_id: sourceEvent.venue_id,
      status: "draft",
      start_at: null,
      end_at: null,
      venue_space: sourceEvent.venue_space,
      expected_headcount: sourceEvent.expected_headcount,
      estimated_takings_band: sourceEvent.estimated_takings_band,
      goal_id: sourceEvent.goal_id,
      promo_tags: sourceEvent.promo_tags,
      created_by: profile.id,
      assigned_reviewer_id: null,
      priority_flag: false,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (insertError || !draftResult?.id) {
    return {
      error:
        insertError?.message ??
        "Unable to create cloned draft. Please retry.",
    };
  }

  const clonePayload = {
    ...(latestVersion?.payload ?? {}),
    cloned_from: sourceEvent.id,
    cloned_at: now,
  };

  const { error: versionInsertError } = await supabase
    .from("event_versions")
    .insert({
      event_id: draftResult.id,
      version: 1,
      payload: clonePayload,
    });

  if (versionInsertError) {
    await supabase.from("events").delete().eq("id", draftResult.id);
    return {
      error: `Draft created but version snapshot failed: ${versionInsertError.message}`,
    };
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "event.cloned",
    entityType: "event",
    entityId: draftResult.id,
    details: {
      source_event_id: sourceEvent.id,
      cloned_at: now,
    },
  });

  revalidatePath("/events");
  revalidatePath("/planning");

  return undefined;
}
