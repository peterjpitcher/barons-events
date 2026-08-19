# Event Email Changes: Developer Specification Review

**Specification reviewed:** `2026-08-19-event-email-changes-scope.md`  
**Review date:** 2026-08-19  
**Repository baseline:** `main` at `1e1368668d76332577306ccb7412f2060e3bad01`  
**Review scope:** Product clarity, functional behaviour, data, integrations, security, reliability, performance, accessibility, testing, monitoring, migration, deployment, rollback, and delivery  
**Source specification changed:** No

## Overall assessment

**Readiness: Not ready for implementation.**

The direction is sensible: remove the broad announcement, retain the two targeted workflow messages, and replace the non-working approved-events section with a useful direct event query. The proposed cap, plain-text status, soft-delete filter, and preservation of the existing Tuesday email structure are also reasonable.

Implementation should not start from this document yet. Three matters block a testable build:

1. The specification says three product decisions are listed at the end, but the decision section is missing. The risk table refers to “decision 2 below,” which does not exist.
2. “Created event” is not defined across the event lifecycle. The current announcement fires on first publication or submission, while the replacement query includes every non-deleted row from `created_at`, including drafts and proposals. The replacement therefore does not necessarily carry “the same news” at a weekly cadence.
3. Exact “since your last email” behaviour cannot be implemented with `users.weekly_digest_last_sent_on`, because it stores only a date. Starting at midnight repeats events created between midnight and the prior send; starting the following day loses events created after the prior send. A timestamp or explicit high-water cursor is required for exact semantics.

The stated **S / one-PR / no-migration** delivery is realistic only if the product accepts approximate date-based wording and its duplicate/omission behaviour. If the stated “since your last email” contract is retained, the work needs a small data migration and stronger idempotency/error-handling design, making the current estimate premature.

## Classification

- **Confirmed issue:** A contradiction, omission, incorrect claim, or implementation incompatibility confirmed against the current repository.
- **Optional improvement:** Not essential to the minimum product change, but improves simplicity, safety, supportability, or future scale.
- **P0:** Blocking decision or correction required before implementation.
- **P1:** Required in the specification before merge approval.
- **P2:** Required before production release, or explicitly accepted as a known limitation.
- **P3:** Optional improvement.

## Unconfirmed assumptions

| Assumption | Why it needs confirmation | Related finding |
|---|---|---|
| “Created” means every event row, regardless of status | The current broadcast occurs on a later lifecycle transition, not on raw row creation. | F02, F03 |
| Drafts, proposals, rejected, cancelled, and completed events belong in the weekly section | The query excludes only soft-deleted rows, while the missing decision section apparently contained a draft decision. | F03 |
| A date-only marker is close enough to “since your last email” | It repeats or omits same-day events and is especially visible because the cron runs hours after midnight. | F04 |
| Losing events older than 14 days after a long outage is acceptable | The clamp intentionally drops older unseen events without telling the recipient. | F06 |
| New and reactivated users should receive up to 14 days of history | No first-send or reactivation journey is specified. | F06 |
| Event title, status, date, and venue should reflect current state at send time | The query has no historical snapshot of what was true when the event was created. | F23 |
| Current venue membership determines the recipient’s scope | Venue links can change between creation and email delivery. | F07, F23 |
| Provider acceptance is sufficient to count an email as sent | Delivery, bounce, and complaint outcomes are not stored or considered. | F10, F18 |
| A targeted message should be sent for every legitimate repeat transition | The retained provider idempotency key can merge repeat transitions. | F13 |
| `event_notification_claims` rows prove broadcasts were sent | The migration backfilled rows with `planned_count = 0`, and the table does not store provider delivery. | F15 |
| Production volume and user scope will remain near the sampled values | There is no capacity threshold or query plan evidence. | F22 |
| Creating an event directly in production is an approved smoke-test action | The proposed manual check has no owner, recipient isolation, cleanup, or exact transition. | F16 |

## Repository evidence reviewed

- `src/lib/notifications.ts`: weekly renderer, mandatory digest query and send loop, Resend response handling, new-event planner orchestration, claims, and logging.
- `src/lib/notifications/plan-new-event.ts`: message selection, self-suppression, normalized inbox deduplication, and announcement planning.
- `src/actions/events.ts`: all three `notifyNewEvent` call sites and the first-publish calculation.
- `src/app/api/cron/weekly-digest/route.ts` and `vercel.json`: cron authentication, logging, schedule, and Tuesday guard.
- `supabase/migrations/20260604113000_baronshub_safe_user_preferences.sql`: date-only weekly digest marker.
- `supabase/migrations/20260723120000_event_notification_claims.sql`: claim schema and historical backfill.
- `supabase/migrations/20260418120000_event_and_planning_venues.sql`: join-table source-of-truth rule for multi-venue events.
- `src/lib/types.ts` and `src/lib/dashboard.ts`: complete event status set and existing human-readable status labels.
- `src/lib/__tests__/weekly-digest.test.ts`, `src/lib/__tests__/notify-new-event.test.ts`, `src/lib/notifications/__tests__/plan-new-event.test.ts`, and `src/actions/__tests__/notify-new-event-after.test.ts`: present test coverage and mock behaviour.
- `docs/Runbooks/CronMonitoring.md`: current operational instructions for the route.
- Installed Resend 6.12.2 definitions and existing tests: email APIs return `{ data, error }`; provider failures do not have to reject the promise.

The four directly relevant test files were run unchanged during this review: **51 tests passed**.

## Findings index

| ID | Title | Status | Priority | Type |
|---|---|---|---|---|
| F01 | The three stated product decisions are missing | Confirmed issue | P0 | Product / Specification completeness |
| F02 | “Created” and “first published” are different event boundaries | Confirmed issue | P0 | Functional / Scope |
| F03 | The included event statuses are undefined | Confirmed issue | P0 | Product / Functional |
| F04 | A date-only field cannot provide “since your last email” semantics | Confirmed issue | P0 | Data / Functional |
| F05 | The per-user window and one-query design are underspecified | Confirmed issue | P1 | Technical / Data |
| F06 | The 14-day clamp and first-send journeys need explicit rules | Confirmed issue | P1 | Product / Data retention |
| F07 | Venue scoping conflicts with the project’s join-first rule | Confirmed issue | P1 | Security / Authorization |
| F08 | Multi-venue rows can display the wrong venue to the recipient | Confirmed issue | P1 | Functional / Data presentation |
| F09 | Ordering, counts, status labels, and overflow semantics are incomplete | Confirmed issue | P1 | Functional / Accessibility |
| F10 | Resend errors can be counted as successful digest sends | Confirmed issue | P1 | Integration / Error handling |
| F11 | The stated per-user idempotency is not concurrency-safe | Confirmed issue | P1 | Reliability / Concurrency |
| F12 | Failed-recipient recovery is not defined | Confirmed issue | P1 | Delivery / Error handling |
| F13 | Retained provider idempotency can suppress a legitimate repeat transition | Confirmed issue | P1 | Integration / Functional |
| F14 | Change 1 leaves unnecessary broadcast-era plumbing | Confirmed issue | P2 | Architecture / Simplification |
| F15 | Production evidence overstates what the stored rows prove | Confirmed issue | P1 | Evidence / Delivery |
| F16 | The manual verification does not identify the real trigger | Confirmed issue | P1 | Testing / Release safety |
| F17 | Rollback does not restore old behaviour “exactly” | Confirmed issue | P1 | Deployment / Rollback |
| F18 | Post-deploy checks do not prove content correctness or delivery | Confirmed issue | P1 | Monitoring / Operations |
| F19 | The test plan misses boundary and failure cases and can give false confidence | Confirmed issue | P1 | Testing / Reliability |
| F20 | The affected-file and documentation list is incomplete | Confirmed issue | P2 | Delivery / Documentation |
| F21 | The S estimate is conditional on unresolved design choices | Confirmed issue | P1 | Delivery / Estimation |
| F22 | The new query has no supporting `created_at` index | Optional improvement | P3 | Performance / Database |
| F23 | Current-state versus creation-time snapshot behaviour is undefined | Confirmed issue | P2 | Functional / Data |
| F24 | The cron time is described as local time when it is configured in UTC | Confirmed issue | P2 | Documentation / Datetime |
| F25 | Email accessibility and client rendering checks are incomplete | Confirmed issue | P2 | Accessibility / Testing |
| F26 | Extract the event selection into a pure helper | Optional improvement | P3 | Simplification / Testing |
| F27 | Use the single-email API after the planner is reduced to one message | Optional improvement | P3 | Simplification / Integration |
| F28 | Link each event row to its event page | Optional improvement | P3 | User experience / Accessibility |
| F29 | Consider a short-lived release switch for the broadcast removal | Optional improvement | P3 | Deployment / Risk |

## Detailed findings

### F01 — The three stated product decisions are missing

- **Relevant section:** Status; Risks; end of document
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Product / Specification completeness
- **Description:** The status says “Three product decisions open (listed at the end),” and the draft risk says “Depends on decision 2 below.” The document ends after Rollback and contains no decisions or open-questions section.
- **Rationale:** At least one missing decision controls whether drafts are included. The other two cannot be inferred safely. The claim that everything else is settled is therefore untrue.
- **Impact:** A developer must invent product behaviour, and QA cannot derive expected results.
- **Recommended action:** Restore all three decisions with an owner, options, selected answer, decision date, and affected acceptance criteria. Keep the status as “Draft / blocked by product decisions” until they are resolved.
- **Suggested wording:** “**Status:** Draft. Implementation is blocked by the three decisions in ‘Unresolved product decisions’.”
- **Open questions:**
  - What are the missing decisions?
  - Who has authority to resolve them?
  - Is any decision intentionally deferred until after release?

### F02 — “Created” and “first published” are different event boundaries

- **Relevant section:** Summary; Current behaviour; Change 2; Risks
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Scope
- **Description:** The summary says the instant “new event news” is moving into the weekly email. In code, the announcement runs when an event first leaves draft through `admin_publish` or `manager_submit`. The proposed digest instead selects by `events.created_at`, so it includes rows that never reached that transition and excludes older drafts that first publish during the week.
- **Rationale:** Creation, proposal, submission, approval, and publication are separate lifecycle events in this application.
- **Impact:** Users can see draft/proposal rows they were never previously emailed about, while a newly published older event can be missing. The new digest is not guaranteed to carry the same news.
- **Recommended action:** Define the intended event boundary. If the requirement is literal row creation, state that this is a deliberate content expansion. If the goal is to replace the announcement, use a persisted first-published/submitted timestamp or a reliable transition event rather than `created_at`.
- **Suggested wording:** “The weekly section lists non-deleted event rows whose database `created_at` falls in the recipient’s window. This intentionally differs from the removed announcement, which fired on first submission/publication.”
- **Open questions:**
  - Should an event saved as a draft but never submitted appear?
  - Should an old draft first submitted this week appear?
  - Is a proposal row a “created event” for this email?

### F03 — The included event statuses are undefined

- **Relevant section:** Change 2; Template wording; Risks
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Product / Functional
- **Description:** The query filters only `deleted_at`. It therefore includes `pending_approval`, `approved_pending_details`, `draft`, `submitted`, `needs_revisions`, `approved`, `rejected`, `cancelled`, and `completed`. The document discusses drafts but gives no complete inclusion matrix.
- **Rationale:** A status label reduces confusion but does not decide whether a row should be disclosed or is useful in this summary.
- **Impact:** Recipients may interpret rejected, cancelled, incomplete, or internal proposal rows as upcoming events. Developers may choose different filters.
- **Recommended action:** Add a status matrix with Include/Exclude and reason for every `EventStatus`. Add an acceptance test for each included and excluded status. Confirm whether the current status at send time is used.
- **Open questions:**
  - Are rejected and cancelled events useful “new event” news?
  - Can an event become `completed` within the 14-day window, and should it remain visible?
  - Should `approved_pending_details` be described as an event or a proposal?

### F04 — A date-only field cannot provide “since your last email” semantics

- **Relevant section:** Change 2 — Window start; Out of scope; Template wording
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data / Functional
- **Description:** `weekly_digest_last_sent_on` is a PostgreSQL `date`. The proposed start is midnight London on that date. The cron sends at 08:00 UTC, which is 08:00 GMT or 09:00 BST. Events created between midnight and the prior send were already eligible for that email and become eligible again next week. Starting on the next day would instead omit events created after the prior send on the same date.
- **Rationale:** A calendar date cannot represent an instant or a stable high-water mark. No arithmetic can recover the missing time.
- **Impact:** The “since your last update” label is observably false and can repeat or lose events.
- **Recommended action:** Choose one of two explicit contracts:
  1. **Exact:** add a `weekly_digest_last_sent_at timestamptz` or event-cursor timestamp, capture one run cutoff, query `[max(lastCursor, cutoff - 14 days), cutoff)`, and advance the cursor only after provider acceptance.
  2. **Approximate/no migration:** change the copy to a date-based period and document expected overlap or omission. Do not say “since your last email.”
- **Suggested wording:** “For each recipient, include events with `created_at >= windowStart` and `created_at < runCutoff`, where `windowStart = max(lastAcceptedDigestAt, runCutoff - 14 days)`.”
- **Open questions:**
  - Is a schema migration acceptable to meet the stated requirement?
  - What one-time cursor value should existing users receive?
  - Does Resend acceptance or local attempt time advance the cursor?

### F05 — The per-user window and one-query design are underspecified

- **Relevant section:** Change 2 — Replace the data source; Window start, per user
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Technical / Data
- **Description:** The SQL shows one `<window start>`, while the next paragraph requires a different start for each user and calls the change “one query instead of two.” It does not say whether to run one events query per recipient or fetch the widest window once and filter in memory. It also gives no exclusive upper bound or stable tie-breaker.
- **Rationale:** Seventeen per-user queries are unnecessary, while applying a global `limit(20)` before per-user venue/window filtering produces wrong lists and overflow counts. Paging by `created_at` alone is unstable when timestamps tie.
- **Impact:** Implementations can have different performance and correctness, especially for venue-scoped users and bulk imports.
- **Recommended action:** Specify one algorithm. Recommended: capture one `runCutoff`; calculate each unsent user’s start; fetch all rows from the earliest start to the exclusive cutoff once; order by `created_at desc, id desc`; then apply each user’s time and venue filters before count, cap, and render. Page the shared query if full counts are required.
- **Open questions:**
  - Is one shared bounded query the intended design?
  - Must overflow counts be exact above PostgREST’s 1,000-row response cap?
  - What should happen to events created while the send loop is running?

### F06 — The 14-day clamp and first-send journeys need explicit rules

- **Relevant section:** Change 2 — Window start; Risks
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Product / Data retention
- **Description:** “Floored at 14 days ago” is ambiguous; the intended operation appears to be `max(lastCursor, fourteenDaysAgo)`. Null, invalid, future, reactivated, and very old markers are not defined. A missed run longer than 14 days silently loses older unseen events.
- **Rationale:** Current production data having no null marker does not cover future users, reactivation, data repair, or prolonged incidents.
- **Impact:** First emails and recovery emails can contain surprising history or omit expected events, and developers may reverse the clamp.
- **Recommended action:** State the exact formula and journeys. Define null as the 14-day clamp, future values as an error or clamp to cutoff, and confirm that older unseen events are intentionally dropped. Add first-send, reactivation, one missed week, and multi-week outage acceptance cases.
- **Suggested wording:** “If no valid prior cursor exists, start at `runCutoff - 14 days`. Never query earlier than that timestamp.”
- **Open questions:**
  - Should a new user see 7 days, 14 days, or only events created after activation?
  - Should a reactivated user retain their old cursor?
  - Should the email state that older events were omitted after an outage?

### F07 — Venue scoping conflicts with the project’s join-first rule

- **Relevant section:** Current behaviour; Change 2 — Keep venue scoping as it is
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security / Authorization
- **Description:** The current digest helper unions `events.venue_id` with all `event_venues` links. Project rules require event reads to use join-table links first and the legacy `venue_id` only when no links exist. The proposed “keep as it is” retains the union behaviour while the service-role query bypasses RLS.
- **Rationale:** Application-side filtering is the authorization boundary for this email. If legacy and join values drift, a venue-scoped manager can receive an event linked only to another venue.
- **Impact:** Event information can be disclosed outside the intended venue scope.
- **Recommended action:** Use `event_venues` exclusively when at least one link exists; use `events.venue_id` only as a legacy fallback when the link array is empty. Add positive and negative multi-venue tests, including a deliberately stale legacy venue.
- **Open questions:**
  - Are there current rows where the legacy primary venue is not present in `event_venues`?
  - Should the same helper correction apply to the unchanged debrief section in this PR?

### F08 — Multi-venue rows can display the wrong venue to the recipient

- **Relevant section:** Change 2 — Query; Template wording
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Data presentation
- **Description:** Scope checks use all venue IDs, but the row detail displays only `events.venue_id` through the scalar `venue` relation. A manager included because their venue is a secondary link can receive an item labelled with a different primary venue.
- **Rationale:** The displayed context should explain why the event is in the recipient’s scoped email.
- **Impact:** Users can think the email leaked an unrelated event or act on the wrong venue.
- **Recommended action:** Select venue names for `event_venues`. Display all linked venues, or display the recipient’s matched venue plus an indicator that the event is multi-venue. Define the global-user presentation too.
- **Open questions:**
  - Should rows list all venues or only the recipient’s venue?
  - What is the maximum acceptable venue-label length?

### F09 — Ordering, counts, status labels, and overflow semantics are incomplete

- **Relevant section:** Change 2 — Cap and overflow; Template wording
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Accessibility
- **Description:** The document does not state whether the summary tile shows total matching events or the 20 displayed rows, when overflow is calculated, or the exact order after scoping. It also says to show status “as a word” without defining labels for all statuses. The repository already has friendlier labels such as “Waiting review” and “Approved, needs details.”
- **Rationale:** `newEvents.length` after slicing would show 20 even when the email says “and 2 more.” Raw underscore replacement produces inconsistent product language.
- **Impact:** Counts can contradict each other and status wording can vary between the application and email.
- **Recommended action:** Add `newEventTotalCount`, `newEventItems`, and `newEventOverflowCount`. Filter first, sort by `created_at desc, id desc`, count, then take 20. State that the summary uses the total. Define or share a complete status-label map and assert HTML and text output.
- **Open questions:**
  - Should the tile show 22 or 20 in a 22-event week?
  - Should the newest or oldest 20 be displayed?
  - Which exact labels are approved for every status?

### F10 — Resend errors can be counted as successful digest sends

- **Relevant section:** Change 2 — Everything else untouched; Verification; Post-deploy checks
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Error handling
- **Description:** `sendMandatoryWeeklyUpdateEmail` awaits `resend.emails.send(...)` but does not inspect its `{ data, error }` response. Existing new-event code and tests explicitly confirm that Resend can resolve with `error`. The digest then updates `weekly_digest_last_sent_on`, increments `sent`, and suppresses retry.
- **Rationale:** A resolved promise is not proof that the provider accepted the email.
- **Impact:** Failed messages can be permanently skipped while the audit row reports `sent: 17, failed: 0`. The proposed production evidence and acceptance check become unreliable.
- **Recommended action:** Inspect `response.error` and require a provider message ID before advancing the cursor or counting success. Record a sanitized error code, leave the cursor unchanged, and continue with other users. Add tests for resolved error, thrown error, and missing provider data.
- **Open questions:**
  - Is provider acceptance the local success boundary?
  - Should permanent provider errors be retried or escalated immediately?

### F11 — The stated per-user idempotency is not concurrency-safe

- **Relevant section:** Current behaviour; Out of scope; Risks
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Reliability / Concurrency
- **Description:** Two overlapping Tuesday invocations can both read the old user marker, both send, and then both update the date. The GET route also has a POST alias and can be manually invoked. ISO-week comparison prevents sequential re-runs, not concurrent sends.
- **Rationale:** The check and update are not an atomic claim and the provider call occurs between them.
- **Impact:** Duplicate weekly updates remain possible during cron overlap, manual retries, or slow executions.
- **Recommended action:** Either add an atomic per-user/per-week delivery claim or use a stable provider idempotency key such as `weekly-update:<week>:<userId>` and persist the accepted outcome. If this remains out of scope, replace “idempotency” with “sequential duplicate suppression” and record the race as an accepted risk.
- **Open questions:**
  - Is at-most-one attempt under concurrency a release requirement?
  - Can a small digest-delivery table be added with the cursor migration?

### F12 — Failed-recipient recovery is not defined

- **Relevant section:** Current behaviour; Risks; Verification
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / Error handling
- **Description:** A thrown send leaves the user marker unchanged, but the function runs only on Tuesday. Weekday cron calls on Wednesday through Friday return immediately, so there is no automatic retry until the next Tuesday. A marker update failure is only logged even after provider acceptance, which can cause a duplicate on manual retry or next week.
- **Rationale:** Per-user failures are expected integration outcomes and need a recovery journey.
- **Impact:** A user can receive no update for a week, then a larger catch-up email, or receive a duplicate after an update failure.
- **Recommended action:** Define same-day retry ownership, alerting, maximum attempts, and what happens when marker persistence fails after provider acceptance. A delivery ledger/provider idempotency key can reconcile that ambiguous outcome.
- **Open questions:**
  - Should Wednesday–Friday cron runs retry Tuesday failures?
  - Who is alerted when `failed > 0`?
  - How is a provider-accepted but locally unrecorded send reconciled?

### F13 — Retained provider idempotency can suppress a legitimate repeat transition

- **Relevant section:** Change 1; Risks — replay protection
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Functional
- **Description:** The current batch key uses event ID, transition name, payload length/kinds, and chunk offset. Removing announcement messages makes the first and later `admin_publish` payloads identical. A revert and republish, or another legitimate occurrence of the same transition, can reuse the same provider key and be treated as the same request.
- **Rationale:** Transition type is not a transition occurrence. Today the first broadcast payload and later targeted-only payload differ; removing the announcement removes that accidental distinction.
- **Impact:** A targeted creator or assignee email that is meant to remain “exactly as it is” can be suppressed.
- **Recommended action:** Decide whether targeted mail is once per event lifetime or once per legitimate transition occurrence. If per occurrence, include a stable operation/transition ID or committed event version in the provider key while keeping retries of the same occurrence stable.
- **Open questions:**
  - Should revert-and-republish notify the creator again?
  - Which existing operation ID or version can uniquely identify the transition?

### F14 — Change 1 leaves unnecessary broadcast-era plumbing

- **Relevant section:** Change 1 — Simplify `notifyNewEvent`; Files
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Architecture / Simplification
- **Description:** After announcement removal, each transition can produce at most one targeted message. The specification still retains `resend.batch.send`, the all-active-users query, broad `NotificationPerson` fields, payload chunking, and planner inputs originally used for broadcast deduplication and venue planning. It lists some removals but not `listActiveNotificationPeople`, `AnnouncementEventContext`, the event-venue joins, or stale function names/comments.
- **Rationale:** The actor can be compared directly with creator/assignee IDs, and user emails are unique in the database. Fetching every active user to send zero or one targeted message adds work and complexity.
- **Impact:** The implementation remains harder to understand and test and performs an unnecessary privileged user query for every transition.
- **Recommended action:** Define the smallest retained contract: fetch the event plus creator/assignee, select zero or one targeted message, and send it. Remove or rename announcement-only types, queries, comments, and tests. Keep normalized email protection if shared-inbox behaviour is still required.
- **Open questions:**
  - Is cross-user shared-inbox detection still required despite the unique email constraint?
  - Should `notifyNewEvent` be renamed to describe workflow-transition mail?

### F15 — Production evidence overstates what the stored rows prove

- **Relevant section:** Evidence from production; Summary; Post-deploy checks
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Evidence / Delivery
- **Description:** `event_notification_claims` was backfilled for existing non-draft lifecycle statuses with `planned_count = 0`. Its total row count is therefore not a count of 112 live broadcasts. Even nonzero claims record a local claim/planned count, not Resend delivery. Likewise, `digest.batch_sent` can report success when Resend resolves with an error, and both digest functions use the same action name.
- **Rationale:** Database intent, provider acceptance, and inbox delivery are different evidence levels.
- **Impact:** Volume, cost, reliability, and “6 of 6 successful” conclusions may be wrong, weakening the business case and post-release comparison.
- **Recommended action:** Attach the exact read-only SQL and definitions used. Separate claim backfill rows, runtime claims, provider-accepted messages, and delivered messages. Filter digest rows by `meta.weekly_update = true`, and state evidence limits.
- **Suggested wording:** Replace “New event broadcasts sent to date” with “Announcement claim rows present; includes migration backfill and does not prove provider delivery” unless provider evidence is joined.
- **Open questions:**
  - How many claim rows have `planned_count > 0` and a non-null `claimed_by`?
  - Does Resend retain enough history to validate accepted or delivered counts?
  - Were audit counts grouped by distinct week and filtered to mandatory weekly updates?

### F16 — The manual verification does not identify the real trigger

- **Relevant section:** Verification — Manual
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing / Release safety
- **Description:** “Create an event in production” may only save a draft, which does not call `notifyNewEvent`. The relevant transitions are administrator auto-publication and manager submission. The check also lacks a named test account, recipient list, cleanup, expected targeted message, and approval to create production data.
- **Rationale:** A zero-email draft creation would pass while the old broadcast remained reachable on publication.
- **Impact:** The production smoke can provide false assurance or send real emails and leave unwanted data.
- **Recommended action:** Prefer staging with a safe Resend domain. If production testing is approved, specify exact journeys: admin creates/publishes, manager submits with a different assignee, self-assigned/self-created suppression, and draft-only save. Name the expected recipients and cleanup owner.
- **Open questions:**
  - Is there a staging environment with operational email safely enabled?
  - Who approves and removes a production smoke event?
  - Which mailbox confirms that no broad fan-out occurred?

### F17 — Rollback does not restore old behaviour “exactly”

- **Relevant section:** Rollback; Change 1 — Leave the database alone
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Deployment / Rollback
- **Description:** Events first submitted or published while the new code is active will not create claim rows. Reverting code does not retroactively broadcast them. If such an event later re-enters draft and is republished after rollback, old code can broadcast it because no claim exists. In-flight callbacks from the old deployment can also run around the cutover.
- **Rationale:** Code rollback restores code paths, not notification history for transitions that occurred during the changed interval.
- **Impact:** Rollback can omit expected old broadcasts or produce delayed broadcasts for events already covered by a digest.
- **Recommended action:** Replace the exact-restore claim with a rollback procedure. Record the deployment interval, decide whether to backfill claims for events transitioned during it before rollback, and state whether any missed broadcast should be sent manually.
- **Suggested wording:** “Reverting restores the old logic for future transitions. Events transitioned while this change was active require an explicit claim/backfill decision.”
- **Open questions:**
  - On rollback, should interval events be marked claimed without sending?
  - How will in-flight old-version sends be detected?

### F18 — Post-deploy checks do not prove content correctness or delivery

- **Relevant section:** Verification — Post deploy; Risks
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Monitoring / Operations
- **Description:** No new claim rows proves only that the removed claim path did not run for exercised events. A `digest.batch_sent` row with 17/0 does not prove the new event query, per-user windows, venue scoping, item counts, provider acceptance, or delivery. Current structured new-event logs also do not list message kinds.
- **Rationale:** The highest risks are incorrect audience/content and silent provider error, neither of which the stated checks observe.
- **Impact:** A privacy leak, empty section, duplicate period, or provider rejection can pass release monitoring.
- **Recommended action:** Add structured, non-PII metrics: transition, message kinds/counts, users eligible/skipped/failed, window min/max, new-event matched/shown/overflow totals, and provider acceptance IDs or counts. Alert on cron absence and any failure. Perform a known-fixture content check for a venue-scoped and global user.
- **Open questions:**
  - Where are alerts sent and who owns them?
  - Is Resend delivered/bounced webhook monitoring available or required?
  - How long should post-deploy monitoring run?

### F19 — The test plan misses boundary and failure cases and can give false confidence

- **Relevant section:** Verification; Files
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing / Reliability
- **Description:** The proposed tests omit exact boundary inclusion/exclusion, London summer/winter conversion, two users with different cursors, null/future cursors, every status, deterministic equal timestamps, multi-venue join precedence, negative cross-venue leakage, total versus shown counts, current-state changes, resolved provider errors, marker update failures, concurrent invocations, and repeat transition idempotency. The common digest mock returns all rows regardless of `.gte`, `.is`, `.order`, or `.limit`, so fixture-only tests can pass without proving the query.
- **Rationale:** Time, authorization, and provider failures are the main risk areas. A permissive query-chain proxy does not enforce them.
- **Impact:** Tests can pass while production duplicates rows, leaks venue data, includes soft-deleted events, or records failed sends as successful.
- **Recommended action:** Extract pure selection/window helpers and test them with real values. Separately assert exact query methods/arguments or use a query-aware integration test. Add HTML and plain-text assertions for labels, status, total, overflow, and empty state. Keep existing planner self-suppression tests after removing announcement cases.
- **Open questions:**
  - Will a local Supabase integration test be part of the PR gate?
  - Should email snapshots be used, or targeted semantic assertions only?

### F20 — The affected-file and documentation list is incomplete

- **Relevant section:** Change 1 files; Change 2 files; Out of scope
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Delivery / Documentation
- **Description:** The code change is likely to touch or remove additional notification types, helper comments, event fetch joins, and active-user logic. `docs/Runbooks/CronMonitoring.md` describes `/api/cron/weekly-digest` as a configurable todo digest and monitors `todo_digest_last_sent_on`, not the mandatory Tuesday update or `weekly_digest_last_sent_on`. The database comment on `event_notification_claims` says it backs `notifyNewEvent`, which becomes historical after this change.
- **Rationale:** Operations and future developers rely on these descriptions. Leaving a dormant table is reasonable, but describing it as active is misleading.
- **Impact:** Delivery estimates miss work, support follows the wrong runbook, and historical data can be misread.
- **Recommended action:** Add the runbook and any architecture/reference docs to the PR. Update code comments/types as part of dead-path removal. Either update the table comment in a small migration or document explicitly that the table and comment describe pre-change history.
- **Open questions:**
  - Is a comment-only migration acceptable despite “no migrations”?
  - Are there dashboards or saved queries that assume claim rows remain active?

### F21 — The S estimate is conditional on unresolved design choices

- **Relevant section:** Status; Complexity; Summary; Out of scope
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / Estimation
- **Description:** The estimate assumes no schema change, unchanged idempotency, simple date arithmetic, and a narrow test update. Exact cursor semantics, venue-rule correction, provider error handling, monitoring, and the missing product decisions can add migration, types, tests, runbook, and rollout work.
- **Rationale:** Estimates made before blocking requirements are resolved cannot be treated as committed scope.
- **Impact:** A one-PR promise can pressure the developer to retain known correctness gaps or under-test the release.
- **Recommended action:** Re-estimate after F01–F06 and the delivery guarantee are decided. It can remain one PR if the cursor migration is small, but use separate commits for broadcast removal, digest selection/rendering, and operational updates.
- **Open questions:**
  - Is the deadline more important than exact cursor semantics?
  - Can the broadcast removal ship first as a smaller risk-reduction change?

### F22 — The new query has no supporting `created_at` index

- **Relevant section:** Change 2 — Replace the data source; Evidence — Volume is safe
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Performance / Database
- **Description:** The events table has indexes for venue, status, start time, assignee, and deleted rows, but no index supporting `created_at` range filtering and descending order. The current table is small, so a sequential scan is likely acceptable now.
- **Rationale:** The query becomes scheduled production work and may grow with imports and retention.
- **Impact:** Future digest runs can become slower, but adding an index today also adds migration/write overhead that may not be justified.
- **Recommended action:** Capture `EXPLAIN (ANALYZE, BUFFERS)` or table size before release. Defer the index while volume is small; add a partial index such as `(created_at desc, id desc) where deleted_at is null` when an agreed threshold is reached.
- **Open questions:**
  - What are the current event row count and digest query time?
  - What latency threshold should trigger the index?

### F23 — Current-state versus creation-time snapshot behaviour is undefined

- **Relevant section:** Change 2 — Query; Template wording
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Functional / Data
- **Description:** The email selects the event’s title, status, date, deletion state, and venue at send time, not at creation time. An event can be renamed, moved to another venue, rejected, cancelled, completed, or soft-deleted between creation and Tuesday.
- **Rationale:** “Events created since” defines the time criterion but not which version of the event is shown or scoped.
- **Impact:** A recipient may not see an event originally created for their venue, or may see one created elsewhere after it moved. Counts can change between preview and send.
- **Recommended action:** State that current non-deleted state and current venue links at `runCutoff` are authoritative, if that is intended. Add journeys for moved venue, changed status, and soft deletion. If creation-time history is required, the current schema/query cannot provide it reliably.
- **Open questions:**
  - Should deleted events contribute to the overflow count?
  - Should venue scope be based on creation-time or send-time membership?

### F24 — The cron time is described as local time when it is configured in UTC

- **Relevant section:** Current behaviour — Tuesday email
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Documentation / Datetime
- **Description:** `vercel.json` configures `0 8 * * 1-5`. This is 08:00 UTC, which is 08:00 in winter and 09:00 in British Summer Time. The function checks the London weekday, but the schedule is not a fixed 08:00 London run.
- **Rationale:** The send time matters to exact window boundaries, user expectations, smoke-test timing, and incident response.
- **Impact:** Documentation and date-based assumptions can be one hour wrong for much of the year.
- **Recommended action:** Say “08:00 UTC weekdays; the function sends only when the London date is Tuesday.” If the product requires 08:00 London year-round, that is a separate scheduling design decision.
- **Open questions:**
  - Is the intended user-facing time 08:00 London or simply Tuesday morning?

### F25 — Email accessibility and client rendering checks are incomplete

- **Relevant section:** Change 2 — Template wording; Verification
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Accessibility / Testing
- **Description:** Requiring a text status rather than colour alone is good, but the specification does not require semantic reading order, meaningful link text, mobile layout, dark mode, long title/venue wrapping, or checks in common email clients. It also does not explicitly require the total/overflow meaning to be understandable in plain text.
- **Rationale:** Email HTML support differs from browser HTML, and the content becomes denser with up to 20 events.
- **Impact:** The new section can be hard to scan or render poorly even while unit tests pass.
- **Recommended action:** Add a lightweight QA matrix: HTML and plain text, keyboard/screen-reader sensible order, status visible in text, 320px mobile width, long title and multi-venue label, dark mode/high contrast, and Gmail/Outlook/Apple Mail rendering where available.
- **Open questions:**
  - Which email clients are supported by the 17 users?
  - Is formal screenshot approval required before release?

### F26 — Extract the event selection into a pure helper

- **Relevant section:** Change 2; Verification
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification / Testing
- **Description:** Window calculation, join-first venue scoping, sorting, counting, capping, and status labelling can be separated from Supabase and Resend I/O.
- **Rationale:** The existing large notification module and permissive database mocks make boundary logic difficult to prove.
- **Impact:** A small helper reduces test setup and makes product decisions visible as data and functions.
- **Recommended action:** Add a focused helper with typed inputs and outputs, then keep the orchestrator responsible only for fetching, sending, and cursor updates. Do not build a generic framework.
- **Open questions:** None.

### F27 — Use the single-email API after the planner is reduced to one message

- **Relevant section:** Change 1 — batch send stays
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification / Integration
- **Description:** The specification says two remaining message kinds benefit from one batch call, but a single transition selects only one of them and sends at most one message. Resend’s single-email API supports request options including an idempotency key.
- **Rationale:** Batch chunking, accepted-count arithmetic, and payload-shape construction are unnecessary for zero-or-one sends.
- **Impact:** Keeping batch is not harmful at current volume, but it preserves code and tests that no longer serve the product behaviour.
- **Recommended action:** After F13 defines occurrence identity, use `resend.emails.send(payload, { idempotencyKey })`, inspect `{ data, error }`, and log one structured outcome.
- **Open questions:** None beyond F13.

### F28 — Link each event row to its event page

- **Relevant section:** Change 2 — Template wording
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** User experience / Accessibility
- **Description:** The email has only a general “Open BaronsHub” button. A user who sees a specific draft or submitted event must reopen the application and find it.
- **Rationale:** Direct, descriptive links make a 20-item summary more actionable and help keyboard and screen-reader users.
- **Impact:** Without links, the summary remains informative but less efficient.
- **Recommended action:** Consider linking each escaped event title to `/events/<id>` with visible title text. Confirm permissions still apply on page load. Retain the general CTA.
- **Open questions:**
  - Is the email intended only as awareness, or should it support direct action?

### F29 — Consider a short-lived release switch for the broadcast removal

- **Relevant section:** Deployment; Rollback
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Deployment / Risk
- **Description:** The change has no independent switch; rollback reintroduces the broad broadcast and has the interval-history problem described in F17.
- **Rationale:** A narrowly scoped flag can stop announcement creation without reverting the digest or targeted-message work.
- **Impact:** This adds configuration complexity, so it is only worthwhile if rollout risk or stakeholder uncertainty is high.
- **Recommended action:** If product approval remains uncertain, use a temporary server-side `NEW_EVENT_ANNOUNCEMENT_ENABLED=false` switch with a removal date. Otherwise prefer permanent code deletion and the explicit rollback procedure.
- **Open questions:**
  - Is there a realistic scenario in which the broad broadcast should be re-enabled quickly?

## Required acceptance matrix

Before implementation, the specification should include at least this journey matrix with final expected answers:

| Journey | Expected immediate email | Expected next Tuesday section |
|---|---|---|
| Administrator creates and auto-approves an event | Creator decision only when actor differs; never all-user announcement | Include/exclude according to the decided creation/status rule |
| Manager creates and submits an event | Assignee review email only when actor differs | Include/exclude according to the decided creation/status rule |
| User saves a draft only | No immediate new-event email | Explicit draft decision required |
| Proposal is created | Existing proposal workflow unchanged | Explicit proposal-status decision required |
| Old draft is first submitted this week | Targeted workflow email | Explicit answer required because `created_at` alone excludes it |
| Event is created, then cancelled/rejected before Tuesday | No all-user announcement | Explicit status decision required |
| Event is created, then soft-deleted before Tuesday | No all-user announcement | Excluded, with count behaviour defined |
| Multi-venue event where recipient venue is secondary | No all-user announcement | Included with accurate venue label |
| User has no venue | Targeted only if creator/assignee | Global list, as already approved by role rules |
| User has no previous digest cursor | N/A | Explicit first-send lookback required |
| Prior Tuesday send failed for one user | N/A | Retry/catch-up behaviour required |
| Two digest invocations overlap | N/A | One accepted email per user/week if that is the guarantee |
| Event created exactly at start or cutoff | N/A | Start inclusive, cutoff exclusive |
| Event title/status/venue changes before send | N/A | Current-state or historical rule required |
| Revert and republish the same event | Targeted repeat rule required | No duplicate creation row; current status shown if included |

## Recommended minimum design

The smallest design that satisfies the literal requirement is:

1. Remove the `announcement` kind and all all-user audience, claim, venue-label, and batch-chunk plumbing from the new-event path.
2. Keep only a zero-or-one targeted workflow message per transition. Give each legitimate transition occurrence a stable ID for provider idempotency.
3. Resolve the complete status matrix and state clearly that the weekly source is row creation, if that is the final product choice.
4. Add a per-user accepted-digest timestamp or cursor. Capture one UTC `runCutoff` before querying.
5. Fetch the widest required event window once using `[earliestStart, runCutoff)`, stable order `created_at desc, id desc`, and no global display limit.
6. Per user, apply their cursor, join-first venue scope, status rule, current-state rule, stable order, total count, 20-item cap, and overflow.
7. Treat a Resend response with `error` or without an accepted message ID as failure. Advance only that user’s cursor after provider acceptance.
8. Define concurrency and retry behaviour. At minimum, use a stable per-user/per-week provider idempotency key and alert on failures.
9. Update the cron runbook and release checks.

If a migration is rejected, the specification should instead use honest date-based wording and explicitly accept overlap or omission. There is no code-only way to reconstruct the exact time of a prior email from a date column.

## Readiness conclusion

### Key required changes

1. Restore and resolve the missing three product decisions.
2. Define whether the weekly section represents database creation or first submission/publication.
3. Define the full event-status inclusion matrix.
4. Replace the date-only “since last email” design with a timestamp/cursor, or weaken the wording and accept its limitations.
5. Specify a shared-query/per-user-filter algorithm with inclusive start, exclusive cutoff, stable ordering, exact counts, and overflow rules.
6. Correct venue scope to join-table first and legacy fallback only.
7. Handle resolved Resend errors before marking a user sent.
8. Define concurrent invocation, retry, repeat-transition, and rollback behaviour.
9. Expand tests and monitoring around boundaries, authorization, provider failures, and content.

### Unresolved decisions

- What were the three omitted product decisions?
- Does “new event” mean row creation, first submission/publication, or another transition?
- Which statuses are included?
- Is an exact timestamp/cursor migration approved?
- Is the 14-day history loss acceptable after longer outages?
- What is the first-send/reactivation window?
- Are repeated targeted emails expected for repeated legitimate transitions?
- Does provider acceptance count as success, and how are failures retried?
- Should multi-venue rows show all venues or the recipient’s matched venue?
- Is the required send time 08:00 London or simply Tuesday morning?

### Major risks

- Repeated or omitted event rows caused by the date-only cursor.
- Disclosure to the wrong venue caused by unioning stale legacy and join-table venue IDs.
- Failed provider requests recorded as successful and never retried.
- A weekly summary that does not replace the removed first-publication news.
- Legitimate repeat targeted messages suppressed by a reused provider idempotency key.
- Rollback producing missing or delayed broadcasts for events transitioned during the release interval.
- Tests passing without exercising query filters or timezone boundaries.

### Recommended next steps

1. Hold a short product decision review and record the missing answers.
2. Choose exact timestamp/cursor semantics or explicitly approve approximate date-based wording.
3. Update the specification with the acceptance matrix and minimum design above.
4. Re-estimate scope after those decisions.
5. Implement in focused commits, run lint/typecheck/tests/build, render both email variants, and use staging-safe smoke data.
6. Deploy with an owned monitoring and rollback window covering the first Tuesday send.
