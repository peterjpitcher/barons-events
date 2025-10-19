"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { recordAuditLog } from "@/lib/audit";

export type GoalFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"label" | "description", string>>;
};

const goalSchema = z.object({
  label: z
    .string()
    .min(1, "Label is required")
    .min(3, "Label must be at least 3 characters")
    .max(120, "Label should be under 120 characters"),
  description: z
    .string()
    .max(500, "Description should be 500 characters or fewer")
    .optional()
    .or(z.literal("")),
});

const ensureCentralPlanner = async (): Promise<
  | {
      error: GoalFormState;
      profile?: undefined;
    }
  | {
      error?: undefined;
      profile: NonNullable<Awaited<ReturnType<typeof getCurrentUserProfile>>>;
    }
> => {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "central_planner") {
    return {
      error: {
        error: "Only Central planners can perform this action.",
      },
    };
  }

  return { profile };
};

export async function createGoalAction(
  _prevState: GoalFormState | undefined,
  formData: FormData
): Promise<GoalFormState | void> {
  const permissionCheck = await ensureCentralPlanner();
  if ("error" in permissionCheck) {
    return permissionCheck.error;
  }

  const submission = {
    label: String(formData.get("label") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
  };

  const parsed = goalSchema.safeParse(submission);
  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: GoalFormState["fieldErrors"] = {};

    Object.entries(flattened).forEach(([key, messages]) => {
      if (!messages || messages.length === 0) return;
      fieldErrors[key as "label" | "description"] = messages[0];
    });

    return {
      fieldErrors,
      error: "Please correct the highlighted fields before saving.",
    };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("goals")
    .insert({
      label: parsed.data.label,
      description:
        parsed.data.description && parsed.data.description.length > 0
          ? parsed.data.description
          : null,
      active: true,
    })
    .select("id")
    .single();

  if (error) {
    return {
      error: `Unable to create goal: ${error.message}`,
    };
  }

  await recordAuditLog({
    actorId: permissionCheck.profile.id,
    action: "goal.created",
    entityType: "goal",
    entityId: data?.id,
    details: {
      label: parsed.data.label,
    },
  });

  revalidatePath("/planning");
}

export type GoalToggleState = {
  error?: string;
};

export async function toggleGoalStatusAction(
  _prevState: GoalToggleState | undefined,
  formData: FormData
): Promise<GoalToggleState | void> {
  const permissionCheck = await ensureCentralPlanner();
  if ("error" in permissionCheck) {
    return permissionCheck.error;
  }

  const goalId = formData.get("goalId");
  const nextActive = formData.get("nextActive");

  if (typeof goalId !== "string" || goalId.length === 0) {
    return {
      error: "Goal identifier is missing.",
    };
  }

  if (nextActive !== "true" && nextActive !== "false") {
    return {
      error: "Invalid activation state.",
    };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("goals")
    .update({
      active: nextActive === "true",
    })
    .eq("id", goalId);

  if (error) {
    return {
      error: `Unable to update goal: ${error.message}`,
    };
  }

  await recordAuditLog({
    actorId: permissionCheck.profile.id,
    action: nextActive === "true" ? "goal.activated" : "goal.deactivated",
    entityType: "goal",
    entityId: goalId,
    details: {
      active: nextActive === "true",
    },
  });

  revalidatePath("/planning");
}
