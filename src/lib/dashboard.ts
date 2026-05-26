import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { addDays, daysBetween } from "@/lib/planning/utils";
import { isBookingFormat, isPaidBookingFormat } from "@/lib/booking-format";
import { canReviewEvents } from "@/lib/roles";
import type { AppUser } from "@/lib/types";
import type { EventSummary } from "@/lib/events";
import type { TodoItem, TodoSource, TodoUrgency } from "@/components/todos/todo-item-types";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

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

export type DashboardEventReadinessIssue = {
  code: string;
  label: string;
  tone: Tone;
};

export type DashboardEventReadiness = {
  id: string;
  title: string;
  href: string;
  startAt: string;
  dateLabel: string;
  daysUntil: number;
  venueName: string;
  status: string;
  statusLabel: string;
  statusTone: Tone;
  readinessScore: number;
  readinessTone: Tone;
  confirmedBookings: number;
  confirmedTickets: number;
  totalCapacity: number | null;
  capacityPercent: number | null;
  openTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  issues: DashboardEventReadinessIssue[];
};

export type DashboardCapacityAlert = {
  id: string;
  title: string;
  href: string;
  venueName: string;
  capacityPercent: number;
  label: string;
  tone: Tone;
};

export type DashboardBookingPulse = {
  confirmedBookingsThisWeek: number;
  ticketsThisWeek: number;
  netSalesThisMonthPence: number;
  averageUpcomingCapacityPct: number | null;
  capacityAlerts: DashboardCapacityAlert[];
};

export type DashboardOperationsSnapshot = {
  readiness: DashboardEventReadiness[];
  bookingPulse: DashboardBookingPulse;
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
  } catch (error) {
    console.error("Dashboard todos: failed to load planning tasks", error);
    errors.push("planning", "sop");
  }

  // Source 3: Review queue (admin / reviewers only)
  if (canReviewEvents(user.role) || user.role === "administrator") {
    try {
      const reviewItems = await fetchReviewQueueTodos(user, today);
      items.push(...reviewItems);
    } catch (error) {
      console.error("Dashboard todos: failed to load review queue", error);
      errors.push("review");
    }
  }

  // Source 4: My events needing revisions
  try {
    const revisionItems = await fetchRevisionTodos(user, today);
    items.push(...revisionItems);
  } catch (error) {
    console.error("Dashboard todos: failed to load revision tasks", error);
    errors.push("revision");
  }

  // Source 5: Debriefs needed (not for executives)
  if (user.role !== "executive") {
    try {
      const debriefItems = await fetchDebriefTodos(user, today);
      items.push(...debriefItems);
    } catch (error) {
      console.error("Dashboard todos: failed to load debrief tasks", error);
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
// Dashboard operations snapshot
// ---------------------------------------------------------------------------

const DASHBOARD_READINESS_WINDOW_DAYS = 14;

const statusLabels: Record<string, string> = {
  pending_approval: "Proposal awaiting approval",
  approved_pending_details: "Approved, needs details",
  draft: "Draft",
  submitted: "Waiting review",
  needs_revisions: "Needs tweaks",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
};

const statusTones: Record<string, Tone> = {
  pending_approval: "info",
  approved_pending_details: "info",
  draft: "neutral",
  submitted: "info",
  needs_revisions: "warning",
  approved: "success",
  rejected: "danger",
  completed: "success",
};

type BookingPulseRow = {
  event_id: string;
  ticket_count: number;
  created_at: string;
};

type PaymentPulseRow = {
  amount_pence: number;
  refunded_amount_pence: number | null;
  status: string;
  completed_at: string | null;
};

type EventTaskStats = {
  open: number;
  overdue: number;
  blocked: number;
};

/**
 * Builds the operational dashboard layer from events already scoped for the
 * current user. Booking, payment, and planning lookups are limited to those
 * visible event ids so aggregate cards do not widen role visibility.
 */
export async function getDashboardOperationsSnapshot(
  events: EventSummary[],
  today: string
): Promise<DashboardOperationsSnapshot> {
  const visibleEvents = events.filter((event) => !event.deleted_at);
  const eventIds = visibleEvents.map((event) => event.id);

  if (eventIds.length === 0) {
    return {
      readiness: [],
      bookingPulse: {
        confirmedBookingsThisWeek: 0,
        ticketsThisWeek: 0,
        netSalesThisMonthPence: 0,
        averageUpcomingCapacityPct: null,
        capacityAlerts: [],
      },
    };
  }

  const now = new Date();
  const upcoming = visibleEvents
    .filter((event) => new Date(event.start_at) >= now)
    .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
  const readinessEvents = upcoming
    .filter((event) => daysBetween(today, event.start_at.slice(0, 10)) <= DASHBOARD_READINESS_WINDOW_DAYS)
    .slice(0, 10);

  const db = createSupabaseAdminClient();
  const [bookings, taskStatsByEvent, payments] = await Promise.all([
    safeDashboardFetch("confirmed bookings", fetchConfirmedBookingsForEvents(db, eventIds), []),
    safeDashboardFetch(
      "event planning task stats",
      fetchPlanningTaskStatsForEvents(db, readinessEvents.map((event) => event.id), today),
      new Map<string, EventTaskStats>()
    ),
    safeDashboardFetch("monthly payment pulse", fetchMonthlyPaymentPulseForEvents(db, eventIds), []),
  ]);

  const bookingStatsByEvent = buildBookingStats(bookings);
  const readiness = readinessEvents.map((event) =>
    buildEventReadiness(event, bookingStatsByEvent.get(event.id), taskStatsByEvent.get(event.id), today)
  );

  return {
    readiness,
    bookingPulse: buildBookingPulse(readiness, bookings, payments, today),
  };
}

async function safeDashboardFetch<T>(label: string, promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error(`Dashboard operations: failed to load ${label}`, error);
    return fallback;
  }
}

async function fetchConfirmedBookingsForEvents(
  db: ReturnType<typeof createSupabaseAdminClient>,
  eventIds: string[]
): Promise<BookingPulseRow[]> {
  if (eventIds.length === 0) return [];

  const { data, error } = await db
    .from("event_bookings")
    .select("event_id, ticket_count, created_at")
    .in("event_id", eventIds)
    .eq("status", "confirmed");

  if (error) throw error;
  return (data ?? []) as BookingPulseRow[];
}

async function fetchMonthlyPaymentPulseForEvents(
  db: ReturnType<typeof createSupabaseAdminClient>,
  eventIds: string[]
): Promise<PaymentPulseRow[]> {
  if (eventIds.length === 0) return [];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data, error } = await db
    .from("payment_transactions")
    .select("amount_pence, refunded_amount_pence, status, completed_at")
    .in("event_id", eventIds)
    .in("status", ["completed", "partially_refunded", "refunded"])
    .not("completed_at", "is", null)
    .gte("completed_at", monthStart);

  if (error) throw error;
  return (data ?? []) as PaymentPulseRow[];
}

async function fetchPlanningTaskStatsForEvents(
  db: ReturnType<typeof createSupabaseAdminClient>,
  eventIds: string[],
  today: string
): Promise<Map<string, EventTaskStats>> {
  const stats = new Map<string, EventTaskStats>();
  if (eventIds.length === 0) return stats;

  const { data, error } = await db
    .from("planning_items")
    .select(`
      event_id,
      tasks:planning_tasks (
        id,
        status,
        due_date,
        is_blocked
      )
    `)
    .in("event_id", eventIds);

  if (error) throw error;

  for (const item of (data ?? []) as Array<{
    event_id: string | null;
    tasks?: Array<{ status: string; due_date: string | null; is_blocked: boolean | null }> | null;
  }>) {
    if (!item.event_id) continue;
    const current = stats.get(item.event_id) ?? { open: 0, overdue: 0, blocked: 0 };
    for (const task of item.tasks ?? []) {
      if (task.status !== "open") continue;
      current.open += 1;
      if (task.due_date && task.due_date < today) current.overdue += 1;
      if (task.is_blocked) current.blocked += 1;
    }
    stats.set(item.event_id, current);
  }

  return stats;
}

function buildBookingStats(bookings: BookingPulseRow[]): Map<string, {
  confirmedBookings: number;
  confirmedTickets: number;
}> {
  const stats = new Map<string, { confirmedBookings: number; confirmedTickets: number }>();

  for (const booking of bookings) {
    const current = stats.get(booking.event_id) ?? { confirmedBookings: 0, confirmedTickets: 0 };
    current.confirmedBookings += 1;
    current.confirmedTickets += booking.ticket_count ?? 0;
    stats.set(booking.event_id, current);
  }

  return stats;
}

function buildEventReadiness(
  event: EventSummary,
  bookingStats: { confirmedBookings: number; confirmedTickets: number } | undefined,
  taskStats: EventTaskStats | undefined,
  today: string
): DashboardEventReadiness {
  const issues: DashboardEventReadinessIssue[] = [];
  const checks: boolean[] = [];
  const status = event.status ?? "draft";
  const dateKey = event.start_at.slice(0, 10);
  const daysUntil = daysBetween(today, dateKey);
  const totalCapacity = typeof event.total_capacity === "number" ? event.total_capacity : null;
  const confirmedTickets = bookingStats?.confirmedTickets ?? 0;
  const capacityPercent =
    totalCapacity && totalCapacity > 0 ? Math.min(100, Math.round((confirmedTickets / totalCapacity) * 100)) : null;

  function addCheck(pass: boolean, issue: DashboardEventReadinessIssue): void {
    checks.push(pass);
    if (!pass) issues.push(issue);
  }

  addCheck(status === "approved" || status === "completed", {
    code: "status",
    label: statusIssueLabel(status),
    tone: status === "needs_revisions" || status === "rejected" ? "danger" : "warning",
  });
  addCheck(Boolean(event.end_at), { code: "end_at", label: "End time missing", tone: "warning" });
  addCheck(Boolean(event.venue_space?.trim()), { code: "venue_space", label: "Space missing", tone: "warning" });
  addCheck(Boolean(event.event_image_path?.trim()), { code: "image", label: "Image missing", tone: "warning" });
  addCheck(Boolean(event.public_title?.trim() && event.public_description?.trim() && event.seo_slug?.trim()), {
    code: "public_copy",
    label: "Public copy incomplete",
    tone: "warning",
  });
  addCheck(!event.booking_enabled || Boolean(event.booking_type || event.booking_url?.trim()), {
    code: "booking_format",
    label: "Booking setup incomplete",
    tone: "warning",
  });

  const bookingFormat = isBookingFormat(event.booking_type) ? event.booking_type : null;
  addCheck(!bookingFormat || !isPaidBookingFormat(bookingFormat) || typeof event.ticket_price === "number", {
    code: "ticket_price",
    label: "Ticket price missing",
    tone: "warning",
  });

  const openTasks = taskStats?.open ?? 0;
  const overdueTasks = taskStats?.overdue ?? 0;
  const blockedTasks = taskStats?.blocked ?? 0;
  addCheck(overdueTasks === 0, {
    code: "overdue_tasks",
    label: `${overdueTasks} overdue task${overdueTasks === 1 ? "" : "s"}`,
    tone: "danger",
  });
  addCheck(blockedTasks === 0, {
    code: "blocked_tasks",
    label: `${blockedTasks} blocked task${blockedTasks === 1 ? "" : "s"}`,
    tone: "danger",
  });

  const passed = checks.filter(Boolean).length;
  const readinessScore = checks.length > 0 ? Math.round((passed / checks.length) * 100) : 100;

  return {
    id: event.id,
    title: event.title,
    href: `/events/${event.id}`,
    startAt: event.start_at,
    dateLabel: new Date(event.start_at).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    daysUntil,
    venueName: event.venue?.name ?? "No venue",
    status,
    statusLabel: statusLabels[status] ?? status,
    statusTone: statusTones[status] ?? "neutral",
    readinessScore,
    readinessTone: readinessScore >= 85 ? "success" : readinessScore >= 65 ? "warning" : "danger",
    confirmedBookings: bookingStats?.confirmedBookings ?? 0,
    confirmedTickets,
    totalCapacity,
    capacityPercent,
    openTasks,
    overdueTasks,
    blockedTasks,
    issues,
  };
}

function statusIssueLabel(status: string): string {
  switch (status) {
    case "pending_approval":
      return "Proposal needs approval";
    case "approved_pending_details":
      return "Approved, details needed";
    case "submitted":
      return "Waiting for review";
    case "needs_revisions":
      return "Needs revisions";
    case "rejected":
      return "Rejected";
    case "draft":
      return "Still in draft";
    default:
      return "Not approved";
  }
}

function buildBookingPulse(
  readiness: DashboardEventReadiness[],
  bookings: BookingPulseRow[],
  payments: PaymentPulseRow[],
  today: string
): DashboardBookingPulse {
  const weekStart = addDays(today, -6);
  const recentBookings = bookings.filter((booking) => booking.created_at.slice(0, 10) >= weekStart);
  const capacityValues = readiness
    .map((event) => event.capacityPercent)
    .filter((value): value is number => typeof value === "number");
  const netSalesThisMonthPence = payments.reduce(
    (sum, row) => sum + row.amount_pence - (row.refunded_amount_pence ?? 0),
    0
  );

  return {
    confirmedBookingsThisWeek: recentBookings.length,
    ticketsThisWeek: recentBookings.reduce((sum, booking) => sum + (booking.ticket_count ?? 0), 0),
    netSalesThisMonthPence,
    averageUpcomingCapacityPct:
      capacityValues.length > 0
        ? Math.round(capacityValues.reduce((sum, value) => sum + value, 0) / capacityValues.length)
        : null,
    capacityAlerts: readiness
      .filter((event) => {
        if (event.capacityPercent == null) return false;
        return event.capacityPercent >= 90 || (event.daysUntil <= 7 && event.capacityPercent <= 25);
      })
      .slice(0, 5)
      .map((event) => ({
        id: event.id,
        title: event.title,
        href: event.href,
        venueName: event.venueName,
        capacityPercent: event.capacityPercent ?? 0,
        label: (event.capacityPercent ?? 0) >= 90 ? "Nearly full" : "Slow bookings",
        tone: (event.capacityPercent ?? 0) >= 90 ? "success" : "warning",
      })),
  };
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
          venue:venues!planning_items_venue_id_fkey ( name )
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
        venue:venues!planning_items_venue_id_fkey ( name )
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

   
  function mapTask(task: any, ownerId: string | null): void {
    if (!task || task.status !== "open") return;
    if (taskMap.has(task.id)) return;

    const item = Array.isArray(task.planning_items) ? task.planning_items[0] : task.planning_items;
    const venue = Array.isArray(item?.venue) ? item.venue[0] : item?.venue;
    const isSop = Boolean(task.sop_section || task.sop_template_task_id);
    const source: TodoSource = isSop ? "sop" : "planning";

    taskMap.set(task.id, {
      id: task.id,
      source,
      title: task.title,
      subtitle: `${isSop ? "SOP Task" : "Planning Task"} \u00B7 ${venue?.name ?? "No venue"} \u00B7 Due ${task.due_date ?? "TBD"}`,
      dueDate: task.due_date ?? null,
      urgency: classifyTodoUrgency(task.due_date ?? null, today),
      canToggle: canToggleForUser(ownerId),
      linkHref: "/planning",
      parentTitle: item?.title ?? undefined,
      venueName: venue?.name ?? undefined,
      planningTaskId: task.id,
      planningItemId: item?.id ?? undefined,
    });
  }

  for (const row of assignedTasks ?? []) {
    // Supabase nested joins may return arrays; extract first element
     
    const rawTask = row.planning_tasks as any;
    const task = Array.isArray(rawTask) ? rawTask[0] : rawTask;
    const item = task?.planning_items;
    const planningItem = Array.isArray(item) ? item[0] : item;
    mapTask(task, planningItem?.owner_id ?? null);
  }

  for (const rawTask of legacyTasks ?? []) {
     
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
    .select("id, title, start_at, venue_id, venue:venues!events_venue_id_fkey(name)")
    .is("deleted_at", null)
    .in("status", ["submitted", "needs_revisions"])
    .order("start_at", { ascending: true })
    .limit(20);

  // Personal dashboard: always scope to events assigned to this user
  query = query.eq("assignee_id", user.id);

  const { data, error } = await query;
  if (error) throw error;

   
  return (data ?? []).map((event: any) => {
    const startDate = event.start_at?.slice(0, 10) ?? null;
    const venue = Array.isArray(event.venue) ? event.venue[0] : event.venue;
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
    .select("id, title, start_at, venue_id, venue:venues!events_venue_id_fkey(name)")
    .eq("created_by", user.id)
    .eq("status", "needs_revisions")
    .is("deleted_at", null)
    .order("start_at", { ascending: true })
    .limit(10);

  if (error) throw error;

   
  return (data ?? []).map((event: any) => {
    const startDate = event.start_at?.slice(0, 10) ?? null;
    const venue = Array.isArray(event.venue) ? event.venue[0] : event.venue;
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
    .select("id, title, end_at, venue_id, venue:venues!events_venue_id_fkey(name), debriefs(id)")
    .eq("status", "approved")
    .lt("end_at", new Date().toISOString())
    .is("deleted_at", null)
    .order("end_at", { ascending: true })
    .limit(10);

  // Personal dashboard: scope to manager responsible with creator fallback
  query = query.or(`manager_responsible_id.eq.${user.id},and(manager_responsible_id.is.null,created_by.eq.${user.id})`);

  const { data, error } = await query;
  if (error) throw error;

  // Filter out events that actually have debriefs (Supabase anti-join workaround)
  const eventsWithoutDebrief = (data ?? []).filter(
     
    (event: any) => !event.debriefs || event.debriefs.length === 0
  );

   
  return eventsWithoutDebrief.map((event: any) => {
    const endDate = event.end_at?.slice(0, 10) ?? null;
    const venue = Array.isArray(event.venue) ? event.venue[0] : event.venue;
    return {
      id: `debrief-${event.id}`,
      source: "debrief" as TodoSource,
      title: `Submit debrief for ${event.title}`,
      subtitle: `Debrief \u00B7 ${venue?.name ?? "No venue"} \u00B7 Ended ${endDate ?? "unknown"}`,
      dueDate: endDate,
      urgency: classifyTodoUrgency(endDate, today, "debrief"),
      canToggle: false,
      linkHref: `/debriefs/${event.id}`,
      venueName: venue?.name ?? undefined,
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
    .select("id, title, end_at, venue:venues!events_venue_id_fkey(name), debriefs(id)")
    .eq("status", "approved")
    .lt("end_at", new Date().toISOString())
    .is("deleted_at", null)
    .order("end_at", { ascending: false })
    .limit(10);

  // Personal dashboard: scope to manager responsible with creator fallback
  query = query.or(`manager_responsible_id.eq.${user.id},and(manager_responsible_id.is.null,created_by.eq.${user.id})`);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? [])
     
    .filter((e: any) => !e.debriefs || e.debriefs.length === 0)
     
    .map((e: any) => ({
      id: e.id,
      title: e.title,
      endAt: e.end_at?.slice(0, 10) ?? "",
      venueName: (Array.isArray(e.venue) ? e.venue[0]?.name : e.venue?.name) ?? "",
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
 * Recent activity feed for executives/admins. Uses service-role client.
 * ONLY returns safe, human-authored audit actions. Strips ALL meta fields.
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
    .not("actor_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  type ActivityAuditRow = {
    id: string;
    action: string;
    actor_id: string | null;
    created_at: string;
  };
  type HumanActivityAuditRow = ActivityAuditRow & { actor_id: string };
  const rows = ((data ?? []) as ActivityAuditRow[]).filter(
    (row): row is HumanActivityAuditRow => Boolean(row.actor_id)
  );

  // Batch-fetch actor names (strip sensitive data -- only return display name)
  const actorIds = [...new Set(rows.map((r) => r.actor_id))];
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

  return rows.map((row) => ({
    id: row.id,
    action: actionLabels[row.action] ?? row.action,
    actorName: actorMap.get(row.actor_id) ?? "Unknown",
    timestamp: row.created_at,
  }));
}
