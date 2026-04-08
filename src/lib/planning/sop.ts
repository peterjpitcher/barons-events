import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SopSectionWithTasks, SopTemplateTree } from "./sop-types";

/**
 * Generate SOP checklist tasks for a planning item.
 * Calls the Postgres RPC function which runs inside a single transaction.
 * Returns the number of tasks created (0 if already generated).
 */
export async function generateSopChecklist(
  planningItemId: string,
  targetDate: string,
  createdBy: string
): Promise<number> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("generate_sop_checklist", {
    p_planning_item_id: planningItemId,
    p_target_date: targetDate,
    p_created_by: createdBy,
  });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

/**
 * Recalculate SOP task due dates when a target date changes.
 * Only recalculates open, non-manually-overridden tasks.
 */
export async function recalculateSopDates(
  planningItemId: string,
  newTargetDate: string
): Promise<number> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("recalculate_sop_dates", {
    p_planning_item_id: planningItemId,
    p_new_target_date: newTargetDate,
  });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

/**
 * Update is_blocked status for tasks affected by a status change.
 * Call this after any task status change (done, not_required, or back to open).
 */
export async function updateBlockedStatus(
  completedTaskId: string,
  newStatus: string
): Promise<void> {
  const db = createSupabaseAdminClient();

  if (newStatus === "done" || newStatus === "not_required") {
    // Find all tasks that depend on the completed task
    const { data: dependentRows, error: depError } = await db
      .from("planning_task_dependencies")
      .select("task_id")
      .eq("depends_on_task_id", completedTaskId);

    if (depError) throw new Error(depError.message);
    if (!dependentRows || dependentRows.length === 0) return;

    // For each dependent task, check if ALL its dependencies are now resolved
    for (const row of dependentRows) {
      const { data: allDeps, error: checkError } = await db
        .from("planning_task_dependencies")
        .select("depends_on_task_id")
        .eq("task_id", row.task_id);

      if (checkError) throw new Error(checkError.message);

      // Check status of all dependency tasks
      const depTaskIds = (allDeps ?? []).map((d: { depends_on_task_id: string }) => d.depends_on_task_id);
      const { data: depTasks, error: statusError } = await db
        .from("planning_tasks")
        .select("id, status")
        .in("id", depTaskIds);

      if (statusError) throw new Error(statusError.message);

      const allResolved = (depTasks ?? []).every(
        (t: { id: string; status: string }) => t.status === "done" || t.status === "not_required"
      );

      await db
        .from("planning_tasks")
        .update({ is_blocked: !allResolved })
        .eq("id", row.task_id)
        .eq("status", "open");
    }
  } else if (newStatus === "open") {
    // Task reopened — all tasks depending on it become blocked
    const { data: dependentRows, error: depError } = await db
      .from("planning_task_dependencies")
      .select("task_id")
      .eq("depends_on_task_id", completedTaskId);

    if (depError) throw new Error(depError.message);
    if (!dependentRows || dependentRows.length === 0) return;

    const taskIds = dependentRows.map((r: { task_id: string }) => r.task_id);
    await db
      .from("planning_tasks")
      .update({ is_blocked: true })
      .in("id", taskIds)
      .eq("status", "open");
  }
}

/**
 * Load the full SOP template tree in one query.
 */
export async function loadSopTemplate(): Promise<SopTemplateTree> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("sop_sections")
    .select(`
      id, label, sort_order, default_assignee_ids, created_at, updated_at,
      tasks:sop_task_templates(
        id, section_id, title, sort_order, default_assignee_ids, t_minus_days, created_at, updated_at,
        dependencies:sop_task_dependencies!sop_task_dependencies_task_template_id_fkey(depends_on_template_id)
      )
    `)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  const sections: SopSectionWithTasks[] = (data ?? []).map((row: {
    id: string;
    label: string;
    sort_order: number;
    default_assignee_ids: string[] | null;
    created_at: string;
    updated_at: string;
    tasks: Array<{
      id: string;
      section_id: string;
      title: string;
      sort_order: number;
      default_assignee_ids: string[] | null;
      t_minus_days: number;
      created_at: string;
      updated_at: string;
      dependencies: Array<{ depends_on_template_id: string }>;
    }>;
  }) => ({
    id: row.id,
    label: row.label,
    sortOrder: row.sort_order,
    defaultAssigneeIds: row.default_assignee_ids ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tasks: (row.tasks ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((t) => ({
        id: t.id,
        sectionId: t.section_id,
        title: t.title,
        sortOrder: t.sort_order,
        defaultAssigneeIds: t.default_assignee_ids ?? [],
        tMinusDays: t.t_minus_days,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        dependencies: (t.dependencies ?? []).map((d) => ({
          dependsOnTemplateId: d.depends_on_template_id,
        })),
      })),
  }));

  return { sections };
}
