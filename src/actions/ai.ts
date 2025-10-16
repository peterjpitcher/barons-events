"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { recordAuditLog } from "@/lib/audit";

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

  if (!profile || profile.role !== "hq_planner") {
    return {
      error: "Only HQ planners can manage AI metadata.",
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

  const { error } = await supabase
    .from("ai_content")
    .update({
      published_at: publishedAt,
      reviewed_by: profile.id,
    })
    .eq("id", parsed.data.contentId);

  if (error) {
    return {
      error: `Unable to update AI metadata: ${error.message}`,
    };
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

export type SaveAiContentState = {
  error?: string;
  success?: boolean;
  fieldErrors?: Partial<
    Record<"synopsis" | "heroCopy" | "seoKeywords" | "audienceTags" | "talentBios", string>
  >;
};

const parseList = (value: string | undefined) =>
  value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];

export async function saveAiContentAction(
  _prevState: SaveAiContentState | undefined,
  formData: FormData
): Promise<SaveAiContentState | void> {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "hq_planner") {
    return {
      error: "Only HQ planners can manage AI metadata.",
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
    const fieldErrors: SaveAiContentState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (
        field &&
        ["synopsis", "heroCopy", "seoKeywords", "audienceTags", "talentBios"].includes(field as string)
      ) {
        fieldErrors![field as keyof SaveAiContentState["fieldErrors"]] = issue.message;
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
