export type PlanningItemStatus = "planned" | "in_progress" | "blocked" | "done" | "cancelled";

export type PlanningTaskStatus = "open" | "done" | "not_required";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export type PlannerCardSource = "planning" | "event";

export type PlanningBucketKey = "past" | "0_30" | "31_60" | "61_90" | "later";

export type PlanningPerson = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type PlanningVenueOption = {
  id: string;
  name: string;
  category?: "pub" | "cafe";
};

export type PlanningTaskAttachment = {
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
};

export type PlanningTask = {
  id: string;
  planningItemId: string;
  title: string;
  assigneeId: string | null;
  assigneeName: string;
  dueDate: string;
  status: PlanningTaskStatus;
  completedAt: string | null;
  sortOrder: number;
  assignees: Array<{ id: string; name: string; email: string }>;
  completedBy: string | null;
  sopSection: string | null;
  sopTemplateTaskId: string | null;
  isBlocked: boolean;
  dueDateManuallyOverridden: boolean;
  dependsOnTaskIds: string[];
  notes: string | null;
  /** Attachments owned directly by this task. Populated by loaders that
   * eagerly fetch (getPlanningItemDetail); left empty elsewhere. */
  attachments: PlanningTaskAttachment[];
};

export type PlanningItem = {
  id: string;
  source: "planning";
  seriesId: string | null;
  occurrenceOn: string | null;
  isException: boolean;
  title: string;
  description: string | null;
  typeLabel: string;
  venueId: string | null;
  venueName: string | null;
  /** Full list of venues attached to this item. When the item has a primary
   * venue, it appears first. Empty when the item is global. */
  venues: Array<{ id: string; name: string; isPrimary: boolean }>;
  ownerId: string | null;
  ownerName: string | null;
  targetDate: string;
  status: PlanningItemStatus;
  createdBy: string;
  tasks: PlanningTask[];
};

export type PlanningEventOverlay = {
  id: string;
  source: "event";
  eventId: string;
  title: string;
  status: string;
  startAt: string;
  endAt: string;
  targetDate: string;
  venueId: string | null;
  venueName: string | null;
  venueSpace: string | null;
  publicTitle: string | null;
  publicTeaser: string | null;
};

export type InspirationCategory = 'bank_holiday' | 'seasonal' | 'floating' | 'sporting';
export type InspirationSource = 'gov_uk_api' | 'computed' | 'openai';

export type PlanningInspirationItem = {
  id: string;
  eventName: string;
  eventDate: string;        // YYYY-MM-DD
  category: InspirationCategory;
  description: string | null;
  source: InspirationSource;
};

export type PlanningAlertCounts = {
  overdueItems: number;
  overdueTasks: number;
  dueSoonItems: number;
  dueSoonTasks: number;
};

export type TodoAlertFilter = "overdue_items" | "overdue_tasks" | "due_soon_items" | "due_soon_tasks";

export type PlanningBoardData = {
  today: string;
  alerts: PlanningAlertCounts;
  planningItems: PlanningItem[];
  events: PlanningEventOverlay[];
  users: PlanningPerson[];
  inspirationItems: PlanningInspirationItem[];
};

export type SeriesTaskTemplateInput = {
  title: string;
  defaultAssigneeId?: string | null;
  dueOffsetDays?: number;
  sortOrder?: number;
};

export type CreatePlanningSeriesInput = {
  title: string;
  description?: string | null;
  typeLabel: string;
  venueId?: string | null;
  ownerId?: string | null;
  createdBy: string;
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceInterval: number;
  recurrenceWeekdays?: number[] | null;
  recurrenceMonthday?: number | null;
  startsOn: string;
  endsOn?: string | null;
  taskTemplates?: SeriesTaskTemplateInput[];
};

export type UpdatePlanningSeriesInput = {
  title?: string;
  description?: string | null;
  typeLabel?: string;
  venueId?: string | null;
  ownerId?: string | null;
  recurrenceFrequency?: RecurrenceFrequency;
  recurrenceInterval?: number;
  recurrenceWeekdays?: number[] | null;
  recurrenceMonthday?: number | null;
  startsOn?: string;
  endsOn?: string | null;
  isActive?: boolean;
  generatedThrough?: string | null;
  taskTemplates?: SeriesTaskTemplateInput[];
};

export type CreatePlanningItemInput = {
  title: string;
  description?: string | null;
  typeLabel: string;
  venueId?: string | null;
  ownerId?: string | null;
  targetDate: string;
  status?: PlanningItemStatus;
  createdBy: string;
};

export type UpdatePlanningItemInput = {
  title?: string;
  description?: string | null;
  typeLabel?: string;
  venueId?: string | null;
  ownerId?: string | null;
  targetDate?: string;
  status?: PlanningItemStatus;
};

export type CreatePlanningTaskInput = {
  planningItemId: string;
  title: string;
  assigneeId?: string | null;
  dueDate: string;
  sortOrder?: number;
  createdBy: string;
};

export type UpdatePlanningTaskInput = {
  title?: string;
  assigneeId?: string | null;
  dueDate?: string;
  status?: PlanningTaskStatus;
  sortOrder?: number;
  notes?: string | null;
};
