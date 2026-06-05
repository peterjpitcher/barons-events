import type { AuditTrailAccordionEntry } from "@/components/audit/audit-trail-accordion";

export type AuditTrailFormattingEntry = {
  id: string;
  action: string;
  actor_id: string | null;
  created_at: string;
  meta: Record<string, unknown> | null;
  contextLabel?: string | null;
  contextTypeLabel?: string | null;
};

export const auditTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London"
});

const metaLabelByKey: Record<string, string> = {
  changes: "Changed",
  changed_fields: "Changed",
  status: "Status",
  previousStatus: "Previous status",
  new_status: "Status",
  assigneeId: "Assignee",
  previousAssigneeId: "Previous assignee",
  assignee_id: "Assignee",
  previous_assignee_id: "Previous assignee",
  feedback: "Feedback",
  filename: "File",
  display_name: "File",
  original_filename: "Original file",
  uploaded_filename: "Uploaded file",
  previous_display_name: "Previous name",
  previous_filename: "Previous file",
  version_no: "Version",
  reason: "Reason",
  mime_type: "Type",
  size_bytes: "Size",
  booking_id: "Booking",
  title: "Title",
  parent_type: "Parent"
};

const hiddenMetaKeys = new Set([
  "storage_path",
  "persisted_field",
  "event_id",
  "planning_item_id",
  "planning_task_id",
  "attachment_id"
]);

function humanizeStatus(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeMetaKey(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatAuditAction(action: string, meta?: Record<string, unknown> | null): string {
  const status = typeof meta?.status === "string" ? humanizeStatus(meta.status) : null;
  const newStatus = typeof meta?.new_status === "string" ? humanizeStatus(meta.new_status) : null;

  switch (action) {
    case "event.created":
      return "Draft created";
    case "event.updated":
      return "Draft updated";
    case "event.draft_saved":
      return "Draft saved";
    case "event.submitted":
    case "event.status_submitted":
      return "Submitted for review";
    case "event.status_changed":
      return status ? `Status changed to ${status}` : "Status changed";
    case "event.assignee_changed":
    case "event.assignee_updated":
      return "Assignee updated";
    case "event.artists_updated":
      return "Artists updated";
    case "event.website_copy_generated":
      return "Website copy generated";
    case "event.booking_settings_updated":
      return "Booking settings updated";
    case "event.terms_generated":
      return "Terms generated";
    case "event.debrief_updated":
      return "Debrief submitted";
    case "event.deleted":
      return "Event deleted";
    case "event.pre_expired":
      return "Pre-approval expired";
    case "event.pre_rejected":
      return "Pre-approval rejected";
    case "booking.created":
      return "Booking created";
    case "booking.updated":
      return "Booking updated";
    case "booking.cancelled":
      return "Booking cancelled";
    case "attachment.uploaded":
      return "Attachment uploaded";
    case "attachment.upload_failed":
      return "Attachment upload failed";
    case "attachment.version_added":
      return "New attachment version uploaded";
    case "attachment.renamed":
      return "Attachment filename changed";
    case "attachment.deleted":
      return "Attachment deleted";
    case "note.created":
      return "Internal note added";
    case "planning.item_created":
      return "Planning item created";
    case "planning.item_updated":
      return "Planning item updated";
    case "planning.item_deleted":
      return "Planning item deleted";
    case "planning.task_created":
      return "Planning task created";
    case "planning.task_updated":
      return "Planning task updated";
    case "planning.task_deleted":
      return "Planning task deleted";
    case "planning.series_created":
      return "Planning series created";
    case "planning.series_updated":
      return "Planning series updated";
    case "planning.series_paused":
      return "Planning series paused";
    case "planning_task.status_changed":
      return newStatus ? `Task marked ${newStatus}` : "Task status changed";
    case "planning_task.reassigned":
      return "Task reassigned";
    case "planning_task.notes_updated":
      return "Task notes updated";
    case "planning_task.dependency_added":
      return "Task dependency added";
    case "planning_task.dependency_removed":
      return "Task dependency removed";
    case "planning_task.cascade_spawn":
      return "Cascade task created";
    case "planning_task.cascade_autocompleted":
      return "Cascade task completed";
    case "planning_task.cascade_reopened":
      return "Cascade task reopened";
    case "planning_task.debrief_created":
      return "Debrief task created";
    case "planning_task.debrief_autocompleted":
      return "Debrief task completed";
    case "planning_task.auto_not_required":
      return "Task marked not required";
    default: {
      const cleaned = action.replace(/^[a-z_]+\./, "").replace(/_/g, " ");
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }
}

export function toAuditMetaRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isVisibleMetaEntry([key, value]: [string, unknown]): boolean {
  if (value === null || value === undefined) return false;
  return !hiddenMetaKeys.has(key);
}

function formatMetaValue(key: string, value: unknown, actorNames: Map<string, string>): string {
  if (key === "version_no" && typeof value === "number") {
    return `v${value}`;
  }
  if (key === "size_bytes" && typeof value === "number") {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  if ((key === "status" || key === "previousStatus" || key === "new_status") && typeof value === "string") {
    return humanizeStatus(value);
  }
  if (
    (key === "assigneeId" || key === "previousAssigneeId" || key === "assignee_id" || key === "previous_assignee_id") &&
    typeof value === "string"
  ) {
    return actorNames.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === "object")) {
      return `${value.length} record${value.length === 1 ? "" : "s"}`;
    }
    return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function buildAuditTrailAccordionEntries(
  entries: AuditTrailFormattingEntry[],
  actorNames: Map<string, string>
): AuditTrailAccordionEntry[] {
  return entries.map((entry) => {
    const actor = entry.actor_id ? actorNames.get(entry.actor_id) ?? "Unknown user" : "System";
    const meta = toAuditMetaRecord(entry.meta);
    const metaKeys = Object.entries(meta).filter((item) => item[0] !== "feedback" && isVisibleMetaEntry(item));
    const createdAt = new Date(entry.created_at);
    const hasValidTimestamp = !Number.isNaN(createdAt.getTime());
    const feedback =
      typeof meta.feedback === "string" && meta.feedback.trim().length ? meta.feedback.trim() : null;

    return {
      id: entry.id,
      actionLabel: formatAuditAction(entry.action, meta),
      actorName: actor,
      timestampLabel: hasValidTimestamp ? auditTimestampFormatter.format(createdAt) : entry.created_at,
      createdAtIso: hasValidTimestamp ? createdAt.toISOString() : null,
      contextLabel: entry.contextLabel ?? null,
      contextTypeLabel: entry.contextTypeLabel ?? null,
      feedback,
      details: metaKeys.map(([key, value]) => ({
        label: metaLabelByKey[key] ?? humanizeMetaKey(key),
        value: formatMetaValue(key, value, actorNames)
      }))
    };
  });
}
