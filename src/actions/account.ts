"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TODO_DIGEST_FREQUENCIES } from "@/lib/communication-preferences";
import { getFieldErrors } from "@/lib/form-errors";
import { recordAuditLogEntry } from "@/lib/audit-log";
import type { ActionResult } from "@/lib/types";

const communicationPreferencesSchema = z.object({
  todoDigestFrequency: z.enum(TODO_DIGEST_FREQUENCIES),
});

export async function updateCommunicationPreferencesAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const parsed = communicationPreferencesSchema.safeParse({
    todoDigestFrequency: formData.get("todoDigestFrequency"),
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Check the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error),
    };
  }

  const db = createSupabaseAdminClient();

  const { data: before, error: beforeError } = await db
    .from("users")
    .select("todo_digest_frequency")
    .eq("id", user.id)
    .maybeSingle();

  if (beforeError) {
    console.error("updateCommunicationPreferencesAction read failed:", beforeError);
    return { success: false, message: "Could not load your preferences." };
  }

  const previousFrequency = before?.todo_digest_frequency ?? "weekdays";
  const frequencyChanged = previousFrequency !== parsed.data.todoDigestFrequency;

  const updatePayload: {
    todo_digest_frequency: string;
    todo_digest_last_sent_on?: string | null;
  } = {
    todo_digest_frequency: parsed.data.todoDigestFrequency,
  };

  if (frequencyChanged) {
    updatePayload.todo_digest_last_sent_on = null;
  }

  const { error } = await db
    .from("users")
    .update(updatePayload)
    .eq("id", user.id);

  if (error) {
    console.error("updateCommunicationPreferencesAction update failed:", error);
    return { success: false, message: "Could not update your preferences." };
  }

  await recordAuditLogEntry({
    entity: "user",
    entityId: user.id,
    action: "user.updated",
    actorId: user.id,
    meta: {
      changed_fields: frequencyChanged ? ["todo_digest_frequency"] : [],
      todo_digest_frequency: {
        old_value: previousFrequency,
        new_value: parsed.data.todoDigestFrequency,
      },
    },
  });

  revalidatePath("/account");
  return { success: true, message: "Communication preferences updated." };
}
