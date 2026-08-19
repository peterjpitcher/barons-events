# Stop the New Event Broadcast, Rebuild the Tuesday Email Around Created Events

**Date:** 2026-08-19
**Revision:** 2 (supersedes revision 1, rewritten after external review `2026-08-19-event-email-changes-scope-review.md` and product decisions)
**Status:** Ready for implementation. All product decisions answered.
**Complexity:** 3 (M). Roughly 400 lines of meaningful change across 7 source files plus tests, and one additive migration. One PR, three commits.
**Reported ask:** "I don't want to send emails every time an event is created now to all users. I also want to update the Tuesday morning email template to show all events created since the last version was sent rather than approved events."

## Change log for revision 2

Revision 1 was reviewed and marked not ready with four P0 findings and eighteen P1/P2 findings. Six things changed materially:

1. **The three product decisions are recorded** (they were referenced but missing). See "Product decisions" below.
2. **A timestamp cursor is added.** Revision 1 tried to build "since your last email" out of `users.weekly_digest_last_sent_on`, which is a `date`. A date cannot represent the moment an email was sent, so the window would repeat or drop events created on a Tuesday morning. One additive column, `users.weekly_digest_last_sent_at timestamptz`, makes the wording honest. This is the one migration.
3. **The production evidence in revision 1 was wrong.** 112 rows in `event_notification_claims` is not 112 broadcasts: 99 of them are the migration backfill (`planned_count = 0`). The real figure is 13 broadcasts totalling 229 emails. The conclusion does not change, the number does.
4. **Venue scoping is corrected to join-table first.** Revision 1 said "keep it as it is", which unions the legacy `events.venue_id` with `event_venues`. Project rule is join table first, legacy only as a fallback. Verified safe against production data.
5. **Resend error handling is fixed.** `sendMandatoryWeeklyUpdateEmail` never inspects the `{ data, error }` response, so a provider rejection is currently recorded as a success and the user is skipped until next week. This is a live bug in the function being changed.
6. **The send path collapses to a single email.** With the announcement gone, each transition produces at most one message, so `resend.batch.send` plus chunking plus payload-shape idempotency keys all come out in favour of `resend.emails.send` with a per-occurrence key.

## Summary

Two changes, both in the same area.

1. **Stop the all-users broadcast when an event is created.** Every new event currently emails all 17 active users. 13 broadcasts have fired since 2026-07-23, sending 229 emails in under a month. The two targeted workflow emails stay: the creator still learns their event was approved, the assignee still learns something is waiting for review.
2. **Change the Tuesday email's first section from "recently approved" to "created since your last email".** This is a repair, not a reword. The section reads from an audit action that has fired 4 times in the life of the system and 0 times in the last 30 days, so it has printed "No newly approved events for your scope." every week for months.

Together these move new event news from an instant blast to a weekly summary.

## Product decisions (answered 2026-08-19)

| # | Question | Answer | Consequence |
|---|---|---|---|
| 1 | Keep the two targeted emails (creator, assignee) when the broadcast goes? | **Yes, keep them.** Users do not want the all-users broadcast; a message to one directly involved person is not the problem. | Only the `announcement` kind is removed. `review_decision` and `submitted_for_review` are unchanged in content and audience. |
| 2 | Should the Tuesday list show every event created, whatever its status? | **Yes, with the status printed next to each row, except rejected events which are excluded.** | Status matrix below. Status is always a word, never a colour. |
| 3 | How far back should "since your last email" reach when a send is missed? | **Use each person's own last-send moment, never reaching back more than 14 days.** | `windowStart = max(lastSentAt, runCutoff - 14 days)`. Null cursor gets the 14-day floor. |

### Status matrix (decision 2)

The weekly section selects on **row creation** (`events.created_at`), not on a lifecycle transition. This is a deliberate widening compared with the removed announcement, which fired on first publish or submit. It is what "all events created" asks for, and it means a draft that never gets submitted is still visible rather than invisible.

| `EventStatus` | In the Tuesday list | Reason |
|---|---|---|
| `draft` | Include | A draft is an event someone started. Hiding it recreates the blind spot the approved section had. |
| `pending_approval` | Include | Shown as "Proposal awaiting approval". |
| `approved_pending_details` | Include | Shown as "Approved, needs details". |
| `submitted` | Include | Shown as "Waiting review". |
| `needs_revisions` | Include | Shown as "Needs tweaks". |
| `approved` | Include | The common case. |
| `cancelled` | Include | It was created in the window and people should know it is off. |
| `completed` | Include | Reachable inside a 14-day window for a short-notice event. |
| `rejected` | **Exclude** | Product decision 2. A rejected event is not news, and listing it invites someone to act on it. |
| soft-deleted (`deleted_at` set) | **Exclude** | Deleted is deleted. Excluded from the list and from the overflow count. |

Labels come from the existing map in `src/lib/dashboard.ts:182`, so the email and the application say the same words.

## Evidence from production (queried live, 2026-08-19)

| Fact | Value | Source and caveat |
|---|---|---|
| Active users receiving both emails | 17 | `users` where `deactivated_at is null` and `email is not null` |
| **Real** new-event broadcasts to date | **13**, latest 2026-08-17 | `event_notification_claims` where `planned_count > 0 and claimed_by is not null`. The other 99 rows are the 2026-07-23 migration backfill and were never sent. |
| Emails those broadcasts planned | 229 | `sum(planned_count)`. This is planned recipients, not proof of provider acceptance or inbox delivery. |
| Events created, last 30 days | 22 | `audit_log` action `event.created` |
| `event.approved` audit rows, last 30 days | **0** | `audit_log` |
| `event.approved` audit rows, all time | **4** | `audit_log` |
| Tuesday digest runs, last 6 weeks | 6 of 6, reporting 17 sent 0 failed | `audit_log` entity `digest`, `meta.weekly_update = true`. See F10: the function cannot currently tell a provider rejection from a success, so "0 failed" is weaker evidence than it looks. |
| Events created per week, last 16 weeks | 1 to 9, plus one import week of 22 | `events.created_at` |
| Live events | 142 | `events` where `deleted_at is null` |
| Live events with no `event_venues` rows | 18 | Legacy rows. They need the `events.venue_id` fallback. |
| Live events whose primary venue is missing from `event_venues` | **0** | Confirms join-first scoping loses nothing. |
| Multi-venue events | 10 | Their rows must show every linked venue, not just the primary. |
| Users with no digest cursor | 0 today | All 17 carry `2026-08-18`. The null path still needs defining for future joiners. |
| Users with a venue set | 1 of 17 | Venue scoping is nearly inert but still an authorisation boundary. |

Two conclusions follow.

**The approved section cannot work as designed.** Administrators create events that are already approved, so nothing passes through a separate approval step and no `event.approved` audit row is written.

**Volume is safe.** At 1 to 9 events a week the section will be short. The 22-event import week is why it still needs a cap and an overflow line.

## Current behaviour

### New event emails

`notifyNewEvent` (`src/lib/notifications.ts:1635`) runs via `after()` from three points in `submitEventForReviewAction` (`src/actions/events.ts` lines 1461, 1879, 1980). It calls the pure planner `planNewEventNotifications` (`src/lib/notifications/plan-new-event.ts`), which produces at most one message per person:

| Message | Who | When |
|---|---|---|
| `review_decision` | The creator, if they are not the actor | Administrator publishes |
| `submitted_for_review` | The assignee, if they are not the actor | Manager submits for review |
| `announcement` | **Every active user, all 17** | First publish only |

The announcement is guarded by a claim row in `event_notification_claims`, and the whole set goes out through one `resend.batch.send`.

### The Tuesday email

`sendMandatoryWeeklyUpdateEmail` (`src/lib/notifications.ts:2246`), triggered by `/api/cron/weekly-digest`. The cron is `0 8 * * 1-5`, which is **08:00 UTC** on weekdays, so 08:00 in winter and 09:00 during British Summer Time. The function returns immediately unless the London date is a Tuesday. Per-user week idempotency comes from `users.weekly_digest_last_sent_on` compared by ISO week start, which suppresses sequential re-runs but not two genuinely concurrent invocations.

Three sections, rendered by `renderWeeklyUpdateEmail` (`src/lib/notifications.ts:270`):

1. **Recently approved events, last 7 days.** Reads `audit_log` for `event.approved`, then loads those events. Always empty in practice.
2. **Your SOP to-dos, due now or next 14 days.** Per user, capped at 10 with an overflow line.
3. **Debriefed events, last 7 days.** Capped at 20.

Sections 1 and 3 are venue scoped by a union of `events.venue_id` and `event_venues`.

## Change 1: stop the new event broadcast

**Reduce the planner to zero or one message.** In `planNewEventNotifications`, delete the announcement loop, `requiresClaim`, `isFirstPublish`, `activeUsers` and the unused `eventVenueIds`. Only one of the two targeted branches can run for a given transition, so the cross-recipient deduplication has nothing left to deduplicate and comes out too. `users.email` carries a unique constraint (`users_email_key`), so comparing the actor by `userId` is exactly equivalent to comparing normalised inboxes, and the shared-inbox guard is no longer needed.

The planner's remaining job is one rule: **on `admin_publish` tell the creator, on `manager_submit` tell the assignee, and say nothing when that person is the one who clicked.**

**Send one email, not a batch.** `notifyNewEvent` drops `listActiveNotificationPeople`, `fetchAnnouncementEventContext`, `buildAnnouncementEmail`, `collectVenueIds`, `buildVenueLabel`, `claimNewEventAnnouncement` and `releaseNewEventAnnouncementClaim`, and switches to `resend.emails.send`. It inspects the `{ data, error }` response rather than treating a resolved promise as success.

**Fix the idempotency key (review F13).** The current key is built from event ID, transition name and payload shape. Once the announcement is gone, a first publish and a later republish produce byte-identical payload shapes, so the provider could treat a legitimate second notification as a replay of the first. The three call sites already have an `operationId` in scope, so `notifyNewEvent` takes it and the key becomes `new-event:<eventId>:<transition>:<operationId>`. That is stable for a retry of the same click and different for a genuine second transition.

**Leave the claim table in place.** `event_notification_claims` keeps its rows as history. Its table comment is updated to say it describes the retired broadcast, so nobody reads it as live infrastructure.

Result: an event that used to send 17 emails now sends at most 1, and 0 when the person who clicked is also the creator.

### Files

| File | Change |
|---|---|
| `src/lib/notifications/plan-new-event.ts` | Reduce to a zero-or-one decision; drop announcement, claim, dedupe and venue inputs |
| `src/lib/notifications.ts` | Remove seven announcement-only helpers and types; rewrite `notifyNewEvent` around a single send with response checking |
| `src/actions/events.ts` | Replace `isFirstPublish` with `operationId` at three call sites |
| `supabase/migrations/…_weekly_digest_sent_at_cursor.sql` | Comment-only update on `event_notification_claims` (bundled with change 2's migration) |
| Three test files | Remove announcement/claim/batch cases, add idempotency-key and provider-error cases |

## Change 2: created events in the Tuesday email

### Window semantics

Add `users.weekly_digest_last_sent_at timestamptz`, backfilled from `weekly_digest_last_sent_on` at 08:00 UTC (the historic send time). `weekly_digest_last_sent_on` stays and keeps doing the ISO-week idempotency check, so that behaviour is untouched.

One `runCutoff` is captured before any query. For each recipient:

```
windowStart = max(weekly_digest_last_sent_at ?? runCutoff - 14 days, runCutoff - 14 days)
include events where created_at >= windowStart and created_at < runCutoff
```

Start inclusive, cutoff exclusive, so an event created while the send loop is running lands in next week's email rather than being counted twice or lost. The cursor advances only after Resend accepts the message.

A missed run longer than 14 days silently drops the older events. That is accepted: the alternative is a first email containing months of history.

### Query

One shared query, not one per user. Compute the earliest `windowStart` across all recipients, fetch that range once through the existing `fetchDigestRows` pager, then filter per user in memory. Seventeen round trips for seventeen users is waste, and a global `limit(20)` applied before per-user filtering would produce wrong lists and wrong overflow counts.

```sql
select id, title, start_at, status, created_at, venue_id,
       venue:venues!events_venue_id_fkey(name),
       event_venues(venue_id, venue:venues(name))
from events
where created_at >= <earliest window start>
  and created_at <  <run cutoff>
  and deleted_at is null
  and status <> 'rejected'
order by created_at desc, id desc
```

Ordering is `created_at desc, id desc` so equal timestamps page deterministically. This replaces two queries (audit log, then events) with one.

### Venue scoping (review F07)

The join table is the source of truth; `events.venue_id` is a denormalised primary venue. Scope resolution becomes:

- If the event has any `event_venues` rows, its venue set is exactly those rows.
- If it has none, fall back to `events.venue_id`.

Verified against production: 0 live events have a primary venue missing from their links, and 18 have no links at all and need the fallback. So this loses nothing and closes the case where a stale legacy `venue_id` would show an event to a manager at an unrelated venue.

A user with no `venue_id` sees everything, unchanged.

### Presentation

- **Row detail:** `<date> · <all linked venue names> · <status label>`. Multi-venue events list every venue, so a manager included through a secondary link can see why the row is in their email (review F08). 10 live events are multi-venue.
- **Ordering:** newest first.
- **Counts:** filter, then count, then cap. The summary tile shows the **total** matching events; the list shows at most 20; the overflow line reports the difference. The tile and the "and N more" line therefore agree (review F09).
- **Status:** always a word from the shared label map, never colour alone.
- **Current state is authoritative.** The email shows the event's title, status and venues as they are at send time, not as they were at creation. An event created for one venue and later moved appears for the new venue's manager. There is no historical snapshot in the schema and building one is not in scope.

### Wording

| Today | New |
|---|---|
| Tile: "Recently approved" | "New events" |
| Heading: "Recently approved events" | "New events added" |
| Pill: "last 7 days" | "since your last update" |
| Empty: "No newly approved events for your scope." | "No new events added for your scope." |

Plain text mirrors the HTML, including the total, the overflow line and the status on every row.

### Provider error handling (review F10)

`resend.emails.send` resolves with `{ data, error }` and does **not** reject on a provider failure. The digest currently ignores this, counts the user as sent, advances the marker and moves on. Corrected: a response carrying `error`, or missing a message ID, counts as failed, leaves both cursors untouched so next Tuesday retries, and is logged with the provider message.

### Everything else unchanged

Tuesday guard, ISO-week idempotency, the SOP to-do section, the debrief section, and the audit row written at the end.

### Files

| File | Change |
|---|---|
| `supabase/migrations/…_weekly_digest_sent_at_cursor.sql` | Add `users.weekly_digest_last_sent_at`, backfill, column comment, claims table comment |
| `src/lib/notifications/select-new-events.ts` | **New.** Pure window, scoping, ordering, counting, capping and labelling |
| `src/lib/notifications.ts` | `sendMandatoryWeeklyUpdateEmail` rewritten around the helper; `renderWeeklyUpdateEmail` wording, total and overflow |
| `src/lib/notifications/__tests__/select-new-events.test.ts` | **New.** Boundary, status, venue and counting cases against real values |
| `src/lib/__tests__/weekly-digest.test.ts` | Replace approved fixtures, add cursor and provider-error cases |
| `docs/Runbooks/CronMonitoring.md` | Describe the Tuesday update and the right column to check |

## Acceptance matrix

| Journey | Immediate email | Next Tuesday section |
|---|---|---|
| Administrator creates and auto-approves an event | Creator decision email only when the actor is not the creator. Never an all-user broadcast. | Included |
| Manager creates and submits an event | Assignee review email only when the actor is not the assignee | Included |
| Administrator creates and approves their own event | **None** | Included |
| User saves a draft and stops | None | **Included**, labelled "Draft" |
| Proposal created (`pending_approval`) | Existing proposal flow unchanged | Included, labelled "Proposal awaiting approval" |
| Old draft first submitted this week | Targeted workflow email | **Not** included: selection is on `created_at`, and it was created earlier |
| Event created then rejected before Tuesday | No broadcast | **Excluded**, and not counted in the total |
| Event created then cancelled before Tuesday | No broadcast | Included, labelled "Cancelled" |
| Event created then soft-deleted before Tuesday | No broadcast | Excluded, and not counted in the total |
| Multi-venue event, recipient's venue is a secondary link | No broadcast | Included, row lists every linked venue |
| Event with no `event_venues` rows | No broadcast | Scoped by legacy `events.venue_id` |
| Recipient has no venue | Targeted only if creator or assignee | Sees every event |
| Recipient has no cursor (new joiner) | N/A | Last 14 days |
| Last Tuesday's send failed for one user | N/A | Their cursor did not advance, so they get both weeks next Tuesday, floored at 14 days |
| No send for three weeks | N/A | 14 days only. Older events are dropped by design. |
| Event created exactly at `windowStart` | N/A | Included (start inclusive) |
| Event created exactly at `runCutoff` | N/A | Excluded (cutoff exclusive), appears next week |
| 22 events in one week | N/A | Tile says 22, list shows 20, overflow line says "and 2 more" |
| Event renamed or moved venue before Tuesday | N/A | Shown with its current title and venues |
| Revert and republish the same event | Targeted email sends again: different `operationId`, so not a provider replay | No duplicate row: `created_at` is unchanged |
| Resend rejects a digest email | N/A | Counted as failed, cursor not advanced, retried next Tuesday |

## What is deliberately not in scope

- **Concurrency.** Two overlapping Tuesday invocations could both send. The cron fires once and the route is not exposed publicly, so this is an accepted risk rather than a fix. The correct wording is "sequential duplicate suppression", not "idempotency".
- **Same-week retry.** A user whose send fails waits until the next Tuesday. Wednesday to Friday cron calls still return immediately.
- **Resend delivery webhooks.** Provider acceptance is the success boundary. Bounces and complaints are not tracked.
- **A `created_at` index on `events`** (review F22). 142 rows. Revisit above roughly 50,000.
- **Per-row links to each event page** (review F28). The general "Open BaronsHub" button stays.
- **A feature flag for the broadcast removal** (review F29). Product has decided; a flag would be dead configuration.
- **Creation-time snapshots** (review F23). Current state is authoritative, stated above.
- **`sendWeeklyDigestEmail`** (`src/lib/notifications.ts:2546`) is dead code, referenced only by its own tests and no route. Removing it is separate housekeeping.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| People lose same-day notice of new events | Medium | This is the requested trade. The Tuesday email carries the same news within a week. |
| A bulk import floods one Tuesday email | Low | 20-item cap, accurate total, overflow line. Happened once, week of 2026-05-11. |
| Drafts confuse readers | Medium | Every row carries its status in words, taken from the same label map the application uses. |
| A missed run drops events older than 14 days | Low | Accepted by decision 3. The alternative is an unbounded first email. |
| Migration backfill is wrong for a user | Low | Backfill is derived from an existing date and only widens or narrows one window by hours. Worst case is one duplicated row in one email. |
| Rollback leaves gaps | Low | See Rollback below. Honest procedure rather than an "exact restore" claim. |

## Verification

**Pipeline:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx supabase db push --dry-run`.

**Unit tests, pure helper** (`select-new-events.test.ts`): window floor at 14 days; null cursor; cursor newer than the floor; `created_at` exactly at `windowStart` included and exactly at `runCutoff` excluded; every status included except `rejected`; soft-deleted excluded from list and total; join-first venue scoping with a stale legacy `venue_id`; legacy fallback when no links exist; multi-venue label; two users with different cursors from one shared row set; total versus shown versus overflow at 20, 21 and 22 rows; deterministic order on equal timestamps.

**Unit tests, orchestration** (`weekly-digest.test.ts`): the shared query uses the earliest window start; both cursors advance only on success; a Resend response carrying `error` counts as failed and leaves cursors untouched; a thrown send does the same; the audit row reports the real counts.

**Unit tests, new-event path**: planner returns nothing for a self-action; returns the creator message on `admin_publish`; returns the assignee message on `manager_submit`; the idempotency key includes `operationId`; a provider error is logged and not counted as sent; no claim row is written.

**Manual, staging preferred** (review F16). If production is used, it needs an owner and cleanup. Four journeys: administrator creates and publishes (creator gets nothing when self-created, one email when the creator is someone else), manager submits with a different assignee (assignee gets one email), draft saved only (no email at all), and a mailbox check confirming no fan-out to the other 16 users.

**Post deploy** (review F18): structured logs carry transition, message kind, provider acceptance and any error for the new-event path; and eligible, sent, failed, window bounds and matched/shown/overflow totals for the digest. Watch the first Tuesday send, then check one venue-scoped and one global recipient's email against the database.

## Rollback

Both code changes revert cleanly. The migration is additive: an unused column and two comments, so it does not need reverting and a rolled-back deployment ignores it.

Rollback does **not** restore the old behaviour exactly (review F17). Events that first publish while the new code is live write no claim row. If one of those is later reverted to draft and republished after a rollback, the old code will broadcast it, even though the Tuesday email already covered it. If a rollback happens, record the deployment window and decide whether to insert claim rows for events transitioned inside it before redeploying the old code.
