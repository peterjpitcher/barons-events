const EVENT_IMAGE_ELIGIBLE_STATUSES = new Set([
  "submitted",
  "needs_revisions",
  "approved",
  "rejected",
  "cancelled",
  "completed"
]);

export function canAddEventImage(status: string | null | undefined): boolean {
  return typeof status === "string" && EVENT_IMAGE_ELIGIBLE_STATUSES.has(status);
}
