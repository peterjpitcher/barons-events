import "server-only";

export type EventActionLogEntry = {
  operation_id: string;
  user_id: string;
  action: "save_event_draft" | "submit_event_for_review" | "propose_event_draft";
  duration_ms: number;
  outcome: "success" | "failure" | "conflict";
  warning_count?: number;
  failed_count?: number;
};

export function logEventAction(entry: EventActionLogEntry): void {
  console.log(JSON.stringify({ kind: "event-action", ...entry }));
}
