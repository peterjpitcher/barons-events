"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUserProfile, type UserProfile } from "@/lib/profile";
import { recordAuditLog } from "@/lib/audit";

export type VenueFormState = {
  error?: string;
  fieldErrors?: Partial<Record<VenueFieldName, string>>;
};

export const timezoneOptions = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Belfast",
  "Europe/Paris",
];

const venueSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .min(2, "Name must be at least 2 characters"),
  address: z
    .string()
    .max(500, "Address should be 500 characters or fewer"),
  region: z
    .string()
    .max(100, "Region should be 100 characters or fewer"),
  timezone: z
    .string()
    .refine(
      (value) => timezoneOptions.includes(value),
      "Timezone must be one of the supported options"
    ),
  capacity: z
    .string()
    .regex(/^\d*$/, "Capacity must be a whole number")
    .refine(
      (value) => value === "" || Number.parseInt(value, 10) >= 0,
      "Capacity must be a positive number"
    ),
});

type VenueFieldName = keyof z.infer<typeof venueSchema>;

type PlannerCheck =
  | {
      error: VenueFormState;
      profile?: undefined;
    }
  | {
      error?: undefined;
      profile: UserProfile;
    };

const ensureHQPlanner = async (): Promise<PlannerCheck> => {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "hq_planner") {
    return {
      error: {
        error: "Only HQ planners can perform this action.",
      },
    };
  }

  return { profile };
};

const parseVenueForm = (
  formData: FormData
): { data: z.infer<typeof venueSchema>; issues?: VenueFormState } => {
  const submission = {
    name: String(formData.get("name") ?? ""),
    address: String(formData.get("address") ?? ""),
    region: String(formData.get("region") ?? ""),
    timezone: String(formData.get("timezone") ?? "Europe/London"),
    capacity: String(formData.get("capacity") ?? ""),
  };

  const sanitized = {
    name: submission.name.trim(),
    address: submission.address.trim(),
    region: submission.region.trim(),
    timezone: submission.timezone,
    capacity: submission.capacity,
  };

  const result = venueSchema.safeParse(submission);

  if (!result.success) {
    const flattened = result.error.flatten().fieldErrors;
    const fieldErrors: VenueFormState["fieldErrors"] = {};

    Object.entries(flattened).forEach(([key, messages]) => {
      if (!messages || messages.length === 0) return;
      fieldErrors[key as VenueFieldName] = messages[0];
    });

    return {
      data: sanitized,
      issues: {
        fieldErrors,
        error: "Please correct the highlighted fields.",
      },
    };
  }

  return { data: sanitized };
};

export async function createVenueAction(
  _prevState: VenueFormState | undefined,
  formData: FormData
): Promise<VenueFormState | void> {
  const permissionCheck = await ensureHQPlanner();
  if ("error" in permissionCheck) {
    return permissionCheck.error;
  }

  const parsed = parseVenueForm(formData);
  if (parsed.issues) {
    return parsed.issues;
  }

  const supabase = createSupabaseServiceRoleClient();
  const capacityValue =
    parsed.data.capacity === ""
      ? null
      : Number.parseInt(parsed.data.capacity, 10);

  const { data, error } = await supabase
    .from("venues")
    .insert({
      name: parsed.data.name,
      address: parsed.data.address.length === 0 ? null : parsed.data.address,
      region: parsed.data.region.length === 0 ? null : parsed.data.region,
      timezone: parsed.data.timezone,
      capacity: capacityValue,
    })
    .select("id")
    .single();

  if (error) {
    return {
      error: `Unable to create venue: ${error.message}`,
    };
  }

  await recordAuditLog({
    actorId: permissionCheck.profile.id,
    action: "venue.created",
    entityType: "venue",
    entityId: data?.id,
    details: {
      name: parsed.data.name,
      region: parsed.data.region || null,
      timezone: parsed.data.timezone,
      capacity: capacityValue,
    },
  });

  revalidatePath("/venues");
  redirect("/venues?status=created");
}

export async function updateVenueAction(
  _prevState: VenueFormState | undefined,
  formData: FormData
): Promise<VenueFormState | void> {
  const permissionCheck = await ensureHQPlanner();
  if ("error" in permissionCheck) {
    return permissionCheck.error;
  }

  const venueId = formData.get("venueId");

  if (typeof venueId !== "string" || venueId.trim().length === 0) {
    return {
      error: "Invalid venue identifier.",
    };
  }

  const parsed = parseVenueForm(formData);
  if (parsed.issues) {
    return parsed.issues;
  }

  const supabase = createSupabaseServiceRoleClient();
  const capacityValue =
    parsed.data.capacity === ""
      ? null
      : Number.parseInt(parsed.data.capacity, 10);

  const { data, error } = await supabase
    .from("venues")
    .update({
      name: parsed.data.name,
      address: parsed.data.address.length === 0 ? null : parsed.data.address,
      region: parsed.data.region.length === 0 ? null : parsed.data.region,
      timezone: parsed.data.timezone,
      capacity: capacityValue,
    })
    .eq("id", venueId)
    .select("id")
    .single();

  if (error) {
    return {
      error: `Unable to update venue: ${error.message}`,
    };
  }

  await recordAuditLog({
    actorId: permissionCheck.profile.id,
    action: "venue.updated",
    entityType: "venue",
    entityId: data?.id ?? venueId,
    details: {
      name: parsed.data.name,
      region: parsed.data.region || null,
      timezone: parsed.data.timezone,
      capacity: capacityValue,
    },
  });

  revalidatePath("/venues");
  redirect("/venues?status=updated");
}
