import type { PlanningTask } from "@/lib/planning/types";

export type TodoSource = "planning" | "sop" | "review" | "revision" | "debrief";
export type TodoUrgency = "overdue" | "due_soon" | "later";

export type TodoItem = {
  id: string;
  source: TodoSource;
  title: string;
  subtitle: string;
  dueDate: string | null;
  urgency: TodoUrgency;
  canToggle: boolean;
  linkHref: string;
  parentTitle?: string;
  venueName?: string;
  eventDate?: string;
  planningTaskId?: string;
  planningItemId?: string;
  assigneeId?: string;
  assigneeName?: string;
  /** Full task object — populated for planning/sop items so the rich
   * SopTaskRow can render notes, attachments, and the status dropdown. */
  task?: PlanningTask;
  /** Sibling tasks under the same planning item — needed by SopTaskRow to
   * resolve the "waiting on ..." label for blocked tasks. */
  siblings?: PlanningTask[];
};
