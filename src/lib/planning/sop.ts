import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { londonDateString } from "./utils";
import type { SopSectionWithTasks, SopTemplateTree } from "./sop-types";

export const EVENT_TODO_NOT_REQUIRED_AFTER_DATE = "2026-06-11";
export const EVENT_TODO_NOT_REQUIRED_BEFORE_DATE = "2026-06-11";

type GenerateSopOptions = {
  notRequiredTemplateIds?: string[];
  applyEventTodoRules?: boolean;
};

export type PastEventTodoNotRequiredTask = {
  id: string;
  planningItemId: string;
  eventId: string;
};

type PastEventTodoCleanupOptions = {
  now?: Date | string;
  pageSize?: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_IN_CHUNK_SIZE = 500;

function toIsoTimestamp(value: Date | string | undefined): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

function chunks<T>(values: T[], size = DEFAULT_IN_CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchRowsInPages<T>(
  buildQuery: () => any,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const query = buildQuery();
    const result = typeof query.range === "function"
      ? await query.range(from, from + pageSize - 1)
      : await query;
    if (result.error) throw new Error(result.error.message);

    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (typeof query.range !== "function" || page.length < pageSize) {
      return rows;
    }
  }
}

export function normaliseSopNotRequiredTemplateIds(values: unknown): string[] {
  const rawValues = Array.isArray(values) ? values : typeof values === "string" ? [values] : [];
  return Array.from(
    new Set(
      rawValues
        .flatMap((value) => String(value).split(","))
        .map((value) => value.trim())
        .filter((value) => UUID_PATTERN.test(value))
    )
  );
}

export function shouldMarkEventTodosNotRequired(
  targetDate: string,
  today = londonDateString(),
  afterDate = EVENT_TODO_NOT_REQUIRED_AFTER_DATE,
  beforeDate = EVENT_TODO_NOT_REQUIRED_BEFORE_DATE
): boolean {
  return targetDate < today || targetDate < beforeDate || targetDate > afterDate;
}

async function markOpenTasksNotRequired(taskIds: string[], completedBy: string | null): Promise<number> {
  if (!taskIds.length) return 0;

  const db = createSupabaseAdminClient();
  const { data, error } = await (db as any)
    .from("planning_tasks")
    .update({
      status: "not_required",
      completed_at: new Date().toISOString(),
      completed_by: completedBy,
    })
    .in("id", taskIds)
    .eq("status", "open")
    .select("id");

  if (error) throw new Error(error.message);

  const updatedIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  for (const taskId of updatedIds) {
    await updateBlockedStatus(taskId, "not_required");
  }

  return updatedIds.length;
}

export async function markPlanningItemOpenTasksNotRequired(
  planningItemId: string,
  completedBy: string | null
): Promise<number> {
  const db = createSupabaseAdminClient();
  const { data, error } = await (db as any)
    .from("planning_tasks")
    .select("id")
    .eq("planning_item_id", planningItemId)
    .eq("status", "open");

  if (error) throw new Error(error.message);

  const taskIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  return markOpenTasksNotRequired(taskIds, completedBy);
}

export async function markSopTemplateTasksNotRequired(
  planningItemId: string,
  templateIds: string[],
  completedBy: string | null
): Promise<number> {
  const ids = normaliseSopNotRequiredTemplateIds(templateIds);
  if (!ids.length) return 0;

  const db = createSupabaseAdminClient();
  const { data: masterRows, error: masterError } = await (db as any)
    .from("planning_tasks")
    .select("id")
    .eq("planning_item_id", planningItemId)
    .or(`sop_template_task_id.in.(${ids.join(",")}),cascade_sop_template_id.in.(${ids.join(",")})`);

  if (masterError) throw new Error(masterError.message);

  const masterIds = ((masterRows ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (!masterIds.length) return 0;

  const { data: taskRows, error: taskError } = await (db as any)
    .from("planning_tasks")
    .select("id")
    .eq("planning_item_id", planningItemId)
    .or(`id.in.(${masterIds.join(",")}),parent_task_id.in.(${masterIds.join(",")})`);

  if (taskError) throw new Error(taskError.message);

  const taskIds = ((taskRows ?? []) as Array<{ id: string }>).map((row) => row.id);
  return markOpenTasksNotRequired(taskIds, completedBy);
}

export async function markPastEventOpenTodosNotRequired(
  options: PastEventTodoCleanupOptions = {}
): Promise<{ processed: number; tasks: PastEventTodoNotRequiredTask[]; nowIso: string }> {
  const nowIso = toIsoTimestamp(options.now);
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const db = createSupabaseAdminClient();

  const pastEvents = await fetchRowsInPages<{ id: string }>(
    () => db
      .from("events")
      .select("id")
      .lt("end_at", nowIso)
      .is("deleted_at", null)
      .order("id", { ascending: true }),
    pageSize
  );
  const eventIds = pastEvents.map((event) => event.id);
  if (eventIds.length === 0) {
    return { processed: 0, tasks: [], nowIso };
  }

  const planningItems: Array<{ id: string; event_id: string }> = [];
  for (const eventIdChunk of chunks(eventIds)) {
    planningItems.push(
      ...(await fetchRowsInPages<{ id: string; event_id: string }>(
        () => db
          .from("planning_items")
          .select("id, event_id")
          .in("event_id", eventIdChunk)
          .order("id", { ascending: true }),
        pageSize
      ))
    );
  }

  const planningItemToEvent = new Map(
    planningItems
      .filter((item) => Boolean(item.event_id))
      .map((item) => [item.id, item.event_id])
  );
  const planningItemIds = [...planningItemToEvent.keys()];
  if (planningItemIds.length === 0) {
    return { processed: 0, tasks: [], nowIso };
  }

  const { data: debriefTemplates, error: templateError } = await (db as any)
    .from("sop_task_templates")
    .select("id")
    .eq("template_key", "debrief");
  if (templateError) throw new Error(templateError.message);

  const debriefTemplateIds = new Set(
    ((debriefTemplates ?? []) as Array<{ id: string }>).map((template) => template.id)
  );

  type OpenTaskRow = {
    id: string;
    planning_item_id: string;
    parent_task_id: string | null;
    sop_template_task_id: string | null;
    cascade_sop_template_id: string | null;
  };

  const openTasks: OpenTaskRow[] = [];
  for (const planningItemIdChunk of chunks(planningItemIds)) {
    openTasks.push(
      ...(await fetchRowsInPages<OpenTaskRow>(
        () => (db as any)
          .from("planning_tasks")
          .select("id, planning_item_id, parent_task_id, sop_template_task_id, cascade_sop_template_id")
          .in("planning_item_id", planningItemIdChunk)
          .eq("status", "open")
          .order("id", { ascending: true }),
        pageSize
      ))
    );
  }
  if (openTasks.length === 0) {
    return { processed: 0, tasks: [], nowIso };
  }

  const debriefTaskIds = new Set(
    openTasks
      .filter((task) =>
        (task.sop_template_task_id && debriefTemplateIds.has(task.sop_template_task_id)) ||
        (task.cascade_sop_template_id && debriefTemplateIds.has(task.cascade_sop_template_id))
      )
      .map((task) => task.id)
  );
  const taskIds = openTasks
    .filter((task) => !debriefTaskIds.has(task.id) && (!task.parent_task_id || !debriefTaskIds.has(task.parent_task_id)))
    .map((task) => task.id);

  if (taskIds.length === 0) {
    return { processed: 0, tasks: [], nowIso };
  }

  const updated: PastEventTodoNotRequiredTask[] = [];
  for (const taskIdChunk of chunks(taskIds)) {
    const { data, error } = await (db as any)
      .from("planning_tasks")
      .update({
        status: "not_required",
        completed_at: nowIso,
        completed_by: null,
        is_blocked: false,
      })
      .in("id", taskIdChunk)
      .eq("status", "open")
      .select("id, planning_item_id");

    if (error) throw new Error(error.message);

    for (const task of (data ?? []) as Array<{ id: string; planning_item_id: string }>) {
      const eventId = planningItemToEvent.get(task.planning_item_id);
      if (!eventId) continue;
      updated.push({
        id: task.id,
        planningItemId: task.planning_item_id,
        eventId,
      });
    }
  }

  for (const task of updated) {
    await updateBlockedStatus(task.id, "not_required");
  }

  return { processed: updated.length, tasks: updated, nowIso };
}

/**
 * Generate SOP checklist tasks for a planning item.
 *
 * Calls the v2 RPC which runs inside a single transaction. v2 adds
 * per-venue expansion for `sop_task_templates.expansion_strategy =
 * 'per_venue'` while preserving v1 column population for `'single'`
 * templates. The task count is extracted from the JSONB return for
 * backward compatibility with existing callers.
 *
 * Returns 0 when the planning item already has SOP-derived tasks
 * (idempotent skip).
 */
export async function generateSopChecklist(
  planningItemId: string,
  targetDate: string,
  createdBy: string,
  options: GenerateSopOptions = {}
): Promise<number> {
  const db = createSupabaseAdminClient();
   
  const { data, error } = await (db as any).rpc("generate_sop_checklist_v2", {
    p_planning_item_id: planningItemId,
    p_target_date: targetDate,
    p_created_by: createdBy,
  });
  if (error) throw new Error(error.message);

  if (options.notRequiredTemplateIds?.length) {
    await markSopTemplateTasksNotRequired(planningItemId, options.notRequiredTemplateIds, createdBy);
  }
  if (options.applyEventTodoRules && shouldMarkEventTodosNotRequired(targetDate)) {
    await markPlanningItemOpenTasksNotRequired(planningItemId, createdBy);
  }

  // v2 returns a JSONB object: { created, masters_created, children_created, skipped_venues, idempotent_skip? }
  if (data && typeof data === "object" && "created" in data) {
    return Number((data as { created: number }).created) || 0;
  }
  // Defensive fallback — if somehow an integer comes back (e.g. transitional state), honour it.
  return typeof data === "number" ? data : 0;
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
   
  const { data, error } = await (db as any)
    .from("sop_sections")
    .select(`
      id, label, sort_order, default_assignee_ids, created_at, updated_at,
      tasks:sop_task_templates(
        id, section_id, title, sort_order, default_assignee_ids, t_minus_days,
        expansion_strategy, venue_filter,
        created_at, updated_at,
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
      expansion_strategy: string | null;
      venue_filter: string | null;
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
        expansionStrategy: (t.expansion_strategy === "per_venue" ? "per_venue" : "single") as
          | "single"
          | "per_venue",
        venueFilter: (t.venue_filter === "all" || t.venue_filter === "pub" || t.venue_filter === "cafe")
          ? (t.venue_filter as "all" | "pub" | "cafe")
          : null,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        dependencies: (t.dependencies ?? []).map((d) => ({
          dependsOnTemplateId: d.depends_on_template_id,
        })),
      })),
  }));

  return { sections };
}
