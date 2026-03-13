"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { updateUser } from "@/lib/users";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getFieldErrors } from "@/lib/form-errors";
import type { ActionResult } from "@/lib/types";
import { destroyAllSessionsForUser } from "@/lib/auth/session";
import { logAuthEvent, hashEmailForAudit } from "@/lib/audit-log";
import { resolveAppUrl } from "@/lib/app-url";
import { sendInviteEmail } from "@/lib/notifications";

const userUpdateSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().max(120).optional(),
  role: z.enum(["venue_manager", "reviewer", "central_planner", "executive"]),
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
  if (currentUser.role !== "central_planner") {
    return { success: false, message: "Only planners can change user access." };
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
        newRole: parsed.data.role
      }
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
  role: z.enum(["venue_manager", "reviewer", "central_planner", "executive"]),
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
  if (currentUser.role !== "central_planner") {
    return { success: false, message: "Only planners can invite users." };
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
  const actionLink = linkData?.properties?.action_link ?? null;

  if (!userId) {
    console.error("[invite] generateLink returned no userId for", parsed.data.email);
    return { success: false, message: "Invitation could not be sent. Please try again or contact support." };
  }

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

    if (actionLink) {
      const sent = await sendInviteEmail(parsed.data.email, actionLink, parsed.data.fullName ?? null);
      if (!sent) {
        console.error("[invite] Resend failed to deliver invite email to", parsed.data.email);
        return { success: false, message: "User created but the invite email failed to send. Please try again." };
      }
    }

    const emailHash = await hashEmailForAudit(parsed.data.email);
    await logAuthEvent({
      event: "auth.invite.sent",
      userId: currentUser.id,
      emailHash,
      meta: { role: parsed.data.role, inviteeId: userId }
    });

    revalidatePath("/users");
    return { success: true, message: "Invite sent." };
  } catch (upsertError) {
    console.error("[invite] upsert failed, rolling back auth user:", upsertError);
    try {
      const cleanupClient = createSupabaseAdminClient();
      await cleanupClient.auth.admin.deleteUser(userId);
    } catch (cleanupError) {
      console.error("[invite] rollback failed:", cleanupError);
    }
    return { success: false, message: "Invitation sent but updating access failed. Please try again." };
  }
}

export async function resendInviteAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }
  if (currentUser.role !== "central_planner") {
    return { success: false, message: "Only planners can resend invites." };
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

  const confirmUrl = new URL("/auth/confirm", resolveAppUrl()).toString();

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "invite",
    email,
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

  const actionLink = linkData?.properties?.action_link ?? null;

  // For a resend action the entire purpose is sending an email, so a missing action_link
  // (generateLink succeeded but returned no link) is treated as an error rather than a silent skip.
  if (!actionLink) {
    console.error("[resend-invite] generateLink returned no action_link for", email);
    return { success: false, message: "Invitation failed. Please try again." };
  }

  const sent = await sendInviteEmail(email, actionLink, fullName);
  if (!sent) {
    console.error("[resend-invite] Resend failed to deliver invite email to", email);
    return { success: false, message: "Invite created but the email failed to send. Please try again." };
  }

  const emailHash = await hashEmailForAudit(email);
  await logAuthEvent({
    event: "auth.invite.resent",
    userId: currentUser.id,
    emailHash,
    meta: { inviteeId: userId }
  });

  return { success: true, message: "Invite resent." };
}
