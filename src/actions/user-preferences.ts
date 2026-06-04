"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAuditLogEntry } from "@/lib/audit-log";
import type { ActionResult } from "@/lib/types";

const pinPreferenceSchema = z.object({
  preference: z.enum(["sop_drawer_pinned", "debrief_pinned", "planning_queue_pinned"]),
  value: z.boolean()
});

function isMissingPreferenceColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    Boolean(error.message?.includes("sop_drawer_pinned")) ||
    Boolean(error.message?.includes("debrief_pinned")) ||
    Boolean(error.message?.includes("planning_queue_pinned"))
  );
}

export async function setUserPinPreferenceAction(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const parsed = pinPreferenceSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Invalid preference." };

  const db = createSupabaseAdminClient();
  const { error } = await (db as any)
    .from("users")
    .update({ [parsed.data.preference]: parsed.data.value })
    .eq("id", user.id);

  if (error) {
    return {
      success: false,
      message: isMissingPreferenceColumn(error)
        ? "Pin preferences need the latest database migration before they can be saved."
        : "Could not save preference."
    };
  }

  await recordAuditLogEntry({
    entity: "user",
    entityId: user.id,
    action: "user.preference_updated",
    actorId: user.id,
    meta: {
      preference: parsed.data.preference,
      value: parsed.data.value
    }
  });

  revalidatePath("/events");
  revalidatePath("/planning");
  return { success: true };
}
