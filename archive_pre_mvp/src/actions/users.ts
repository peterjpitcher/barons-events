"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";

const roleSchema = z.enum(["central_planner", "reviewer", "venue_manager", "executive"]);

const createUserSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  fullName: z
    .string()
    .min(1, "Full name is required.")
    .max(120, "Full name must be 120 characters or fewer."),
  role: roleSchema,
  venueId: z.string().uuid("Select a valid venue.").optional(),
  sendInvite: z.boolean().optional(),
});

export type CreateUserFieldName = "email" | "fullName" | "role" | "venueId";

export type CreateUserFormState = {
  status: "idle" | "error" | "success";
  message?: string;
  temporaryPassword?: string;
  fieldErrors?: Partial<Record<CreateUserFieldName, string>>;
};

const initialState: CreateUserFormState = { status: "idle" };

const formatUnknownError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred.";
};

export const createUserAction = async (
  _prevState: CreateUserFormState | undefined,
  formData: FormData
): Promise<CreateUserFormState> => {
  const currentUser = await getCurrentUserProfile();

  if (!currentUser || currentUser.role !== "central_planner") {
    return {
      status: "error",
      message: "Only central planners can manage users.",
    };
  }

  const submission = {
    email: String(formData.get("email") ?? "").trim(),
    fullName: String(formData.get("fullName") ?? "").trim(),
    role: String(formData.get("role") ?? "").trim(),
    venueId: (() => {
      const value = String(formData.get("venueId") ?? "").trim();
      return value.length > 0 ? value : undefined;
    })(),
    sendInvite: formData.get("sendInvite") === "on",
  };

  const parsed = createUserSchema.safeParse(submission);

  if (!parsed.success) {
    const fieldErrors: Partial<Record<CreateUserFieldName, string>> = {};

    const flattened = parsed.error.flatten().fieldErrors;
    if (flattened.email?.[0]) fieldErrors.email = flattened.email[0];
    if (flattened.fullName?.[0]) fieldErrors.fullName = flattened.fullName[0];
    if (flattened.role?.[0]) fieldErrors.role = flattened.role[0];
    if (flattened.venueId?.[0]) fieldErrors.venueId = flattened.venueId[0];

    return {
      status: "error",
      message: "Please fix the highlighted fields before creating a user.",
      fieldErrors,
    };
  }

  const payload = parsed.data;

  const rawVenueId = formData.get("venueId");
  const venueIdValue =
    typeof rawVenueId === "string" && rawVenueId.trim().length > 0
      ? rawVenueId.trim()
      : null;

  if (payload.role === "venue_manager" && !payload.venueId) {
    return {
      status: "error",
      message: "Select a venue for venue managers.",
      fieldErrors: {
        venueId: "Select a venue before creating a venue manager account.",
      },
    };
  }

  const supabase = createSupabaseServiceRoleClient();

  const generatedPassword = randomBytes(16).toString("base64url").slice(0, 16);

  const metadata = {
    full_name: payload.fullName,
    role: payload.role,
    venue_id: payload.role === "venue_manager" ? venueIdValue : null,
  } satisfies Record<string, unknown>;

  let createdUserId: string | null = null;

  try {
    const createResult = await supabase.auth.admin.createUser({
      email: payload.email,
      password: generatedPassword,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (createResult.error) {
      return {
        status: "error",
        message: `Unable to create user: ${createResult.error.message}`,
      };
    }

    const createdUser = createResult.data?.user ?? null;

    if (!createdUser?.id) {
      return {
        status: "error",
        message: "Supabase returned an unexpected response while creating the user.",
      };
    }

    createdUserId = createdUser.id;

    const { error: upsertError } = await supabase
      .from("users")
      .upsert(
        {
          id: createdUser.id,
          email: payload.email,
          full_name: payload.fullName,
          role: payload.role,
          venue_id: payload.role === "venue_manager" ? venueIdValue : null,
        },
        { onConflict: "id" }
      );

    if (upsertError) {
      await supabase.auth.admin.deleteUser(createdUser.id);
      return {
        status: "error",
        message: `User was created but we couldn’t store their profile: ${upsertError.message}`,
      };
    }

    let message = `Account created for ${payload.email}.`;
    let temporaryPassword: string | undefined;

    if (payload.sendInvite) {
      const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
        payload.email,
        { data: metadata }
      );

      if (inviteError) {
        message = `Account created for ${payload.email}, but the invite email could not be sent: ${inviteError.message}. Share the temporary password below.`;
        temporaryPassword = generatedPassword;
      } else {
        message = `Invitation sent to ${payload.email}. They’ll set their password when they accept.`;
      }
    } else {
      temporaryPassword = generatedPassword;
      message = `Account created for ${payload.email}. Share the temporary password below.`;
    }

    revalidatePath("/settings");

    return {
      status: "success",
      message,
      temporaryPassword,
    };
  } catch (error) {
    if (createdUserId) {
      await supabase.auth.admin.deleteUser(createdUserId);
    }
    return {
      status: "error",
      message: formatUnknownError(error),
    };
  }
};

export { initialState as createUserInitialState };
