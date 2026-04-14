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
  recordPasswordResetAttempt,
  makeSessionCookieOptions,
  SESSION_COOKIE_NAME
} from "@/lib/auth/session";
import { validatePassword } from "@/lib/auth/password-policy";
import { logAuthEvent, hashEmailForAudit } from "@/lib/audit-log";
import { resolveAppUrl } from "@/lib/app-url";
import { verifyTurnstile } from "@/lib/turnstile";

const credentialsSchema = z.object({
  email: z.string().email({ message: "Enter a valid email" }),
  password: z.string().min(8, { message: "Password must be at least 8 characters" })
});

const emailOnlySchema = z.object({
  email: z.string().email({ message: "Enter a valid email" })
});

export type ResetPasswordState =
  | { status: "idle"; message?: undefined; fieldErrors?: FieldErrors }
  | { status: "success"; message?: string; fieldErrors?: FieldErrors }
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
    typeof redirectToRaw === "string" && redirectToRaw.startsWith("/") && !redirectToRaw.startsWith("//") && !redirectToRaw.includes("\\")
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

  // Verify Turnstile CAPTCHA token before any auth work
  const turnstileToken = formData.get("cf-turnstile-response") as string | null;
  const turnstileValid = await verifyTurnstile(turnstileToken, "login", "strict");
  if (!turnstileValid) {
    return { success: false, message: "Security check failed. Please try again." };
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
    // Log lockout event (fire-and-forget)
    const lockoutEmailHash = await hashEmailForAudit(parsed.data.email);
    logAuthEvent({
      event: "auth.lockout",
      emailHash: lockoutEmailHash,
      ipAddress: ip,
      userAgent: headerStore.get("user-agent") ?? undefined
    }).catch(() => {});
    // Return identical error to wrong password — prevents lockout state enumeration
    return { success: false, message: "Those details didn't match." };
  }

  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Differentiate service errors (5xx) from credential failures — Gap 1.5
    // During a Supabase outage, we must NOT record failed login attempts
    // as that would lock out legitimate users.
    const isServiceError = typeof error.status === "number" && error.status >= 500;

    if (isServiceError) {
      const emailHash = await hashEmailForAudit(parsed.data.email);
      await logAuthEvent({
        event: "auth.login.service_error",
        ipAddress: ip,
        emailHash,
        userAgent: headerStore.get("user-agent") ?? undefined,
        meta: { reason: error.message, status: error.status }
      });
      return { success: false, message: "Sign in is temporarily unavailable. Please try again shortly." };
    }

    // Genuine credential failure — record the failed attempt
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

  // Create custom app session — MUST succeed for protected routes to work
  try {
    const userAgent = headerStore.get("user-agent") ?? undefined;
    const sessionId = await createSession(data.user.id, { userAgent, ipAddress: ip });
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionId, makeSessionCookieOptions());
  } catch (sessionErr) {
    console.error("[auth] App session creation failed — aborting login:", sessionErr);
    // Sign out the Supabase session to prevent JWT-without-app-session state
    await supabase.auth.signOut();
    await logAuthEvent({
      event: "auth.login.failure",
      userId: data.user.id,
      ipAddress: ip,
      meta: { reason: "session_creation_failed" }
    });
    return {
      success: false,
      message: "Sign in failed due to a server error. Please try again."
    };
  }

  await logAuthEvent({
    event: "auth.login.success",
    userId: data.user.id,
    ipAddress: ip,
    userAgent: headerStore.get("user-agent") ?? undefined
  });

  redirect(redirectTarget);
}

export async function signOutAction(reasonOrFormData?: string | FormData) {
  const reason = typeof reasonOrFormData === "string" ? reasonOrFormData : undefined;
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
  const url = reason ? `/login?reason=${encodeURIComponent(reason)}` : "/login";
  redirect(url);
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

  // Verify Turnstile CAPTCHA token before processing the request
  const turnstileToken = formData.get("cf-turnstile-response") as string | null;
  const turnstileValid = await verifyTurnstile(turnstileToken, "password_reset", "strict");
  if (!turnstileValid) {
    return { success: false, message: "Security check failed. Please try again." };
  }

  // Per-email rate limit: 3 requests per hour
  const rateLimited = await recordPasswordResetAttempt(parsed.data.email);
  if (rateLimited) {
    // Always return generic success to prevent email enumeration
    redirect("/forgot-password?status=sent");
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
  // Note: validatePassword accepts an optional currentPasswordHash for no-reuse checking,
  // but Supabase Auth does not expose password hashes through the client API (neither
  // the anon-key client nor the admin client). The HIBP breach check still provides
  // protection against known-compromised passwords.
  // TODO: If Supabase adds password hash access via admin API, pass currentHash here.
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

  // Destroy all sessions then immediately issue a fresh one to prevent session fixation
  let sessionTeardownFailed = false;

  try {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (currentUser) {
      // Attempt to destroy all existing sessions — Gap 1.6
      try {
        await destroyAllSessionsForUser(currentUser.id);
      } catch (destroyError) {
        console.error("Failed to destroy sessions after password reset:", destroyError);
        sessionTeardownFailed = true;
      }

      // Issue a replacement session before signing out (auth standard §3 — session fixation prevention)
      try {
        const cookieStore = await cookies();
        const newSessionId = await createSession(currentUser.id, {
          userAgent: "",
          ipAddress: "", // not available in server action context
        });
        cookieStore.set(SESSION_COOKIE_NAME, newSessionId, makeSessionCookieOptions());
      } catch (sessionError) {
        console.error("Failed to issue replacement session after password reset:", sessionError);
      }

      await logAuthEvent({
        event: "auth.password_updated",
        userId: currentUser.id,
        meta: sessionTeardownFailed ? { session_teardown_failed: true } : undefined
      });

      // Clear lockout records now that the user has proved mailbox ownership
      try {
        const { data: { user: refreshedUser } } = await supabase.auth.getUser();
        if (refreshedUser?.email) {
          await clearLockoutForAllIps(refreshedUser.email);
        }
      } catch {
        // Non-fatal — lockout records are housekeeping
      }
    }
  } catch (outerError) {
    console.error("Failed during password reset session management:", outerError);
    sessionTeardownFailed = true;
  }

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    console.error("Failed to sign out after password reset:", signOutError);
    sessionTeardownFailed = true;
  }

  if (sessionTeardownFailed) {
    return {
      status: "success",
      message: "Password updated. Please sign in again on all your devices to ensure full security."
    };
  }

  return { status: "success" };
}
