"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUserProfile, type UserProfile } from "@/lib/profile";
import { recordAuditLog } from "@/lib/audit";

const DEFAULT_VENUE_TIMEZONE = "Europe/London";

export type VenueFormState = {
  error?: string;
  fieldErrors?: Partial<Record<VenueFieldName, string>>;
  areaErrors?: string[];
};

export type VenueAreaFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "capacity", string>>;
};

export type VenueReviewerFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"reviewerId", string>>;
};

const venueSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .min(2, "Name must be at least 2 characters"),
  address: z
    .string()
    .max(500, "Address should be 500 characters or fewer"),
});

const venueAreaSchema = z.object({
  venueId: z.string().uuid("Venue reference is required."),
  name: z
    .string()
    .min(1, "Name is required")
    .max(120, "Name must be 120 characters or fewer"),
  capacity: z
    .string()
    .regex(/^\d*$/, "Capacity must be a whole number")
    .refine(
      (value) => value === "" || value === undefined || Number.parseInt(value, 10) >= 0,
      "Capacity must be a positive number"
    )
    .optional(),
});

const newVenueAreaSchema = venueAreaSchema.omit({ venueId: true });

const venueAreaUpdateSchema = venueAreaSchema.extend({
  areaId: z.string().uuid("Area identifier is required."),
});

const venueAreaDeleteSchema = z.object({
  venueId: z.string().uuid("Venue reference is required."),
  areaId: z.string().uuid("Area identifier is required."),
});

const venueDefaultReviewerSchema = z.object({
  venueId: z.string().uuid("Venue reference is required."),
  reviewerId: z.string().uuid("Select a reviewer to add."),
});

const venueDefaultReviewerDeleteSchema = z.object({
  venueId: z.string().uuid("Venue reference is required."),
  mappingId: z.string().uuid("Reviewer mapping reference is required."),
  reviewerId: z.string().uuid("Reviewer reference is required."),
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

const ensureCentralPlanner = async (): Promise<PlannerCheck> => {
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

const parseVenueForm = (
  formData: FormData
): { data: z.infer<typeof venueSchema>; issues?: VenueFormState } => {
  const submission = {
    name: String(formData.get("name") ?? ""),
    address: String(formData.get("address") ?? ""),
  };

  const sanitized = {
    name: submission.name.trim(),
    address: submission.address.trim(),
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
  const permissionCheck = await ensureCentralPlanner();
  if ("error" in permissionCheck) {
    return permissionCheck.error;
  }

  const parsed = parseVenueForm(formData);
  if (parsed.issues) {
    return parsed.issues;
  }

  const supabase = createSupabaseServiceRoleClient();
  const rawAreaNames = formData.getAll("areaName");
  const rawAreaCapacities = formData.getAll("areaCapacity");

  const draftAreas = rawAreaNames.map((value, index) => {
    const name = typeof value === "string" ? value.trim() : "";
    const capacityRaw =
      typeof rawAreaCapacities[index] === "string"
        ? rawAreaCapacities[index]!.trim()
        : "";

    return {
      name,
      capacity: capacityRaw,
    };
  });

  const filteredAreas = draftAreas.filter(
    (area) => area.name.length > 0 || area.capacity.length > 0
  );

  const areaErrors: string[] = [];
  const parsedAreas: Array<{ name: string; capacity: number | null }> = [];

  filteredAreas.forEach((area, index) => {
    const parsedArea = newVenueAreaSchema.safeParse({
      name: area.name,
      capacity: area.capacity,
    });

    if (!parsedArea.success) {
      const messages = parsedArea.error.issues.map((issue) => issue.message);
      areaErrors.push(`Area ${index + 1}: ${messages.join(", ")}`);
      return;
    }

    const capacityValue =
      parsedArea.data.capacity && parsedArea.data.capacity.length > 0
        ? Number.parseInt(parsedArea.data.capacity, 10)
        : null;

    parsedAreas.push({
      name: parsedArea.data.name.trim(),
      capacity: capacityValue,
    });
  });

  if (areaErrors.length > 0) {
    return {
      error: "Please fix the area details before saving.",
      areaErrors,
    };
  }

  const { data, error } = await supabase
    .from("venues")
    .insert({
      name: parsed.data.name,
      address: parsed.data.address.length === 0 ? null : parsed.data.address,
      timezone: DEFAULT_VENUE_TIMEZONE,
    })
    .select("id")
    .single();

  if (error) {
    return {
      error: `Unable to create venue: ${error.message}`,
    };
  }

  const venueId = data?.id;

  if (venueId && parsedAreas.length > 0) {
    const { error: areaInsertError } = await supabase
      .from("venue_areas")
      .insert(
        parsedAreas.map((area) => ({
          venue_id: venueId,
          name: area.name,
          capacity: area.capacity,
        }))
      );

    if (areaInsertError) {
      await supabase.from("venues").delete().eq("id", venueId);
      return {
        error: `Venue created but areas could not be saved: ${areaInsertError.message}`,
      };
    }
  }

  await recordAuditLog({
    actorId: permissionCheck.profile.id,
    action: "venue.created",
    entityType: "venue",
    entityId: venueId,
    details: {
      name: parsed.data.name,
      timezone: DEFAULT_VENUE_TIMEZONE,
      areas_created: parsedAreas.map((area) => ({
        name: area.name,
        capacity: area.capacity,
      })),
    },
  });

  revalidatePath("/venues");
  redirect("/venues?status=created");
}

export async function updateVenueAction(
  _prevState: VenueFormState | undefined,
  formData: FormData
): Promise<VenueFormState | void> {
  const permissionCheck = await ensureCentralPlanner();
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

  const { data, error } = await supabase
    .from("venues")
    .update({
      name: parsed.data.name,
      address: parsed.data.address.length === 0 ? null : parsed.data.address,
      timezone: DEFAULT_VENUE_TIMEZONE,
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
      timezone: DEFAULT_VENUE_TIMEZONE,
    },
  });

  revalidatePath("/venues");
  redirect("/venues?status=updated");
}

const UNIQUE_CONSTRAINT_CODE = "23505";

export async function addVenueDefaultReviewerAction(
  _prevState: VenueReviewerFormState | undefined,
  formData: FormData
): Promise<VenueReviewerFormState | void> {
  const permissionCheck = await ensureCentralPlanner();
  if ("error" in permissionCheck) {
    const errorState = permissionCheck.error;
    return {
      error: errorState?.error ?? "Only Central planners can perform this action.",
    };
  }
  const { profile } = permissionCheck;

  const parsed = venueDefaultReviewerSchema.safeParse({
    venueId: formData.get("venueId"),
    reviewerId: formData.get("reviewerId"),
  });

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: VenueReviewerFormState["fieldErrors"] = {};
    if (flattened.reviewerId?.[0]) {
      fieldErrors.reviewerId = flattened.reviewerId[0];
    }

    return {
      fieldErrors,
      error: "Select a reviewer before saving.",
    };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("venue_default_reviewers")
    .insert({
      venue_id: parsed.data.venueId,
      reviewer_id: parsed.data.reviewerId,
    });

  if (error) {
    const code =
      typeof (error as { code?: string } | null)?.code === "string"
        ? (error as { code?: string }).code
        : null;

    if (code === UNIQUE_CONSTRAINT_CODE) {
      return {
        fieldErrors: {
          reviewerId: "That reviewer is already assigned to this venue.",
        },
        error: "Select a different reviewer before saving.",
      };
    }

    return {
      error: `Unable to add default reviewer: ${error.message}`,
    };
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "venue.default_reviewer_added",
    entityType: "venue",
    entityId: parsed.data.venueId,
    details: {
      reviewer_id: parsed.data.reviewerId,
    },
  });

  revalidatePath(`/venues/${parsed.data.venueId}/edit`);
  revalidatePath("/venues");

  return undefined;
}

export async function removeVenueDefaultReviewerAction(
  formData: FormData
): Promise<VenueReviewerFormState | void> {
  const permissionCheck = await ensureCentralPlanner();
  if ("error" in permissionCheck) {
    const errorState = permissionCheck.error;
    return {
      error: errorState?.error ?? "Only Central planners can perform this action.",
    };
  }
  const { profile } = permissionCheck;

  const parsed = venueDefaultReviewerDeleteSchema.safeParse({
    venueId: formData.get("venueId"),
    mappingId: formData.get("mappingId"),
    reviewerId: formData.get("reviewerId"),
  });

  if (!parsed.success) {
    return {
      error: "Unable to remove default reviewer. Refresh and try again.",
    };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("venue_default_reviewers")
    .delete()
    .eq("id", parsed.data.mappingId)
    .eq("venue_id", parsed.data.venueId);

  if (error) {
    return {
      error: `Unable to remove default reviewer: ${error.message}`,
    };
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "venue.default_reviewer_removed",
    entityType: "venue",
    entityId: parsed.data.venueId,
    details: {
      reviewer_id: parsed.data.reviewerId,
      reviewer_mapping_id: parsed.data.mappingId,
    },
  });

  revalidatePath(`/venues/${parsed.data.venueId}/edit`);
  revalidatePath("/venues");

  return undefined;
}

const parseAreaForm = (
  formData: FormData
): { data: z.infer<typeof venueAreaSchema>; issues?: VenueAreaFormState } => {
  const submission = {
    venueId: String(formData.get("venueId") ?? ""),
    name: String(formData.get("name") ?? ""),
    capacity: (() => {
      const raw = formData.get("capacity");
      if (typeof raw !== "string") return undefined;
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    })(),
  };

  const result = venueAreaSchema.safeParse(submission);

  if (!result.success) {
    const flattened = result.error.flatten().fieldErrors;
    const fieldErrors: VenueAreaFormState["fieldErrors"] = {};

    if (flattened.name?.[0]) fieldErrors.name = flattened.name[0];
    if (flattened.capacity?.[0]) fieldErrors.capacity = flattened.capacity[0];

    return {
      data: submission,
      issues: {
        fieldErrors,
        error: "Please fix the highlighted fields before saving.",
      },
    };
  }

  return { data: result.data };
};

export async function createVenueAreaAction(
  _prevState: VenueAreaFormState | undefined,
  formData: FormData
): Promise<VenueAreaFormState | void> {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "central_planner") {
    return {
      error: "Only Central planners can perform this action.",
    };
  }

  const parsed = parseAreaForm(formData);
  if (parsed.issues) {
    return parsed.issues;
  }

  const capacityValue = parsed.data.capacity
    ? Number.parseInt(parsed.data.capacity, 10)
    : null;

  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("venue_areas")
    .insert({
      venue_id: parsed.data.venueId,
      name: parsed.data.name.trim(),
      capacity: capacityValue,
    });

  if (error) {
    return {
      error: `Unable to create area: ${error.message}`,
    };
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "venue.area_created",
    entityType: "venue",
    entityId: parsed.data.venueId,
    details: {
      area_name: parsed.data.name,
      capacity: capacityValue,
    },
  });

  revalidatePath(`/venues/${parsed.data.venueId}/edit`);
  revalidatePath("/venues");
  return undefined;
}

export async function updateVenueAreaAction(
  _prevState: VenueAreaFormState | undefined,
  formData: FormData
): Promise<VenueAreaFormState | void> {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "central_planner") {
    return {
      error: "Only Central planners can perform this action.",
    };
  }

  const submission = {
    venueId: String(formData.get("venueId") ?? ""),
    areaId: String(formData.get("areaId") ?? ""),
    name: String(formData.get("name") ?? ""),
    capacity: (() => {
      const raw = formData.get("capacity");
      if (typeof raw !== "string") return undefined;
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    })(),
  };

  const result = venueAreaUpdateSchema.safeParse(submission);

  if (!result.success) {
    const flattened = result.error.flatten().fieldErrors;
    const fieldErrors: VenueAreaFormState["fieldErrors"] = {};

    if (flattened.name?.[0]) fieldErrors.name = flattened.name[0];
    if (flattened.capacity?.[0]) fieldErrors.capacity = flattened.capacity[0];

    return {
      fieldErrors,
      error: "Please fix the highlighted fields before saving.",
    };
  }

  const capacityValue = result.data.capacity
    ? Number.parseInt(result.data.capacity, 10)
    : null;

  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("venue_areas")
    .update({
      name: result.data.name.trim(),
      capacity: capacityValue,
    })
    .eq("id", result.data.areaId);

  if (error) {
    return {
      error: `Unable to update area: ${error.message}`,
    };
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "venue.area_updated",
    entityType: "venue",
    entityId: result.data.venueId,
    details: {
      area_id: result.data.areaId,
      area_name: result.data.name,
      capacity: capacityValue,
    },
  });

  revalidatePath(`/venues/${result.data.venueId}/edit`);
  revalidatePath("/venues");
  return undefined;
}

export async function deleteVenueAreaAction(formData: FormData) {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "central_planner") {
    return {
      error: "Only Central planners can perform this action.",
    } satisfies VenueAreaFormState;
  }

  const result = venueAreaDeleteSchema.safeParse({
    venueId: formData.get("venueId"),
    areaId: formData.get("areaId"),
  });

  if (!result.success) {
    return {
      error: "Unable to remove area. Refresh and try again.",
    } satisfies VenueAreaFormState;
  }

  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("venue_areas")
    .delete()
    .eq("id", result.data.areaId);

  if (error) {
    return {
      error: `Unable to remove area: ${error.message}`,
    } satisfies VenueAreaFormState;
  }

  await recordAuditLog({
    actorId: profile.id,
    action: "venue.area_deleted",
    entityType: "venue",
    entityId: result.data.venueId,
    details: {
      area_id: result.data.areaId,
    },
  });

  revalidatePath(`/venues/${result.data.venueId}/edit`);
  revalidatePath("/venues");
  return undefined;
}
