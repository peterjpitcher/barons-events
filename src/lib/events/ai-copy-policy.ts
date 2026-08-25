/**
 * Which event statuses allow AI website copy to be generated and saved.
 *
 * Reported by Charlotte Whindle on 2026-08-24: approving a proposal leaves the
 * event at `approved_pending_details`, which was not on the old two-status
 * allowlist, so the administrator who had just approved it was told to "approve
 * the event to enable AI generation". Directly created events never hit this
 * because create mode uses a different, ungated action.
 *
 * Both the client control and the server action read this one list, so they can
 * never drift into a dead button or a server that accepts what the UI hides.
 *
 * Every event status is ruled on explicitly rather than inferred from a notion
 * of "editable", so a new status has to be considered here on purpose.
 */
const AI_COPY_ELIGIBLE_STATUSES = new Set([
  // Approved but the details are still being filled in. The reported case.
  "approved_pending_details",
  // Where an administrator completes details after approving a proposal.
  "draft",
  // A reviewer may regenerate copy before approving.
  "submitted",
  // The revision loop is exactly when copy gets fixed.
  "needs_revisions",
  "approved",
  // Archive and SEO edits on past events are legitimate.
  "completed"
]);

/**
 * Excluded on purpose:
 * - `pending_approval`: not yet approved, and the form is not usable at this point.
 * - `rejected` and `cancelled`: terminal, never publish, and generating would
 *   churn the slug of a dead event.
 */
export function canGenerateWebsiteCopy(status: string | null | undefined): boolean {
  return typeof status === "string" && AI_COPY_ELIGIBLE_STATUSES.has(status);
}

/**
 * Whether the public web address may still be rewritten.
 *
 * The slug is produced by the model and is not deterministic, so regenerating
 * copy on a live event would move its public URL. `src/lib/event-public-url.ts`
 * emits the bare slug for events that have one, printed QR codes and shared
 * short links point at it, and the external brand site resolves
 * `/api/v1/events/by-slug/[slug]`. Once an event has been published its slug is
 * frozen for good, which is why `first_published_at` is never cleared.
 */
export function canWriteSeoSlug(firstPublishedAt: string | null | undefined): boolean {
  return !firstPublishedAt;
}
