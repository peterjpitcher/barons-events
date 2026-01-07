"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseActionClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { sendPasswordResetEmail } from "@/lib/notifications";
import { getFieldErrors, type FieldErrors } from "@/lib/form-errors";

const credentialsSchema = z.object({
  email: z.string().email({ message: "Enter a valid email" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" })
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

  const supabase = await createSupabaseActionClient();

  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { success: false, message: "Those details didn't match." };
  }

  redirect(redirectTarget);
}

export async function signOutAction() {
  const supabase = await createSupabaseActionClient();
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
    const fieldErrors = getFieldErrors(parsed.error);
    if (messages.includes("Passwords do not match.")) {
      return {
        status: "mismatch",
        message: "Those passwords didn’t match. Try again with the same password twice.",
        fieldErrors: {
          ...fieldErrors,
          confirmPassword: "Passwords do not match."
        }
      };
    }
    if (messages.includes("Missing reset token.")) {
      return {
        status: "missing-token",
        message: "We couldn’t detect a valid reset token. Open the latest reset link from your email and try again.",
        fieldErrors: {
          ...fieldErrors,
          token: "Missing reset token."
        }
      };
    }
    return { status: "invalid", message: "Check the highlighted fields.", fieldErrors };
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
