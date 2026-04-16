import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { addDays } from "@/lib/planning/utils";
import { canManageAllPlanning, canReviewEvents } from "@/lib/roles";
import type { AppUser } from "@/lib/types";
import type { TodoItem, TodoSource, TodoUrgency } from "@/components/todos/todo-item-types";

// ---------------------------------------------------------------------------
// Urgency classification
// ---------------------------------------------------------------------------

/**
 * Classify urgency for a todo item.
 *
 * Default mode (planning/SOP/review/revision):
 *   overdue  = dueDate < today
 *   due_soon = dueDate between today and today + 7 days (inclusive)
 *   later    = everything else or null dueDate
 *
 * Debrief mode (end_at-based):
 *   overdue  = end_at more than 7 days ago
 *   due_soon = end_at within last 7 days (inclusive of today)
 *   later    = event not yet ended (end_at > today)
 */
export function classifyTodoUrgency(
  dueDate: string | null,
  today: string,
  mode: "default" | "debrief" = "default"
): TodoUrgency {
  if (!dueDate) return "later";

  if (mode === "debrief") {
    const sevenDaysAgo = addDays(today, -7);
    if (dueDate < sevenDaysAgo) return "overdue";
    if (dueDate <= today) return "due_soon";
    return "later";
  }

  const sevenDaysFromNow = addDays(today, 7);
  if (dueDate < today) return "overdue";
  if (dueDate <= sevenDaysFromNow) return "due_soon";
  return "later";
}

// ---------------------------------------------------------------------------
// Dashboard todo aggregation
// ---------------------------------------------------------------------------

export type DashboardTodoResult = {
  items: TodoItem[];
  errors: TodoSource[];
};

export async function getDashboardTodoItems(
  user: AppUser,
  today: string
): Promise<DashboardTodoResult> {
  const items: TodoItem[] = [];
  const errors: TodoSource[] = [];

  // Source 1 & 2: Planning tasks + SOP tasks (same table, filtered by assignee)
  try {
    const planningItems = await fetchUserPlanningTasks(user, today);
    items.push(...planningItems);
  } catch {
    errors.push("planning", "sop");
  }

  // Source 3: Review queue (admin / reviewers only)
  if (canReviewEvents(user.role) || user.role === "administrator") {
    try {
      const reviewItems = await fetchReviewQueueTodos(user, today);
      items.push(...reviewItems);
    } catch {
      errors.push("review");
    }
  }

  // Source 4: My events needing revisions
  try {
    const revisionItems = await fetchRevisionTodos(user, today);
    items.push(...revisionItems);
  } catch {
    errors.push("revision");
  }

  // Source 5: Debriefs needed (not for executives)
  if (user.role !== "executive") {
    try {
      const debriefItems = await fetchDebriefTodos(user, today);
      items.push(...debriefItems);
    } catch {
      errors.push("debrief");
    }
  }

  // Sort: overdue first, then due_soon, then later. Within each group, dueDate asc.
  const urgencyOrder: Record<TodoUrgency, number> = { overdue: 0, due_soon: 1, later: 2 };
  items.sort((a, b) => {
    const urgDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (urgDiff !== 0) return urgDiff;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });

  return { items, errors };
}

// ---------------------------------------------------------------------------
// Per-source fetchers (private)
// ---------------------------------------------------------------------------

async function fetchUserPlanningTasks(user: AppUser, today: string): Promise<TodoItem[]> {
  const db = createSupabaseAdminClient();

  // Fetch tasks assigned to user via junction table
  const { data: assignedTasks, error } = await db
    .from("planning_task_assignees")
    .select(`
      task_id,
      planning_tasks!inner (
        id, title, assignee_id, due_date, status,
        sop_section, sop_template_task_id, planning_item_id,
        planning_items!inner (
          id, title, owner_id, venue_id,
          venues ( name )
        )
      )
    `)
    .eq("user_id", user.id);

  if (error) throw error;

  // Also fetch tasks where legacy assignee_id matches
  const { data: legacyTasks, error: legacyError } = await db
    .from("planning_tasks")
    .select(`
      id, title, assignee_id, due_date, status,
      sop_section, sop_template_task_id, planning_item_id,
      planning_items!inner (
        id, title, owner_id, venue_id,
        venues ( name )
      )
    `)
    .eq("assignee_id", user.id)
    .eq("status", "open")
    .limit(50);

  if (legacyError) throw legacyError;

  // Merge and deduplicate by task id
  const taskMap = new Map<string, TodoItem>();

  const canToggleForUser = (ownerId: string | null): boolean => {
    if (user.role === "administrator") return true;
    if (ownerId === user.id) return true;
    // User is assigned to this task, so they can toggle it
    return true;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested select types are complex
  function mapTask(task: any, ownerId: string | null): void {
    if (!task || task.status !== "open") return;
    if (taskMap.has(task.id)) return;

    const item = task.planning_items;
    const isSop = Boolean(task.sop_section || task.sop_template_task_id);
    const source: TodoSource = isSop ? "sop" : "planning";

    taskMap.set(task.id, {
      id: task.id,
      source,
      title: task.title,
      subtitle: `${isSop ? "SOP Task" : "Planning Task"} \u00B7 ${item?.venues?.name ?? "No venue"} \u00B7 Due ${task.due_date ?? "TBD"}`,
      dueDate: task.due_date ?? null,
      urgency: classifyTodoUrgency(task.due_date ?? null, today),
      canToggle: canToggleForUser(ownerId),
      linkHref: "/planning",
      parentTitle: item?.title ?? undefined,
      venueName: item?.venues?.name ?? undefined,
      planningTaskId: task.id,
      planningItemId: item?.id ?? undefined,
    });
  }

  for (const row of assignedTasks ?? []) {
    // Supabase nested joins may return arrays; extract first element
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested join types
    const rawTask = row.planning_tasks as any;
    const task = Array.isArray(rawTask) ? rawTask[0] : rawTask;
    const item = task?.planning_items;
    const planningItem = Array.isArray(item) ? item[0] : item;
    mapTask(task, planningItem?.owner_id ?? null);
  }

  for (const rawTask of legacyTasks ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested join types
    const task = rawTask as any;
    const item = task.planning_items;
    const planningItem = Array.isArray(item) ? item[0] : item;
    mapTask(task, planningItem?.owner_id ?? null);
  }

  return Array.from(taskMap.values());
}

async function fetchReviewQueueTodos(user: AppUser, today: string): Promise<TodoItem[]> {
  const db = createSupabaseAdminClient();
  let query = db
    .from("events")
    .select("id, title, start_at, venue_id, venues!inner(name)")
    .is("deleted_at", null)
    .in("status", ["submitted", "needs_revisions"])
    .order("start_at", { ascending: true })
    .limit(20);

  // Personal dashboard: always scope to events assigned to this user
  query = query.eq("assignee_id", user.id);

  const { data, error } = await query;
  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested join types
  return (data ?? []).map((event: any) => {
    const startDate = event.start_at?.slice(0, 10) ?? null;
    const venue = Array.isArray(event.venues) ? event.venues[0] : event.venues;
    return {
      id: `review-${event.id}`,
      source: "review" as TodoSource,
      title: event.title,
      subtitle: `Review Queue \u00B7 ${venue?.name ?? "No venue"} \u00B7 ${startDate ?? "No date"}`,
      dueDate: startDate,
      urgency: classifyTodoUrgency(startDate, today),
      canToggle: false,
      linkHref: `/events/${event.id}`,
      venueName: venue?.name ?? undefined,
      eventDate: startDate ?? undefined,
    };
  });
}

async function fetchRevisionTodos(user: AppUser, today: string): Promise<TodoItem[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("events")
    .select("id, title, start_at, venue_id, venues!inner(name)")
    .eq("created_by", user.id)
    .eq("status", "needs_revisions")
    .is("deleted_at", null)
    .order("start_at", { ascending: true })
    .limit(10);

  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested join types
  return (data ?? []).map((event: any) => {
    const startDate = event.start_at?.slice(0, 10) ?? null;
    const venue = Array.isArray(event.venues) ? event.venues[0] : event.venues;
    return {
      id: `revision-${event.id}`,
      source: "revision" as TodoSource,
      title: event.title,
      subtitle: `Your Event \u00B7 ${venue?.name ?? "No venue"} \u00B7 Needs revisions`,
      dueDate: startDate,
      urgency: classifyTodoUrgency(startDate, today),
      canToggle: false,
      linkHref: `/events/${event.id}`,
      venueName: venue?.name ?? undefined,
      eventDate: startDate ?? undefined,
    };
  });
}

async function fetchDebriefTodos(user: AppUser, today: string): Promise<TodoItem[]> {
  const db = createSupabaseAdminClient();

  // Events that are approved, past end_at, and have no debrief
  let query = db
    .from("events")
    .select("id, title, end_at, venue_id, venues!inner(name), debriefs(id)")
    .eq("status", "approved")
    .lt("end_at", new Date().toISOString())
    .is("deleted_at", null)
    .order("end_at", { ascending: true })
    .limit(10);

  // Personal dashboard: scope to events user created or is assigned to
  query = query.or(`created_by.eq.${user.id},assignee_id.eq.${user.id}`);

  const { data, error } = await query;
  if (error) throw error;

  // Filter out events that actually have debriefs (Supabase anti-join workaround)
  const eventsWithoutDebrief = (data ?? []).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested types
    (event: any) => !event.debriefs || event.debriefs.length === 0
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested types
  return eventsWithoutDebrief.map((event: any) => {
    const endDate = event.end_at?.slice(0, 10) ?? null;
    return {
      id: `debrief-${event.id}`,
      source: "debrief" as TodoSource,
      title: `Submit debrief for ${event.title}`,
      subtitle: `Debrief \u00B7 ${event.venues?.name ?? "No venue"} \u00B7 Ended ${endDate ?? "unknown"}`,
      dueDate: endDate,
      urgency: classifyTodoUrgency(endDate, today, "debrief"),
      canToggle: false,
      linkHref: `/debriefs/${event.id}`,
      venueName: event.venues?.name ?? undefined,
      eventDate: endDate ?? undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Context card queries
// ---------------------------------------------------------------------------

/**
 * Debriefs due: approved events past end_at with no debrief record.
 */
export async function getDebriefsDue(user: AppUser): Promise<Array<{
  id: string;
  title: string;
  endAt: string;
  venueName: string;
}>> {
  const db = createSupabaseAdminClient();
  let query = db
    .from("events")
    .select("id, title, end_at, venues!inner(name), debriefs(id)")
    .eq("status", "approved")
    .lt("end_at", new Date().toISOString())
    .is("deleted_at", null)
    .order("end_at", { ascending: false })
    .limit(10);

  // Personal dashboard: scope to events user created or is assigned to
  query = query.or(`created_by.eq.${user.id},assignee_id.eq.${user.id}`);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested types
    .filter((e: any) => !e.debriefs || e.debriefs.length === 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested types
    .map((e: any) => ({
      id: e.id,
      title: e.title,
      endAt: e.end_at?.slice(0, 10) ?? "",
      venueName: e.venues?.name ?? "",
    }));
}

/**
 * Executive summary stats for the dashboard.
 */
export async function getExecutiveSummaryStats(): Promise<{
  eventsThisMonth: number;
  bookingsThisMonth: number;
  debriefCompletionPercent: number;
  approvedThisWeek: number;
}> {
  const db = createSupabaseAdminClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [eventsRes, bookingsRes, debriefableRes, debriefedRes, approvedRes] = await Promise.all([
    db.from("events").select("id", { count: "exact", head: true })
      .gte("start_at", monthStart).is("deleted_at", null),
    db.from("event_bookings").select("id", { count: "exact", head: true })
      .eq("status", "confirmed").gte("created_at", monthStart),
    db.from("events").select("id", { count: "exact", head: true })
      .in("status", ["approved", "completed"]).is("deleted_at", null),
    db.from("debriefs").select("id", { count: "exact", head: true }),
    db.from("events").select("id", { count: "exact", head: true })
      .eq("status", "approved").gte("updated_at", weekStart).is("deleted_at", null),
  ]);

  const debriefable = debriefableRes.count ?? 0;
  const debriefed = debriefedRes.count ?? 0;
  const pct = debriefable > 0 ? Math.round((debriefed / debriefable) * 100) : 100;

  return {
    eventsThisMonth: eventsRes.count ?? 0,
    bookingsThisMonth: bookingsRes.count ?? 0,
    debriefCompletionPercent: pct,
    approvedThisWeek: approvedRes.count ?? 0,
  };
}

/**
 * Recent activity feed for executives. Uses service-role client.
 * ONLY returns safe audit actions. Strips ALL meta fields.
 */
export async function getRecentActivity(limit = 10): Promise<Array<{
  id: string;
  action: string;
  actorName: string;
  timestamp: string;
}>> {
  const db = createSupabaseAdminClient();

  const safeActions = [
    "event.approved",
    "event.rejected",
    "event.completed",
    "event.submitted",
    "event.debrief_updated",
  ];

  const { data, error } = await db
    .from("audit_log")
    .select("id, action, actor_id, created_at")
    .in("action", safeActions)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  // Batch-fetch actor names (strip sensitive data -- only return display name)
  const actorIds = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const actorMap = new Map<string, string>();

  if (actorIds.length > 0) {
    const { data: users } = await db
      .from("users")
      .select("id, full_name")
      .in("id", actorIds);
    for (const u of users ?? []) {
      actorMap.set(u.id, u.full_name ?? "Unknown");
    }
  }

  const actionLabels: Record<string, string> = {
    "event.approved": "approved an event",
    "event.rejected": "rejected an event",
    "event.completed": "completed an event",
    "event.submitted": "submitted an event",
    "event.debrief_updated": "submitted a debrief",
  };

  return (data ?? []).map((row) => ({
    id: row.id,
    action: actionLabels[row.action] ?? row.action,
    actorName: actorMap.get(row.actor_id ?? "") ?? "System",
    timestamp: row.created_at,
  }));
}
