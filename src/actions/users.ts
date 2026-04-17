"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { updateUser } from "@/lib/users";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getFieldErrors } from "@/lib/form-errors";
import type { ActionResult, UserImpactSummary } from "@/lib/types";
import { isAdministrator } from "@/lib/roles";
import { destroyAllSessionsForUser } from "@/lib/auth/session";
import { logAuthEvent, hashEmailForAudit, recordAuditLogEntry } from "@/lib/audit-log";
import { resolveAppUrl } from "@/lib/app-url";
import { sendInviteEmail } from "@/lib/notifications";

const userUpdateSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().max(120).optional(),
  role: z.enum(["administrator", "office_worker", "executive"]),
  venueId: z.union([z.string().uuid(), z.literal(""), z.null(), z.undefined()])
});

export async function updateUserAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }
  if (currentUser.role !== "administrator") {
    return { success: false, message: "Only administrators can change user access." };
  }

  const parsed = userUpdateSchema.safeParse({
    userId: formData.get("userId"),
    fullName: typeof formData.get("fullName") === "string" ? formData.get("fullName") : undefined,
    role: typeof formData.get("role") === "string" ? formData.get("role") : "",
    venueId: formData.get("venueId")
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Check the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error)
    };
  }

  try {
    const supabase = await createSupabaseActionClient();
    const { data: currentUserData } = await supabase
      .from("users")
      .select("role, venue_id")
      .eq("id", parsed.data.userId)
      .single();

    await updateUser(parsed.data.userId, {
      fullName: parsed.data.fullName ?? null,
      role: parsed.data.role,
      venueId: parsed.data.venueId ? parsed.data.venueId : null
    });

    // Destroy all sessions for the user when their role changes.
    // This prevents demoted users from retaining elevated access in active sessions.
    try {
      await destroyAllSessionsForUser(parsed.data.userId);
    } catch (sessionError) {
      console.error("Failed to destroy sessions after role update:", sessionError);
      // Non-fatal: the role change in DB is authoritative
    }

    await logAuthEvent({
      event: "auth.role.changed",
      userId: currentUser.id,
      meta: {
        targetUserId: parsed.data.userId,
        oldRole: currentUserData?.role ?? "unknown",
        newRole: parsed.data.role,
        oldVenueId: currentUserData?.venue_id ?? null,
        newVenueId: parsed.data.venueId ? parsed.data.venueId : null
      }
    });

    // Capture all field changes (not just role) so non-role edits are auditable.
    const changedFields: string[] = [];
    if ((currentUserData?.role ?? null) !== parsed.data.role) changedFields.push("role");
    if ((currentUserData?.venue_id ?? null) !== (parsed.data.venueId || null)) changedFields.push("venue_id");
    if (parsed.data.fullName !== undefined) changedFields.push("full_name");

    await recordAuditLogEntry({
      entity: "user",
      entityId: parsed.data.userId,
      action: "user.updated",
      actorId: currentUser.id,
      meta: { changed_fields: changedFields }
    });

    revalidatePath("/users");
    return { success: true, message: "User updated." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not update the user right now." };
  }
}

const inviteSchema = z.object({
  email: z.string().email({ message: "Enter a valid email" }),
  fullName: z.string().max(120).optional(),
  role: z.enum(["administrator", "office_worker", "executive"]),
  venueId: z.union([z.string().uuid(), z.literal(""), z.null(), z.undefined()])
});

export async function inviteUserAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }
  if (currentUser.role !== "administrator") {
    return { success: false, message: "Only administrators can invite users." };
  }

  const parsed = inviteSchema.safeParse({
    email: typeof formData.get("email") === "string" ? formData.get("email") : "",
    fullName: typeof formData.get("fullName") === "string" ? formData.get("fullName") : undefined,
    role: typeof formData.get("role") === "string" ? formData.get("role") : "",
    venueId: formData.get("venueId")
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Check the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error)
    };
  }

  // Check for existing deactivated user with this email — direct admin to reactivate instead
  const preCheckClient = createSupabaseAdminClient();
  const { data: existingUser } = await preCheckClient
    .from("users")
    .select("id, deactivated_at")
    .eq("email", parsed.data.email)
    .maybeSingle();

  if (existingUser?.deactivated_at) {
    return {
      success: false,
      message: "This email belongs to a deactivated user. Reactivate them instead of sending a new invite.",
    };
  }

  const adminClient = createSupabaseAdminClient();
  const confirmUrl = new URL("/auth/confirm", resolveAppUrl()).toString();

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "invite",
    email: parsed.data.email,
    options: {
      data: { full_name: parsed.data.fullName ?? undefined },
      redirectTo: confirmUrl
    }
  });

  if (linkError) {
    console.error("[invite] generateLink failed:", linkError.status, linkError.message);
    if (linkError.status === 429) {
      return { success: false, message: "Too many invitations sent recently. Please wait a few minutes and try again." };
    }
    return { success: false, message: "Invitation failed. Please try again." };
  }

  const userId = linkData?.user?.id ?? null;
  const hashedToken = linkData?.properties?.hashed_token ?? null;

  if (!userId || !hashedToken) {
    console.error("[invite] generateLink returned incomplete data for", parsed.data.email, { hasUserId: !!userId, hasHashedToken: !!hashedToken });
    return { success: false, message: "Invitation could not be sent. Please try again or contact support." };
  }

  // Build a direct token_hash link that bypasses Supabase's server-side /auth/v1/verify
  // redirect. This avoids OTP-burn by email link prefetchers (Outlook SafeLinks, etc.)
  // and matches what /auth/confirm expects: ?token_hash=...&type=invite
  const inviteLink = `${confirmUrl}?token_hash=${encodeURIComponent(hashedToken)}&type=invite`;

  try {
    const adminDb = createSupabaseAdminClient();
    const { error: upsertError } = await adminDb.from("users").upsert({
      id: userId,
      email: parsed.data.email,
      full_name: parsed.data.fullName ?? null,
      role: parsed.data.role,
      venue_id: parsed.data.venueId ? parsed.data.venueId : null
    });

    if (upsertError) {
      throw upsertError;
    }

    const sent = await sendInviteEmail(parsed.data.email, inviteLink, parsed.data.fullName ?? null);
    if (!sent) {
      console.error("[invite] Resend failed to deliver invite email to", parsed.data.email);
      throw new Error("Email delivery failed");
    }
  } catch (error) {
    console.error("[invite] failed, rolling back auth user:", error);
    try {
      const cleanupClient = createSupabaseAdminClient();
      const { error: deleteError } = await cleanupClient.auth.admin.deleteUser(userId);
      if (deleteError) {
        console.error("[invite] Rollback failed — orphaned auth user:", userId, deleteError);
        await logAuthEvent({
          event: "auth.invite.sent",
          userId: currentUser.id,
          meta: {
            rollback_failed: true,
            orphaned_auth_user_id: userId,
          }
        });
      }
    } catch (cleanupError) {
      console.error("[invite] rollback failed:", cleanupError);
    }
    return { success: false, message: "Invitation failed. Please try again." };
  }

  // Audit logging — outside rollback scope so failures don't invalidate sent invites
  try {
    const emailHash = await hashEmailForAudit(parsed.data.email);
    await logAuthEvent({
      event: "auth.invite.sent",
      userId: currentUser.id,
      emailHash,
      meta: { role: parsed.data.role, inviteeId: userId }
    });
  } catch (auditError) {
    console.error("[invite] audit logging failed (non-fatal):", auditError);
  }

  revalidatePath("/users");
  return { success: true, message: "Invite sent." };
}

export async function resendInviteAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }
  if (currentUser.role !== "administrator") {
    return { success: false, message: "Only administrators can resend invites." };
  }

  // Validate inputs — consistent with the Zod pattern used in inviteUserAction and updateUserAction.
  // `z` is already imported in this file (used by existing schemas above).
  const resendSchema = z.object({
    userId: z.string().uuid(),
    email: z.string().email({ message: "Enter a valid email" }),
    fullName: z.string().max(120).optional()
  });

  const parsed = resendSchema.safeParse({
    userId: formData.get("userId"),
    email: formData.get("email"),
    fullName: typeof formData.get("fullName") === "string" ? formData.get("fullName") : undefined
  });

  if (!parsed.success) {
    return { success: false, message: "Missing required fields." };
  }

  const userId = parsed.data.userId;
  const email = parsed.data.email;
  const fullName = parsed.data.fullName ?? null;   // undefined → null, consistent with inviteUserAction pattern

  const adminClient = createSupabaseAdminClient();

  // Verify the user hasn't already confirmed their email
  const { data: authData, error: getUserError } = await adminClient.auth.admin.getUserById(userId);
  if (getUserError) {
    console.error("[resend-invite] getUserById failed:", getUserError.message);
    return { success: false, message: "Could not verify invite status. Please try again." };
  }
  if (authData?.user?.email_confirmed_at) {   // double-guard: authData itself can be null
    return { success: false, message: "This user has already accepted their invite." };
  }

  // Use server-side email — never trust client-supplied values for invite dispatch
  const serverEmail = authData?.user?.email;
  if (!serverEmail) {
    console.error("[resend-invite] no email found for auth user", userId);
    return { success: false, message: "Could not find user email. Please try again." };
  }

  const confirmUrl = new URL("/auth/confirm", resolveAppUrl()).toString();

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "invite",
    email: serverEmail,
    options: {
      data: { full_name: fullName ?? undefined },
      redirectTo: confirmUrl
    }
  });

  if (linkError) {
    console.error("[resend-invite] generateLink failed:", linkError.status, linkError.message);
    if (linkError.status === 429) {
      return { success: false, message: "Too many invitations sent recently. Please wait a few minutes and try again." };
    }
    return { success: false, message: "Invitation failed. Please try again." };
  }

  const hashedToken = linkData?.properties?.hashed_token ?? null;

  // For a resend action the entire purpose is sending an email, so a missing hashed_token
  // (generateLink succeeded but returned no token) is treated as an error rather than a silent skip.
  if (!hashedToken) {
    console.error("[resend-invite] generateLink returned no hashed_token for", email);
    return { success: false, message: "Invitation failed. Please try again." };
  }

  // Build a direct token_hash link — bypasses Supabase's server-side verify redirect,
  // preventing OTP-burn by email link prefetchers.
  const inviteLink = `${confirmUrl}?token_hash=${encodeURIComponent(hashedToken)}&type=invite`;

  const sent = await sendInviteEmail(serverEmail, inviteLink, fullName);
  if (!sent) {
    console.error("[resend-invite] Resend failed to deliver invite email to", serverEmail);
    return { success: false, message: "Invite created but the email failed to send. Please try again." };
  }

  const emailHash = await hashEmailForAudit(serverEmail);
  await logAuthEvent({
    event: "auth.invite.resent",
    userId: currentUser.id,
    emailHash,
    meta: { inviteeId: userId }
  });

  return { success: true, message: "Invite resent." };
}

// ─── User deactivation / deletion actions ──────────────────────────────────

/** Active users eligible as reassignment targets (excludes executives, deactivated, and the target user). */
export async function listReassignmentTargets(
  excludeUserId: string
): Promise<Array<{ id: string; full_name: string | null; email: string; role: string }>> {
  const caller = await getCurrentUser();
  if (!caller || !isAdministrator(caller.role)) {
    return [];
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("users")
    .select("id, full_name, email, role")
    .is("deactivated_at", null)
    .neq("id", excludeUserId)
    .neq("role", "executive")
    .order("full_name");

  if (error) throw new Error(`Failed to list reassignment targets: ${error.message}`);
  return data ?? [];
}

export async function getUserImpactSummary(
  userId: string
): Promise<{ data?: UserImpactSummary; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdministrator(user.role)) {
    return { error: "Unauthorized" };
  }

  const db = createSupabaseAdminClient();

  const [
    eventsCreated, eventsAssigned,
    planningSeriesOwned, planningSeriesCreated,
    planningItemsOwned, planningItemsCreated,
    planningTasksAssigned, planningTasksCreated,
    planningTaskAssignees, taskTemplateDefaults,
    artistsCreated, eventArtistsCreated,
    shortLinksCreated, venueDefaults,
    approvalsReviewed, eventVersionsSubmitted,
    debriefsSubmitted, eventsDeletedBy,
    tasksCompletedBy, venueOverridesCreated,
    eventsManagerResponsible, venueDefaultManager
  ] = await Promise.all([
    db.from("events").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("events").select("id", { count: "exact", head: true }).eq("assignee_id", userId),
    db.from("planning_series").select("id", { count: "exact", head: true }).eq("owner_id", userId),
    db.from("planning_series").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("planning_items").select("id", { count: "exact", head: true }).eq("owner_id", userId),
    db.from("planning_items").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("planning_tasks").select("id", { count: "exact", head: true }).eq("assignee_id", userId),
    db.from("planning_tasks").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("planning_task_assignees").select("id", { count: "exact", head: true }).eq("user_id", userId),
    db.from("planning_series_task_templates").select("id", { count: "exact", head: true }).eq("default_assignee_id", userId),
    db.from("artists").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("event_artists").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("short_links").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("venues").select("id", { count: "exact", head: true }).eq("default_approver_id", userId),
    db.from("approvals").select("id", { count: "exact", head: true }).eq("reviewer_id", userId),
    db.from("event_versions").select("id", { count: "exact", head: true }).eq("submitted_by", userId),
    db.from("debriefs").select("id", { count: "exact", head: true }).eq("submitted_by", userId),
    db.from("events").select("id", { count: "exact", head: true }).eq("deleted_by", userId),
    db.from("planning_tasks").select("id", { count: "exact", head: true }).eq("completed_by", userId),
    db.from("venue_opening_overrides").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("events").select("id", { count: "exact", head: true }).eq("manager_responsible_id", userId).is("deleted_at", null),
    db.from("venues").select("id", { count: "exact", head: true }).eq("default_manager_responsible_id", userId),
  ]);

  return {
    data: {
      eventsCreated: eventsCreated.count ?? 0,
      eventsAssigned: eventsAssigned.count ?? 0,
      planningSeriesOwned: planningSeriesOwned.count ?? 0,
      planningSeriesCreated: planningSeriesCreated.count ?? 0,
      planningItemsOwned: planningItemsOwned.count ?? 0,
      planningItemsCreated: planningItemsCreated.count ?? 0,
      planningTasks: (planningTasksAssigned.count ?? 0) + (planningTasksCreated.count ?? 0),
      planningTaskAssignees: planningTaskAssignees.count ?? 0,
      taskTemplateDefaults: taskTemplateDefaults.count ?? 0,
      artistsCreated: artistsCreated.count ?? 0,
      eventArtistsCreated: eventArtistsCreated.count ?? 0,
      shortLinksCreated: shortLinksCreated.count ?? 0,
      venueDefaults: venueDefaults.count ?? 0,
      eventsManagerResponsible: eventsManagerResponsible.count ?? 0,
      venueDefaultManager: venueDefaultManager.count ?? 0,
      sopDefaultAssignees: 0, // SOP array query requires custom SQL — acceptable to show 0 in UI
      approvalsReviewed: approvalsReviewed.count ?? 0,
      eventVersionsSubmitted: eventVersionsSubmitted.count ?? 0,
      debriefsSubmitted: debriefsSubmitted.count ?? 0,
      eventsDeletedBy: eventsDeletedBy.count ?? 0,
      tasksCompletedBy: tasksCompletedBy.count ?? 0,
      venueOverridesCreated: venueOverridesCreated.count ?? 0,
    }
  };
}

export async function deactivateUserAction(
  userId: string,
  reassignToUserId: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCurrentUser();
  if (!caller || !isAdministrator(caller.role)) {
    return { success: false, error: "Unauthorized" };
  }
  if (userId === caller.id) {
    return { success: false, error: "You cannot deactivate yourself." };
  }

  const db = createSupabaseAdminClient();

  const { data: target } = await db
    .from("users")
    .select("id, role, deactivated_at, full_name")
    .eq("id", userId)
    .single();

  if (!target) return { success: false, error: "User not found." };
  if (target.role === "administrator") return { success: false, error: "Cannot deactivate an administrator." };
  if (target.deactivated_at) return { success: false, error: "User is already deactivated." };

  const { data: reassignTarget } = await db
    .from("users")
    .select("id, deactivated_at, role")
    .eq("id", reassignToUserId)
    .single();

  if (!reassignTarget || reassignTarget.deactivated_at || reassignTarget.role === "executive") {
    return { success: false, error: "The selected user is no longer active. Please choose another." };
  }

  const { error: rpcError } = await db.rpc("reassign_and_deactivate_user", {
    p_target_id: userId,
    p_reassign_to_id: reassignToUserId,
    p_caller_id: caller.id,
  });

  if (rpcError) {
    console.error("Deactivation RPC failed:", rpcError.message);
    return { success: false, error: "Something went wrong. Please try again." };
  }

  // Destroy sessions (app_sessions references auth.users)
  await db.from("app_sessions").delete().eq("user_id", userId);

  revalidatePath("/users");
  return { success: true };
}

export async function reactivateUserAction(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCurrentUser();
  if (!caller || !isAdministrator(caller.role)) {
    return { success: false, error: "Unauthorized" };
  }

  const db = createSupabaseAdminClient();

  const { data: target } = await db
    .from("users")
    .select("id, deactivated_at")
    .eq("id", userId)
    .single();

  if (!target) return { success: false, error: "User not found." };
  if (!target.deactivated_at) return { success: false, error: "User is not deactivated." };

  const { error } = await db
    .from("users")
    .update({ deactivated_at: null, deactivated_by: null })
    .eq("id", userId);

  if (error) return { success: false, error: "Failed to reactivate user." };

  await recordAuditLogEntry({
    entity: "user",
    entityId: userId,
    action: "user.reactivated",
    actorId: caller.id,
  });

  revalidatePath("/users");
  return { success: true };
}

export async function deleteUserAction(
  userId: string,
  reassignToUserId: string,
  confirmName: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCurrentUser();
  if (!caller || !isAdministrator(caller.role)) {
    return { success: false, error: "Unauthorized" };
  }
  if (userId === caller.id) {
    return { success: false, error: "You cannot delete yourself." };
  }

  const db = createSupabaseAdminClient();

  const { data: target } = await db
    .from("users")
    .select("id, email, full_name, role")
    .eq("id", userId)
    .single();

  if (!target) return { success: false, error: "User not found." };
  if (target.role === "administrator") return { success: false, error: "Cannot delete an administrator." };

  // Verify name confirmation
  const nameMatch =
    confirmName.trim().toLowerCase() === (target.full_name ?? "").trim().toLowerCase() ||
    confirmName.trim().toLowerCase() === target.email.trim().toLowerCase();
  if (!nameMatch) return { success: false, error: "Name confirmation does not match." };

  // Verify reassignment target
  const { data: reassignTarget } = await db
    .from("users")
    .select("id, deactivated_at, role")
    .eq("id", reassignToUserId)
    .single();

  if (!reassignTarget || reassignTarget.deactivated_at || reassignTarget.role === "executive") {
    return { success: false, error: "The selected user is no longer active. Please choose another." };
  }

  // Reassign content atomically
  const { error: rpcError } = await db.rpc("reassign_user_content", {
    p_from_id: userId,
    p_to_id: reassignToUserId,
  });

  if (rpcError) {
    console.error("Reassignment RPC failed:", rpcError.message);
    return { success: false, error: "Something went wrong. Please try again." };
  }

  // Audit log MUST succeed before deletion
  const emailHash = await hashEmailForAudit(target.email);
  const { error: auditError } = await db.from("audit_log").insert({
    entity: "user",
    entity_id: userId,
    action: "user.deleted",
    actor_id: caller.id,
    meta: { deleted_email_hash: emailHash, reassigned_to: reassignToUserId },
  });

  if (auditError) {
    console.error("Audit log write failed:", auditError.message);
    return { success: false, error: "Could not record audit trail. Please try again." };
  }

  // Delete auth.users — cascades to public.users and app_sessions
  const { error: authError } = await db.auth.admin.deleteUser(userId);
  if (authError) {
    console.error("Auth user deletion failed:", authError.message);
    return { success: false, error: "Failed to delete user account. Content has been reassigned — you can retry deletion." };
  }

  revalidatePath("/users");
  return { success: true };
}
