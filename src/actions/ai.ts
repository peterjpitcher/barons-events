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
