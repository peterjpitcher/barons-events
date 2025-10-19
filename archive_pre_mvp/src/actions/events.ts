"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { recordAuditLog } from "@/lib/audit";
import { sendReviewerAssignmentEmail } from "@/lib/notifications/reviewer-emails";

export type EventFormState = {
  error?: string;
  fieldErrors?: Partial<Record<keyof EventDraftInput, string>>;
};

const DRAFT_REMINDER_DELAY_MS = 1000 * 60 * 60 * 48;

type ServiceSupabaseClient = ReturnType<typeof createSupabaseServiceRoleClient>;

type VenueReviewerMapEntry = {
  reviewer_id: string;
};

type SubmissionEventRecord = {
  id: string;
  title: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  venue_id: string;
  venue_name: string | null;
  created_by: string;
  assigned_reviewer_id: string | null;
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
  areaIds: z.array(z.string()).optional(),
});

type EventDraftInput = z.infer<typeof eventSchema>;

const getEventAreaIds = async (
  supabase: ServiceSupabaseClient,
  eventId: string
): Promise<string[]> => {
  const { data, error } = await supabase
    .from("event_areas")
    .select("venue_area_id")
    .eq("event_id", eventId);

  if (error) {
    throw new Error(`Unable to load assigned venue areas: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ venue_area_id: string | null }>;

  return rows
    .map((row) => row.venue_area_id ?? null)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => a.localeCompare(b));
};

const getVenueAreaCount = async (
  supabase: ServiceSupabaseClient,
  venueId: string
): Promise<number> => {
  const { count, error } = await supabase
    .from("venue_areas")
    .select("id", { head: true, count: "exact" })
    .eq("venue_id", venueId);

  if (error) {
    throw new Error(`Unable to verify venue areas before submission: ${error.message}`);
  }

  return count ?? 0;
};

const extractVenueName = (value: unknown): string | null => {
  if (!value) return null;
  if (Array.isArray(value)) {
    const [first] = value as Array<{ name?: string | null }>;
    return first?.name ?? null;
  }
  if (typeof value === "object") {
    return (value as { name?: string | null }).name ?? null;
  }
  return null;
};

const ensureReviewerAssignment = async ({
  supabase,
  event,
  actorId,
  dashboardUrl,
}: {
  supabase: ServiceSupabaseClient;
  event: SubmissionEventRecord;
  actorId: string;
  dashboardUrl: string;
}): Promise<{ reviewerId: string | null; newlyAssigned: boolean }> => {
  if (event.assigned_reviewer_id) {
    return { reviewerId: event.assigned_reviewer_id, newlyAssigned: false };
  }

  const { data: defaultRows, error: defaultsError } = await supabase
    .from("venue_default_reviewers")
    .select("reviewer_id")
    .eq("venue_id", event.venue_id);

  if (defaultsError) {
    throw new Error(`Unable to load default reviewers: ${defaultsError.message}`);
  }

  const defaultReviewerIds = (defaultRows ?? []) as VenueReviewerMapEntry[];

  const candidateReviewerIds = defaultReviewerIds.map((row) => row.reviewer_id);

  let reviewerId: string | null = candidateReviewerIds[0] ?? null;

  if (!reviewerId) {
    const { data: centralPlanners, error: centralPlannerError } = await supabase
      .from("users")
      .select("id")
      .eq("role", "central_planner")
      .order("created_at", { ascending: true });

    if (centralPlannerError) {
      throw new Error(`Unable to load central planners: ${centralPlannerError.message}`);
    }

    reviewerId =
      (centralPlanners ?? [])
        .map((row) => (row as { id: string }).id)
        .find((id) => id.length > 0) ?? null;
  }

  if (!reviewerId) {
    return { reviewerId: null, newlyAssigned: false };
  }

  const { error: updateError } = await supabase
    .from("events")
    .update({
      assigned_reviewer_id: reviewerId,
    })
    .eq("id", event.id);

  if (updateError) {
    throw new Error(`Unable to assign reviewer: ${updateError.message}`);
  }

  await recordAuditLog({
    actorId,
    action: "event.reviewer_assigned",
    entityType: "event",
    entityId: event.id,
    details: {
      reviewer_id: reviewerId,
    },
  });

  const { data: reviewerProfile } = await supabase
    .from("users")
    .select("email,full_name")
    .eq("id", reviewerId)
    .maybeSingle();

  const reviewerEmail = (reviewerProfile?.email as string | null) ?? null;

  if (reviewerEmail) {
    try {
      await sendReviewerAssignmentEmail({
        reviewerEmail,
        reviewerName: (reviewerProfile?.full_name as string | null) ?? null,
        eventTitle: event.title,
        venueName: event.venue_name ?? "Venue TBC",
        startAt: event.start_at ?? "",
        dashboardUrl,
      });
    } catch (error) {
      console.error("[reviews] Failed to send assignment email", {
        eventId: event.id,
        reviewerId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { reviewerId, newlyAssigned: true };
};

const queueDraftReminder = async ({
  supabase,
  eventId,
  userId,
}: {
  supabase: ServiceSupabaseClient;
  eventId: string;
  userId: string;
}): Promise<void> => {
  const remindAt = new Date(Date.now() + DRAFT_REMINDER_DELAY_MS).toISOString();

  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("type", "draft_reminder")
    .eq("user_id", userId)
    .contains("payload", { event_id: eventId })
    .in("status", ["queued", "sending"])
    .limit(1);

  if (existing && existing.length > 0) {
    return;
  }

  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    type: "draft_reminder",
    status: "queued",
    payload: {
      event_id: eventId,
      remind_at: remindAt,
    },
  });

  if (error) {
    console.error("[events] Failed to queue draft reminder", {
      eventId,
      userId,
      error: error.message,
    });
  }
};

const performEventSubmission = async ({
  supabase,
  event,
  actorId,
  preloadedAreaIds,
}: {
  supabase: ServiceSupabaseClient;
  event: SubmissionEventRecord;
  actorId: string;
  preloadedAreaIds?: string[];
}): Promise<void> => {
  if (!["draft", "needs_revisions"].includes(event.status)) {
    throw new Error("Only drafts or revisions can be submitted.");
  }

  let areaIds = preloadedAreaIds;

  if (!areaIds) {
    areaIds = await getEventAreaIds(supabase, event.id);
  }

  if (areaIds.length === 0) {
    const availableAreaCount = await getVenueAreaCount(supabase, event.venue_id);
    if (availableAreaCount > 0) {
      throw new Error("Assign at least one venue area before submitting this draft.");
    }
  }

  const { data: latestVersion, error: versionFetchError } = await supabase
    .from("event_versions")
    .select("version, payload")
    .eq("event_id", event.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionFetchError) {
    throw new Error(`Unable to load draft versions: ${versionFetchError.message}`);
  }

  const nextVersionNumber = (latestVersion?.version ?? 0) + 1;
  const submittedAt = new Date().toISOString();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { reviewerId } = await ensureReviewerAssignment({
    supabase,
    event,
    actorId,
    dashboardUrl: `${appUrl}/reviews`,
  });

  const { error: updateError } = await supabase
    .from("events")
    .update({
      status: "submitted",
    })
    .eq("id", event.id);

  if (updateError) {
    throw new Error(`Unable to submit draft: ${updateError.message}`);
  }

  const previousPayload =
    latestVersion?.payload && typeof latestVersion.payload === "object"
      ? (latestVersion.payload as Record<string, unknown>)
      : {};

  const submissionPayload = {
    ...previousPayload,
    status: "submitted",
    title: event.title,
    start_at: event.start_at,
    end_at: event.end_at,
    venue_id: event.venue_id,
    venue_area_ids: areaIds,
    assigned_reviewer_id: reviewerId ?? event.assigned_reviewer_id ?? null,
    submitted_at: submittedAt,
    submitted_by: actorId,
  } satisfies Record<string, unknown>;

  const { error: versionError } = await supabase
    .from("event_versions")
    .insert({
      event_id: event.id,
      version: nextVersionNumber,
      payload: submissionPayload,
      submitted_at: submittedAt,
      submitted_by: actorId,
    });

  if (versionError) {
    throw new Error(
      `Draft submitted but version snapshot failed: ${versionError.message}`
    );
  }

  await recordAuditLog({
    actorId,
    action: "event.submitted",
    entityType: "event",
    entityId: event.id,
    details: {
      version: nextVersionNumber,
      submitted_at: submittedAt,
      venue_area_ids: areaIds,
      assigned_reviewer_id: reviewerId ?? event.assigned_reviewer_id ?? null,
    },
  });
};

export async function createEventDraftAction(
  formData: FormData
): Promise<EventFormState | void> {
  const profile = await getCurrentUserProfile();

  const intentRaw = formData.get("intent");
  const intent = intentRaw === "submit" ? "submit" : "save";

  if (!profile) {
    return {
      error: "You must be signed in to create an event.",
    };
  }

  if (
    !["venue_manager", "central_planner"].includes(profile.role ?? "")
  ) {
    return {
      error: "You do not have permission to create event drafts.",
    };
  }

  const rawAreaIds = formData
    .getAll("areaIds")
    .map((value) => (typeof value === "string" ? value : String(value)));

  const parseResult = eventSchema.safeParse({
    title: formData.get("title"),
    venueId: formData.get("venueId"),
    startAt: formData.get("startAt"),
    endAt: formData.get("endAt"),
    areaIds: rawAreaIds,
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

  const areaIds = (parseResult.data.areaIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

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

  if (areaIds.length === 0) {
    const { count: availableAreaCount, error: areaCountError } = await supabase
      .from("venue_areas")
      .select("id", { head: true, count: "exact" })
      .eq("venue_id", parseResult.data.venueId);

    if (areaCountError) {
      return {
        error: `Unable to verify venue areas: ${areaCountError.message}`,
      };
    }

    if ((availableAreaCount ?? 0) > 0) {
      return {
        fieldErrors: {
          areaIds: "Select at least one area for this venue before creating the draft.",
        },
        error: "Select at least one area before creating this draft.",
      };
    }
  }

  if (areaIds.length > 0) {
    const { data: fetchedAreas, error: areaFetchError } = await supabase
      .from("venue_areas")
      .select("id, venue_id")
      .in("id", areaIds);

    if (areaFetchError) {
      return {
        error: `Unable to verify venue areas: ${areaFetchError.message}`,
      };
    }

    const areaRecords = (fetchedAreas ?? []) as Array<{ id: string; venue_id: string }>;

    if (areaRecords.length !== areaIds.length) {
      return {
        error: "One or more selected areas could not be found. Refresh and try again.",
      };
    }

    const invalidArea = areaRecords.some(
      (area) => area.venue_id !== parseResult.data.venueId
    );

    if (invalidArea) {
      return {
        error: "Selected areas do not belong to the chosen venue.",
      };
    }
  }

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
    .select(
      `
        id,
        title,
        status,
        start_at,
        end_at,
        venue_id,
        created_by,
        assigned_reviewer_id,
        venue:venues(name)
      `
    )
    .single();

  if (error) {
    return {
      error: `Unable to create event draft: ${error.message}`,
    };
  }

  const rawEventRow = data as
    | {
        id: string;
        title: string;
        status: string;
        start_at: string | null;
        end_at: string | null;
        venue_id: string;
        created_by: string;
        assigned_reviewer_id: string | null;
        venue?: { name: string | null } | Array<{ name: string | null }> | null;
      }
    | null;

  const eventId = rawEventRow?.id;

  if (!eventId) {
    return {
      error: "Event draft created without identifier. Please retry.",
    };
  }

  if (areaIds.length > 0) {
    const { error: areaInsertError } = await supabase
      .from("event_areas")
      .insert(
        areaIds.map((areaId) => ({
          event_id: eventId,
          venue_area_id: areaId,
        }))
      );

    if (areaInsertError) {
      await supabase.from("events").delete().eq("id", eventId);
      return {
        error: `Draft created but venue areas could not be saved: ${areaInsertError.message}`,
      };
    }
  }

  const versionPayload = {
    title: parseResult.data.title,
    start_at: parseResult.data.startAt,
    end_at: parseResult.data.endAt ?? null,
    venue_id: parseResult.data.venueId,
    venue_area_ids: areaIds,
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
      venue_area_ids: areaIds,
      version: 1,
    },
  });

  const submissionEvent: SubmissionEventRecord = {
    id: eventId,
    title: rawEventRow?.title ?? parseResult.data.title,
    status: rawEventRow?.status ?? "draft",
    start_at:
      rawEventRow?.start_at ?? new Date(parseResult.data.startAt).toISOString(),
    end_at:
      rawEventRow?.end_at ??
      (parseResult.data.endAt ? new Date(parseResult.data.endAt).toISOString() : null),
    venue_id: parseResult.data.venueId,
    venue_name: extractVenueName(rawEventRow?.venue ?? null),
    created_by: rawEventRow?.created_by ?? profile.id,
    assigned_reviewer_id: rawEventRow?.assigned_reviewer_id ?? null,
  };

  if (intent === "submit") {
    try {
      await performEventSubmission({
        supabase,
        event: submissionEvent,
        actorId: profile.id,
        preloadedAreaIds: areaIds,
      });
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Unable to submit event draft.",
      };
    }
  } else {
    await queueDraftReminder({
      supabase,
      eventId,
      userId: profile.id,
    });
  }

  if (intent === "submit") {
    revalidatePath("/events");
    revalidatePath("/reviews");
    redirect("/events?status=submitted");
  } else {
    revalidatePath("/events");
    redirect("/events?status=created");
  }
}

const submitSchema = z.object({
  eventId: z.string().uuid("Invalid event identifier."),
});

const updateSchema = eventSchema.extend({
  eventId: z.string().uuid("Invalid event identifier."),
});

export async function updateEventDraftAction(
  formData: FormData
): Promise<EventFormState | void> {
  const profile = await getCurrentUserProfile();
  const intentRaw = formData.get("intent");
  const intent = intentRaw === "submit" ? "submit" : "save";

  if (!profile) {
    return {
      error: "You must be signed in to update this event.",
    };
  }

  if (!["venue_manager", "central_planner"].includes(profile.role ?? "")) {
    return {
      error: "You do not have permission to update this event.",
    };
  }

  const rawAreaIds = formData
    .getAll("areaIds")
    .map((value) => (typeof value === "string" ? value : String(value)));

  const parsed = updateSchema.safeParse({
    eventId: formData.get("eventId"),
    title: formData.get("title"),
    venueId: formData.get("venueId"),
    startAt: formData.get("startAt"),
    endAt: formData.get("endAt"),
    areaIds: rawAreaIds,
  });

  if (!parsed.success) {
    const fieldErrors: EventFormState["fieldErrors"] = {};
    const flattened = parsed.error.flatten().fieldErrors;

    for (const [key, messages] of Object.entries(flattened)) {
      if (key === "eventId") continue;
      if (messages && messages.length > 0) {
        fieldErrors[key as keyof EventDraftInput] = messages[0];
      }
    }

    return {
      fieldErrors,
      error: "Please fix the highlighted fields before saving.",
    };
  }

  const areaIds = (parsed.data.areaIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const supabase = createSupabaseServiceRoleClient();

  const { data: eventRecord, error: eventFetchError } = await supabase
    .from("events")
    .select(
      `
        id,
        status,
        created_by,
        venue_id,
        title,
        start_at,
        end_at,
        assigned_reviewer_id
      `
    )
    .eq("id", parsed.data.eventId)
    .maybeSingle();

  if (eventFetchError) {
    return {
      error: `Unable to load event: ${eventFetchError.message}`,
    };
  }

  if (!eventRecord) {
    return {
      error: "We could not find that event. Refresh and try again.",
    };
  }

  const isCentralPlanner = profile.role === "central_planner";
  const isVenueManager = profile.role === "venue_manager";
  const isOwner = profile.id === eventRecord.created_by;

  if (!isCentralPlanner && !(isVenueManager && isOwner)) {
    return {
      error: "You do not have permission to update this event.",
    };
  }

  if (!["draft", "needs_revisions"].includes(eventRecord.status ?? "")) {
    return {
      error: "Only drafts or events needing revisions can be updated.",
    };
  }

  if (areaIds.length === 0) {
    const { count: availableAreaCount, error: areaCountError } = await supabase
      .from("venue_areas")
      .select("id", { head: true, count: "exact" })
      .eq("venue_id", parsed.data.venueId);

    if (areaCountError) {
      return {
        error: `Unable to verify venue areas: ${areaCountError.message}`,
      };
    }

    if ((availableAreaCount ?? 0) > 0) {
      return {
        fieldErrors: {
          areaIds: "Select at least one area for this venue before saving changes.",
        },
        error: "Select at least one area before saving this draft.",
      };
    }
  }

  if (areaIds.length > 0) {
    const { data: fetchedAreas, error: areaFetchError } = await supabase
      .from("venue_areas")
      .select("id, venue_id")
      .in("id", areaIds);

    if (areaFetchError) {
      return {
        error: `Unable to verify venue areas: ${areaFetchError.message}`,
      };
    }

    const areaRecords = (fetchedAreas ?? []) as Array<{ id: string; venue_id: string }>;

    if (areaRecords.length !== areaIds.length) {
      return {
        error: "One or more selected areas could not be found. Refresh and try again.",
      };
    }

    const invalidArea = areaRecords.some((area) => area.venue_id !== parsed.data.venueId);

    if (invalidArea) {
      return {
        error: "Selected areas do not belong to the chosen venue.",
      };
    }
  }

  const previousEventState = {
    title: eventRecord.title,
    venue_id: eventRecord.venue_id,
    start_at: eventRecord.start_at,
    end_at: eventRecord.end_at,
  };

  let previousAreaIds: string[] = [];

  try {
    previousAreaIds = await getEventAreaIds(supabase, eventRecord.id);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to load existing venue areas.",
    };
  }

  const restorePreviousAreas = async () => {
    try {
      await supabase
        .from("event_areas")
        .delete()
        .eq("event_id", eventRecord.id);
    } catch {
      // ignore restore failures
    }

    if (previousAreaIds.length > 0) {
      try {
        await supabase
          .from("event_areas")
          .insert(
            previousAreaIds.map((areaId) => ({
              event_id: eventRecord.id,
              venue_area_id: areaId,
            }))
          );
      } catch {
        // ignore restore failures
      }
    }
  };

  const { error: areaDeleteError } = await supabase
    .from("event_areas")
    .delete()
    .eq("event_id", eventRecord.id);

  if (areaDeleteError) {
    return {
      error: `Unable to update venue areas: ${areaDeleteError.message}`,
    };
  }

  if (areaIds.length > 0) {
    const { error: areaInsertError } = await supabase
      .from("event_areas")
      .insert(
        areaIds.map((areaId) => ({
          event_id: eventRecord.id,
          venue_area_id: areaId,
        }))
      );

    if (areaInsertError) {
      await restorePreviousAreas();
      return {
        error: `Unable to update venue areas: ${areaInsertError.message}`,
      };
    }
  }

  const updatedStartIso = new Date(parsed.data.startAt).toISOString();
  const updatedEndIso = parsed.data.endAt ? new Date(parsed.data.endAt).toISOString() : null;

  const { error: eventUpdateError } = await supabase
    .from("events")
    .update({
      title: parsed.data.title,
      venue_id: parsed.data.venueId,
      start_at: updatedStartIso,
      end_at: updatedEndIso,
    })
    .eq("id", eventRecord.id);

  if (eventUpdateError) {
    await restorePreviousAreas();
    try {
      await supabase
        .from("events")
        .update(previousEventState)
        .eq("id", eventRecord.id);
    } catch {
      // ignore restore failures
    }

    return {
      error: `Unable to update event draft: ${eventUpdateError.message}`,
    };
  }

  const { data: venueRow } = await supabase
    .from("venues")
    .select("name")
    .eq("id", parsed.data.venueId)
    .maybeSingle();

  const venueName = (venueRow?.name as string | null) ?? null;

  const { data: latestVersion, error: versionFetchError } = await supabase
    .from("event_versions")
    .select("version,payload")
    .eq("event_id", eventRecord.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionFetchError) {
    try {
      await supabase
        .from("events")
        .update(previousEventState)
        .eq("id", eventRecord.id);
    } catch {
      // ignore restore failures
    }
    await restorePreviousAreas();

    return {
      error: `Unable to load draft versions: ${versionFetchError.message}`,
    };
  }

  const previousPayload =
    latestVersion?.payload && typeof latestVersion.payload === "object"
      ? (latestVersion.payload as Record<string, unknown>)
      : {};

  const nextVersionNumber = (latestVersion?.version ?? 0) + 1;

  const updatedPayload = {
    ...previousPayload,
    title: parsed.data.title,
    start_at: parsed.data.startAt,
    end_at: parsed.data.endAt ?? null,
    venue_id: parsed.data.venueId,
    venue_area_ids: areaIds,
    status: eventRecord.status,
  };

  const { error: versionInsertError } = await supabase
    .from("event_versions")
    .insert({
      event_id: eventRecord.id,
      version: nextVersionNumber,
      payload: updatedPayload,
    });

  if (versionInsertError) {
    try {
      await supabase
        .from("events")
        .update(previousEventState)
        .eq("id", eventRecord.id);
    } catch {
      // ignore restore failures
    }
    await restorePreviousAreas();

    return {
      error: `Draft updated but version snapshot failed: ${versionInsertError.message}`,
    };
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "event.draft_updated",
    entityType: "event",
    entityId: eventRecord.id,
    details: {
      previous: {
        title: previousEventState.title,
        venue_id: previousEventState.venue_id,
        start_at: previousEventState.start_at,
        end_at: previousEventState.end_at,
        venue_area_ids: previousAreaIds,
      },
      updated: {
        title: parsed.data.title,
        venue_id: parsed.data.venueId,
        start_at: parsed.data.startAt,
        end_at: parsed.data.endAt ?? null,
        venue_area_ids: areaIds,
      },
    },
  });

  if (intent === "submit") {
    try {
      await performEventSubmission({
        supabase,
        event: {
          id: eventRecord.id,
          title: parsed.data.title,
          status: eventRecord.status,
          start_at: updatedStartIso,
          end_at: updatedEndIso,
          venue_id: parsed.data.venueId,
          venue_name: venueName,
          created_by: eventRecord.created_by,
          assigned_reviewer_id: eventRecord.assigned_reviewer_id ?? null,
        },
        actorId: profile.id,
        preloadedAreaIds: areaIds,
      });
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Unable to submit event draft.",
      };
    }

    revalidatePath(`/events/${eventRecord.id}`);
    revalidatePath("/events");
    revalidatePath("/reviews");
    redirect("/events?status=submitted");
  } else {
    await queueDraftReminder({
      supabase,
      eventId: eventRecord.id,
      userId: profile.id,
    });

    revalidatePath("/events");
    revalidatePath(`/events/${eventRecord.id}`);
    redirect(`/events/${eventRecord.id}?status=updated`);
  }
}

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
  const { data: eventRow, error: fetchError } = await supabase
    .from("events")
    .select(
      `
        id,
        title,
        status,
        start_at,
        end_at,
        venue_id,
        created_by,
        assigned_reviewer_id,
        venue:venues(name)
      `
    )
    .eq("id", parse.data.eventId)
    .single();

  if (fetchError || !eventRow) {
    throw new Error(
      fetchError?.message ?? "We could not find that draft. Please try again."
    );
  }

  const submissionEvent: SubmissionEventRecord = {
    id: eventRow.id,
    title: eventRow.title,
    status: eventRow.status,
    start_at: eventRow.start_at,
    end_at: eventRow.end_at,
    venue_id: eventRow.venue_id,
    venue_name: extractVenueName(eventRow.venue ?? null),
    created_by: eventRow.created_by,
    assigned_reviewer_id: eventRow.assigned_reviewer_id,
  };

  const isCentralPlanner = profile.role === "central_planner";
  const isOwner = submissionEvent.created_by === profile.id;

  if (!isCentralPlanner && !(profile.role === "venue_manager" && isOwner)) {
    throw new Error("You do not have permission to submit this draft.");
  }

  await performEventSubmission({
    supabase,
    event: submissionEvent,
    actorId: profile.id,
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

  if (!profile || profile.role !== "central_planner") {
    return {
      error: "Only Central planners can clone events.",
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

  const { data: sourceAreaRows, error: sourceAreaError } = await supabase
    .from("event_areas")
    .select("venue_area_id")
    .eq("event_id", sourceEvent.id);

  if (sourceAreaError) {
    return {
      error: `Unable to load source event areas: ${sourceAreaError.message}`,
    };
  }

  const sourceAreaIds = (sourceAreaRows ?? []).map(
    (row) => (row as { venue_area_id: string }).venue_area_id
  );

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

  if (sourceAreaIds.length > 0) {
    const { error: areaCloneError } = await supabase
      .from("event_areas")
      .insert(
        sourceAreaIds.map((areaId) => ({
          event_id: draftResult.id,
          venue_area_id: areaId,
        }))
      );

    if (areaCloneError) {
      await supabase.from("events").delete().eq("id", draftResult.id);
      return {
        error: `Draft created but venue areas could not be copied: ${areaCloneError.message}`,
      };
    }
  }

  const clonePayload = {
    ...(latestVersion?.payload ?? {}),
    cloned_from: sourceEvent.id,
    cloned_at: now,
    venue_area_ids: sourceAreaIds,
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
      venue_area_ids: sourceAreaIds,
    },
  });

  revalidatePath("/events");
  revalidatePath("/planning");

  return undefined;
}
