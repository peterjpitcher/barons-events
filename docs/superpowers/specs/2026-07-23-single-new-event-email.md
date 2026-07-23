# One Email Per New Event: Discovery and Fix Specification

**Date:** 2026-07-23
**Revision:** 2 (supersedes revision 1; rewritten after external review and product decisions)
**Reported problem:** "We should only be sending one email out to users when a new event is added, right now there are multiple."
**Status:** Ready for implementation. All product decisions answered.
**Complexity:** 3 (M), roughly 300 lines of meaningful change, one PR.

## Change log for revision 2

Revision 1 was reviewed (`2026-07-23-single-new-event-email-review.md`) and marked not ready, with eight P0 findings. Product decisions have also since been answered. Four things changed materially:

1. **The wide audience is correct, not a bug.** Product confirmed the announcement should reach every application user. Revision 1's "Phase 2: scope the audience" is deleted. The venue filter is removed instead, because it wrongly *excludes* single-venue managers from other venues' events.
2. **The publisher should receive the announcement.** Revision 1 proposed excluding them. Product said no, include them. The message to drop is therefore the redundant *targeted* email when someone approves their own event.
3. **Notification state moves off `public.events` to its own table.** Revision 1's `events.announced_at` column would have failed to deploy. See "The blocker revision 1 missed" below.
4. **Claim, plan, batch, `after()`.** The design is now a pure planner plus a single claim row plus one batched send dispatched via `after()`, instead of three scattered fire-and-forget calls.

## Summary

There is no single bug. Two things were confused in revision 1, and only one of them is real.

**The real problem is overlap.** One click produces two different emails to the same person. An administrator who creates and publishes their own event receives "Update on your event" (because they are the creator) and "New event coming soon" (because they are a user), seconds apart. That is the "multiple emails" being reported.

**The wide audience is not a problem.** 18 of 19 users receive every announcement, which looked like a fault. Product has confirmed this is intended: the announcement is for all application users. In fact the existing filter is subtly wrong in the *other* direction, and that is fixed here.

Separately, there is a latent bug worth closing while we are in the file: the announcement keeps no record of having been sent, so reverting an event to draft and republishing re-broadcasts to everyone, with no limit.

## Product decisions (answered 2026-07-23)

| # | Question | Answer | Consequence |
|---|---|---|---|
| 1 | Who receives the announcement? | All users of the application. Staff users, not customers. | Audience rule is "every active user with an email". The `venue_id` filter is deleted. |
| 2 | Should the publisher receive the announcement for their own event? | Yes. | The actor is *included* in the broadcast. Their self-directed targeted email is dropped instead. |
| 3 | Is the manager submit-for-review flow meant to be used? | Yes, it needs to be used but is not yet. | The assignee overlap stays in scope even though it has never fired in production. |
| 4 | What does `venue_id` mean on a user? | Set means the manager works at that one venue only. Null means they work across multiple or all venues. | The data is correct as it stands. No data cleanup task. |

Answer 4 is why the current filter is wrong. `!user.venue_id || venueIds.has(user.venue_id)` reads as "include venue-less users always, and venue-tied users only for their own venue". Under answer 1 every user should be included, so the single-venue manager is currently being wrongly excluded from other venues' announcements.

## Evidence

Read from the production database (project `shofawaztmdxytukhozo`, read-only aggregates, no personal data) on 2026-07-23. The exact queries are in the appendix so this is reproducible.

| Metric | Result |
|---|---|
| Active users with an email | 19 |
| Active users with `venue_id IS NULL` | 18 |
| Administrators with `venue_id IS NULL` | 5 of 5 |
| `audit_log` rows for `action='event.submitted'` | 0 |
| `audit_log` admin auto-approvals from `draft` | 94, latest 2026-07-22 |
| `event_save_idempotency` rows | 0 |
| Venues with `default_approver_id` set | 0 of 13 |
| Events by status | approved 50, completed 45, rejected 23, draft 13, `approved_pending_details` 2, cancelled 2 |

Two caveats on how strongly this reads, per review finding F19. `recordAuditLogEntry` swallows insert errors, so zero `event.submitted` rows is strong evidence that the manager submit flow has no record of running, not absolute proof that nobody ever attempted it. And database rows prove application state, not that Resend accepted or delivered anything.

The zero `event_save_idempotency` count is the load-bearing one: both save RPCs write a row on success, so an empty table after 169 draft saves is strong evidence that `EVENT_SAVE_USE_RPC` is off in production and the RPC branches have never executed.

## Root causes

Ranked by production impact. Each was confirmed against source and survived an adversarial refutation pass.

### RC1. Administrator publish sends the acting admin two emails from one click

**This is the live problem, and the 94-row path.**

```ts
// src/actions/events.ts:1840-1843
await sendReviewDecisionEmail(targetEventId, "approved");   // to event.creator.email
if (existingEvent.status === "draft") {
  void sendNewEventAnnouncementEmail(targetEventId);        // to all 18 venue-less users
}
```

When an administrator creates and publishes their own event they are the creator *and* a user. Nothing excludes them from the broadcast, and nothing notices they have just been sent a targeted message. The `existingEvent.status === "draft"` guard passes because `existingEvent` is a snapshot read at [events.ts:1758](src/actions/events.ts:1758), before `autoApproveEvent` mutates the row.

**Impact:** 2 emails to the acting administrator, "Update on your event: X" and "New event coming soon: X".

### RC2. The announcement has no sent-marker, so republishing re-blasts everyone

`sendNewEventAnnouncementEmail` ([notifications.ts:1445-1508](src/lib/notifications.ts:1445)) has no idempotency claim and no send ledger, unlike the proposal email which claims a row before sending ([notifications.ts:1359](src/lib/notifications.ts:1359)). Its only protection is a pre-write status read, and `revertToDraftAction` ([events.ts:3343](src/actions/events.ts:3343)) writes the status back to `draft`, re-arming every guard.

**Impact:** one further full broadcast per revert-and-republish cycle, unbounded.

A needs-revisions resubmit does *not* re-announce, because the guard is `draft`, not `draft|needs_revisions`.

### RC3. Provider failures are invisible and counted as success

Verified in the installed SDK: `resend@6.12.2` types `send` as returning `Response<T> = ({data, error: null} | {error, data: null})` ([node_modules/resend/dist/index.d.mts:117-125](node_modules/resend/dist/index.d.mts)). It **resolves** on provider error rather than rejecting. The current code discards every response and wraps the fan-out in `Promise.allSettled` ([notifications.ts:1478-1489](src/lib/notifications.ts:1478)), so a rejected send is recorded as a fulfilled promise and silently dropped.

Compounding it: 18 simultaneous individual sends against Resend's default 2-per-second rate limit, with every throttling rejection discarded.

**Impact:** we cannot currently tell how many emails actually went out. Nothing logs a successful send; the message id is thrown away.

### RC4. Fire-and-forget sends are dropped on serverless freeze

All three announcement calls use bare `void`. On Vercel an un-awaited promise is dropped when the invocation freezes. This repo has already diagnosed and fixed exactly this, at [src/app/[code]/route.ts:114-120](src/app/[code]/route.ts:114) with a test at [route.test.ts:179-184](src/app/[code]/route.test.ts:179). The notification path never got the same treatment.

### RC5. Concurrent publishes both pass the stale guard

Status is read at [events.ts:1758](src/actions/events.ts:1758) and the update at [events.ts:1891](src/actions/events.ts:1891) carries no status predicate. Two overlapping requests both read `draft`, both succeed, both announce. Same-tab double-clicks are blocked by `disabled={isPending}` in [floating-action-bar.tsx:35](src/components/events/floating-action-bar.tsx:35), so this needs two tabs, two devices, or a retried POST.

### RC6. Create-then-submit double-click can create two event rows

The create flow always takes the legacy path ([events.ts:1400](src/actions/events.ts:1400) requires `rawEventId`) and never reads the idempotency key: `readIdempotencyKey` is only called inside the two RPC branches. `createEventDraft` ([events.ts:1659](src/actions/events.ts:1659)) mints a fresh uuid per request. `disabled={isPending}` only engages after a React re-render, so the window is one render frame wide.

**This design does not close RC6.** Two rows are two ids, so two claims, so two broadcasts. See "What this does not solve".

### RC7. Assignee overlap (never fired, but in scope per decision 3)

[events.ts:1936](src/actions/events.ts:1936) awaits `sendEventSubmittedEmail` to the assignee, then [events.ts:1938](src/actions/events.ts:1938) fires the announcement, which includes the assignee. The assignee is always an administrator: [reviewers.ts:20-23](src/lib/reviewers.ts:20) lists administrators only, all 13 venues have no `default_approver_id`, so `resolveAssignee` falls through to the first administrator by name.

### Struck from revision 1: the central events lead "duplicate"

Revision 1 listed the lead receiving a proposal email and later an announcement as a defect. It is not. They are different lifecycle points, days apart, with different subjects and different calls to action. Removed from scope.

## The blocker revision 1 missed

Revision 1 proposed `alter table public.events add column announced_at` plus a backfill `UPDATE`. **That backfill would have failed to deploy.**

`events_require_admin_or_service_write` ([20260604150000_baronshub_rbac_read_all_admin_writes.sql:52-80](supabase/migrations/20260604150000_baronshub_rbac_read_all_admin_writes.sql)) rejects any write to `public.events` unless the caller is service-role or an administrator. Under `npx supabase db push` there is no JWT, so `auth.role()` is null and `current_user_role()` returns null. Neither branch is taken and the function reaches `raise exception 'Only administrators can create or edit events'` at line 72. No migration since that trigger landed performs a data `UPDATE` on `public.events`, so there is no precedent suggesting otherwise.

A second, quieter problem: `trg_events_updated` ([initial_mvp.sql:161-162](supabase/migrations/20250218000000_initial_mvp.sql)) sets `updated_at` on every update, and [dashboard.ts:810-811](src/lib/dashboard.ts:810) counts `approvedThisWeek` as approved events with `updated_at >= weekStart`. The backfill would have inflated that dashboard tile for a week.

Both dissolve by putting notification state in its own table rather than on `public.events`. That is the structural decision below.

## Design

### Principle

Each person receives **exactly one** email per event per transition. Where someone qualifies for more than one message, priority decides which:

1. **Assignee** gets "New event ready for review". Most actionable, wins outright.
2. **Creator, when the creator is not the actor**, gets "Update on your event".
3. **Everyone else, including the actor**, gets "New event coming soon".

Rule 2's exception is decision 2 in action. Telling you that your own event was approved, when you are the person who approved it, is noise. The actor drops that self-directed message and receives the broadcast like everybody else.

### Shape

Three parts, each independently testable.

| Part | Location | Nature |
|---|---|---|
| `planNewEventNotifications(input)` | `src/lib/notifications/plan-new-event.ts` (new) | Pure. No I/O, no `Date`, no Supabase import. Decides the one message each normalised inbox gets. Unit-tests with zero mocks. |
| `notifyNewEvent(params)` | `src/lib/notifications.ts` | Gathers context, calls the planner, takes the claim, sends one Resend batch, writes one JSON log line, releases the claim on total failure. |
| The claim | new table `public.event_notification_claims` | At-most-once barrier, keyed `(event_id, transition_key)`. |

### Why a claim table and not a column on `events`

This dissolves the deploy blocker rather than working around it:

- No `UPDATE public.events` in the migration, so `events_require_admin_or_service_write` is never invoked and the push succeeds.
- `trg_events_updated` never fires, so the 94 historical rows do not land in the `approvedThisWeek` window.
- No new column on `events`, so `to_jsonb(e.*)` at [20260507132000_return_event_rpc_updated_at.sql:476](supabase/migrations/20260507132000_return_event_rpc_updated_at.sql), `%rowtype` selects, and `select *` at [notifications.ts:1189](src/lib/notifications.ts:1189) are all unchanged.
- A claim is a fact about a notification, not about an event.

Cost is one extra round trip, which the column approach also needed. Net zero.

This is the sixth instance of a pattern the repo already uses, not a new subsystem: claim-before-send with a compensating release appears at [sms.ts:180-219](src/lib/sms.ts:180), [notifications.ts:1297-1341](src/lib/notifications.ts:1297), and three migrations.

### Migration

`supabase/migrations/20260723120000_event_notification_claims.sql`

```sql
create table if not exists public.event_notification_claims (
  event_id       uuid        not null references public.events(id) on delete cascade,
  transition_key text        not null,
  claimed_at     timestamptz not null default timezone('utc', now()),
  claimed_by     uuid        references public.users(id) on delete set null,
  planned_count  integer     not null default 0,
  primary key (event_id, transition_key)
);

comment on table public.event_notification_claims is
  'At-most-once barrier for the new-event announcement broadcast. A row means the broadcast for (event_id, transition_key) has been dispatched. Deleting a row re-arms the send.';

alter table public.event_notification_claims enable row level security;

drop policy if exists "event_notification_claims_admin_select" on public.event_notification_claims;
create policy "event_notification_claims_admin_select"
  on public.event_notification_claims
  for select to authenticated
  using (public.current_user_role() = 'administrator');

-- No INSERT/UPDATE/DELETE policies. All writes go through createSupabaseAdminClient()
-- (src/lib/supabase/admin.ts:11-22), which is service-role and bypasses RLS.
```

### Backfill and the status truth table

Revision 1 used `status <> 'draft'`, which is wrong in both directions. There are 2 live `approved_pending_details` rows it would have permanently silenced. Use an explicit list:

```sql
insert into public.event_notification_claims (event_id, transition_key, claimed_at, claimed_by, planned_count)
select e.id, 'new_event', coalesce(e.submitted_at, e.created_at, timezone('utc', now())), null, 0
from public.events e
where e.status in ('submitted', 'needs_revisions', 'approved', 'cancelled', 'completed')
on conflict (event_id, transition_key) do nothing;

notify pgrst, 'reload schema';
```

| Status | Claim as sent? | Why |
|---|---|---|
| `pending_approval` | **No** | Proposals are created here. The announcement fires only on `draft -> submitted/approved`, so these have never been announced. Claiming them would permanently suppress their first real announcement. |
| `approved_pending_details` | **No** | Set by `pre_approve_event_proposal`, then moved to `draft`, then published. Never announced yet. 2 live rows. |
| `draft` | **No** | Never published: correctly unclaimed. Previously announced then reverted: produces one further broadcast, accepted and bounded at one. |
| `submitted` | **Yes** | Reachable only through the announcing transition. |
| `needs_revisions` | **Yes** | Reached from `submitted`, so already announced. |
| `approved` | **Yes** | The 94 auto-approvals live here. |
| `rejected` | **No** | Ambiguous. A proposal can be rejected straight from `pending_approval` having never been announced, and `rejected` is revertible. |
| `cancelled` | **Yes** | Reachable only from a published state. |
| `completed` | **Yes** | Terminal state of a published event. |

Volume: 94 rows, milliseconds.

**Residual risk, accepted:** an event announced before this deploy and then reverted to `draft` will produce exactly one further broadcast on its next publish. Bounded at one, because the claim then sticks.

**Rejected alternative:** an audit-log-driven backfill would catch that case, but `recordAuditLogEntry` swallows insert errors so the audit log is not a reliable source of truth, and the payoff is suppressing at most one email.

### The planner

```ts
export type NewEventTransition = "admin_publish" | "manager_submit";

export type PlannedMessageKind = "review_decision" | "submitted_for_review" | "announcement";

export function planNewEventNotifications(
  input: PlanNewEventNotificationsInput
): NewEventNotificationPlan;
```

Algorithm:

1. `normalise = (e) => e.trim().toLowerCase()`. Drop empty. This one key is used for **both** exclusion and deduplication. Revision 1 excluded by user id and deduplicated by email, which are different identities (review finding F10).
2. Resolve `actorEmailKey` from `activeUsers` by `userId`.
3. Plan the targeted message first, so it owns its email key:
   - `admin_publish` with a creator: plan `review_decision`, **unless the creator's key equals `actorEmailKey`**, in which case plan nothing. This is decision 2.
   - `manager_submit` with an assignee: plan `submitted_for_review`. Not suppressed for the actor, because the assignee is by definition someone else.
4. `requiresClaim = isFirstPublish`. If false, stop here. A needs-revisions resubmit behaves exactly as today.
5. Audience is every active user with an email. No venue filter (decision 1).
6. Walk the audience in order. Key already in the map means a targeted message already owns this inbox: record as suppressed. Otherwise plan `announcement`.

One message per inbox holds by construction, because targeted messages populate the map before the announcement loop runs.

### The orchestrator

`notifyNewEvent` gathers context, plans, claims, and sends. Four properties that matter:

- **Never claim when email is disabled or unconfigured.** Return before touching the table, otherwise turning email on later finds every event already claimed.
- **The claim gates the announcement only, never the targeted email.** A targeted message is a per-transition confirmation and must survive a pre-existing claim. Without this, on a revert-and-republish the creator would silently lose their confirmation.
- **One `resend.batch.send` call, not 18 individual sends.** Verified available: `Batch.send` at [index.d.mts:1500](node_modules/resend/dist/index.d.mts), `idempotencyKey` at `:172-178`, limit 100 per request. This fixes the rate-limit exposure in RC3 and makes the logging tractable. Pass a deterministic `idempotencyKey` as a second layer under the claim row.
- **Inspect `{ data, error }` on the response.** Do not treat a resolved promise as success (RC3). Release the claim only when **zero** messages were accepted; partial success keeps it, so a retry cannot duplicate.

Log one structured line per dispatch with `{ eventId, transition, planned, accepted, failed, suppressed }`. Nothing currently logs a successful send, which is why this problem needed the Resend dashboard to diagnose.

### Call-site changes

All three sites are in `submitEventForReviewAction`. Replace `void send...` with `after(() => notifyNewEvent({...}))`.

| Line | Transition | `isFirstPublish` |
|---|---|---|
| [events.ts:1434](src/actions/events.ts:1434) (RPC branch) | `admin_publish` | `preSubmitContext?.status === "draft"` |
| [events.ts:1840-1843](src/actions/events.ts:1840) (admin branch) | `admin_publish` | `existingEvent.status === "draft"` |
| [events.ts:1936-1939](src/actions/events.ts:1936) (manager branch) | `manager_submit` | `statusBefore === "draft"` |

[events.ts:2108](src/actions/events.ts:2108), `sendReviewDecisionEmail` inside `reviewerDecisionAction`, is **unchanged**. It is a different lifecycle event and never announces, so it keeps its own path. That also means a planner bug cannot swallow it.

`after()` rather than `await`: `await` would put the fan-out on the publish critical path and break the project rule "never await email sends in critical paths". `after()` fixes RC4 without that cost, and is already this repo's shipped idiom.

**Must be proven by test, not assumed:** that `after()` callbacks registered before `redirect(redirectUrl)` on the create-then-submit path still run.

Also delete `sendEventSubmittedEmail` and `sendNewEventAnnouncementEmail`, extracting their template builders. Five test files mock those two names and need updating: `reschedule-event.test.ts`, `cancel-event.test.ts`, `events-edit-rbac.test.ts`, `events-rpc.test.ts`, `events-operation-id.test.ts`.

### Environment precondition

Set `.env.local.docker:14` to `EVENT_SAVE_USE_RPC=false` so local matches production. Currently local is `true` and production is off, which means RC1 is not reproducible on a developer machine.

## Review findings: accepted and rejected

| ID | Verdict | Reasoning |
|---|---|---|
| F02 (claim does not close RC5/RC6) | **Accepted** | Correct. Two event rows are two ids, so two claims. Revision 1 overclaimed. Now listed under "does not solve". |
| F03 (targeted emails unguarded) | **Accepted, modified** | Correct that they are unguarded. Taking the small conditional-write adjunct; rejecting the ledger. |
| F04 (`updated_at` and triggers) | **Accepted, modified** | The buried migration blocker is the single highest-value item in the review. Sidestepped entirely by not writing to `events`. Outbox remedy rejected. |
| F05 (claim-before-send loses mail) | **Accepted, modified** | Loss mechanism is real. Taking claim plus `{data, error}` inspection plus release-on-total-failure. Rejecting per-recipient rows, attempt counters, backoff and replay tooling. |
| F06 (awaiting the fan-out) | **Accepted, modified** | Correct that `await` is wrong. A durable queue is not the answer; `after()` is this repo's own tested idiom for exactly this failure. |
| F07 (Phase 1 leaves fan-out live) | **Superseded** | Product decision 1 makes the wide audience correct. The finding was reasonable given revision 1's framing. |
| F08 (`status <> 'draft'` backfill) | **Accepted** | Simply right, and empirically confirmed: 2 live `approved_pending_details` rows would have been silenced. Fixed with the explicit truth table. |
| F09 (senders return `void`) | **Accepted** | Correct and load-bearing. Resolved by deletion: the planner replaces both. |
| F10 (id versus email identity) | **Accepted, modified** | A DB-level duplicate cannot currently exist, but using one key for both costs nothing and removes a confusion class. Rejecting a `citext` migration. |
| F11 (proposal email is not a duplicate) | **Accepted** | Correct. Different lifecycle points. Struck from scope. |
| F16 (RPC divergence) | **Accepted** | Correct that it cannot be waved off. Fixed by routing both branches through `notifyNewEvent` and setting the local flag to false. Rejecting "repair the RPC path now". |
| F17 (Resend resolves on error) | **Accepted** | Simply right, verified in the shipped SDK. Highest-value reliability item. |
| F19 (evidence overstated) | **Accepted, modified** | Softened "has never run" to "has no record of running". Queries pasted in the appendix. Rejecting the four-tier delivery taxonomy. |
| F22 (schema ripple) | **Rejected** | Moot. No column is added to `events`. |
| F25 (caps and concurrency) | **Accepted, modified** | The concurrency half is a live bug: 18 simultaneous sends against a 2/sec limit with rejections discarded. Fixed by batch send. Rejecting audience caps and future-volume tests. |
| F26 (accessibility criteria) | **Rejected** | Moot. No preference UI is built. |
| F29 (batch sending) | **Accepted, re-prioritised** | Right, and mis-prioritised at P3. It is a correctness fix that makes the code smaller. Moved into the main PR. |
| F23 / per-recipient delivery rows | **Rejected** | Over-engineering. Roughly 6,500 messages a year; the failure mode is a colleague missing a heads-up about something already visible in the app. |

Where the reviewer was simply right and it changed the design: F04, F08, F17, F09, F11.

## What this does not solve

Listed honestly rather than glossed.

1. **Delivery guarantees.** At-most-once per event, best-effort per recipient, provider acceptance counts as success. No retry, no backoff, no ledger. Manual recovery is one statement:
   ```sql
   delete from public.event_notification_claims
   where event_id = '<uuid>' and transition_key = 'new_event';
   ```
   Escalation if loss is ever actually reported: a cron sweeper following [reconcile-event-images/route.ts:19-50](src/app/api/cron/reconcile-event-images/route.ts), not a queue.
2. **Inbox delivery.** Resend accepting a message is not a person receiving it. No webhook consumer is built.
3. **RC6, duplicate event rows.** Two rows are two claims, so two broadcasts. Recommended small adjunct: a synchronous `useRef` latch in the submit handler at [event-form.tsx:774-776](src/components/events/event-form.tsx:774), because `disabled={isPending}` only engages after a re-render. Park database-level create idempotency until a duplicate is actually observed.
4. **RC5's data half.** Two concurrent publishes still create two approval rows, two audit rows and two event versions. Recommended small adjunct: thread `previousStatus` as an extra `.eq("status", ...)` predicate through `updateEventWithFallback` ([events.ts:612-645](src/actions/events.ts:612), which already threads an optional extra `.eq()`), and skip audit, versions and notification when zero rows change. Only the email half of RC5 is closed without it.
5. **Enqueue durability.** `after()` runs post-commit. A crash between commit and dispatch loses the announcement with no record.
6. **`EVENT_SAVE_USE_RPC` being enabled.** The flag stays off in this work. The role-check repair below is a precondition for ever turning it on, but flipping the flag is a separate decision with its own testing.
7. **The same F17 bug in the digest loops.** `failed++` at [notifications.ts:2306-2309](src/lib/notifications.ts:2306) and `:2676-2679` is permanently zero for provider failures. Separate ticket.

## Addendum: the retired `office_worker` role check

Added 2026-07-23 following product decision 3 ("the manager submit flow needs to be used but isn't yet"). This is **a separate concern from the email fix** and ships as its own migration and commit.

### What is wrong

Migration `20260605143000_retire_executive_rename_manager_role.sql` renamed `office_worker` to `manager` and tightened the constraint to `check (role in ('administrator', 'manager'))`. No user row can hold `office_worker` any more. But **five live database functions still authorise against that value**, and all five read the raw `u.role` column rather than the normalising `current_user_role()` helper.

Verified against the live database (`shofawaztmdxytukhozo`) by reading `pg_proc.prosrc`:

| Function | Line | Effect on a manager |
|---|---|---|
| `enforce_event_status_transitions` | 39 | **Live bug today.** Denies proposal completion. |
| `submit_event_for_review` | 41, 64 | Rejects. Dormant, flag-gated. |
| `save_event_draft` | 91, 106 | Rejects. Dormant, flag-gated. |
| `propose_event_draft` | 36, 81 | Rejects. Dormant, flag-gated. |
| `create_multi_venue_event_drafts` | 40, 43, 51 | Rejects. Dormant, flag-gated. |

Three further functions mention `office_worker` but **normalise** it (`when role = 'office_worker' then 'manager'`) and are therefore harmless: `current_user_role`, `create_multi_venue_event_proposals`, `create_multi_venue_planning_items`. They are left alone.

### The live one

`enforce_event_status_transitions` is a trigger, so it runs on every event status change regardless of `EVENT_SAVE_USE_RPC`. On the `approved_pending_details -> draft` transition (a manager completing an approved proposal):

- line 16, administrators return early
- line 19, service role returns early
- line 29, the creator returns early
- line 39, `if v_user_role = 'office_worker' and v_user_venue = new.venue_id then return new`
- line 43, everyone else raises

A manager who is not the creator can never match line 39, so they hit the exception. **A manager cannot complete a proposal created by someone else, even at their own venue.** There are 2 events sitting in `approved_pending_details` in production. This is the most likely reason the submit flow is not yet in use.

### The fix

Replace the literal `'office_worker'` with `'manager'` in the five authorising functions, preserving every other line of their logic. `create_or_replace` each one; no signature changes, so no grants change and no dependent objects break.

The venue-scoping semantics need one deliberate change, because `venue_id` means something different now (product decision 4: set means single-venue, null means works across all venues). The existing checks read:

```sql
-- create_multi_venue_event_drafts:43
if v_user_role = 'office_worker' and v_user_venue is null then
  raise exception 'Office workers without a venue assignment cannot create events';
```

Under decision 4 a null `venue_id` means "works across multiple or all venues", so that exception is now backwards: it rejects exactly the managers with the broadest remit. It is removed. The per-venue check at line 51 keeps its shape but only bites when the manager actually has a venue:

```sql
if v_user_role = 'manager' and v_user_venue is not null and v_user_venue != v_venue_id then
  raise exception 'Manager % cannot manage venue %', v_created_by, v_venue_id;
end if;
```

`save_event_draft:106` and `submit_event_for_review:64` already have this shape (`v_user_venue is null or v_user_venue = e.venue_id`) and need only the role literal changed.

Error message wording moves from "Office worker" to "Manager" throughout.

### Scope boundary

This addendum repairs authorisation only. It does not turn `EVENT_SAVE_USE_RPC` on, and it does not change what the RPC path does about email (the RPC branch still never calls `sendEventSubmittedEmail`; that is handled by routing both branches through `notifyNewEvent` in the main change).

## Testing

| Layer | Test |
|---|---|
| Planner (pure) | Actor who is also creator gets the announcement, not the decision email |
| Planner | Creator who is not the actor gets the decision email, not the announcement |
| Planner | Assignee gets the review email, not the announcement |
| Planner | Every active user is in the audience regardless of `venue_id` |
| Planner | Property test: no duplicate `emailKey` across 200 randomised inputs |
| Orchestrator | `resend.batch.send` **resolves** `{ data: null, error }` and the claim is released |
| Orchestrator | Partial success keeps the claim |
| Orchestrator | A lost claim still sends the targeted message |
| Orchestrator | No claim is taken when operational email is disabled |
| Integration | Admin create-and-publish produces exactly one email to the acting admin |
| Integration | Revert to draft then republish sends no second announcement |
| Integration | `after()` callback runs after the action returns, including on the `redirect()` path (copy the mock at [route.test.ts:8-20](src/app/[code]/route.test.ts:8)) |
| Migration | Backfill claims exactly the five listed statuses, against a real database |

Pipeline before push: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx supabase db push --dry-run`, `npm run advisors`.

## Rollout

1. Migration first, then code. The code reads a table that must already exist.
2. Deploy. Volume goes from 19 outbound per event to 18, and the acting administrator goes from 2 emails to 1.
3. Verify in Resend: publish one test event, confirm the acting administrator receives exactly one message, then revert and republish and confirm no second broadcast.

**Rollback:** revert the commit. The table can stay; a stale claim only suppresses announcements, it never causes extra mail. Note that reverting the code restores the old duplicate behaviour immediately, so rollback is a decision to accept the original problem, not a neutral act.

## Expected volume

| | Outbound per event | Acting admin receives |
|---|---|---|
| Today | 19 (1 decision + 18 announcements) | 2 |
| After this change | 18 | 1 |

The absolute volume barely moves, because decision 1 confirms the broad audience is wanted. What changes is that **no individual receives two emails for one event**, which is the reported complaint.

## Appendix: verification queries

Run against project `shofawaztmdxytukhozo`. Read-only aggregates, no personal data.

```sql
select 'active_users_total' as metric, count(*)::text as value
  from public.users where deactivated_at is null and email is not null
union all select 'active_users_no_venue', count(*)::text
  from public.users where deactivated_at is null and email is not null and venue_id is null
union all select 'admins_no_venue', count(*)::text
  from public.users where deactivated_at is null and role='administrator' and venue_id is null
union all select 'audit_event_submitted', count(*)::text
  from public.audit_log where action='event.submitted'
union all select 'audit_autoapproved_from_draft', count(*)::text
  from public.audit_log where action='event.status_changed'
   and meta->>'autoApproved'='true' and meta->>'previousStatus'='draft'
union all select 'event_save_idempotency_rows', count(*)::text
  from public.event_save_idempotency
union all select 'venues_with_default_approver', count(*)::text
  from public.venues where default_approver_id is not null;

select status, count(*) as rows, count(*) filter (where deleted_at is not null) as soft_deleted
from public.events group by status order by rows desc;
```
