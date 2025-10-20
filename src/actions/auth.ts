"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseActionClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { sendPasswordResetEmail } from "@/lib/notifications";

const credentialsSchema = z.object({
  email: z.string().email({ message: "Enter a valid email" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" })
});

const emailOnlySchema = z.object({
  email: z.string().email({ message: "Enter a valid email" })
});

export type ResetPasswordState =
  | { status: "idle"; message?: undefined }
  | { status: "success"; message?: undefined }
  | { status: "invalid"; message?: string }
  | { status: "mismatch"; message?: string }
  | { status: "missing-token"; message?: string }
  | { status: "expired"; message?: string }
  | { status: "error"; message?: string };

const passwordResetSchema = z
  .object({
    password: z.string().min(8, { message: "Password must be at least 8 characters." }),
    confirmPassword: z.string().min(8, { message: "Confirm your password with at least 8 characters." }),
    token: z.string().optional(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional()
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords do not match."
      });
    }

    if (!data.token && !(data.accessToken && data.refreshToken)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["token"],
        message: "Missing reset token."
      });
    }
  });

function resolveAppUrl() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? null;
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;

  return siteUrl ?? appUrl ?? vercelUrl ?? "http://localhost:3000";
}

export async function signInAction(formData: FormData) {
  const redirectToRaw = formData.get("redirectTo");
  const redirectTarget =
    typeof redirectToRaw === "string" && redirectToRaw.startsWith("/") && !redirectToRaw.startsWith("//")
      ? redirectToRaw
      : "/";

  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });

  if (!parsed.success) {
    const params = new URLSearchParams({ error: "invalid" });
    if (redirectTarget !== "/") {
      params.set("redirectedFrom", redirectTarget);
    }
    redirect(`/login?${params.toString()}`);
  }

  const supabase = await createSupabaseActionClient();

  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    const params = new URLSearchParams({ error: "auth" });
    if (redirectTarget !== "/") {
      params.set("redirectedFrom", redirectTarget);
    }
    redirect(`/login?${params.toString()}`);
  }

  redirect(redirectTarget);
}

export async function signOutAction() {
  const supabase = await createSupabaseActionClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordResetAction(formData: FormData) {
  const parsed = emailOnlySchema.safeParse({
    email: formData.get("email")
  });

  if (!parsed.success) {
    const params = new URLSearchParams({ status: "invalid" });
    redirect(`/forgot-password?${params.toString()}`);
  }

  const redirectUrl = new URL("/reset-password", resolveAppUrl()).toString();

  let resetEmailSent = false;

  try {
    const adminClient = createSupabaseServiceRoleClient();
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: parsed.data.email,
      options: {
        redirectTo: redirectUrl
      }
    });

    if (error) {
      if ((error as { code?: string }).code !== "user_not_found") {
        console.error("Password reset link generation failed", error);
      }
    } else if (data?.properties?.action_link) {
      resetEmailSent = await sendPasswordResetEmail(parsed.data.email, data.properties.action_link);
    }
  } catch (error) {
    console.error("Password reset link generation threw", error);
  }

  if (!resetEmailSent) {
    const supabase = await createSupabaseActionClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: redirectUrl
    });

    if (error) {
      console.error("Password reset request failed", error);
    }
  }

  const params = new URLSearchParams({ status: "sent", email: parsed.data.email });
  redirect(`/forgot-password?${params.toString()}`);
}

export async function completePasswordResetAction(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const parsed = passwordResetSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    token: formData.get("token"),
    accessToken: formData.get("accessToken"),
    refreshToken: formData.get("refreshToken")
  });

  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => issue.message);
    if (messages.includes("Passwords do not match.")) {
      return { status: "mismatch", message: "Those passwords didn’t match. Try again with the same password twice." };
    }
    if (messages.includes("Missing reset token.")) {
      return {
        status: "missing-token",
        message: "We couldn’t detect a valid reset token. Open the latest reset link from your email and try again."
      };
    }
    return { status: "invalid", message: "Passwords must be at least 8 characters." };
  }

  const supabase = await createSupabaseActionClient();

  if (parsed.data.token) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(parsed.data.token);
    if (exchangeError) {
      console.error("Password reset token exchange failed", exchangeError);
      return {
        status: "expired",
        message: "That password reset link has expired. Request a fresh link and try again."
      };
    }
  } else if (parsed.data.accessToken && parsed.data.refreshToken) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: parsed.data.accessToken,
      refresh_token: parsed.data.refreshToken
    });

    if (sessionError) {
      console.error("Password reset session error", sessionError);
      return {
        status: "expired",
        message: "That password reset link has expired. Request a fresh link and try again."
      };
    }
  } else {
    return {
      status: "missing-token",
      message: "We couldn’t detect a valid reset token. Open the latest reset link from your email and try again."
    };
  }

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

  await supabase.auth.signOut();
  return { status: "success" };
}
