"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { recordAuditLog } from "@/lib/audit";
import { generateAiMetadata } from "@/lib/ai/generate";

const publishSchema = z.object({
  contentId: z.string().uuid("Select a valid AI content record."),
  intent: z.enum(["publish", "retract"]),
});

export type PublishAiContentState = {
  error?: string;
};

export async function updateAiContentPublicationAction(
  _prevState: PublishAiContentState | undefined,
  formData: FormData
): Promise<PublishAiContentState | void> {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "central_planner") {
    return {
      error: "Only Central planners can manage AI metadata.",
    };
  }

  const parsed = publishSchema.safeParse({
    contentId: formData.get("contentId"),
    intent: formData.get("intent"),
  });

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Provide a valid publication instruction.",
    };
  }

  const supabase = createSupabaseServiceRoleClient();
  const publishedAt =
    parsed.data.intent === "publish" ? new Date().toISOString() : null;

  const { data: contentRow, error: contentFetchError } = await supabase
    .from("ai_content")
    .select(
      `
        id,
        event_id,
        synopsis,
        hero_copy,
        seo_keywords,
        audience_tags,
        talent_bios,
        version,
        published_at
      `
    )
    .eq("id", parsed.data.contentId)
    .single();

  if (contentFetchError || !contentRow) {
    return {
      error:
        contentFetchError?.message ??
        "Unable to load AI metadata before publishing.",
    };
  }

  if (parsed.data.intent === "publish") {
    const seoKeywords = normaliseJsonStringArray(contentRow.seo_keywords);
    const audienceTags = normaliseJsonStringArray(contentRow.audience_tags);
    const talentBios = normaliseJsonStringArray(contentRow.talent_bios);

    const publishPayload = {
      version: contentRow.version,
      synopsis: contentRow.synopsis,
      heroCopy: contentRow.hero_copy,
      seoKeywords,
      audienceTags,
      talentBios,
    };

    const { error: queueError } = await supabase
      .from("ai_publish_queue")
      .upsert(
        {
          content_id: contentRow.id,
          event_id: contentRow.event_id,
          payload: publishPayload,
          status: "pending",
        },
        { onConflict: "content_id" }
      );

    if (queueError) {
      return {
        error: `Unable to queue metadata publish: ${queueError.message}`,
      };
    }
  }

  const { error } = await supabase
    .from("ai_content")
    .update({
      published_at: publishedAt,
      reviewed_by: profile.id,
    })
    .eq("id", parsed.data.contentId);

  if (error) {
    if (parsed.data.intent === "publish") {
      await supabase
        .from("ai_publish_queue")
        .update({
          status: "failed",
        })
        .eq("content_id", parsed.data.contentId);
    }

    return {
      error: `Unable to update AI metadata: ${error.message}`,
    };
  }

  if (parsed.data.intent === "retract") {
    const { error: cancelError } = await supabase
      .from("ai_publish_queue")
      .update({
        status: "cancelled",
      })
      .eq("content_id", parsed.data.contentId);

    if (cancelError) {
      console.error(
        "[ai_content] Failed to mark publish queue item as cancelled",
        JSON.stringify({
          contentId: parsed.data.contentId,
          error: cancelError.message,
        })
      );
    }
  }

  await recordAuditLog({
    actorId: profile.id,
    action:
      parsed.data.intent === "publish"
        ? "ai_content.published"
        : "ai_content.retracted",
    entityType: "ai_content",
    entityId: parsed.data.contentId,
    details: {
      published_at: publishedAt,
    },
  });

  revalidatePath("/planning");
  revalidatePath("/events");
}

const editSchema = z.object({
  contentId: z.string().uuid("Select a valid AI content record."),
  synopsis: z.string().max(2000, "Synopsis should be 2000 characters or fewer.").optional().or(z.literal("")),
  heroCopy: z.string().max(2000, "Hero copy should be 2000 characters or fewer.").optional().or(z.literal("")),
  seoKeywords: z.string().max(1000, "Keywords should be 1000 characters or fewer.").optional().or(z.literal("")),
  audienceTags: z.string().max(1000, "Audience tags should be 1000 characters or fewer.").optional().or(z.literal("")),
  talentBios: z.string().max(2000, "Talent bios should be 2000 characters or fewer.").optional().or(z.literal("")),
});

const editableFields = ["synopsis", "heroCopy", "seoKeywords", "audienceTags", "talentBios"] as const;
type EditableField = (typeof editableFields)[number];

export type SaveAiContentState = {
  error?: string;
  success?: boolean;
  fieldErrors?: Partial<Record<EditableField, string>>;
};

const parseList = (value: string | undefined) =>
  value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];

const normaliseJsonStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0);
      }
    } catch {
      // Ignore JSON parsing failures; fall back to comma-separated parsing.
    }

    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
};

const toNullableArray = (values: string[]): string[] | null =>
  values.length > 0 ? values : null;

export async function saveAiContentAction(
  _prevState: SaveAiContentState | undefined,
  formData: FormData
): Promise<SaveAiContentState | void> {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "central_planner") {
    return {
      error: "Only Central planners can manage AI metadata.",
    };
  }

  const submission = {
    contentId: String(formData.get("contentId") ?? ""),
    synopsis: formData.get("synopsis")?.toString() ?? "",
    heroCopy: formData.get("heroCopy")?.toString() ?? "",
    seoKeywords: formData.get("seoKeywords")?.toString() ?? "",
    audienceTags: formData.get("audienceTags")?.toString() ?? "",
    talentBios: formData.get("talentBios")?.toString() ?? "",
  };

  const parsed = editSchema.safeParse(submission);

  if (!parsed.success) {
    const fieldErrors: Partial<Record<EditableField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field && editableFields.includes(field as EditableField)) {
        const fieldName = field as EditableField;
        fieldErrors[fieldName] = issue.message;
      }
    }

    return {
      error: "Please correct the highlighted fields before saving.",
      fieldErrors,
    };
  }

  const supabase = createSupabaseServiceRoleClient();
  const keywordList = parseList(parsed.data.seoKeywords);
  const audienceList = parseList(parsed.data.audienceTags);
  const talentList = parseList(parsed.data.talentBios);

  const { error } = await supabase
    .from("ai_content")
    .update({
      synopsis: parsed.data.synopsis?.length ? parsed.data.synopsis : null,
      hero_copy: parsed.data.heroCopy?.length ? parsed.data.heroCopy : null,
      seo_keywords: keywordList.length > 0 ? keywordList : null,
      audience_tags: audienceList.length > 0 ? audienceList : null,
      talent_bios: talentList.length > 0 ? talentList : null,
      reviewed_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.contentId);

  if (error) {
    return {
      error: `Unable to update AI metadata: ${error.message}`,
    };
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "ai_content.updated",
    entityType: "ai_content",
    entityId: parsed.data.contentId,
    details: {
      reviewer_id: profile.id,
    },
  });

  revalidatePath("/planning");
  revalidatePath("/events");

  return {
    success: true,
  };
}

const regenerateSchema = z.object({
  contentId: z.string().uuid("Select a valid AI content record."),
  reason: z
    .string()
    .max(500, "Reason should be 500 characters or fewer.")
    .optional()
    .or(z.literal("")),
});

export type RegenerateAiContentState = {
  error?: string;
  success?: boolean;
  contentId?: string;
};

export async function regenerateAiContentAction(
  _prevState: RegenerateAiContentState | undefined,
  formData: FormData
): Promise<RegenerateAiContentState | void> {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "central_planner") {
    return {
      error: "Only Central planners can request AI regenerations.",
    };
  }

  const contentIdValue = formData.get("contentId");
  const reasonValue = formData.get("reason");

  const parsed = regenerateSchema.safeParse({
    contentId: contentIdValue,
    reason: typeof reasonValue === "string" ? reasonValue : undefined,
  });

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Provide a valid regeneration request.",
    };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data: contentRow, error: contentFetchError } = await supabase
    .from("ai_content")
    .select("id,event_id,version")
    .eq("id", parsed.data.contentId)
    .maybeSingle();

  if (contentFetchError || !contentRow) {
    return {
      error:
        contentFetchError?.message ??
        "Unable to locate the AI content record.",
    };
  }

  const { data: latestVersionRow, error: versionFetchError } = await supabase
    .from("ai_content")
    .select("version")
    .eq("event_id", contentRow.event_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionFetchError) {
    return {
      error: `Unable to determine next version: ${versionFetchError.message}`,
    };
  }

  const nextVersion = (latestVersionRow?.version ?? 0) + 1;
  const requestedAt = new Date().toISOString();

  const reason = parsed.data.reason?.trim() ? parsed.data.reason.trim() : null;

  const { data: eventDetails } = await supabase
    .from("events")
    .select("title, venue:venues(name)")
    .eq("id", contentRow.event_id)
    .maybeSingle();

  const venueRelation = eventDetails?.venue;
  let venueName: string | null = null;
  if (Array.isArray(venueRelation)) {
    const [firstVenue] = venueRelation as Array<{ name: string | null }>;
    venueName = firstVenue?.name ?? null;
  } else if (venueRelation && typeof venueRelation === "object") {
    const singleVenue = venueRelation as { name: string | null };
    venueName = singleVenue.name ?? null;
  }

  const aiOutput = await generateAiMetadata({
    eventTitle: (eventDetails?.title as string | null) ?? "Barons Event",
    venueName,
    reason,
  });

  const aiSnapshot = {
    synopsis: aiOutput.synopsis,
    hero_copy: aiOutput.heroCopy,
    seo_keywords: toNullableArray(aiOutput.seoKeywords),
    audience_tags: toNullableArray(aiOutput.audienceTags),
    talent_bios: toNullableArray(aiOutput.talentBios),
  };

  const { error: insertError } = await supabase
    .from("ai_content")
    .insert({
      event_id: contentRow.event_id,
      version: nextVersion,
      synopsis: aiSnapshot.synopsis,
      hero_copy: aiSnapshot.hero_copy,
      seo_keywords: aiSnapshot.seo_keywords,
      audience_tags: aiSnapshot.audience_tags,
      talent_bios: aiSnapshot.talent_bios,
      generated_at: requestedAt,
      generated_by: aiOutput.generatedBy,
      reviewed_by: profile.id,
    })
    .select("id")
    .single();

  if (insertError) {
    return {
      error: `Unable to request regeneration: ${insertError.message}`,
    };
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "ai_content.regenerate_requested",
    entityType: "ai_content",
    entityId: parsed.data.contentId,
    details: {
      requested_version: nextVersion,
      base_content_id: parsed.data.contentId,
      generated_by: aiOutput.generatedBy,
      reason,
    },
  });

  revalidatePath("/planning");
  revalidatePath("/events");

  return {
    success: true,
    contentId: parsed.data.contentId,
  };
}
