import type { PlanningBucketKey, PlanningItem, RecurrenceFrequency } from "@/lib/planning/types";
import type { TodoItem, TodoSource, TodoUrgency } from "@/components/todos/todo-item-types";
import { DISPLAY_TIMEZONE } from "@/lib/datetime";

const DAY_MS = 24 * 60 * 60 * 1000;

const londonDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function londonDateString(date: Date = new Date()): string {
  return londonDateFormatter.format(date);
}

/**
 * Compute the initial value for a multi-venue picker from a record that has
 * both a scalar `venueId` (primary venue) and an array `venues` (full
 * attachment list). Prefers the array when populated so editors hydrate
 * from the complete list rather than only the primary — fixes the class of
 * silent-data-loss bug tracked in issue-log 2026-04-18 item 03.
 *
 * Falls back to the scalar for records that pre-date the join table, and
 * returns an empty list when neither is present (global item).
 */
export function deriveInitialVenueIds(input: {
  venueId?: string | null;
  venues?: Array<{ id: string }> | null;
}): string[] {
  if (input.venues && input.venues.length > 0) {
    return input.venues.map((v) => v.id);
  }
  return input.venueId ? [input.venueId] : [];
}

export function parseDateOnly(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }

  // Validate that the parsed date components match the input components.
  // new Date() silently normalises impossible dates (e.g. Feb 31 → Mar 3),
  // so we must reject inputs where the round-tripped components diverge.
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const inputYear = Number(match[1]);
    const inputMonth = Number(match[2]);
    const inputDay = Number(match[3]);
    if (
      parsed.getUTCFullYear() !== inputYear ||
      parsed.getUTCMonth() + 1 !== inputMonth ||
      parsed.getUTCDate() !== inputDay
    ) {
      throw new Error(
        `Invalid date: ${value} — day ${inputDay} does not exist in month ${inputMonth}`
      );
    }
  }

  return parsed;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateValue: string, deltaDays: number): string {
  const date = parseDateOnly(dateValue);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return formatDateOnly(date);
}

export function daysBetween(fromDate: string, toDate: string): number {
  const from = parseDateOnly(fromDate);
  const to = parseDateOnly(toDate);
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function minDate(left: string, right: string): string {
  return left <= right ? left : right;
}

export function maxDate(left: string, right: string): string {
  return left >= right ? left : right;
}

export function bucketForDayOffset(dayOffset: number): PlanningBucketKey {
  if (dayOffset <= 30) return "0_30";
  if (dayOffset <= 60) return "31_60";
  if (dayOffset <= 90) return "61_90";
  return "later";
}

export function bucketStartOffset(bucket: PlanningBucketKey): number {
  switch (bucket) {
    case "past":
      return -Infinity;
    case "0_30":
      return 0;
    case "31_60":
      return 31;
    case "61_90":
      return 61;
    case "later":
      return 91;
    default:
      return 0;
  }
}

function clampOffsetForBucket(offset: number, bucket: PlanningBucketKey): number {
  const min = 0;

  if (bucket === "later") {
    return Math.max(min, offset);
  }

  if (bucket === "0_30") {
    return Math.min(30, Math.max(min, offset));
  }

  return Math.min(29, Math.max(min, offset));
}

export function computeMovedTargetDate(params: {
  today: string;
  sourceDate: string;
  targetBucket: PlanningBucketKey;
}): string {
  const sourceOffset = daysBetween(params.today, params.sourceDate);
  const sourceBucket = bucketForDayOffset(sourceOffset);
  const sourceBucketStart = bucketStartOffset(sourceBucket);
  const sourceWithinBucket = sourceOffset - sourceBucketStart;
  const targetBucketStart = bucketStartOffset(params.targetBucket);
  const nextOffset = targetBucketStart + clampOffsetForBucket(sourceWithinBucket, params.targetBucket);
  return addDays(params.today, nextOffset);
}

type RecurrenceRule = {
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceInterval: number;
  recurrenceWeekdays?: number[] | null;
  recurrenceMonthday?: number | null;
  startsOn: string;
  endsOn?: string | null;
};

function dayOfWeek(dateValue: string): number {
  return parseDateOnly(dateValue).getUTCDay();
}

function dayOfMonth(dateValue: string): number {
  return parseDateOnly(dateValue).getUTCDate();
}

function firstDayOfMonth(dateValue: string): string {
  const date = parseDateOnly(dateValue);
  date.setUTCDate(1);
  return formatDateOnly(date);
}

function addMonths(dateValue: string, deltaMonths: number): string {
  const date = parseDateOnly(dateValue);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonthDate = new Date(Date.UTC(year, month + deltaMonths, 1));
  const endOfMonthDate = new Date(Date.UTC(targetMonthDate.getUTCFullYear(), targetMonthDate.getUTCMonth() + 1, 0));
  const targetDay = Math.min(day, endOfMonthDate.getUTCDate());

  return formatDateOnly(
    new Date(Date.UTC(targetMonthDate.getUTCFullYear(), targetMonthDate.getUTCMonth(), targetDay))
  );
}

function monthsBetween(fromDate: string, toDate: string): number {
  const from = parseDateOnly(fromDate);
  const to = parseDateOnly(toDate);
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

function daysInMonth(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

function normaliseWeekdays(rule: RecurrenceRule): number[] {
  const source = Array.isArray(rule.recurrenceWeekdays) ? rule.recurrenceWeekdays : [];
  const unique = Array.from(new Set(source.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)));
  if (unique.length > 0) {
    unique.sort((left, right) => left - right);
    return unique;
  }
  return [dayOfWeek(rule.startsOn)];
}

export function generateOccurrenceDates(params: {
  rule: RecurrenceRule;
  fromDate: string;
  throughDate: string;
}): string[] {
  const { rule } = params;
  const lowerBound = maxDate(params.fromDate, rule.startsOn);
  const upperBound = rule.endsOn ? minDate(params.throughDate, rule.endsOn) : params.throughDate;

  if (lowerBound > upperBound) {
    return [];
  }

  const interval = Number.isInteger(rule.recurrenceInterval) && rule.recurrenceInterval > 0 ? rule.recurrenceInterval : 1;

  if (rule.recurrenceFrequency === "daily") {
    const dates: string[] = [];
    let cursor = lowerBound;
    while (cursor <= upperBound) {
      const diff = daysBetween(rule.startsOn, cursor);
      if (diff >= 0 && diff % interval === 0) {
        dates.push(cursor);
      }
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  if (rule.recurrenceFrequency === "weekly") {
    const weekdays = normaliseWeekdays(rule);
    const dates: string[] = [];
    let cursor = lowerBound;
    while (cursor <= upperBound) {
      const diff = daysBetween(rule.startsOn, cursor);
      if (diff >= 0) {
        const weekIndex = Math.floor(diff / 7);
        if (weekIndex % interval === 0 && weekdays.includes(dayOfWeek(cursor))) {
          dates.push(cursor);
        }
      }
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  const monthday = rule.recurrenceMonthday && rule.recurrenceMonthday >= 1 && rule.recurrenceMonthday <= 31
    ? rule.recurrenceMonthday
    : dayOfMonth(rule.startsOn);
  const startMonth = firstDayOfMonth(lowerBound);
  const endMonth = firstDayOfMonth(upperBound);

  const dates: string[] = [];
  let monthCursor = startMonth;
  while (monthCursor <= endMonth) {
    const monthDiff = monthsBetween(firstDayOfMonth(rule.startsOn), monthCursor);
    if (monthDiff >= 0 && monthDiff % interval === 0) {
      const monthDate = parseDateOnly(monthCursor);
      const year = monthDate.getUTCFullYear();
      const month = monthDate.getUTCMonth();
      const candidateDay = Math.min(monthday, daysInMonth(year, month));
      const candidate = formatDateOnly(new Date(Date.UTC(year, month, candidateDay)));
      if (candidate >= lowerBound && candidate <= upperBound && candidate >= rule.startsOn) {
        dates.push(candidate);
      }
    }
    monthCursor = firstDayOfMonth(addMonths(monthCursor, 1));
  }

  return dates;
}

// ---------------------------------------------------------------------------
// Planning → TodoItem mapping (used by planning board + dashboard)
// ---------------------------------------------------------------------------

/**
 * Classify urgency for a todo item (client-safe version).
 *
 * Mirrors the logic in src/lib/dashboard.ts classifyTodoUrgency but avoids
 * importing from the server-only module so this utility stays usable in
 * client components (e.g. planning-board.tsx).
 */
function classifyUrgency(dueDate: string | null, today: string): TodoUrgency {
  if (!dueDate) return "later";
  const sevenDaysFromNow = addDays(today, 7);
  if (dueDate < today) return "overdue";
  if (dueDate <= sevenDaysFromNow) return "due_soon";
  return "later";
}

/**
 * Convert PlanningItem[] (with nested tasks) into TodoItem[] for the
 * UnifiedTodoList component.
 */
export function planningItemsToTodoItems(
  items: PlanningItem[],
  today: string,
  canManageAll: boolean,
  currentUserId: string
): TodoItem[] {
  const result: TodoItem[] = [];

  for (const item of items) {
    for (const task of item.tasks) {
      if (task.status !== "open") continue;
      // Only show tasks that are due today or earlier — not future-dated items
      if (task.dueDate && task.dueDate > today) continue;

      const isSop = Boolean(task.sopSection || task.sopTemplateTaskId);
      const source: TodoSource = isSop ? "sop" : "planning";

      const isAssignedViaJunction = task.assignees.some(
        (a) => a.id === currentUserId
      );
      const canToggle =
        canManageAll ||
        item.ownerId === currentUserId ||
        task.assigneeId === currentUserId ||
        isAssignedViaJunction;

      result.push({
        id: task.id,
        source,
        title: task.title,
        subtitle: `${isSop ? "SOP Task" : "Planning Task"} \u00B7 ${item.venueName ?? "No venue"} \u00B7 Due ${task.dueDate ?? "TBD"}`,
        dueDate: task.dueDate ?? null,
        urgency: classifyUrgency(task.dueDate ?? null, today),
        canToggle,
        linkHref: "/planning",
        parentTitle: item.title,
        venueName: item.venueName ?? undefined,
        planningTaskId: task.id,
        planningItemId: item.id,
        assigneeId: task.assigneeId ?? undefined,
        assigneeName: task.assigneeName ?? undefined,
        // Carry the full task + siblings so the rich SopTaskRow can render
        // notes, attachments, dependency labels, and the status dropdown
        // without re-fetching anything.
        task,
        siblings: item.tasks,
      });
    }
  }

  return result;
}
