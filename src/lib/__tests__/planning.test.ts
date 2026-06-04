import { describe, expect, it } from "vitest";
import {
  bucketForDayOffset,
  computeMovedTargetDate,
  generateOccurrenceDates,
  planningItemsToTodoItems
} from "@/lib/planning/utils";
import type { PlanningItem, PlanningTask } from "@/lib/planning/types";

describe("planning recurrence generation", () => {
  it("generates daily occurrences for interval 2", () => {
    const dates = generateOccurrenceDates({
      rule: {
        recurrenceFrequency: "daily",
        recurrenceInterval: 2,
        startsOn: "2026-03-01"
      },
      fromDate: "2026-03-01",
      throughDate: "2026-03-07"
    });

    expect(dates).toEqual(["2026-03-01", "2026-03-03", "2026-03-05", "2026-03-07"]);
  });

  it("generates weekly occurrences on selected weekdays", () => {
    const dates = generateOccurrenceDates({
      rule: {
        recurrenceFrequency: "weekly",
        recurrenceInterval: 1,
        recurrenceWeekdays: [1, 4],
        startsOn: "2026-03-01"
      },
      fromDate: "2026-03-01",
      throughDate: "2026-03-14"
    });

    expect(dates).toEqual(["2026-03-02", "2026-03-05", "2026-03-09", "2026-03-12"]);
  });

  it("generates monthly occurrences with day clamped to month length", () => {
    const dates = generateOccurrenceDates({
      rule: {
        recurrenceFrequency: "monthly",
        recurrenceInterval: 1,
        recurrenceMonthday: 31,
        startsOn: "2026-01-31"
      },
      fromDate: "2026-01-31",
      throughDate: "2026-03-31"
    });

    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("stops recurrence generation at end date", () => {
    const dates = generateOccurrenceDates({
      rule: {
        recurrenceFrequency: "weekly",
        recurrenceInterval: 1,
        recurrenceWeekdays: [1],
        startsOn: "2026-03-02",
        endsOn: "2026-03-16"
      },
      fromDate: "2026-03-01",
      throughDate: "2026-03-31"
    });

    expect(dates).toEqual(["2026-03-02", "2026-03-09", "2026-03-16"]);
  });
});

describe("planning buckets and move logic", () => {
  it("maps day offsets into 30/60/90 buckets", () => {
    expect(bucketForDayOffset(0)).toBe("0_30");
    expect(bucketForDayOffset(30)).toBe("0_30");
    expect(bucketForDayOffset(31)).toBe("31_60");
    expect(bucketForDayOffset(60)).toBe("31_60");
    expect(bucketForDayOffset(61)).toBe("61_90");
    expect(bucketForDayOffset(90)).toBe("61_90");
    expect(bucketForDayOffset(91)).toBe("later");
  });

  it("preserves offset when moving from one bucket to another", () => {
    const moved = computeMovedTargetDate({
      today: "2026-03-01",
      sourceDate: "2026-03-10",
      targetBucket: "31_60"
    });

    // source offset is +9 days in 0-30 bucket, moved to 31-60 => day 40
    expect(moved).toBe("2026-04-10");
  });

  it("clamps offsets when moving into 31-60/61-90 buckets", () => {
    const moved = computeMovedTargetDate({
      today: "2026-03-01",
      sourceDate: "2026-03-31",
      targetBucket: "31_60"
    });

    // source offset is +30 days, clamped to +29 within the 31-60 window
    expect(moved).toBe("2026-04-30");
  });
});

const baseTask: PlanningTask = {
  id: "task-1",
  planningItemId: "item-1",
  title: "Base task",
  assigneeId: "user-1",
  assigneeName: "Planner",
  dueDate: "2026-05-25",
  status: "open",
  completedAt: null,
  sortOrder: 0,
  assignees: [{ id: "user-1", name: "Planner", email: "planner@example.com" }],
  completedBy: null,
  sopSection: null,
  sopTemplateTaskId: null,
  isBlocked: false,
  dueDateManuallyOverridden: false,
  manuallyAssigned: false,
  dependsOnTaskIds: [],
  notes: null,
  attachments: []
};

function task(overrides: Partial<PlanningTask>): PlanningTask {
  return { ...baseTask, ...overrides };
}

function item(overrides: Partial<PlanningItem>): PlanningItem {
  return {
    id: "item-1",
    source: "planning",
    eventId: null,
    seriesId: null,
    occurrenceOn: null,
    isException: false,
    title: "Planning item",
    description: null,
    typeLabel: "Campaign",
    venueId: null,
    venueName: null,
    venues: [],
    ownerId: null,
    ownerName: null,
    targetDate: "2026-05-25",
    startAt: null,
    endAt: null,
    status: "planned",
    createdBy: "user-1",
    tasks: [],
    ...overrides
  };
}

describe("planning todo conversion", () => {
  it("defaults to open tasks due today or overdue", () => {
    const todos = planningItemsToTodoItems(
      [
        item({
          tasks: [
            task({ id: "overdue", title: "Overdue", dueDate: "2026-05-24" }),
            task({ id: "today", title: "Today", dueDate: "2026-05-25" }),
            task({ id: "future", title: "Future", dueDate: "2026-05-26" }),
            task({ id: "done", title: "Done", dueDate: "2026-05-24", status: "done" })
          ]
        })
      ],
      "2026-05-25",
      true,
      "user-1"
    );

    expect(todos.map((todo) => todo.title)).toEqual(["Overdue", "Today"]);
  });

  it("applies planning alert filters to the todo list", () => {
    const planningItems = [
      item({
        id: "overdue-item",
        title: "Overdue item",
        targetDate: "2026-05-20",
        tasks: [task({ id: "future-on-overdue-item", title: "Future on overdue item", dueDate: "2026-06-02" })]
      }),
      item({
        id: "current-item",
        title: "Current item",
        targetDate: "2026-05-25",
        tasks: [
          task({ id: "overdue-task", title: "Overdue task", dueDate: "2026-05-24" }),
          task({ id: "soon-task", title: "Soon task", dueDate: "2026-05-30" }),
          task({ id: "later-task", title: "Later task", dueDate: "2026-06-03" })
        ]
      })
    ];

    expect(
      planningItemsToTodoItems(planningItems, "2026-05-25", true, "user-1", "overdue_items")
        .map((todo) => todo.title)
    ).toEqual(["Future on overdue item"]);
    expect(
      planningItemsToTodoItems(planningItems, "2026-05-25", true, "user-1", "overdue_tasks")
        .map((todo) => todo.title)
    ).toEqual(["Overdue task"]);
    expect(
      planningItemsToTodoItems(planningItems, "2026-05-25", true, "user-1", "due_soon_tasks")
        .map((todo) => todo.title)
    ).toEqual(["Soon task"]);
  });
});
