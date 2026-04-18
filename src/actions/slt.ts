"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAuditLogEntry } from "@/lib/audit-log";
import type { ActionResult } from "@/lib/types";

const addSchema = z.object({ userId: z.string().uuid() });
const removeSchema = z.object({ userId: z.string().uuid() });

export async function addSltMemberAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can manage SLT." };
  }

  const parsed = addSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) {
    return { success: false, message: "Select a user." };
  }

  const db = createSupabaseAdminClient();
   
  const { data, error } = await (db as any)
    .from("slt_members")
    .insert({ user_id: parsed.data.userId, added_by: user.id })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { success: false, message: "That user is already on the SLT." };
    }
    console.error("addSltMemberAction failed:", error);
    return { success: false, message: "Could not add SLT member." };
  }

  await recordAuditLogEntry({
    entity: "slt_member",
    entityId: data.id,
    action: "slt_member.added",
    actorId: user.id,
    meta: { user_id: parsed.data.userId }
  });

  revalidatePath("/settings");
  return { success: true, message: "SLT member added." };
}

export async function removeSltMemberAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can manage SLT." };
  }

  const parsed = removeSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) {
    return { success: false, message: "Select a user." };
  }

  const db = createSupabaseAdminClient();
   
  const { data, error } = await (db as any)
    .from("slt_members")
    .delete()
    .eq("user_id", parsed.data.userId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("removeSltMemberAction failed:", error);
    return { success: false, message: "Could not remove SLT member." };
  }

  if (data) {
    await recordAuditLogEntry({
      entity: "slt_member",
      entityId: data.id,
      action: "slt_member.removed",
      actorId: user.id,
      meta: { user_id: parsed.data.userId }
    });
  }

  revalidatePath("/settings");
  return { success: true, message: "SLT member removed." };
}
