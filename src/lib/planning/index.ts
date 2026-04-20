import {
  createSupabaseActionClient,
  createSupabaseReadonlyClient
} from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { normaliseOptionalText } from "@/lib/normalise";
import { generateSopChecklist } from "@/lib/planning/sop";
import type {
  CreatePlanningItemInput,
  CreatePlanningSeriesInput,
  CreatePlanningTaskInput,
  PlanningBoardData,
  PlanningEventOverlay,
  PlanningInspirationItem,
  PlanningItem,
  PlanningItemStatus,
  PlanningPerson,
  PlanningTask,
  PlanningTaskStatus,
  RecurrenceFrequency,
  UpdatePlanningItemInput,
  UpdatePlanningSeriesInput,
  UpdatePlanningTaskInput
} from "@/lib/planning/types";
import {
  addDays,
  daysBetween,
  generateOccurrenceDates,
  londonDateString,
  maxDate,
  minDate
} from "@/lib/planning/utils";

type PlanningSeriesRow = Database["public"]["Tables"]["planning_series"]["Row"];
type PlanningItemRow = Database["public"]["Tables"]["planning_items"]["Row"];
type PlanningTemplateRow = Database["public"]["Tables"]["planning_series_task_templates"]["Row"];
type PlanningTaskRow = Database["public"]["Tables"]["planning_tasks"]["Row"];

type EventOverlayRow = Pick<
  Database["public"]["Tables"]["events"]["Row"],
  "id" | "title" | "status" | "start_at" | "end_at" | "venue_space" | "venue_id"
>;

type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
};

function isMissingPlanningTableError(error: SupabaseErrorLike | null | undefined): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    message.includes("could not find the table 'public.planning_") ||
    (message.includes("relation \"public.planning_") && message.includes("does not exist")) ||
    (message.includes("relation \"planning_") && message.includes("does not exist"))
  );
}

function toDateKey(value: Date | string): string {
  if (value instanceof Date) {
    return londonDateString(value);
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return londonDateString(parsed);
}

function toPerson(row: { id: string; full_name: string | null; email: string; role?: string | null }): PlanningPerson {
  return {
    id: row.id,
    name: row.full_name ?? row.email,
    email: row.email,
    role: row.role ?? "unknown"
  };
}

function resolveSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

type RawUserRelation = { id: string; full_name: string | null; email: string } | null;
type RawAssigneeJunction = { user: RawUserRelation | RawUserRelation[] | null };
type RawDependencyRelation = { depends_on_task_id: string };
type RawPlanningTaskRow = PlanningTaskRow & {
  assignee?: RawUserRelation | RawUserRelation[] | null;
  assignees?: RawAssigneeJunction[];
  dependencies?: RawDependencyRelation[];
  sop_section?: string | null;
  sop_template_task_id?: string | null;
  is_blocked?: boolean;
  due_date_manually_overridden?: boolean;
  completed_by?: string | null;
  notes?: string | null;
};

function toPlanningTask(task: RawPlanningTaskRow): PlanningTask {
  const assignee = resolveSingleRelation(task?.assignee);
  const assigneesRaw = Array.isArray(task?.assignees) ? task.assignees : [];
  const assignees = assigneesRaw.map((a: RawAssigneeJunction) => {
    const rawUser = a?.user;
    const user = Array.isArray(rawUser) ? rawUser[0] : rawUser;
    return {
      id: user?.id ?? "",
      name: user?.full_name ?? user?.email ?? "Unknown",
      email: user?.email ?? "",
    };
  });

  return {
    id: task.id,
    planningItemId: task.planning_item_id,
    title: task.title,
    assigneeId: task.assignee_id ?? null,
    assigneeName: assignee?.full_name ?? assignee?.email ?? "To be determined",
    assignees,
    dueDate: task.due_date,
    status: task.status as PlanningTaskStatus,
    completedAt: task.completed_at ?? null,
    completedBy: task.completed_by ?? null,
    sortOrder: task.sort_order ?? 0,
    sopSection: task.sop_section ?? null,
    sopTemplateTaskId: task.sop_template_task_id ?? null,
    isBlocked: task.is_blocked ?? false,
    dueDateManuallyOverridden: task.due_date_manually_overridden ?? false,
    dependsOnTaskIds: Array.isArray(task?.dependencies)
      ? task.dependencies.map((d: RawDependencyRelation) => d.depends_on_task_id).filter(Boolean)
      : [],
     
    notes: (task as any).notes ?? null,
    // Attachments default to empty; the detail loader populates them in a
    // second pass so the board query stays lean.
    attachments: [],
  };
}

type RawPlanningItemRow = PlanningItemRow & {
  owner?: RawUserRelation | RawUserRelation[] | null;
  venue?: { id: string; name: string } | Array<{ id: string; name: string }> | null;
  tasks?: RawPlanningTaskRow[] | null;
  planning_item_venues?: Array<{
    venue_id: string;
    is_primary: boolean;
    venue?: { id: string; name: string } | Array<{ id: string; name: string }> | null;
  }>;
};

function toPlanningItem(row: RawPlanningItemRow): PlanningItem {
  const owner = resolveSingleRelation(row?.owner);
  const venue = resolveSingleRelation(row?.venue);
  const tasks = Array.isArray(row?.tasks)
    ? row.tasks.map((task: RawPlanningTaskRow) => toPlanningTask(task)).sort((left: PlanningTask, right: PlanningTask) => {
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        if (left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate);
        return left.title.localeCompare(right.title);
      })
    : [];

  // Full venue attachment list with primary first, then alphabetical.
  const attachments = Array.isArray(row?.planning_item_venues) ? row.planning_item_venues : [];
  const venues = attachments
    .map((attachment) => {
      const v = resolveSingleRelation(attachment.venue);
      return { id: attachment.venue_id, name: v?.name ?? "Unknown venue", isPrimary: Boolean(attachment.is_primary) };
    })
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return {
    id: row.id,
    source: "planning",
    seriesId: row.series_id,
    occurrenceOn: row.occurrence_on,
    isException: Boolean(row.is_exception),
    title: row.title,
    description: row.description,
    typeLabel: row.type_label,
    venueId: row.venue_id,
    venueName: venue?.name ?? null,
    venues,
    ownerId: row.owner_id,
    ownerName: owner?.full_name ?? owner?.email ?? null,
    targetDate: row.target_date,
    status: row.status as PlanningItemStatus,
    createdBy: row.created_by,
    tasks
  };
}

function eventTargetDateFromStart(startAt: string): string {
  const parsed = new Date(startAt);
  if (Number.isNaN(parsed.getTime())) {
    return londonDateString();
  }
  return londonDateString(parsed);
}

type RawEventOverlayRow = EventOverlayRow & {
  venue?: { name: string | null } | Array<{ name: string | null }> | null;
  public_title?: string | null;
  public_teaser?: string | null;
};

function toPlanningEventOverlay(row: RawEventOverlayRow): PlanningEventOverlay {
  const venue = resolveSingleRelation(row?.venue);
  return {
    id: `event-${row.id}`,
    source: "event",
    eventId: row.id,
    title: row.title,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
    targetDate: eventTargetDateFromStart(row.start_at),
    venueId: row.venue_id ?? null,
    venueName: venue?.name ?? null,
    venueSpace: row.venue_space ?? null,
    publicTitle: row.public_title ?? null,
    publicTeaser: row.public_teaser ?? null
  };
}

function seriesDefaultStatus(): PlanningItemStatus {
  return "planned";
}

async function createTasksFromTemplates(params: {
  series: PlanningSeriesRow;
  templates: PlanningTemplateRow[];
  insertedItems: Array<{ id: string; target_date: string }>;
}) {
  if (!params.templates.length || !params.insertedItems.length) {
    return;
  }

  const admin = createSupabaseAdminClient();

  const taskRows: Array<Pick<PlanningTaskRow, "planning_item_id" | "title" | "assignee_id" | "due_date" | "status" | "sort_order" | "created_by">> = [];

  params.insertedItems.forEach((item) => {
    params.templates.forEach((template, index) => {
      const title = normaliseOptionalText(template.title);
      if (!title) return;

      taskRows.push({
        planning_item_id: item.id,
        title,
        assignee_id: template.default_assignee_id ?? null,
        due_date: addDays(item.target_date, template.due_offset_days ?? 0),
        status: "open",
        sort_order: template.sort_order ?? index,
        created_by: params.series.created_by
      });
    });
  });

  if (!taskRows.length) {
    return;
  }

  // any: taskRows built dynamically from templates; Supabase generics don't cover extended columns
  const { error } = await admin.from("planning_tasks").insert(taskRows as any);
  if (error) {
    throw new Error(`Could not create recurring tasks: ${error.message}`);
  }
}

async function getSeriesTaskTemplates(seriesId: string): Promise<PlanningTemplateRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("planning_series_task_templates")
    .select("*")
    .eq("series_id", seriesId)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Could not load series task templates: ${error.message}`);
  }

  return (data ?? []) as PlanningTemplateRow[];
}

async function generateOccurrencesForSeries(series: PlanningSeriesRow, throughDate: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const startsOn = series.starts_on;
  const generationStart = series.generated_through ? addDays(series.generated_through, 1) : startsOn;
  const fromDate = maxDate(startsOn, generationStart);
  const upperBound = series.ends_on ? minDate(throughDate, series.ends_on) : throughDate;

  if (fromDate > upperBound) {
    if (!series.generated_through || series.generated_through < upperBound) {
      await admin.from("planning_series").update({ generated_through: upperBound }).eq("id", series.id);
    }
    return;
  }

  const occurrenceDates = generateOccurrenceDates({
    rule: {
      recurrenceFrequency: series.recurrence_frequency as RecurrenceFrequency,
      recurrenceInterval: series.recurrence_interval,
      recurrenceWeekdays: series.recurrence_weekdays,
      recurrenceMonthday: series.recurrence_monthday,
      startsOn: series.starts_on,
      endsOn: series.ends_on
    },
    fromDate,
    throughDate: upperBound
  });

  if (!occurrenceDates.length) {
    await admin.from("planning_series").update({ generated_through: upperBound }).eq("id", series.id);
    return;
  }

  const { data: existingRows, error: existingError } = await admin
    .from("planning_items")
    .select("occurrence_on")
    .eq("series_id", series.id)
    .gte("occurrence_on", fromDate)
    .lte("occurrence_on", upperBound);

  if (existingError) {
    throw new Error(`Could not load existing occurrences: ${existingError.message}`);
  }

  const existing = new Set(
    ((existingRows ?? []) as Array<{ occurrence_on: string | null }>)
      .map((row) => row.occurrence_on)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );

  const missingDates = occurrenceDates.filter((dateValue) => !existing.has(dateValue));
  let insertedRows: Array<{ id: string; target_date: string }> = [];

  if (missingDates.length) {
    const insertPayload = missingDates.map((dateValue) => ({
      series_id: series.id,
      occurrence_on: dateValue,
      is_exception: false,
      title: series.title,
      description: series.description,
      type_label: series.type_label,
      venue_id: series.venue_id,
      owner_id: series.owner_id,
      target_date: dateValue,
      status: seriesDefaultStatus(),
      created_by: series.created_by
    }));

    const { data: inserted, error: insertError } = await admin
      .from("planning_items")
      // any: insertPayload built dynamically from series config; Supabase generics don't cover extended columns
      .insert(insertPayload as any)
      .select("id,target_date");

    if (insertError) {
      throw new Error(`Could not generate planning occurrences: ${insertError.message}`);
    }

    insertedRows = ((inserted ?? []) as Array<{ id: string; target_date: string }>);
  }

  if (insertedRows.length) {
    const templates = await getSeriesTaskTemplates(series.id);
    await createTasksFromTemplates({
      series,
      templates,
      insertedItems: insertedRows
    });

    // Generate SOP checklist for each new planning item
    for (const item of insertedRows) {
      try {
        await generateSopChecklist(item.id, item.target_date, series.created_by);
      } catch (sopError) {
        console.error(`SOP generation failed for occurrence ${item.id}:`, sopError);
      }
    }
  }

  const { error: updateError } = await admin
    .from("planning_series")
    .update({ generated_through: upperBound })
    .eq("id", series.id);

  if (updateError) {
    throw new Error(`Could not update generation cursor: ${updateError.message}`);
  }
}

export async function ensurePlanningOccurrencesThrough(throughDateInput: Date | string): Promise<void> {
  const throughDate = toDateKey(throughDateInput);
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("planning_series")
    .select("*")
    .eq("is_active", true)
    .lte("starts_on", throughDate)
    .order("starts_on", { ascending: true });

  if (error) {
    if (isMissingPlanningTableError(error)) {
      return;
    }
    throw new Error(`Could not load recurring planning series: ${error.message}`);
  }

  for (const series of (data ?? []) as PlanningSeriesRow[]) {
    await generateOccurrencesForSeries(series, throughDate);
  }
}

export async function listPlanningUsers(): Promise<PlanningPerson[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id,full_name,email,role")
    .is("deactivated_at", null)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Could not load planning users: ${error.message}`);
  }

  return ((data ?? []) as Array<{ id: string; full_name: string | null; email: string; role: string | null }>).map(toPerson);
}

async function fetchInspirationItems(
  db: ReturnType<typeof createSupabaseAdminClient>,
  today: string,
  windowEndDate: string
): Promise<PlanningInspirationItem[]> {
  // Fetch all dismissal IDs — dismissals are organisation-wide (single-tenant system).
  // All users share the same suppression list so once any user hides an inspiration item,
  // it no longer appears for anyone. This is by design (see spec).
  const { data: dismissals } = await db
    .from('planning_inspiration_dismissals')
    .select('inspiration_item_id');

  const dismissedIds = (dismissals ?? []).map((d: { inspiration_item_id: string }) => d.inspiration_item_id);

  let query = db
    .from('planning_inspiration_items')
    .select('*')
    .gte('event_date', today)
    .lte('event_date', windowEndDate)
    .order('event_date', { ascending: true });

  if (dismissedIds.length > 0) {
    query = query.not('id', 'in', `(${dismissedIds.join(',')})`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('fetchInspirationItems: query failed', error);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    eventName: row.event_name as string,
    eventDate: row.event_date as string,
    category: row.category as PlanningInspirationItem['category'],
    description: (row.description as string | null) ?? null,
    source: row.source as PlanningInspirationItem['source'],
  }));
}

export async function listPlanningBoardData(params?: {
  today?: Date | string;
  includeLater?: boolean;
  filters?: {
    venueId?: string | null;
    statuses?: PlanningItemStatus[];
  };
  /** Calendar mode: skip the ±365-day date window so historic activity is
   * visible. Default false so board/list views keep their current scope. */
  unbounded?: boolean;
  /** Calendar mode: include `done`/`cancelled` planning items and
   * `completed`/`rejected` events. Default false keeps the board clean. */
  includeAllStatuses?: boolean;
}): Promise<PlanningBoardData> {
  const today = toDateKey(params?.today ?? new Date());
  const planningWindowEnd = addDays(today, 90);
  await ensurePlanningOccurrencesThrough(planningWindowEnd);

  const includeLater = params?.includeLater ?? true;
  const unbounded = params?.unbounded ?? false;
  const includeAllStatuses = params?.includeAllStatuses ?? false;
  const lowerBound = addDays(today, -365);
  const upperBound = includeLater ? addDays(today, 365) : planningWindowEnd;

  const admin = createSupabaseAdminClient();

  let itemsQuery = admin
    .from("planning_items")
    .select(
      `
      id,
      series_id,
      occurrence_on,
      is_exception,
      title,
      description,
      type_label,
      venue_id,
      owner_id,
      target_date,
      status,
      created_by,
      created_at,
      updated_at,
      venue:venues!planning_items_venue_id_fkey(id,name),
      planning_item_venues(venue_id, is_primary, venue:venues(id,name)),
      owner:users!planning_items_owner_id_fkey(id,full_name,email),
      tasks:planning_tasks(
        id,
        planning_item_id,
        title,
        assignee_id,
        due_date,
        status,
        completed_at,
        completed_by,
        sort_order,
        sop_section,
        sop_template_task_id,
        is_blocked,
        due_date_manually_overridden,
        notes,
        assignee:users!planning_tasks_assignee_id_fkey(id,full_name,email),
        assignees:planning_task_assignees(user:users(id,full_name,email)),
        dependencies:planning_task_dependencies!planning_task_dependencies_task_id_fkey(depends_on_task_id)
      )
    `
    )
    .order("target_date", { ascending: true });

  if (!unbounded) {
    itemsQuery = itemsQuery.gte("target_date", lowerBound).lte("target_date", upperBound);
  }

  if (params?.filters?.venueId) {
    itemsQuery = itemsQuery.eq("venue_id", params.filters.venueId);
  }

  if (params?.filters?.statuses && params.filters.statuses.length > 0) {
    itemsQuery = itemsQuery.in("status", params.filters.statuses);
  } else if (!includeAllStatuses) {
    // By default, hide completed/cancelled planning items from the board.
    // Calendar mode (includeAllStatuses) skips this filter.
    itemsQuery = itemsQuery.not("status", "in", '("done","cancelled")');
  }

  const { data: itemData, error: itemsError } = await itemsQuery;
  let planningItems: PlanningItem[] = [];

  if (itemsError) {
    if (!isMissingPlanningTableError(itemsError)) {
      throw new Error(`Could not load planning items: ${itemsError.message}`);
    }
  } else {
    planningItems = ((itemData ?? []) as RawPlanningItemRow[]).map((row) => toPlanningItem(row));
  }

  const startLowerIso = `${lowerBound}T00:00:00.000Z`;
  const startUpperIso = `${upperBound}T23:59:59.999Z`;

  let eventsQuery = admin
    .from("events")
    .select(
      "id,title,status,start_at,end_at,venue_space,venue_id,public_title,public_teaser,venue:venues!events_venue_id_fkey(name)"
    )
    .order("start_at", { ascending: true });

  if (!unbounded) {
    eventsQuery = eventsQuery.gte("start_at", startLowerIso).lte("start_at", startUpperIso);
  }
  if (!includeAllStatuses) {
    eventsQuery = eventsQuery.not("status", "in", '("completed","rejected")');
  }

  const { data: eventData, error: eventsError } = await eventsQuery;

  if (eventsError) {
    throw new Error(`Could not load event overlays: ${eventsError.message}`);
  }

  const events = ((eventData ?? []) as Array<EventOverlayRow & { venue: { name: string | null } | Array<{ name: string | null }> | null }>).map((row) =>
    toPlanningEventOverlay(row)
  );

  const users = await listPlanningUsers();

  const windowEndStr = addDays(today, 180);
  const inspirationItems = await fetchInspirationItems(admin, today, windowEndStr);

  const soonLimit = addDays(today, 7);
  const openItemStatuses = new Set<PlanningItemStatus>(["planned", "in_progress", "blocked"]);

  const overdueItems = planningItems.filter((item) => openItemStatuses.has(item.status) && item.targetDate < today).length;
  const dueSoonItems = planningItems.filter(
    (item) => openItemStatuses.has(item.status) && item.targetDate >= today && item.targetDate <= soonLimit
  ).length;

  const taskList = planningItems.flatMap((item) => item.tasks);
  const overdueTasks = taskList.filter((task) => task.status === "open" && task.dueDate < today).length;
  const dueSoonTasks = taskList.filter((task) => task.status === "open" && task.dueDate >= today && task.dueDate <= soonLimit).length;

  return {
    today,
    alerts: {
      overdueItems,
      overdueTasks,
      dueSoonItems,
      dueSoonTasks
    },
    planningItems,
    events,
    users,
    inspirationItems
  };
}

/**
 * Load a single planning item with the same shape as listPlanningBoardData —
 * full venue list, owner, task array, and task assignees. Used by the
 * dedicated detail page `/planning/[planningItemId]`.
 */
export async function getPlanningItemDetail(itemId: string): Promise<PlanningItem | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("planning_items")
    .select(
      `
      id,
      series_id,
      occurrence_on,
      is_exception,
      title,
      description,
      type_label,
      venue_id,
      owner_id,
      target_date,
      status,
      created_by,
      created_at,
      updated_at,
      venue:venues!planning_items_venue_id_fkey(id,name),
      planning_item_venues(venue_id, is_primary, venue:venues(id,name)),
      owner:users!planning_items_owner_id_fkey(id,full_name,email),
      tasks:planning_tasks(
        id,
        planning_item_id,
        title,
        assignee_id,
        due_date,
        status,
        completed_at,
        completed_by,
        sort_order,
        sop_section,
        sop_template_task_id,
        is_blocked,
        due_date_manually_overridden,
        notes,
        assignee:users!planning_tasks_assignee_id_fkey(id,full_name,email),
        assignees:planning_task_assignees(user:users(id,full_name,email)),
        dependencies:planning_task_dependencies!planning_task_dependencies_task_id_fkey(depends_on_task_id)
      )
    `
    )
    .eq("id", itemId)
    .maybeSingle();

  if (error) {
    if (isMissingPlanningTableError(error)) return null;
    throw new Error(`Could not load planning item: ${error.message}`);
  }
  if (!data) return null;
  const item = toPlanningItem(data as RawPlanningItemRow);

  // Second pass: eagerly load attachments for every task on this item.
  // Kept separate from the board loader so board rendering stays cheap.
  if (item.tasks.length > 0) {
    const taskIds = item.tasks.map((task) => task.id);
     
    const { data: attachmentRows } = await (admin as any)
      .from("attachments")
      .select("id, planning_task_id, original_filename, mime_type, size_bytes")
      .in("planning_task_id", taskIds)
      .eq("upload_status", "uploaded")
      .is("deleted_at", null);
    type Row = {
      id: string;
      planning_task_id: string | null;
      original_filename: string;
      mime_type: string;
      size_bytes: number;
    };
    const byTask = new Map<string, Array<Row>>();
    for (const row of ((attachmentRows ?? []) as Row[])) {
      if (!row.planning_task_id) continue;
      const bucket = byTask.get(row.planning_task_id) ?? [];
      bucket.push(row);
      byTask.set(row.planning_task_id, bucket);
    }
    for (const task of item.tasks) {
      const rows = byTask.get(task.id) ?? [];
      task.attachments = rows.map((row) => ({
        id: row.id,
        filename: row.original_filename,
        sizeBytes: row.size_bytes,
        mimeType: row.mime_type
      }));
    }
  }

  return item;
}

export async function createPlanningItem(payload: CreatePlanningItemInput): Promise<PlanningItemRow> {
  const supabase = await createSupabaseActionClient();

  const insertPayload = {
    title: payload.title,
    description: normaliseOptionalText(payload.description ?? null),
    type_label: payload.typeLabel,
    venue_id: payload.venueId ?? null,
    owner_id: payload.ownerId ?? null,
    target_date: payload.targetDate,
    status: payload.status ?? "planned",
    created_by: payload.createdBy
  };

  // any: Supabase generics don't cover extended columns (e.g. event_id)
  const { data, error } = await supabase.from("planning_items").insert(insertPayload as any).select("*").single();

  if (error || !data) {
    throw new Error(`Could not create planning item: ${error?.message ?? "Unknown error"}`);
  }

  return data as PlanningItemRow;
}

export async function updatePlanningItem(itemId: string, updates: UpdatePlanningItemInput): Promise<PlanningItemRow> {
  const supabase = await createSupabaseActionClient();

  const { data: existing, error: fetchError } = await supabase
    .from("planning_items")
    .select("series_id,occurrence_on")
    .eq("id", itemId)
    .single();

  if (fetchError) {
    throw new Error(`Could not load planning item: ${fetchError.message}`);
  }

  const updatePayload: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(updates, "title")) {
    updatePayload["title"] = updates.title;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "description")) {
    updatePayload["description"] = normaliseOptionalText(updates.description ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "typeLabel")) {
    updatePayload["type_label"] = updates.typeLabel;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "venueId")) {
    updatePayload["venue_id"] = updates.venueId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "ownerId")) {
    updatePayload["owner_id"] = updates.ownerId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "targetDate")) {
    updatePayload["target_date"] = updates.targetDate;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "status")) {
    updatePayload["status"] = updates.status;
  }

  const isRecurring = Boolean(existing?.series_id && existing?.occurrence_on);
  const targetDateValue = typeof updatePayload["target_date"] === "string" ? (updatePayload["target_date"] as string) : null;
  if (isRecurring && targetDateValue && targetDateValue !== existing?.occurrence_on) {
    updatePayload["is_exception"] = true;
  }

  const { data, error } = await supabase
    .from("planning_items")
    // any: dynamic payload built from camelCase→snake_case mapping; Supabase generics don't cover extended columns
    .update(updatePayload as any)
    .eq("id", itemId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Could not update planning item: ${error?.message ?? "Unknown error"}`);
  }

  return data as PlanningItemRow;
}

export async function movePlanningItemDate(itemId: string, targetDate: string): Promise<PlanningItemRow> {
  return updatePlanningItem(itemId, { targetDate });
}

export async function deletePlanningItem(itemId: string): Promise<void> {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("planning_items").delete().eq("id", itemId);

  if (error) {
    throw new Error(`Could not delete planning item: ${error.message}`);
  }
}

export async function createPlanningSeries(payload: CreatePlanningSeriesInput): Promise<PlanningSeriesRow> {
  const supabase = await createSupabaseActionClient();

  const insertPayload = {
    title: payload.title,
    description: normaliseOptionalText(payload.description ?? null),
    type_label: payload.typeLabel,
    venue_id: payload.venueId ?? null,
    owner_id: payload.ownerId ?? null,
    created_by: payload.createdBy,
    recurrence_frequency: payload.recurrenceFrequency,
    recurrence_interval: payload.recurrenceInterval,
    recurrence_weekdays: payload.recurrenceWeekdays ?? null,
    recurrence_monthday: payload.recurrenceMonthday ?? null,
    starts_on: payload.startsOn,
    ends_on: payload.endsOn ?? null,
    is_active: true,
    generated_through: null
  };

  const { data, error } = await supabase
    .from("planning_series")
    // any: Supabase generics don't cover all planning_series columns in generated types
    .insert(insertPayload as any)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Could not create recurring planning series: ${error?.message ?? "Unknown error"}`);
  }

  const templates = Array.isArray(payload.taskTemplates) ? payload.taskTemplates : [];
  if (templates.length > 0) {
    const templateRows = templates
      .map((template, index) => ({
        series_id: data.id,
        title: normaliseOptionalText(template.title) ?? "",
        default_assignee_id: template.defaultAssigneeId ?? null,
        due_offset_days: template.dueOffsetDays ?? 0,
        sort_order: template.sortOrder ?? index
      }))
      .filter((template) => template.title.length > 0);

    if (templateRows.length > 0) {
      // any: templateRows built dynamically; Supabase generics incomplete for this table
      const { error: templateError } = await supabase.from("planning_series_task_templates").insert(templateRows as any);
      if (templateError) {
        throw new Error(`Could not create series task templates: ${templateError.message}`);
      }
    }
  }

  return data as PlanningSeriesRow;
}

export async function updatePlanningSeries(seriesId: string, updates: UpdatePlanningSeriesInput): Promise<PlanningSeriesRow> {
  const supabase = await createSupabaseActionClient();

  const updatePayload: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(updates, "title")) {
    updatePayload["title"] = updates.title;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "description")) {
    updatePayload["description"] = normaliseOptionalText(updates.description ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "typeLabel")) {
    updatePayload["type_label"] = updates.typeLabel;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "venueId")) {
    updatePayload["venue_id"] = updates.venueId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "ownerId")) {
    updatePayload["owner_id"] = updates.ownerId ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "recurrenceFrequency")) {
    updatePayload["recurrence_frequency"] = updates.recurrenceFrequency;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "recurrenceInterval")) {
    updatePayload["recurrence_interval"] = updates.recurrenceInterval;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "recurrenceWeekdays")) {
    updatePayload["recurrence_weekdays"] = updates.recurrenceWeekdays ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "recurrenceMonthday")) {
    updatePayload["recurrence_monthday"] = updates.recurrenceMonthday ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "startsOn")) {
    updatePayload["starts_on"] = updates.startsOn;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "endsOn")) {
    updatePayload["ends_on"] = updates.endsOn ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "isActive")) {
    updatePayload["is_active"] = updates.isActive;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "generatedThrough")) {
    updatePayload["generated_through"] = updates.generatedThrough ?? null;
  }

  const { data, error } = await supabase
    .from("planning_series")
    // any: dynamic payload built from camelCase→snake_case mapping
    .update(updatePayload as any)
    .eq("id", seriesId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Could not update recurring planning series: ${error?.message ?? "Unknown error"}`);
  }

  if (Array.isArray(updates.taskTemplates)) {
    const { error: deleteError } = await supabase
      .from("planning_series_task_templates")
      .delete()
      .eq("series_id", seriesId);

    if (deleteError) {
      throw new Error(`Could not reset series task templates: ${deleteError.message}`);
    }

    const templateRows = updates.taskTemplates
      .map((template, index) => ({
        series_id: seriesId,
        title: normaliseOptionalText(template.title) ?? "",
        default_assignee_id: template.defaultAssigneeId ?? null,
        due_offset_days: template.dueOffsetDays ?? 0,
        sort_order: template.sortOrder ?? index
      }))
      .filter((template) => template.title.length > 0);

    if (templateRows.length > 0) {
      // any: templateRows built dynamically; Supabase generics incomplete for this table
      const { error: insertError } = await supabase.from("planning_series_task_templates").insert(templateRows as any);
      if (insertError) {
        throw new Error(`Could not save series task templates: ${insertError.message}`);
      }
    }
  }

  return data as PlanningSeriesRow;
}

export async function pausePlanningSeries(seriesId: string): Promise<PlanningSeriesRow> {
  return updatePlanningSeries(seriesId, { isActive: false });
}

export async function createPlanningTask(payload: CreatePlanningTaskInput): Promise<PlanningTaskRow> {
  const supabase = await createSupabaseActionClient();

  const insertPayload = {
    planning_item_id: payload.planningItemId,
    title: payload.title,
    assignee_id: payload.assigneeId ?? null,
    due_date: payload.dueDate,
    status: "open",
    sort_order: payload.sortOrder ?? 0,
    created_by: payload.createdBy
  };

  // any: Supabase generics don't cover all planning_tasks columns in generated types
  const { data, error } = await supabase.from("planning_tasks").insert(insertPayload as any).select("*").single();

  if (error || !data) {
    throw new Error(`Could not create planning task: ${error?.message ?? "Unknown error"}`);
  }

  return data as PlanningTaskRow;
}

export async function updatePlanningTask(taskId: string, updates: UpdatePlanningTaskInput): Promise<PlanningTaskRow> {
  const supabase = await createSupabaseActionClient();

  const updatePayload: Record<string, unknown> = {};

  // Use `!== undefined` rather than `hasOwnProperty`: callers build the
  // updates object via an object literal that always includes every key, so
  // `hasOwnProperty` is true even for fields the caller isn't trying to
  // change. Treating any undefined value as "skip" matches the optional
  // semantics of UpdatePlanningTaskInput and stops a notes-only save from
  // silently clearing assignee_id / completed_at.
  if (updates.title !== undefined) {
    updatePayload["title"] = updates.title;
  }
  if (updates.assigneeId !== undefined) {
    updatePayload["assignee_id"] = updates.assigneeId;
  }
  if (updates.dueDate !== undefined) {
    updatePayload["due_date"] = updates.dueDate;
  }
  if (updates.sortOrder !== undefined) {
    updatePayload["sort_order"] = updates.sortOrder;
  }
  if (updates.status !== undefined) {
    updatePayload["status"] = updates.status;
    updatePayload["completed_at"] =
      updates.status === "done" || updates.status === "not_required"
        ? new Date().toISOString()
        : null;
  }
  if (updates.notes !== undefined) {
    updatePayload["notes"] = updates.notes;
  }

  const { data, error } = await supabase
    .from("planning_tasks")
    // any: dynamic payload built from camelCase→snake_case mapping
    .update(updatePayload as any)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Could not update planning task: ${error?.message ?? "Unknown error"}`);
  }

  return data as PlanningTaskRow;
}

export async function togglePlanningTaskStatus(
  taskId: string,
  newStatus: PlanningTaskStatus,
  userId?: string
): Promise<PlanningTaskRow> {
  const supabase = await createSupabaseActionClient();
  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "done" || newStatus === "not_required") {
    updates.completed_at = new Date().toISOString();
    updates.completed_by = userId ?? null;
  } else {
    updates.completed_at = null;
    updates.completed_by = null;
  }
  const { data, error } = await supabase
    .from("planning_tasks")
    .update(updates)
    .eq("id", taskId)
    .select()
    .single();
  if (error) throw error;
  return data as PlanningTaskRow;
}

export async function deletePlanningTask(taskId: string): Promise<void> {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("planning_tasks").delete().eq("id", taskId);

  if (error) {
    throw new Error(`Could not delete planning task: ${error.message}`);
  }
}

export async function listPlanningSeries(): Promise<PlanningSeriesRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase.from("planning_series").select("*").order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load planning series: ${error.message}`);
  }

  return (data ?? []) as PlanningSeriesRow[];
}

export async function clearPlanningSeries(seriesId: string): Promise<void> {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("planning_series").delete().eq("id", seriesId);

  if (error) {
    throw new Error(`Could not delete planning series: ${error.message}`);
  }
}

export function computeDueSoonSummary(boardData: Pick<PlanningBoardData, "planningItems" | "today">): {
  openItemsInNext14Days: number;
  openTasksInNext14Days: number;
} {
  const until = addDays(boardData.today, 14);
  const openStatuses = new Set<PlanningItemStatus>(["planned", "in_progress", "blocked"]);

  const openItemsInNext14Days = boardData.planningItems.filter(
    (item) => openStatuses.has(item.status) && item.targetDate >= boardData.today && item.targetDate <= until
  ).length;

  const openTasksInNext14Days = boardData.planningItems
    .flatMap((item) => item.tasks)
    .filter((task) => task.status === "open" && task.dueDate >= boardData.today && task.dueDate <= until).length;

  return {
    openItemsInNext14Days,
    openTasksInNext14Days
  };
}

export function countOpenTaskLoadByAssignee(items: PlanningItem[]): Record<string, number> {
  const result: Record<string, number> = {};

  items.forEach((item) => {
    item.tasks.forEach((task) => {
      if (task.status !== "open") return;
      const key = task.assigneeId ?? "tbd";
      result[key] = (result[key] ?? 0) + 1;
    });
  });

  return result;
}

export function groupEventsByStatus(events: PlanningEventOverlay[]): Record<string, number> {
  return events.reduce<Record<string, number>>((acc, event) => {
    acc[event.status] = (acc[event.status] ?? 0) + 1;
    return acc;
  }, {});
}

export function computeItemOffsetFromToday(today: string, targetDate: string): number {
  return daysBetween(today, targetDate);
}
