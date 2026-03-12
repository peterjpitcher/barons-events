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

  let adminClient: ReturnType<typeof createSupabaseAdminClient>;
  try {
    adminClient = createSupabaseAdminClient();
    console.log("[invite:1] admin client created OK");
  } catch (clientErr) {
    console.error("[invite:1] FAILED to create admin client:", clientErr);
    return { success: false, message: "Server configuration error. Contact support." };
  }

  const confirmUrl = new URL("/auth/confirm", resolveAppUrl()).toString();
  console.log("[invite:2] confirmUrl =", confirmUrl, "| email =", parsed.data.email, "| role =", parsed.data.role);

  let linkData: Awaited<ReturnType<typeof adminClient.auth.admin.generateLink>>["data"];
  let linkError: Awaited<ReturnType<typeof adminClient.auth.admin.generateLink>>["error"];

  try {
    const result = await adminClient.auth.admin.generateLink({
      type: "invite",
      email: parsed.data.email,
      options: {
        data: { full_name: parsed.data.fullName ?? undefined },
        redirectTo: confirmUrl
      }
    });
    linkData = result.data;
    linkError = result.error;
    console.log("[invite:3] generateLink response — error:", linkError ? `${linkError.status} ${linkError.message}` : "none", "| userId:", result.data?.user?.id ?? "null", "| hasActionLink:", !!result.data?.properties?.action_link);
  } catch (generateErr) {
    console.error("[invite:3] generateLink THREW:", generateErr);
    return { success: false, message: "Invitation failed unexpectedly. Please try again." };
  }

  if (linkError) {
    console.error("[invite:3] generateLink error detail — status:", linkError.status, "| code:", (linkError as unknown as Record<string, unknown>).code, "| message:", linkError.message);
    if (linkError.status === 429) {
      return { success: false, message: "Too many invitations sent recently. Please wait a few minutes and try again." };
    }
    return { success: false, message: `Invitation failed (code ${linkError.status}). Please try again.` };
  }

  const userId = linkData?.user?.id ?? null;
  const actionLink = linkData?.properties?.action_link ?? null;

  console.log("[invite:4] userId =", userId, "| actionLink present =", !!actionLink);

  if (!userId) {
    console.error("[invite:4] no userId returned — linkData:", JSON.stringify(linkData));
    return { success: false, message: "Invitation could not be sent. Please try again or contact support." };
  }

  try {
    console.log("[invite:5] upserting into public.users — id:", userId);
    const adminDb = createSupabaseAdminClient();
    const { error: upsertError } = await adminDb.from("users").upsert({
      id: userId,
      email: parsed.data.email,
      full_name: parsed.data.fullName ?? null,
      role: parsed.data.role,
      venue_id: parsed.data.venueId ? parsed.data.venueId : null
    });

    if (upsertError) {
      console.error("[invite:5] upsert failed:", upsertError);
      throw upsertError;
    }
    console.log("[invite:5] upsert OK");

    if (actionLink) {
      console.log("[invite:6] sending invite email via Resend");
      const sent = await sendInviteEmail(parsed.data.email, actionLink, parsed.data.fullName ?? null);
      console.log("[invite:6] Resend result:", sent ? "sent" : "FAILED");
    } else {
      console.error("[invite:6] no actionLink — skipping email");
    }

    const emailHash = await hashEmailForAudit(parsed.data.email);
    await logAuthEvent({
      event: "auth.invite.sent",
      userId: currentUser.id,
      emailHash,
      meta: { role: parsed.data.role, inviteeId: userId }
    });

    revalidatePath("/users");
    console.log("[invite:7] SUCCESS");
    return { success: true, message: "Invite sent." };
  } catch (upsertError) {
    console.error("[invite:5] catch block — rolling back auth user:", upsertError);
    try {
      const cleanupClient = createSupabaseAdminClient();
      await cleanupClient.auth.admin.deleteUser(userId);
      console.log("[invite:5] auth user deleted (rollback)");
    } catch (cleanupError) {
      console.error("[invite:5] rollback FAILED:", cleanupError);
    }
    return { success: false, message: "Invitation sent but updating access failed. Please try again." };
  }
}
