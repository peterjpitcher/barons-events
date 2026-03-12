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

  // Use generateLink instead of inviteUserByEmail so we control email delivery via Resend.
  // generateLink creates the auth user (or reuses an existing one) and returns a signed URL
  // without sending any email — identical to how password reset works in this codebase.
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "invite",
    email: parsed.data.email,
    options: {
      data: { full_name: parsed.data.fullName ?? undefined },
      redirectTo: confirmUrl
    }
  });

  if (linkError) {
    console.error("[invite] generateLink failed:", linkError);
    if (linkError.status === 429) {
      return { success: false, message: "Too many invitations sent recently. Please wait a few minutes and try again." };
    }
    return { success: false, message: "Invitation failed. Double-check the email and try again." };
  }

  const userId = linkData?.user?.id ?? null;
  const actionLink = linkData?.properties?.action_link ?? null;

  if (!userId) {
    console.error("[invite] generateLink returned no user id for", parsed.data.email);
    return { success: false, message: "Invitation could not be sent. Please try again or contact support." };
  }

  try {
    if (userId) {
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
    }

    if (actionLink) {
      const sent = await sendInviteEmail(parsed.data.email, actionLink, parsed.data.fullName ?? null);
      if (!sent) {
        console.error("[invite] Resend failed to deliver invite email to", parsed.data.email);
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
    console.error(upsertError);
    // Atomicity: remove the auth user if we couldn't write their profile record
    if (userId) {
      try {
        const cleanupClient = createSupabaseAdminClient();
        await cleanupClient.auth.admin.deleteUser(userId);
      } catch (cleanupError) {
        console.error("Failed to clean up orphaned auth user after invite failure", cleanupError);
      }
    }
    return { success: false, message: "Invitation sent but updating access failed. Please try again." };
  }
}
