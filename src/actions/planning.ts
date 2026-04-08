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
import { canUsePlanning, canViewPlanning } from "@/lib/roles";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { generateInspirationItems } from "@/lib/planning/inspiration";

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
  if (!canUsePlanning(user.role)) {
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

    await createPlanningItem({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      typeLabel: parsed.data.typeLabel,
      venueId: parsed.data.venueId ? parsed.data.venueId : null,
      ownerId: parsed.data.ownerId ? parsed.data.ownerId : null,
      targetDate: parsed.data.targetDate,
      status: (parsed.data.status ?? "planned") as PlanningItemStatus,
      createdBy: user.id
    });

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
    await ensureUser();
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

    revalidatePath("/planning");
    return { success: true, message: "Recurring series paused." };
  } catch (error) {
    console.error("Failed to pause planning series", error);
    return { success: false, message: "Could not pause recurring series." };
  }
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

    await createPlanningTask({
      planningItemId: parsed.data.planningItemId,
      title: parsed.data.title,
      assigneeId: parsed.data.assigneeId ? parsed.data.assigneeId : null,
      dueDate: parsed.data.dueDate,
      sortOrder: parsed.data.sortOrder,
      createdBy: user.id
    });

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
    await ensureUser();
    const parsed = updateTaskSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Check the highlighted fields.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
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
      sortOrder: parsed.data.sortOrder
    });

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
    await togglePlanningTaskStatus(parsed.data.taskId, parsed.data.status, user.id);
    revalidatePath("/planning");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to update task status" };
  }
}

const deleteTaskSchema = z.object({ taskId: uuidSchema });

export async function deletePlanningTaskAction(input: unknown): Promise<PlanningActionResult> {
  try {
    await ensureUser();
    const parsed = deleteTaskSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Task reference is invalid.",
        fieldErrors: zodFieldErrors(parsed.error)
      };
    }

    await deletePlanningTask(parsed.data.taskId);

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
    if (!canViewPlanning(user.role)) {
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
    const { error: insertItemError } = await db
      .from("planning_items")
      .insert({
        title: item.event_name,
        target_date: item.event_date,
        type_label: "Occasion",
        status: "planned",
        created_by: user.id,
      });

    if (insertItemError) {
      console.error("convertInspirationItemAction: insert planning_item failed", insertItemError);
      return { success: false, message: "Failed to add to plan." };
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
    if (!canViewPlanning(user.role)) {
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
    if (!user || user.role !== "central_planner") {
      return { success: false, message: "Unauthorised." };
    }

    const today = new Date();
    const windowEnd = new Date(today);
    windowEnd.setDate(today.getDate() + 180);

    const count = await generateInspirationItems(today, windowEnd);

    revalidatePath("/planning");
    return { success: true, message: `Inspiration items refreshed — ${count} occasions found.` };
  } catch (error) {
    console.error("refreshInspirationItemsAction:", error);
    return { success: false, message: "Refresh failed. Check server logs." };
  }
}
