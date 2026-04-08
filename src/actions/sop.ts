"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { canEditSopTemplate, canViewSopTemplate } from "@/lib/roles";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { loadSopTemplate } from "@/lib/planning/sop";
import type { SopTemplateTree } from "@/lib/planning/sop-types";

// ─── Result type ─────────────────────────────────────────────────────────────

export interface SopActionResult {
  success: boolean;
  message?: string;
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function ensureSopUser(requireWrite = false) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("You must be signed in.");
  }
  if (requireWrite && !canEditSopTemplate(user.role)) {
    throw new Error("You do not have permission to edit the SOP template.");
  }
  if (!requireWrite && !canViewSopTemplate(user.role)) {
    throw new Error("You do not have permission to view the SOP template.");
  }
  return user;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const sopSectionSchema = z.object({
  label: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0),
  defaultAssigneeIds: z.array(z.string().uuid()).max(10).default([]),
});

const sopSectionUpdateSchema = sopSectionSchema.partial().extend({
  id: z.string().uuid(),
});

const sopTaskTemplateSchema = z.object({
  sectionId: z.string().uuid(),
  title: z.string().min(1).max(200),
  sortOrder: z.number().int().min(0),
  defaultAssigneeIds: z.array(z.string().uuid()).max(10).default([]),
  tMinusDays: z.number().int().min(0),
});

const sopTaskTemplateUpdateSchema = sopTaskTemplateSchema.extend({
  id: z.string().uuid(),
});

const sopDependencySchema = z.object({
  taskTemplateId: z.string().uuid(),
  dependsOnTemplateId: z.string().uuid(),
});

// ─── User list for assignee selection ────────────────────────────────────────

export async function loadSopAssignableUsersAction(): Promise<
  Array<{ id: string; name: string }>
> {
  await ensureSopUser(false);
  const { listAssignableUsers } = await import("@/lib/users");
  const users = await listAssignableUsers();
  return users.map((u) => ({ id: u.id, name: u.name }));
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Load the full SOP template tree, augmented with the caller's edit capability.
 */
export async function loadSopTemplateAction(): Promise<
  SopTemplateTree & { canEdit: boolean }
> {
  const user = await ensureSopUser(false);
  const template = await loadSopTemplate();
  return { ...template, canEdit: canEditSopTemplate(user.role) };
}

// ─── Section actions ──────────────────────────────────────────────────────────

export async function createSopSectionAction(
  input: unknown
): Promise<SopActionResult> {
  try {
    const user = await ensureSopUser(true);
    const parsed = sopSectionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid section data." };
    }

    const db = createSupabaseAdminClient();
    const { error } = await db.from("sop_sections").insert({
      label: parsed.data.label,
      sort_order: parsed.data.sortOrder,
      default_assignee_ids: parsed.data.defaultAssigneeIds,
    });

    if (error) {
      console.error("createSopSectionAction: insert failed", error);
      return { success: false, message: "Could not create section." };
    }

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_section.created",
      actorId: user.id,
      meta: { label: parsed.data.label },
    });

    revalidatePath("/settings");
    return { success: true, message: "Section created." };
  } catch (error) {
    console.error("createSopSectionAction:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Could not create section.",
    };
  }
}

export async function updateSopSectionAction(
  input: unknown
): Promise<SopActionResult> {
  try {
    const user = await ensureSopUser(true);
    const parsed = sopSectionUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid section data." };
    }

    const db = createSupabaseAdminClient();
    const updates: Record<string, unknown> = {};
    if (parsed.data.label !== undefined) updates.label = parsed.data.label;
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder;
    if (parsed.data.defaultAssigneeIds !== undefined) updates.default_assignee_ids = parsed.data.defaultAssigneeIds;

    const { error } = await db
      .from("sop_sections")
      .update(updates)
      .eq("id", parsed.data.id);

    if (error) {
      console.error("updateSopSectionAction: update failed", error);
      return { success: false, message: "Could not update section." };
    }

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_section.updated",
      actorId: user.id,
      meta: { id: parsed.data.id, label: parsed.data.label },
    });

    revalidatePath("/settings");
    return { success: true, message: "Section updated." };
  } catch (error) {
    console.error("updateSopSectionAction:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Could not update section.",
    };
  }
}

export async function deleteSopSectionAction(
  sectionId: string
): Promise<SopActionResult> {
  try {
    const user = await ensureSopUser(true);
    const idParsed = z.string().uuid().safeParse(sectionId);
    if (!idParsed.success) {
      return { success: false, message: "Invalid section ID." };
    }

    const db = createSupabaseAdminClient();
    const { error } = await db
      .from("sop_sections")
      .delete()
      .eq("id", sectionId);

    if (error) {
      console.error("deleteSopSectionAction: delete failed", error);
      return { success: false, message: "Could not delete section." };
    }

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_section.deleted",
      actorId: user.id,
      meta: { id: sectionId },
    });

    revalidatePath("/settings");
    return { success: true, message: "Section deleted." };
  } catch (error) {
    console.error("deleteSopSectionAction:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Could not delete section.",
    };
  }
}

// ─── Task template actions ────────────────────────────────────────────────────

export async function createSopTaskTemplateAction(
  input: unknown
): Promise<SopActionResult> {
  try {
    const user = await ensureSopUser(true);
    const parsed = sopTaskTemplateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid task template data." };
    }

    const db = createSupabaseAdminClient();
    const { error } = await db.from("sop_task_templates").insert({
      section_id: parsed.data.sectionId,
      title: parsed.data.title,
      sort_order: parsed.data.sortOrder,
      default_assignee_ids: parsed.data.defaultAssigneeIds,
      t_minus_days: parsed.data.tMinusDays,
    });

    if (error) {
      console.error("createSopTaskTemplateAction: insert failed", error);
      return { success: false, message: "Could not create task template." };
    }

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_task_template.created",
      actorId: user.id,
      meta: { title: parsed.data.title, sectionId: parsed.data.sectionId },
    });

    revalidatePath("/settings");
    return { success: true, message: "Task template created." };
  } catch (error) {
    console.error("createSopTaskTemplateAction:", error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Could not create task template.",
    };
  }
}

export async function updateSopTaskTemplateAction(
  input: unknown
): Promise<SopActionResult> {
  try {
    const user = await ensureSopUser(true);
    const parsed = sopTaskTemplateUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid task template data." };
    }

    const db = createSupabaseAdminClient();
    const { error } = await db
      .from("sop_task_templates")
      .update({
        section_id: parsed.data.sectionId,
        title: parsed.data.title,
        sort_order: parsed.data.sortOrder,
        default_assignee_ids: parsed.data.defaultAssigneeIds,
        t_minus_days: parsed.data.tMinusDays,
      })
      .eq("id", parsed.data.id);

    if (error) {
      console.error("updateSopTaskTemplateAction: update failed", error);
      return { success: false, message: "Could not update task template." };
    }

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_task_template.updated",
      actorId: user.id,
      meta: { id: parsed.data.id, title: parsed.data.title },
    });

    revalidatePath("/settings");
    return { success: true, message: "Task template updated." };
  } catch (error) {
    console.error("updateSopTaskTemplateAction:", error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Could not update task template.",
    };
  }
}

export async function deleteSopTaskTemplateAction(
  taskTemplateId: string
): Promise<SopActionResult> {
  try {
    const user = await ensureSopUser(true);
    const idParsed = z.string().uuid().safeParse(taskTemplateId);
    if (!idParsed.success) {
      return { success: false, message: "Invalid task template ID." };
    }

    const db = createSupabaseAdminClient();
    const { error } = await db
      .from("sop_task_templates")
      .delete()
      .eq("id", taskTemplateId);

    if (error) {
      console.error("deleteSopTaskTemplateAction: delete failed", error);
      return { success: false, message: "Could not delete task template." };
    }

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_task_template.deleted",
      actorId: user.id,
      meta: { id: taskTemplateId },
    });

    revalidatePath("/settings");
    return { success: true, message: "Task template deleted." };
  } catch (error) {
    console.error("deleteSopTaskTemplateAction:", error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Could not delete task template.",
    };
  }
}

// ─── Dependency actions ───────────────────────────────────────────────────────

export async function createSopDependencyAction(
  input: unknown
): Promise<SopActionResult> {
  try {
    const user = await ensureSopUser(true);
    const parsed = sopDependencySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid dependency data." };
    }

    // Prevent self-dependency
    if (parsed.data.taskTemplateId === parsed.data.dependsOnTemplateId) {
      return { success: false, message: "A task cannot depend on itself." };
    }

    const db = createSupabaseAdminClient();
    const { error } = await db.from("sop_task_dependencies").insert({
      task_template_id: parsed.data.taskTemplateId,
      depends_on_template_id: parsed.data.dependsOnTemplateId,
    });

    if (error) {
      console.error("createSopDependencyAction: insert failed", error);
      return { success: false, message: "Could not create dependency." };
    }

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_dependency.created",
      actorId: user.id,
      meta: {
        taskTemplateId: parsed.data.taskTemplateId,
        dependsOnTemplateId: parsed.data.dependsOnTemplateId,
      },
    });

    revalidatePath("/settings");
    return { success: true, message: "Dependency created." };
  } catch (error) {
    console.error("createSopDependencyAction:", error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Could not create dependency.",
    };
  }
}

/**
 * Delete a dependency by its composite key (taskTemplateId + dependsOnTemplateId).
 * Useful when the UI only has the composite key, not the row ID.
 */
export async function deleteSopDependencyByCompositeAction(
  input: unknown
): Promise<SopActionResult> {
  try {
    const user = await ensureSopUser(true);
    const parsed = sopDependencySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid dependency data." };
    }

    const db = createSupabaseAdminClient();
    const { error } = await db
      .from("sop_task_dependencies")
      .delete()
      .eq("task_template_id", parsed.data.taskTemplateId)
      .eq("depends_on_template_id", parsed.data.dependsOnTemplateId);

    if (error) {
      console.error("deleteSopDependencyByCompositeAction: delete failed", error);
      return { success: false, message: "Could not delete dependency." };
    }

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_dependency.deleted",
      actorId: user.id,
      meta: {
        taskTemplateId: parsed.data.taskTemplateId,
        dependsOnTemplateId: parsed.data.dependsOnTemplateId,
      },
    });

    revalidatePath("/settings");
    return { success: true, message: "Dependency removed." };
  } catch (error) {
    console.error("deleteSopDependencyByCompositeAction:", error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Could not delete dependency.",
    };
  }
}

export async function deleteSopDependencyAction(
  dependencyId: string
): Promise<SopActionResult> {
  try {
    const user = await ensureSopUser(true);
    const idParsed = z.string().uuid().safeParse(dependencyId);
    if (!idParsed.success) {
      return { success: false, message: "Invalid dependency ID." };
    }

    const db = createSupabaseAdminClient();
    const { error } = await db
      .from("sop_task_dependencies")
      .delete()
      .eq("id", dependencyId);

    if (error) {
      console.error("deleteSopDependencyAction: delete failed", error);
      return { success: false, message: "Could not delete dependency." };
    }

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_dependency.deleted",
      actorId: user.id,
      meta: { id: dependencyId },
    });

    revalidatePath("/settings");
    return { success: true, message: "Dependency deleted." };
  } catch (error) {
    console.error("deleteSopDependencyAction:", error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Could not delete dependency.",
    };
  }
}
