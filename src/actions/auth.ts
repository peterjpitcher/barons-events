"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPasswordResetEmail } from "@/lib/notifications";
import { getFieldErrors, type FieldErrors } from "@/lib/form-errors";
import {
  createSession,
  destroyAllSessionsForUser,
  clearLockoutForAllIps,
  recordFailedLoginAttempt,
  isLockedOut,
  makeSessionCookieOptions,
  SESSION_COOKIE_NAME
} from "@/lib/auth/session";
import { validatePassword } from "@/lib/auth/password-policy";
import { logAuthEvent, hashEmailForAudit } from "@/lib/audit-log";
import { resolveAppUrl } from "@/lib/app-url";

const credentialsSchema = z.object({
  email: z.string().email({ message: "Enter a valid email" }),
  password: z.string().min(8, { message: "Password must be at least 8 characters" })
});

const emailOnlySchema = z.object({
  email: z.string().email({ message: "Enter a valid email" })
});

export type ResetPasswordState =
  | { status: "idle"; message?: undefined; fieldErrors?: FieldErrors }
  | { status: "success"; message?: undefined; fieldErrors?: FieldErrors }
  | { status: "invalid"; message?: string; fieldErrors?: FieldErrors }
  | { status: "mismatch"; message?: string; fieldErrors?: FieldErrors }
  | { status: "missing-token"; message?: string; fieldErrors?: FieldErrors }
  | { status: "expired"; message?: string; fieldErrors?: FieldErrors }
  | { status: "error"; message?: string; fieldErrors?: FieldErrors };

type AuthFormState = {
  success: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
};

export type SignInState = AuthFormState;
export type PasswordResetRequestState = AuthFormState;

const passwordResetSchema = z
  .object({
    password: z.string().min(12, { message: "Password must be at least 12 characters." }),
    confirmPassword: z.string().min(12, { message: "Confirm your password with at least 12 characters." })
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords do not match."
      });
    }
  });

export async function signInAction(_: SignInState | undefined, formData: FormData): Promise<SignInState> {
  const redirectToRaw = formData.get("redirectTo");
  const redirectTarget =
    typeof redirectToRaw === "string" && redirectToRaw.startsWith("/") && !redirectToRaw.startsWith("//")
      ? redirectToRaw
      : "/";

  const parsed = credentialsSchema.safeParse({
    email: typeof formData.get("email") === "string" ? formData.get("email") : "",
    password: typeof formData.get("password") === "string" ? formData.get("password") : ""
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Check the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error)
    };
  }

  // Get client IP for lockout tracking (Next.js headers)
  const { headers } = await import("next/headers");
  const headerStore = await headers();
  const ip =
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerStore.get("x-real-ip") ??
    "unknown";

  // Check lockout before attempting sign-in
  const locked = await isLockedOut(parsed.data.email, ip);
  if (locked) {
    // Return identical error to wrong password — prevents lockout state enumeration
    return { success: false, message: "Those details didn't match." };
  }

  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Record the failed attempt
    await recordFailedLoginAttempt(parsed.data.email, ip);
    const emailHash = await hashEmailForAudit(parsed.data.email);
    await logAuthEvent({
      event: "auth.login.failure",
      ipAddress: ip,
      emailHash,
      userAgent: headerStore.get("user-agent") ?? undefined,
      meta: { reason: error.message }
    });
    return { success: false, message: "Those details didn't match." };
  }

  if (!data.user) {
    return { success: false, message: "Sign-in failed. Please try again." };
  }

  // Clear lockout counter for this IP on successful sign-in
  try {
    const { clearLockoutForIp } = await import("@/lib/auth/session");
    await clearLockoutForIp(parsed.data.email, ip);
  } catch {
    // Non-fatal
  }

  // Create custom app session record
  try {
    const userAgent = headerStore.get("user-agent") ?? undefined;
    const sessionId = await createSession(data.user.id, { userAgent, ipAddress: ip });
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionId, makeSessionCookieOptions());
  } catch (sessionError) {
    console.error("Failed to create app session after sign-in:", sessionError);
    // Non-fatal: fall through — Supabase JWT still provides basic auth
  }

  await logAuthEvent({
    event: "auth.login.success",
    userId: data.user.id,
    ipAddress: ip,
    userAgent: headerStore.get("user-agent") ?? undefined
  });

  redirect(redirectTarget);
}

export async function signOutAction() {
  const supabase = await createSupabaseActionClient();

  // Capture user before destroying session
  const { data: { user: currentUser } } = await supabase.auth.getUser();

  // Destroy the app session record
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (sessionId) {
      const { destroySession } = await import("@/lib/auth/session");
      await destroySession(sessionId);
      cookieStore.set(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
    }
  } catch (error) {
    console.error("Failed to destroy app session on sign-out:", error);
  }

  await logAuthEvent({
    event: "auth.logout",
    userId: currentUser?.id
  });

  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordResetAction(
  _: PasswordResetRequestState | undefined,
  formData: FormData
): Promise<PasswordResetRequestState> {
  const parsed = emailOnlySchema.safeParse({
    email: typeof formData.get("email") === "string" ? formData.get("email") : ""
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Check the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error)
    };
  }

  const redirectUrl = new URL("/auth/confirm", resolveAppUrl()).toString();

  try {
    const adminClient = createSupabaseAdminClient();
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: parsed.data.email,
      options: { redirectTo: redirectUrl }
    });

    if (error) {
      if ((error as { code?: string }).code !== "user_not_found") {
        console.error("Password reset link generation failed", error);
      }
      // Always redirect with success to prevent email enumeration
    } else if (data?.properties?.action_link) {
      const sent = await sendPasswordResetEmail(parsed.data.email, data.properties.action_link);
      if (!sent) {
        console.error("Password reset email failed to send via Resend");
      }
    }
  } catch (error) {
    console.error("Password reset threw:", error);
  }

  // Clear lockout records for this email (password reset is a valid recovery mechanism)
  try {
    await clearLockoutForAllIps(parsed.data.email);
  } catch {
    // Non-fatal
  }

  const emailHashForLog = await hashEmailForAudit(parsed.data.email);
  await logAuthEvent({
    event: "auth.password_reset.requested",
    emailHash: emailHashForLog
  });

  // Always generic success — never reveal if the email exists
  redirect("/forgot-password?status=sent");
}

export async function completePasswordResetAction(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const parsed = passwordResetSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword")
  });

  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => issue.message);
    const fieldErrors = getFieldErrors(parsed.error);
    if (messages.includes("Passwords do not match.")) {
      return {
        status: "mismatch",
        message: "Those passwords didn't match. Try again with the same password twice.",
        fieldErrors: { ...fieldErrors, confirmPassword: "Passwords do not match." }
      };
    }
    return { status: "invalid", message: "Check the highlighted fields.", fieldErrors };
  }

  // Server-side password policy validation (authoritative)
  const policyResult = await validatePassword(parsed.data.password);
  if (!policyResult.valid) {
    return {
      status: "invalid",
      message: policyResult.errors[0] ?? "Password does not meet requirements.",
      fieldErrors: { password: policyResult.errors[0] }
    };
  }

  const supabase = await createSupabaseActionClient();

  const { error: updateError } = await supabase.auth.updateUser({
    password: parsed.data.password
  });

  if (updateError) {
    console.error("Password update failed", updateError);
    return {
      status: "error",
      message: "Something went wrong updating your password. Request a new reset link and try again."
    };
  }

  // Destroy all sessions — user must re-authenticate
  try {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (currentUser) {
      await destroyAllSessionsForUser(currentUser.id);
      await logAuthEvent({
        event: "auth.password_updated",
        userId: currentUser.id
      });
    }
  } catch (sessionError) {
    console.error("Failed to destroy sessions after password reset:", sessionError);
  }

  await supabase.auth.signOut();
  return { status: "success" };
}
