"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  createPlanningItem,
  createPlanningSeries,
  createPlanningTask,
  deletePlanningItem,
  deletePlanningTask,
  movePlanningItemDate,
  pausePlanningSeries,
  togglePlanningTaskStatus,
  updatePlanningItem,
  updatePlanningSeries,
  updatePlanningTask
} from "@/lib/planning";
import type { PlanningItemStatus, PlanningTaskStatus, RecurrenceFrequency } from "@/lib/planning/types";
import { canCreatePlanningItems, canManageAllPlanning, canViewPlanning } from "@/lib/roles";
import type { AppUser, UserRole } from "@/lib/types";
import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { generateInspirationItems } from "@/lib/planning/inspiration";
import { generateSopChecklist, normaliseSopNotRequiredTemplateIds, recalculateSopDates, updateBlockedStatus } from "@/lib/planning/sop";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canCreatePlanningForVenueSelection, canEditVenueLinkedPlanning } from "@/lib/visibility";

export type PlanningActionResult = {
  success: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

const uuidSchema = z.string().uuid();
const optionalUuidSchema = z.union([z.string().uuid(), z.literal(""), z.null(), z.undefined()]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optionalDateTimeSchema = z.union([z.string().datetime(), z.literal(""), z.null(), z.undefined()]);
const planningStatusSchema = z.enum(["planned", "in_progress", "blocked", "done", "cancelled"]);
const taskStatusSchema = z.enum(["open", "done", "not_required"]);
const frequencySchema = z.enum(["daily", "weekly", "monthly"]);

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  error.issues.forEach((issue) => {
    const key = issue.path.join(".") || "form";
    if (!result[key]) {
      result[key] = issue.message;
    }
  });
  return result;
}

async function ensureUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("You must be signed in.");
  }
  if (!canCreatePlanningItems(user.role, user.venueId)) {
    throw new Error("You do not have permission to perform planning actions.");
  }
  return user;
}

const createItemSchema = z.object({
  title: z.string().min(2, "Add a title").max(160),
  description: z.string().max(2000).optional().nullable(),
  typeLabel: z.string().min(2, "Add a planning type").max(120),
  /** Legacy single-venue field — kept as a fallback for callers that only
   * pick one venue. `venueIds` is preferred. */
  venueId: optionalUuidSchema,
  /** Multi-venue selection. Empty or missing → global item. First entry is
   * treated as the primary venue for the denormalised venue_id column. */
  venueIds: z.array(z.string().uuid()).optional(),
  ownerId: optionalUuidSchema,
  targetDate: dateSchema,
  startAt: optionalDateTimeSchema,
  endAt: optionalDateTimeSchema,
  status: planningStatusSchema.optional(),
  sopNotRequiredTemplateIds: z.array(z.string().uuid()).optional()
});

/** Calls the set_planning_item_venues helper to sync the join table. */
async function syncPlanningItemVenueAttachments(itemId: string, venueIds: string[]): Promise<void> {
  if (!itemId) return;
  const db = createSupabaseAdminClient();
   
  const { error } = await (db as any).rpc("set_planning_item_venues", {
    p_item_id: itemId,
    p_venue_ids: venueIds
  });
  if (error) {
    console.error("syncPlanningItemVenueAttachments RPC failed:", error);
  }
}

async function loadPlanningItemAccess(itemId: string) {
  const db = createSupabaseAdminClient();
  const { data } = await (db as any)
    .from("planning_items")
    .select("id, venue_id, planning_item_venues(venue_id)")
    .eq("id", itemId)
    .maybeSingle();
  return data as { id: string; venue_id: string | null; planning_item_venues?: Array<{ venue_id: string | null }> | null } | null;
}

async function loadPlanningSeriesAccess(seriesId: string) {
  const db = createSupabaseAdminClient();
  const { data } = await (db as any)
    .from("planning_series")
    .select("id, venue_id")
    .eq("id", seriesId)
    .maybeSingle();
  return data as { id: string; venue_id: string | null } | null;
}

async function loadTaskRouteContext(taskId: string): Promise<{ planningItemId: string | null; eventId: string | null }> {
  const db = createSupabaseAdminClient();
  const { data: task } = await db
    .from("planning_tasks")
    .select("planning_item_id")
    .eq("id", taskId)
    .maybeSingle();

  const planningItemId = task?.planning_item_id ?? null;
  if (!planningItemId) {
    return { planningItemId: null, eventId: null };
  }

  const { data: item } = await db
    .from("planning_items")
    .select("event_id")
    .eq("id", planningItemId)
    .maybeSingle();

  return {
    planningItemId,
    eventId: item?.event_id ?? null
  };
}

function revalidatePlanningRouteContext(context: { planningItemId?: string | null; eventId?: string | null }): void {
  revalidatePath("/planning");
  if (context.planningItemId) {
    revalidatePath(`/planning/${context.planningItemId}`);
  }
  if (context.eventId) {
    revalidatePath(`/events/${context.eventId}`);
  }
  revalidatePath("/");
}

async function ensureCanManagePlanningItem(
  user: AppUser,
  planningItemId: string
): Promise<PlanningActionResult | null> {
  const item = await loadPlanningItemAccess(planningItemId);
  if (!item) return { success: false, message: "Planning item not found." };
  if (!canEditVenueLinkedPlanning(user, { venue_id: item.venue_id, planning_item_venues: item.planning_item_venues ?? [] })) {
    return { success: false, message: "You can only manage planning items for your assigned venue." };
  }
  return null;
}

export async function createPlanningItemAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = createItemSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Check the highlighted fields.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    // Prefer the multi-venue array; fall back to the single venueId field
    // for older callers. An empty selection means the item is global.
    const venueIds = parsed.data.venueIds && parsed.data.venueIds.length > 0
      ? parsed.data.venueIds
      : parsed.data.venueId
        ? [parsed.data.venueId]
        : [];
    if (!canCreatePlanningForVenueSelection(user, venueIds)) {
      return {
        success: false,
        message: "You can only create planning items for your assigned venue.",
        fieldErrors: { venueIds: "Choose your assigned venue" }
      };
    }
    const primaryVenueId = venueIds[0] ?? null;
    const inputObject = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const hasStartAt = Object.prototype.hasOwnProperty.call(inputObject, "startAt");
    const hasEndAt = Object.prototype.hasOwnProperty.call(inputObject, "endAt");

    const item = await createPlanningItem({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      typeLabel: parsed.data.typeLabel,
      venueId: primaryVenueId,
      ownerId: parsed.data.ownerId ? parsed.data.ownerId : null,
      targetDate: parsed.data.targetDate,
      ...(hasStartAt ? { startAt: parsed.data.startAt || null } : {}),
      ...(hasEndAt ? { endAt: parsed.data.endAt || null } : {}),
      status: (parsed.data.status ?? "planned") as PlanningItemStatus,
      createdBy: user.id
    });

    // Keep the join table in sync with the full venue list (primary + any
    // extras). Global items (empty list) clear any existing attachments.
    await syncPlanningItemVenueAttachments(item.id, venueIds);

    try {
      await generateSopChecklist(item.id, item.target_date, user.id, {
        notRequiredTemplateIds: normaliseSopNotRequiredTemplateIds(parsed.data.sopNotRequiredTemplateIds ?? [])
      });
    } catch (sopError) {
      console.error("SOP checklist generation failed:", sopError);
    }

    recordAuditLogEntry({
      entity: "planning",
      entityId: item.id,
      action: "planning.item_created",
      actorId: user.id,
      meta: { title: parsed.data.title, venue_count: venueIds.length }
    }).catch(() => {});
    revalidatePath("/planning");
    return {
      success: true,
      message:
        venueIds.length <= 1
          ? "Planning item created."
          : `Planning item created, linked to ${venueIds.length} venues.`
    };
  } catch (error) {
    console.error("Failed to create planning item", error);
    return { success: false, message: "Could not create planning item." };
  }
}

const updateItemSchema = z.object({
  itemId: uuidSchema,
  title: z.string().min(2).max(160).optional(),
  description: z.string().max(2000).optional().nullable(),
  typeLabel: z.string().min(2).max(120).optional(),
  venueId: optionalUuidSchema,
  /** Multi-venue selection. When present, replaces the item's full venue
   * attachment list (empty array → global). Primary venue is the first id. */
  venueIds: z.array(z.string().uuid()).optional(),
  ownerId: optionalUuidSchema,
  targetDate: dateSchema.optional(),
  startAt: optionalDateTimeSchema,
  endAt: optionalDateTimeSchema,
  status: planningStatusSchema.optional()
});

export async function updatePlanningItemAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = updateItemSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Check the highlighted fields.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    // When venueIds is provided, it's the authoritative list (primary first).
    // When only venueId is provided, treat it as a single-venue update (for
    // back-compat with older callers).
    const hasVenueIds = parsed.data.venueIds !== undefined;
    const hasVenueId = parsed.data.venueId !== undefined;
    const effectiveVenueIds = hasVenueIds
      ? parsed.data.venueIds!
      : hasVenueId
        ? parsed.data.venueId
          ? [parsed.data.venueId]
          : []
        : null; // null = no change
    const primaryVenueId = effectiveVenueIds && effectiveVenueIds.length > 0
      ? effectiveVenueIds[0]
      : null;
    const manageError = await ensureCanManagePlanningItem(user, parsed.data.itemId);
    if (manageError) return manageError;
    if (effectiveVenueIds !== null && !canCreatePlanningForVenueSelection(user, effectiveVenueIds)) {
      return {
        success: false,
        message: "You can only assign planning items to your assigned venue.",
        fieldErrors: { venueIds: "Choose your assigned venue" }
      };
    }

    await updatePlanningItem(parsed.data.itemId, {
      title: parsed.data.title,
      description: parsed.data.description,
      typeLabel: parsed.data.typeLabel,
      // Only touch venue_id when the caller actually sent a venue update.
      ...(effectiveVenueIds !== null ? { venueId: primaryVenueId } : {}),
      ...(parsed.data.ownerId !== undefined ? { ownerId: parsed.data.ownerId ? parsed.data.ownerId : null } : {}),
      targetDate: parsed.data.targetDate,
      ...(parsed.data.startAt !== undefined ? { startAt: parsed.data.startAt || null } : {}),
      ...(parsed.data.endAt !== undefined ? { endAt: parsed.data.endAt || null } : {}),
      status: parsed.data.status as PlanningItemStatus | undefined
    });

    // Re-sync the join table when a venue update was requested.
    if (effectiveVenueIds !== null) {
      await syncPlanningItemVenueAttachments(parsed.data.itemId, effectiveVenueIds);
    }

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.itemId,
      action: "planning.item_updated",
      actorId: user.id,
      meta: {
        title: parsed.data.title,
        status: parsed.data.status,
        ...(effectiveVenueIds !== null ? { venue_count: effectiveVenueIds.length } : {})
      }
    }).catch(() => {});
    revalidatePath("/planning");
    return { success: true, message: "Planning item updated." };
  } catch (error) {
    console.error("Failed to update planning item", error);
    return { success: false, message: "Could not update planning item." };
  }
}

const moveItemSchema = z.object({
  itemId: uuidSchema,
  targetDate: dateSchema
});

export async function movePlanningItemDateAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = moveItemSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Move payload is invalid.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    const manageError = await ensureCanManagePlanningItem(user, parsed.data.itemId);
    if (manageError) return manageError;

    await movePlanningItemDate(parsed.data.itemId, parsed.data.targetDate);

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.itemId,
      action: "planning.item_updated",
      actorId: user.id,
      meta: { changed_fields: ["target_date"], target_date: parsed.data.targetDate }
    }).catch(() => {});

    try {
      await recalculateSopDates(parsed.data.itemId, parsed.data.targetDate);
    } catch (sopError) {
      console.error("SOP date recalculation failed:", sopError);
    }

    revalidatePath("/planning");
    return { success: true, message: "Planning date moved." };
  } catch (error) {
    console.error("Failed to move planning item date", error);
    return { success: false, message: "Could not move planning item." };
  }
}

const deleteItemSchema = z.object({
  itemId: uuidSchema
});

export async function deletePlanningItemAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = deleteItemSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Planning item reference is invalid.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    const manageError = await ensureCanManagePlanningItem(user, parsed.data.itemId);
    if (manageError) return manageError;

    await deletePlanningItem(parsed.data.itemId);

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.itemId,
      action: "planning.item_deleted",
      actorId: user.id,
      meta: {}
    }).catch(() => {});
    revalidatePath("/planning");
    return { success: true, message: "Planning item deleted." };
  } catch (error) {
    console.error("Failed to delete planning item", error);
    return { success: false, message: "Could not delete planning item." };
  }
}

const taskTemplateSchema = z.object({
  title: z.string().min(2).max(160),
  defaultAssigneeId: optionalUuidSchema,
  dueOffsetDays: z.number().int().min(-365).max(365).optional(),
  sortOrder: z.number().int().min(0).max(999).optional()
});

const createSeriesSchema = z
  .object({
    title: z.string().min(2, "Add a title").max(160),
    description: z.string().max(2000).optional().nullable(),
    typeLabel: z.string().min(2, "Add a planning type").max(120),
    venueId: optionalUuidSchema,
    ownerId: optionalUuidSchema,
    recurrenceFrequency: frequencySchema,
    recurrenceInterval: z.number().int().min(1).max(365),
    recurrenceWeekdays: z.array(z.number().int().min(0).max(6)).optional().nullable(),
    recurrenceMonthday: z.number().int().min(1).max(31).optional().nullable(),
    startsOn: dateSchema,
    endsOn: dateSchema.optional().nullable(),
    sopNotRequiredTemplateIds: z.array(z.string().uuid()).optional(),
    taskTemplates: z.array(taskTemplateSchema).optional()
  })
  .superRefine((values, ctx) => {
    if (values.recurrenceFrequency === "weekly") {
      const weekdays = values.recurrenceWeekdays ?? [];
      if (weekdays.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Choose at least one weekday",
          path: ["recurrenceWeekdays"]
        });
      }
    }

    if (values.recurrenceFrequency === "monthly" && !values.recurrenceMonthday) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose a day of month",
        path: ["recurrenceMonthday"]
      });
    }

    if (values.endsOn && values.endsOn < values.startsOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be after start date",
        path: ["endsOn"]
      });
    }
  });

export async function createPlanningSeriesAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = createSeriesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Check the highlighted fields.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }
    const venueIds = parsed.data.venueId ? [parsed.data.venueId] : [];
    if (!canCreatePlanningForVenueSelection(user, venueIds)) {
      return {
        success: false,
        message: "You can only create planning series for your assigned venue.",
        fieldErrors: { venueId: "Choose your assigned venue" }
      };
    }

    await createPlanningSeries({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      typeLabel: parsed.data.typeLabel,
      venueId: parsed.data.venueId ? parsed.data.venueId : null,
      ownerId: parsed.data.ownerId ? parsed.data.ownerId : null,
      createdBy: user.id,
      recurrenceFrequency: parsed.data.recurrenceFrequency as RecurrenceFrequency,
      recurrenceInterval: parsed.data.recurrenceInterval,
      recurrenceWeekdays: parsed.data.recurrenceWeekdays ?? null,
      recurrenceMonthday: parsed.data.recurrenceMonthday ?? null,
      startsOn: parsed.data.startsOn,
      endsOn: parsed.data.endsOn ?? null,
      sopNotRequiredTemplateIds: normaliseSopNotRequiredTemplateIds(parsed.data.sopNotRequiredTemplateIds ?? []),
      taskTemplates: parsed.data.taskTemplates?.map((template) => ({
        title: template.title,
        defaultAssigneeId: template.defaultAssigneeId ? template.defaultAssigneeId : null,
        dueOffsetDays: template.dueOffsetDays ?? 0,
        sortOrder: template.sortOrder ?? 0
      }))
    });

    recordAuditLogEntry({
      entity: "planning",
      entityId: "series",
      action: "planning.series_created",
      actorId: user.id,
      meta: { title: parsed.data.title, frequency: parsed.data.recurrenceFrequency }
    }).catch(() => {});
    revalidatePath("/planning");
    return { success: true, message: "Recurring planning series created." };
  } catch (error) {
    console.error("Failed to create planning series", error);
    return { success: false, message: "Could not create recurring series." };
  }
}

const updateSeriesSchema = createSeriesSchema.partial().extend({
  seriesId: uuidSchema
});

export async function updatePlanningSeriesAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = updateSeriesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Check the highlighted fields.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }
    const currentSeries = await loadPlanningSeriesAccess(parsed.data.seriesId);
    if (!currentSeries) return { success: false, message: "Planning series not found." };
    if (!canEditVenueLinkedPlanning(user, { venue_id: currentSeries.venue_id })) {
      return { success: false, message: "You can only manage planning series for your assigned venue." };
    }
    if (
      parsed.data.venueId !== undefined &&
      !canCreatePlanningForVenueSelection(user, parsed.data.venueId ? [parsed.data.venueId] : [])
    ) {
      return {
        success: false,
        message: "You can only assign planning series to your assigned venue.",
        fieldErrors: { venueId: "Choose your assigned venue" }
      };
    }

    await updatePlanningSeries(parsed.data.seriesId, {
      title: parsed.data.title,
      description: parsed.data.description,
      typeLabel: parsed.data.typeLabel,
      venueId: parsed.data.venueId ? parsed.data.venueId : null,
      ownerId: parsed.data.ownerId ? parsed.data.ownerId : null,
      recurrenceFrequency: parsed.data.recurrenceFrequency as RecurrenceFrequency | undefined,
      recurrenceInterval: parsed.data.recurrenceInterval,
      recurrenceWeekdays: parsed.data.recurrenceWeekdays ?? undefined,
      recurrenceMonthday: parsed.data.recurrenceMonthday ?? undefined,
      startsOn: parsed.data.startsOn,
      endsOn: parsed.data.endsOn ?? undefined,
      sopNotRequiredTemplateIds:
        parsed.data.sopNotRequiredTemplateIds === undefined
          ? undefined
          : normaliseSopNotRequiredTemplateIds(parsed.data.sopNotRequiredTemplateIds),
      taskTemplates: parsed.data.taskTemplates?.map((template) => ({
        title: template.title,
        defaultAssigneeId: template.defaultAssigneeId ? template.defaultAssigneeId : null,
        dueOffsetDays: template.dueOffsetDays ?? 0,
        sortOrder: template.sortOrder ?? 0
      }))
    });

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.seriesId,
      action: "planning.series_updated",
      actorId: user.id,
      meta: { title: parsed.data.title }
    }).catch(() => {});
    revalidatePath("/planning");
    return { success: true, message: "Recurring series updated." };
  } catch (error) {
    console.error("Failed to update planning series", error);
    return { success: false, message: "Could not update recurring series." };
  }
}

const pauseSeriesSchema = z.object({ seriesId: uuidSchema });

export async function pausePlanningSeriesAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = pauseSeriesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Series reference is invalid.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }
    const currentSeries = await loadPlanningSeriesAccess(parsed.data.seriesId);
    if (!currentSeries) return { success: false, message: "Planning series not found." };
    if (!canEditVenueLinkedPlanning(user, { venue_id: currentSeries.venue_id })) {
      return { success: false, message: "You can only manage planning series for your assigned venue." };
    }

    await pausePlanningSeries(parsed.data.seriesId);

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.seriesId,
      action: "planning.series_paused",
      actorId: user.id,
      meta: {}
    }).catch(() => {});
    revalidatePath("/planning");
    return { success: true, message: "Recurring series paused." };
  } catch (error) {
    console.error("Failed to pause planning series", error);
    return { success: false, message: "Could not pause recurring series." };
  }
}

async function ensureOwnsParentItem(
  userId: string,
  userRole: UserRole,
  userVenueId: string | null,
  planningItemId: string
): Promise<PlanningActionResult | null> {
  if (canManageAllPlanning(userRole)) return null;
  const item = await loadPlanningItemAccess(planningItemId);
  if (!item) return { success: false, message: "Planning item not found." };
  const user: AppUser = { id: userId, role: userRole, venueId: userVenueId, email: "", fullName: null, deactivatedAt: null };
  if (!canEditVenueLinkedPlanning(user, { venue_id: item.venue_id, planning_item_venues: item.planning_item_venues ?? [] })) {
    return { success: false, message: "You can only manage tasks for planning items at your assigned venue." };
  }
  return null;
}

async function ensureOwnsParentItemOfTask(
  userId: string,
  userRole: UserRole,
  userVenueId: string | null,
  taskId: string
): Promise<PlanningActionResult | null> {
  if (canManageAllPlanning(userRole)) return null;
  const supabase = await createSupabaseReadonlyClient();
  const { data: task } = await supabase
    .from("planning_tasks")
    .select("planning_item_id, assignee_id")
    .eq("id", taskId)
    .single();
  if (!task) {
    return { success: false, message: "Task not found." };
  }

  return ensureOwnsParentItem(userId, userRole, userVenueId, task.planning_item_id);
}

const createTaskSchema = z.object({
  planningItemId: uuidSchema,
  title: z.string().min(2, "Add a task title").max(160),
  assigneeId: optionalUuidSchema,
  dueDate: dateSchema,
  sortOrder: z.number().int().min(0).max(999).optional()
});

export async function createPlanningTaskAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = createTaskSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Check the highlighted fields.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    // Ownership check: non-admins can only add tasks to their own planning items
    const ownershipError = await ensureOwnsParentItem(user.id, user.role, user.venueId, parsed.data.planningItemId);
    if (ownershipError) return ownershipError;

    await createPlanningTask({
      planningItemId: parsed.data.planningItemId,
      title: parsed.data.title,
      assigneeId: parsed.data.assigneeId ? parsed.data.assigneeId : null,
      dueDate: parsed.data.dueDate,
      sortOrder: parsed.data.sortOrder,
      createdBy: user.id
    });

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.planningItemId,
      action: "planning.task_created",
      actorId: user.id,
      meta: { title: parsed.data.title }
    }).catch(() => {});
    revalidatePath("/planning");
    return { success: true, message: "Task added." };
  } catch (error) {
    console.error("Failed to create planning task", error);
    return { success: false, message: "Could not add task." };
  }
}

const updateTaskSchema = z.object({
  taskId: uuidSchema,
  title: z.string().min(2).max(160).optional(),
  assigneeId: optionalUuidSchema,
  dueDate: dateSchema.optional(),
  status: taskStatusSchema.optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  notes: z.string().max(10_000).nullable().optional()
});

const taskDependencySchema = z.object({
  taskId: uuidSchema,
  dependsOnTaskId: uuidSchema
});

type PlanningTaskDependencyRow = {
  task_id: string;
  depends_on_task_id: string;
};

type PlanningTaskDependencyValidationResult =
  | { success: true; planningItemId: string }
  | { success: false; message?: string; fieldErrors?: Record<string, string> };

async function refreshPlanningTaskBlockedStatus(taskId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  const { data: dependencyRows, error: dependencyError } = await db
    .from("planning_task_dependencies")
    .select("depends_on_task_id")
    .eq("task_id", taskId);

  if (dependencyError) {
    throw new Error(dependencyError.message);
  }

  const dependencyIds = (dependencyRows ?? [])
    .map((row: { depends_on_task_id: string | null }) => row.depends_on_task_id)
    .filter((id): id is string => Boolean(id));

  if (dependencyIds.length === 0) {
    const { error } = await db
      .from("planning_tasks")
      .update({ is_blocked: false })
      .eq("id", taskId)
      .eq("status", "open");
    if (error) throw new Error(error.message);
    return;
  }

  const { data: dependencyTasks, error: taskError } = await db
    .from("planning_tasks")
    .select("id, status")
    .in("id", dependencyIds);

  if (taskError) {
    throw new Error(taskError.message);
  }

  const dependencyStatus = new Map(
    (dependencyTasks ?? []).map((task: { id: string; status: string }) => [task.id, task.status])
  );
  const isBlocked = dependencyIds.some((id) => dependencyStatus.get(id) === "open");

  const { error } = await db
    .from("planning_tasks")
    .update({ is_blocked: isBlocked })
    .eq("id", taskId)
    .eq("status", "open");

  if (error) {
    throw new Error(error.message);
  }
}

async function validatePlanningTaskDependency(
  taskId: string,
  dependsOnTaskId: string
): Promise<PlanningTaskDependencyValidationResult> {
  if (taskId === dependsOnTaskId) {
    return { success: false, message: "A task cannot depend on itself." };
  }

  const db = createSupabaseAdminClient();
  const { data: taskRows, error: taskError } = await db
    .from("planning_tasks")
    .select("id, planning_item_id")
    .in("id", [taskId, dependsOnTaskId]);

  if (taskError) {
    throw new Error(taskError.message);
  }

  const tasksById = new Map(
    (taskRows ?? []).map((task: { id: string; planning_item_id: string }) => [task.id, task])
  );
  const task = tasksById.get(taskId);
  const dependency = tasksById.get(dependsOnTaskId);

  if (!task || !dependency) {
    return { success: false, message: "Task not found." };
  }
  if (task.planning_item_id !== dependency.planning_item_id) {
    return { success: false, message: "Dependencies can only be added between tasks on the same planning item." };
  }

  const { data: siblingRows, error: siblingError } = await db
    .from("planning_tasks")
    .select("id")
    .eq("planning_item_id", task.planning_item_id);

  if (siblingError) {
    throw new Error(siblingError.message);
  }

  const siblingIds = (siblingRows ?? []).map((row: { id: string }) => row.id);
  const { data: dependencyRows, error: dependencyError } = await db
    .from("planning_task_dependencies")
    .select("task_id, depends_on_task_id")
    .in("task_id", siblingIds);

  if (dependencyError) {
    throw new Error(dependencyError.message);
  }

  const edges = new Map<string, string[]>();
  for (const row of (dependencyRows ?? []) as PlanningTaskDependencyRow[]) {
    const existing = edges.get(row.task_id) ?? [];
    existing.push(row.depends_on_task_id);
    edges.set(row.task_id, existing);
  }
  edges.set(taskId, [...(edges.get(taskId) ?? []), dependsOnTaskId]);

  const visited = new Set<string>();
  function reachesTask(currentId: string): boolean {
    if (currentId === taskId) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    return (edges.get(currentId) ?? []).some((nextId) => reachesTask(nextId));
  }

  if (reachesTask(dependsOnTaskId)) {
    return { success: false, message: "That dependency would create a circular chain." };
  }

  return { success: true, planningItemId: task.planning_item_id };
}

export async function createPlanningTaskDependencyAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = taskDependencySchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Dependency reference is invalid.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    const ownershipError = await ensureOwnsParentItemOfTask(user.id, user.role, user.venueId, parsed.data.taskId);
    if (ownershipError) return ownershipError;

    const validation = await validatePlanningTaskDependency(parsed.data.taskId, parsed.data.dependsOnTaskId);
    if (!validation.success) return validation;

    const db = createSupabaseAdminClient();
    const { error } = await db
      .from("planning_task_dependencies")
      .insert({
        task_id: parsed.data.taskId,
        depends_on_task_id: parsed.data.dependsOnTaskId
      });

    if (error && error.code !== "23505") {
      throw new Error(error.message);
    }

    await refreshPlanningTaskBlockedStatus(parsed.data.taskId);
    recordAuditLogEntry({
      entity: "planning_task",
      entityId: parsed.data.taskId,
      action: "planning_task.dependency_added",
      actorId: user.id,
      meta: { depends_on_task_id: parsed.data.dependsOnTaskId }
    }).catch(() => {});
    revalidatePath("/planning");
    revalidatePath(`/planning/${validation.planningItemId}`);
    revalidatePath("/");
    return { success: true, message: error?.code === "23505" ? "Dependency already exists." : "Dependency added." };
  } catch (error) {
    console.error("Failed to create planning task dependency", error);
    return { success: false, message: "Could not add dependency." };
  }
}

export async function deletePlanningTaskDependencyAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = taskDependencySchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Dependency reference is invalid.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    const ownershipError = await ensureOwnsParentItemOfTask(user.id, user.role, user.venueId, parsed.data.taskId);
    if (ownershipError) return ownershipError;

    const db = createSupabaseAdminClient();
    const { data: task, error: taskError } = await db
      .from("planning_tasks")
      .select("planning_item_id")
      .eq("id", parsed.data.taskId)
      .maybeSingle();

    if (taskError) throw new Error(taskError.message);
    if (!task) return { success: false, message: "Task not found." };

    const { error } = await db
      .from("planning_task_dependencies")
      .delete()
      .eq("task_id", parsed.data.taskId)
      .eq("depends_on_task_id", parsed.data.dependsOnTaskId);

    if (error) {
      throw new Error(error.message);
    }

    await refreshPlanningTaskBlockedStatus(parsed.data.taskId);
    recordAuditLogEntry({
      entity: "planning_task",
      entityId: parsed.data.taskId,
      action: "planning_task.dependency_removed",
      actorId: user.id,
      meta: { depends_on_task_id: parsed.data.dependsOnTaskId }
    }).catch(() => {});
    revalidatePath("/planning");
    revalidatePath(`/planning/${task.planning_item_id}`);
    revalidatePath("/");
    return { success: true, message: "Dependency removed." };
  } catch (error) {
    console.error("Failed to delete planning task dependency", error);
    return { success: false, message: "Could not remove dependency." };
  }
}

export async function updatePlanningTaskAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = updateTaskSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Check the highlighted fields.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    // Ownership check: non-admins can only update tasks on their own planning items
    const ownershipError = await ensureOwnsParentItemOfTask(user.id, user.role, user.venueId, parsed.data.taskId);
    if (ownershipError) return ownershipError;
    const routeContext = await loadTaskRouteContext(parsed.data.taskId);

    if (parsed.data.status && parsed.data.status !== "open") {
      const db = createSupabaseAdminClient();
      const { data: task, error: taskError } = await db
        .from("planning_tasks")
        .select("is_blocked")
        .eq("id", parsed.data.taskId)
        .maybeSingle();

      if (taskError) throw new Error(taskError.message);
      if (task?.is_blocked) {
        return { success: false, message: "Complete the blocking tasks first." };
      }
    }

    await updatePlanningTask(parsed.data.taskId, {
      title: parsed.data.title,
      assigneeId: Object.prototype.hasOwnProperty.call(parsed.data, "assigneeId")
        ? parsed.data.assigneeId
          ? parsed.data.assigneeId
          : null
        : undefined,
      dueDate: parsed.data.dueDate,
      status: parsed.data.status as PlanningTaskStatus | undefined,
      sortOrder: parsed.data.sortOrder,
      notes: Object.prototype.hasOwnProperty.call(parsed.data, "notes")
        ? (parsed.data.notes ?? null)
        : undefined
    });

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.taskId,
      action: "planning.task_updated",
      actorId: user.id,
      meta: { title: parsed.data.title, status: parsed.data.status }
    }).catch(() => {});

    // Dedicated audit line for notes changes — makes it easy to trace
    // notes history without scanning every planning.task_updated row.
    // Note text is intentionally not included in meta (PII hygiene).
    if (Object.prototype.hasOwnProperty.call(parsed.data, "notes")) {
      recordAuditLogEntry({
        entity: "planning_task",
        entityId: parsed.data.taskId,
        action: "planning_task.notes_updated",
        actorId: user.id,
        meta: { changed_fields: ["notes"] }
      }).catch(() => {});
    }

    revalidatePlanningRouteContext(routeContext);
    return { success: true, message: "Task updated." };
  } catch (error) {
    console.error("Failed to update planning task", error);
    return { success: false, message: "Could not update task." };
  }
}

export async function togglePlanningTaskStatusAction(input: unknown): Promise<PlanningActionResult> {
  const user = await ensureUser();
  const parsed = z.object({ taskId: uuidSchema, status: taskStatusSchema }).safeParse(input);
  if (!parsed.success) return { success: false, fieldErrors: zodFieldErrors(parsed.error) };
  try {
    // Ownership check: non-admins can only toggle tasks on their own planning items
    const ownershipError = await ensureOwnsParentItemOfTask(user.id, user.role, user.venueId, parsed.data.taskId);
    if (ownershipError) return ownershipError;
    const routeContext = await loadTaskRouteContext(parsed.data.taskId);

    if (parsed.data.status !== "open") {
      const db = createSupabaseAdminClient();
      const { data: task, error: taskError } = await db
        .from("planning_tasks")
        .select("is_blocked")
        .eq("id", parsed.data.taskId)
        .maybeSingle();

      if (taskError) throw new Error(taskError.message);
      if (task?.is_blocked) {
        return { success: false, message: "Complete the blocking tasks first." };
      }
    }

    await togglePlanningTaskStatus(parsed.data.taskId, parsed.data.status, user.id);
    recordAuditLogEntry({
      entity: "planning_task",
      entityId: parsed.data.taskId,
      action: "planning_task.status_changed",
      actorId: user.id,
      meta: { new_status: parsed.data.status }
    }).catch(() => {});
    try {
      if (parsed.data.status === "open") {
        await refreshPlanningTaskBlockedStatus(parsed.data.taskId);
      }
      await updateBlockedStatus(parsed.data.taskId, parsed.data.status);
    } catch (blockErr) {
      console.error("Failed to update blocked status:", blockErr);
    }
    revalidatePlanningRouteContext(routeContext);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to update task status" };
  }
}

// ─── Reassign task assignees (multi-assignee) ────────────────────────────────

export async function reassignPlanningTaskAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = z.object({
      taskId: z.string().min(1),
      assigneeIds: z.array(z.string().min(1)),
    }).safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid input.", fieldErrors: zodFieldErrors(parsed.error) };
    }

    // Ownership check: non-admins can only reassign tasks on their own planning items
    const ownershipError = await ensureOwnsParentItemOfTask(user.id, user.role, user.venueId, parsed.data.taskId);
    if (ownershipError) return ownershipError;

    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const db = createSupabaseAdminClient();

    // Remove existing assignees
    const { error: delError } = await db
      .from("planning_task_assignees")
      .delete()
      .eq("task_id", parsed.data.taskId);
    if (delError) throw delError;

    // Insert new assignees
    if (parsed.data.assigneeIds.length > 0) {
      const rows = parsed.data.assigneeIds.map((userId) => ({
        task_id: parsed.data.taskId,
        user_id: userId,
      }));
      const { error: insError } = await db
        .from("planning_task_assignees")
        .insert(rows);
      if (insError) throw insError;

      // Update the primary assignee_id to the first assignee and mark as manually assigned
      const { error: updateError } = await db
        .from("planning_tasks")
        .update({ assignee_id: parsed.data.assigneeIds[0], manually_assigned: true })
        .eq("id", parsed.data.taskId);
      if (updateError) throw updateError;
    } else {
      // Clear primary assignee and mark as manually assigned
      const { error: updateError } = await db
        .from("planning_tasks")
        .update({ assignee_id: null, manually_assigned: true })
        .eq("id", parsed.data.taskId);
      if (updateError) throw updateError;
    }

    recordAuditLogEntry({
      entity: "planning_task",
      entityId: parsed.data.taskId,
      action: "planning_task.reassigned",
      actorId: user.id,
      meta: { assignee_ids: parsed.data.assigneeIds }
    }).catch(() => {});
    revalidatePath("/planning");
    return { success: true, message: "Task reassigned." };
  } catch (error) {
    console.error("Failed to reassign planning task", error);
    return { success: false, message: "Could not reassign task." };
  }
}

const deleteTaskSchema = z.object({ taskId: uuidSchema });

export async function deletePlanningTaskAction(input: unknown): Promise<PlanningActionResult> {
  try {
    const user = await ensureUser();
    const parsed = deleteTaskSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Task reference is invalid.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    // Ownership check: non-admins can only delete tasks on their own planning items
    const ownershipError = await ensureOwnsParentItemOfTask(user.id, user.role, user.venueId, parsed.data.taskId);
    if (ownershipError) return ownershipError;

    await deletePlanningTask(parsed.data.taskId);

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.taskId,
      action: "planning.task_deleted",
      actorId: user.id,
      meta: {}
    }).catch(() => {});
    revalidatePath("/planning");
    return { success: true, message: "Task deleted." };
  } catch (error) {
    console.error("Failed to delete planning task", error);
    return { success: false, message: "Could not delete task." };
  }
}

// ─── Inspiration item actions ─────────────────────────────────────────────────

export async function convertInspirationItemAction(
  id: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user) return { success: false, message: "You must be signed in." };
    if (!canCreatePlanningItems(user.role, user.venueId)) {
      return { success: false, message: "You do not have permission to perform this action." };
    }

    const db = await createSupabaseActionClient();

    // Fetch the inspiration item
    const { data: item, error: fetchError } = await db
      .from("planning_inspiration_items")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !item) {
      return { success: false, message: "Inspiration item not found." };
    }

    // Create the planning item
    const { data: newItem, error: insertItemError } = await db
      .from("planning_items")
      .insert({
        title: item.event_name,
        target_date: item.event_date,
        type_label: "Occasion",
        status: "planned",
        created_by: user.id,
        venue_id: user.venueId,
      })
      .select("id, target_date")
      .single();

    if (insertItemError || !newItem) {
      console.error("convertInspirationItemAction: insert planning_item failed", insertItemError);
      return { success: false, message: "Failed to add to plan." };
    }

    // Generate SOP checklist for the new planning item
    try {
      await generateSopChecklist(newItem.id, newItem.target_date, user.id);
    } catch (sopError) {
      console.error("convertInspirationItemAction: SOP generation failed (item still created):", sopError);
    }

    // Record the dismissal (with reason = 'converted')
    const { error: dismissalError } = await db.from("planning_inspiration_dismissals").insert({
      inspiration_item_id: id,
      dismissed_by: user.id,
      reason: "converted",
    });
    if (dismissalError) {
      console.warn("convertInspirationItemAction: dismissal insert failed (item may reappear on board)", dismissalError);
    }

    recordAuditLogEntry({
      entity: "planning",
      entityId: newItem.id,
      action: "planning.item_created",
      actorId: user.id,
      meta: { source: "inspiration", inspiration_item_id: id }
    }).catch(() => {});

    revalidatePath("/planning");
    return { success: true, message: "Added to your plan." };
  } catch (error) {
    console.error("convertInspirationItemAction:", error);
    return { success: false, message: "Something went wrong." };
  }
}

export async function dismissInspirationItemAction(
  id: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user) return { success: false, message: "You must be signed in." };
    if (!canCreatePlanningItems(user.role, user.venueId)) {
      return { success: false, message: "You do not have permission to perform this action." };
    }

    const db = await createSupabaseActionClient();
    const { error: dismissalError } = await db.from("planning_inspiration_dismissals").insert({
      inspiration_item_id: id,
      dismissed_by: user.id,
      reason: "dismissed",
    });
    if (dismissalError) {
      console.error("dismissInspirationItemAction: dismissal insert failed", dismissalError);
      return { success: false, message: "Failed to hide item." };
    }

    recordAuditLogEntry({
      entity: "planning",
      entityId: id,
      action: "planning.inspiration_dismissed",
      actorId: user.id,
      meta: {}
    }).catch(() => {});

    revalidatePath("/planning");
    return { success: true };
  } catch (error) {
    console.error("dismissInspirationItemAction:", error);
    return { success: false, message: "Something went wrong." };
  }
}

export async function refreshInspirationItemsAction(): Promise<{ success: boolean; message?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "administrator") {
      return { success: false, message: "Unauthorised." };
    }

    const today = new Date();
    const windowEnd = new Date(today);
    windowEnd.setDate(today.getDate() + 180);

    const count = await generateInspirationItems(today, windowEnd);

    recordAuditLogEntry({
      entity: "planning",
      entityId: user.id,
      action: "planning.inspiration_refreshed",
      actorId: user.id,
      meta: { count, window_end: windowEnd.toISOString() }
    }).catch(() => {});

    revalidatePath("/planning");
    return { success: true, message: `Inspiration items refreshed — ${count} occasions found.` };
  } catch (error) {
    console.error("refreshInspirationItemsAction:", error);
    return { success: false, message: "Refresh failed. Check server logs." };
  }
}
