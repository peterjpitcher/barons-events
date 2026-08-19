# Implementation Plan: Event Email Changes

**Specification:** `2026-08-19-event-email-changes-scope.md` revision 2
**Date:** 2026-08-19
**Shape:** one PR, three commits, in the order below. Each commit leaves the tree green.

## Commit order and why

1. **Migration first.** The digest code reads a column that must exist before it deploys. Additive and safe to land ahead of the code.
2. **Broadcast removal second.** It is the higher-value, lower-risk half. If anything in the digest work goes wrong, this half is still shippable on its own.
3. **Digest rewrite third.** Depends on the column from commit 1.

---

## Commit 1: `feat: add a weekly digest send cursor`

### `supabase/migrations/20260819090000_weekly_digest_sent_at_cursor.sql`

- `alter table public.users add column if not exists weekly_digest_last_sent_at timestamptz;`
- Backfill from the existing date at 08:00 UTC, the historic send time:
  `update public.users set weekly_digest_last_sent_at = (weekly_digest_last_sent_on::timestamp at time zone 'UTC') + interval '8 hours' where weekly_digest_last_sent_on is not null and weekly_digest_last_sent_at is null;`
- `comment on column` explaining that the date column drives week idempotency and the timestamp drives the content window.
- `comment on table public.event_notification_claims` rewritten to say it is history for the retired broadcast.
- `notify pgrst, 'reload schema';`

Checked before writing: `public.users` has no write-guard trigger (only `set_updated_at` and a role/venue audit trigger that this update does not touch), so the backfill runs cleanly under `supabase db push`. That trap is what forced `event_notification_claims` into its own table.

### `src/lib/supabase/types.ts`

Add `weekly_digest_last_sent_at: string | null` to the `users` Row, Insert and Update types.

---

## Commit 2: `feat: stop broadcasting new events to every user`

### `src/lib/notifications/plan-new-event.ts` (rewrite, roughly 60 lines)

New contract:

```ts
export type NewEventTransition = "admin_publish" | "manager_submit";
export type PlannedMessageKind = "review_decision" | "submitted_for_review";
export type NotificationPerson = { userId: string; email: string; fullName: string | null };
export type PlannedMessage = { kind; sendTo; userId; fullName };
export type SuppressedMessage = { userId; kind; reason: "self_notification" };
export type PlanNewEventNotificationsInput = { transition; actorUserId; creator; assignee };
export type NewEventNotificationPlan = { message: PlannedMessage | null; suppressed: SuppressedMessage[] };
```

Rule: `admin_publish` targets the creator, `manager_submit` targets the assignee, and neither sends when that person is the actor. Deleted: the announcement loop, `requiresClaim`, `isFirstPublish`, `activeUsers`, `eventVenueIds`, the `claimedKeys` map, `emailKey` normalisation and the `already_targeted` / `duplicate_email` reasons. Justification for dropping normalised-inbox comparison: `users.email` carries a unique constraint, so equal inboxes imply equal `userId`.

### `src/lib/notifications.ts` (new-event path)

Delete: `AnnouncementEventContext`, `fetchAnnouncementEventContext`, `listActiveNotificationPeople`, `toPerson`, `collectVenueIds`, `buildVenueLabel`, `buildAnnouncementEmail`, `claimNewEventAnnouncement`, `releaseNewEventAnnouncementClaim`.

Add a lean `fetchTransitionEventContext(eventId)` selecting the event plus creator and assignee only. No venue joins, no `event_venues`.

Rewrite `notifyNewEvent({ eventId, actorUserId, transition, operationId })`:

1. Guard on operational emails and a Resend client, as now.
2. Fetch context. Return when the event is missing.
3. Plan. Return when `message` is null, logging the suppression.
4. Build the one email with the existing `buildReviewDecisionEmail` or `buildSubmittedForReviewEmail`.
5. `resend.emails.send(payload, { idempotencyKey: "new-event:<eventId>:<transition>:<operationId>" })`.
6. Treat a resolved `{ error }` or a missing `data.id` as failure. Wrap in try/catch for thrown network errors.
7. One structured log line: `event`, `eventId`, `transition`, `kind`, `sent`, `messageId`, `suppressed`, `error`.

### `src/actions/events.ts`

Three call sites: replace `isFirstPublish: ...` with `operationId`. Remove the now-dead `wasDraft` / `wasDraftBeforeApproval` / `statusBefore === "draft"` locals and the comments explaining why they were pinned outside the closure. `announceEventId` / `submittedEventId` pinning stays: `targetEventId` is still a mutable `let`.

### Tests

- `plan-new-event.test.ts`: keep self-suppression and both targeted cases, drop everything about announcements, claims and deduplication.
- `notify-new-event.test.ts`: drop claim, release and batch-chunking cases. Add: single send used, idempotency key contains `operationId`, resolved provider error not counted as sent, no claim table access.
- `notify-new-event-after.test.ts`: update the expected call shape to `operationId`.

---

## Commit 3: `feat: show newly created events in the Tuesday email`

### `src/lib/notifications/select-new-events.ts` (new, pure, no I/O)

```ts
export const NEW_EVENT_STATUS_LABELS: Record<string, string>   // mirrors dashboard.ts
export const EXCLUDED_NEW_EVENT_STATUSES = ["rejected"]
export const NEW_EVENT_MAX_LOOKBACK_DAYS = 14
export const NEW_EVENT_EMAIL_LIMIT = 20

export type NewEventRow = {
  id; title; status; created_at; start_at;
  venue_id: string | null;
  venue: { name } | { name }[] | null;
  event_venues?: Array<{ venue_id; venue: { name } | { name }[] | null }> | null;
};

export function resolveNewEventWindowStart(lastSentAt, runCutoff, maxLookbackDays?): string
export function newEventVenueIds(row): string[]        // join-first, legacy fallback
export function newEventVenueLabel(row): string        // every linked venue, deduped
export function selectNewEventsForUser({ rows, windowStart, runCutoff, userVenueId, formatDate, limit? })
  : { total: number; items: Array<{ title; detail }>; overflowCount: number }
```

`selectNewEventsForUser` filters on window and venue, sorts `created_at desc, id desc`, counts the **total**, then slices to the limit and reports the remainder. Detail string: `<date> · <venues> · <status label>`.

Why a separate module: the existing digest test mock resolves every query chain to the same rows regardless of `.gte` / `.is` / `.order`, so filter logic tested only through that mock proves nothing. This helper takes real values and returns real answers.

### `src/lib/notifications.ts` (`sendMandatoryWeeklyUpdateEmail`)

1. Capture `runCutoff = new Date().toISOString()` once, before any query.
2. Add `weekly_digest_last_sent_at` to the users select.
3. After filtering to unsent users, compute each one's `windowStart` and take the earliest.
4. Replace the two approved-events queries with one paged `events` query over `[earliestStart, runCutoff)`, `deleted_at is null`, `status <> 'rejected'`, ordered `created_at desc, id desc`, selecting `event_venues(venue_id, venue:venues(name))`.
5. Per user, call `selectNewEventsForUser` with their own `windowStart`.
6. Pass `newEvents`, `newEventTotal` and `newEventOverflowCount` to the renderer.
7. Check the Resend response: `error` present or `data.id` missing counts as failed and skips both cursor updates.
8. On success update `weekly_digest_last_sent_on` **and** `weekly_digest_last_sent_at = runCutoff` in one statement.
9. Structured log per run: eligible, sent, failed, window bounds, rows fetched.

The debrief section keeps its own 7-day window and is untouched.

### `src/lib/notifications.ts` (`renderWeeklyUpdateEmail`)

- `WeeklyUpdateEmailContent`: `approvedEvents` becomes `newEvents`, plus `newEventTotal` and `newEventOverflowCount`.
- Tile shows `newEventTotal` with label "New events".
- Heading "New events added", pill "since your last update", empty state "No new events added for your scope."
- Overflow line reusing the existing muted-item style.
- Plain text mirrors all of it.
- Replace the em dashes in the existing plain-text row separators with the middle dot already used inside detail strings, so the file is consistent and passes the house punctuation rule.

### Tests

- New `select-new-events.test.ts` covering every case listed in the spec's verification section.
- `weekly-digest.test.ts`: replace approved fixtures with created-event fixtures, fix `mockEmailSend` to the real `{ data, error }` shape, add provider-error and cursor-advance cases, assert the shared query's `gte` / `lt` arguments through `setupPagedMockDb`.

### `docs/Runbooks/CronMonitoring.md`

Correct three things: `/api/cron/weekly-digest` runs the **mandatory Tuesday update**, not the configurable todo digest; the schedule is 08:00 **UTC** on weekdays with a London Tuesday guard; the columns to inspect are `weekly_digest_last_sent_on` and `weekly_digest_last_sent_at`, not `todo_digest_last_sent_on`.

---

## Verification gate

After each commit: `npm run lint`, `npm run typecheck`, `npm test`. After the last: `npm run build` and `npx supabase db push --dry-run`.

## Open risks carried into the PR description

- Concurrency on the digest is unresolved and accepted.
- A failed recipient waits a week, with no same-week retry.
- Rollback needs the claim-backfill decision recorded in the spec.
