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
import type { UserRole } from "@/lib/types";
import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { generateInspirationItems } from "@/lib/planning/inspiration";
import { generateSopChecklist, recalculateSopDates, updateBlockedStatus } from "@/lib/planning/sop";
import { recordAuditLogEntry } from "@/lib/audit-log";

export type PlanningActionResult = {
  success: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

const uuidSchema = z.string().uuid();
const optionalUuidSchema = z.union([z.string().uuid(), z.literal(""), z.null(), z.undefined()]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
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
  if (!canCreatePlanningItems(user.role)) {
    throw new Error("You do not have permission to perform planning actions.");
  }
  return user;
}

const createItemSchema = z.object({
  title: z.string().min(2, "Add a title").max(160),
  description: z.string().max(2000).optional().nullable(),
  typeLabel: z.string().min(2, "Add a planning type").max(120),
  venueId: optionalUuidSchema,
  ownerId: optionalUuidSchema,
  targetDate: dateSchema,
  status: planningStatusSchema.optional()
});

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

    const item = await createPlanningItem({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      typeLabel: parsed.data.typeLabel,
      venueId: parsed.data.venueId ? parsed.data.venueId : null,
      ownerId: parsed.data.ownerId ? parsed.data.ownerId : null,
      targetDate: parsed.data.targetDate,
      status: (parsed.data.status ?? "planned") as PlanningItemStatus,
      createdBy: user.id
    });

    try {
      await generateSopChecklist(item.id, item.target_date, user.id);
    } catch (sopError) {
      console.error("SOP checklist generation failed:", sopError);
    }

    recordAuditLogEntry({
      entity: "planning",
      entityId: item.id,
      action: "planning.item_created",
      actorId: user.id,
      meta: { title: parsed.data.title }
    }).catch(() => {});
    revalidatePath("/planning");
    return { success: true, message: "Planning item created." };
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
  ownerId: optionalUuidSchema,
  targetDate: dateSchema.optional(),
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

    await updatePlanningItem(parsed.data.itemId, {
      title: parsed.data.title,
      description: parsed.data.description,
      typeLabel: parsed.data.typeLabel,
      venueId: parsed.data.venueId ? parsed.data.venueId : null,
      ownerId: parsed.data.ownerId ? parsed.data.ownerId : null,
      targetDate: parsed.data.targetDate,
      status: parsed.data.status as PlanningItemStatus | undefined
    });

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.itemId,
      action: "planning.item_updated",
      actorId: user.id,
      meta: { title: parsed.data.title, status: parsed.data.status }
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
    await ensureUser();
    const parsed = moveItemSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Move payload is invalid.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    await movePlanningItemDate(parsed.data.itemId, parsed.data.targetDate);

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.itemId,
      action: "planning.item_updated",
      actorId: null,
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
    await ensureUser();
    const parsed = deleteItemSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Planning item reference is invalid.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    await deletePlanningItem(parsed.data.itemId);

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.itemId,
      action: "planning.item_deleted",
      actorId: null,
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
    await ensureUser();
    const parsed = updateSeriesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Check the highlighted fields.",
        fieldErrors: zodFieldErrors(parsed.error)
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
      actorId: null,
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
    await ensureUser();
    const parsed = pauseSeriesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Series reference is invalid.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    await pausePlanningSeries(parsed.data.seriesId);

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.seriesId,
      action: "planning.series_paused",
      actorId: null,
      meta: {}
    }).catch(() => {});
    revalidatePath("/planning");
    return { success: true, message: "Recurring series paused." };
  } catch (error) {
    console.error("Failed to pause planning series", error);
    return { success: false, message: "Could not pause recurring series." };
  }
}

/**
 * Verify the current user owns the parent planning item.
 * Returns an error result if the user is not admin and does not own the item.
 */
async function ensureOwnsParentItem(
  userId: string,
  userRole: UserRole,
  planningItemId: string
): Promise<PlanningActionResult | null> {
  if (canManageAllPlanning(userRole)) return null;
  const supabase = await createSupabaseReadonlyClient();
  const { data: parentItem } = await supabase
    .from("planning_items")
    .select("owner_id")
    .eq("id", planningItemId)
    .single();
  if (parentItem?.owner_id !== userId) {
    return { success: false, message: "You can only manage tasks on your own planning items." };
  }
  return null;
}

/**
 * Verify the current user owns the parent planning item of a given task.
 * Returns an error result if the user is not admin and does not own the parent item.
 */
async function ensureOwnsParentItemOfTask(
  userId: string,
  userRole: UserRole,
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

  // Check 1: Parent planning item owner
  const ownershipError = await ensureOwnsParentItem(userId, userRole, task.planning_item_id);
  if (!ownershipError) return null;

  // Check 2: Assigned via junction table (multi-assignee)
  const { data: assigneeRow } = await supabase
    .from("planning_task_assignees")
    .select("id")
    .eq("task_id", taskId)
    .eq("user_id", userId)
    .maybeSingle();
  if (assigneeRow) return null;

  // Check 3: Legacy single assignee
  if (task.assignee_id === userId) return null;

  return { success: false, message: "You can only manage tasks on your own planning items." };
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
    const ownershipError = await ensureOwnsParentItem(user.id, user.role, parsed.data.planningItemId);
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
  sortOrder: z.number().int().min(0).max(999).optional()
});

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
    const ownershipError = await ensureOwnsParentItemOfTask(user.id, user.role, parsed.data.taskId);
    if (ownershipError) return ownershipError;

    await updatePlanningTask(parsed.data.taskId, {
      title: parsed.data.title,
      assigneeId: Object.prototype.hasOwnProperty.call(parsed.data, "assigneeId")
        ? parsed.data.assigneeId
          ? parsed.data.assigneeId
          : null
        : undefined,
      dueDate: parsed.data.dueDate,
      status: parsed.data.status as PlanningTaskStatus | undefined,
      sortOrder: parsed.data.sortOrder
    });

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.taskId,
      action: "planning.task_updated",
      actorId: null,
      meta: { title: parsed.data.title, status: parsed.data.status }
    }).catch(() => {});
    revalidatePath("/planning");
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
    const ownershipError = await ensureOwnsParentItemOfTask(user.id, user.role, parsed.data.taskId);
    if (ownershipError) return ownershipError;

    await togglePlanningTaskStatus(parsed.data.taskId, parsed.data.status, user.id);
    recordAuditLogEntry({
      entity: "planning_task",
      entityId: parsed.data.taskId,
      action: "planning_task.status_changed",
      actorId: user.id,
      meta: { new_status: parsed.data.status }
    }).catch(() => {});
    try {
      await updateBlockedStatus(parsed.data.taskId, parsed.data.status);
    } catch (blockErr) {
      console.error("Failed to update blocked status:", blockErr);
    }
    revalidatePath("/planning");
    revalidatePath("/");
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
    const ownershipError = await ensureOwnsParentItemOfTask(user.id, user.role, parsed.data.taskId);
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

      // Update the primary assignee_id to the first assignee
      await db
        .from("planning_tasks")
        .update({ assignee_id: parsed.data.assigneeIds[0] })
        .eq("id", parsed.data.taskId);
    } else {
      // Clear primary assignee
      await db
        .from("planning_tasks")
        .update({ assignee_id: null })
        .eq("id", parsed.data.taskId);
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
    const ownershipError = await ensureOwnsParentItemOfTask(user.id, user.role, parsed.data.taskId);
    if (ownershipError) return ownershipError;

    await deletePlanningTask(parsed.data.taskId);

    recordAuditLogEntry({
      entity: "planning",
      entityId: parsed.data.taskId,
      action: "planning.task_deleted",
      actorId: null,
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
    if (!canCreatePlanningItems(user.role)) {
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
    if (!canCreatePlanningItems(user.role)) {
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
