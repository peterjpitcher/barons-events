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
};
