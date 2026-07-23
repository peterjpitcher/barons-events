# One Email Per New Event: Developer Specification Review

**Specification reviewed:** `2026-07-23-single-new-event-email.md`  
**Review date:** 2026-07-23  
**Review scope:** Product clarity, technical design, data, security, delivery, integrations, reliability, performance, accessibility, testing, rollout, and monitoring  
**Source specification changed:** No

## Overall assessment

**Readiness: Not ready for implementation.**

The diagnosis correctly identifies an over-wide announcement audience and overlap between targeted and announcement emails. The source references are useful. However, the Phase 1 design does not yet meet its stated guarantee and has eight blocking issues:

1. “One email” is not defined clearly enough to prove the product problem will be fixed.
2. A per-event announcement claim does not stop the duplicate event rows described in RC5.
3. It does not stop concurrent targeted emails or duplicate status side effects described in RC4.
4. Updating `events.announced_at` also updates `events.updated_at`, interferes with optimistic concurrency, and requires a privileged write path.
5. Claiming before a multi-recipient send can permanently lose all or part of the announcement.
6. Awaiting the full Resend fan-out conflicts with the project rule to queue email work and adds an unbounded external dependency to the event action.
7. Phase 1 leaves the confirmed over-wide audience live, so it may not solve what the product owner means by “multiple emails out to users.”
8. The proposed backfill suppresses future announcements for proposal-path events while failing to mark previously announced events that are currently back in draft.

The safest design is a separate notification outbox or delivery ledger, keyed by event, transition, and normalized recipient email. The event transition should enqueue the final chosen message without changing `events.updated_at`; a background worker should send it with a provider idempotency key and record accepted, failed, and retry states.

The stated Phase 1 size of **M** is optimistic if the guarantee is retained. A robust implementation is likely **L**. A small temporary hotfix can still be shipped separately, but it must have narrower claims.

## Classification

- **Confirmed issue:** A contradiction, missing requirement, or incompatibility confirmed against the current repository.
- **Optional improvement:** Not required for the minimum fix, but likely to improve maintainability, delivery safety, or operating cost.
- **P0:** Resolve before implementation starts.
- **P1:** Resolve in the specification before it is build-ready.
- **P2:** Resolve before production release.
- **P3:** Optional improvement.

## Unconfirmed assumptions

| Assumption | Why it needs confirmation | Related finding |
|---|---|---|
| “One email” means one message per recipient, not one total outbound campaign or one template | The reported wording can reasonably mean any of these. | F01, F07 |
| Preventing duplicates is more important than retrying failed sends | The proposed claim provides at-most-once attempts, not reliable delivery. | F05 |
| The actor should never receive the announcement | This is an unresolved product decision but is treated as decided in Phase 1. | F01, F12 |
| An event should receive only one announcement for its whole lifetime | The principle says “per state transition,” while `announced_at` is lifetime-scoped. | F01, F18 |
| A proposal email and a later publication announcement are unwanted duplicates | They occur at different lifecycle transitions and may carry different meaning. | F11 |
| The central-events-lead role and announcement preference should always be the same | The spec proposes a separate user flag but initializes it from the existing lead flag. | F13, F14 |
| Phase 1 may leave the broad audience live | This continues the confirmed fan-out and disclosure while waiting for Phase 2. | F07, F24 |
| `EVENT_SAVE_USE_RPC` will remain off everywhere relevant | It is off in the stated production evidence, but local Docker enables it and the code path remains deployable. | F16 |
| Production counts prove actual Resend sends and delivery | Database rows prove application state more strongly than provider acceptance or inbox delivery. | F19 |
| A non-deactivated user is an eligible announcement recipient | Invite state, account use, role, and communication preference are not considered. | F13, F24 |
| User and recipient volume will remain close to 19 | No upper bound or concurrency limit is defined. | F06, F25 |
| The migration backfill can update `events` without trigger side effects | Current triggers change `updated_at` and restrict event writes. | F04, F08, F21 |

## Repository evidence reviewed

- `src/actions/events.ts`: RPC/legacy branches, stale status reads, targeted sends, announcement calls, auto-approval, and revert-to-draft behavior.
- `src/actions/pre-event.ts`: proposal creation and central-lead email behavior in both flag states.
- `src/lib/notifications.ts`: recipient query, swallowed errors, proposal claim, targeted send functions, and `Promise.allSettled` announcement fan-out.
- `src/components/events/event-form.tsx` and `floating-action-bar.tsx`: idempotency fields, optimistic-concurrency token handling, and client pending state.
- `supabase/migrations/20250218000000_initial_mvp.sql`: `trg_events_updated` and case-sensitive unique user email.
- `supabase/migrations/20260604150000_baronshub_rbac_read_all_admin_writes.sql`: service-role/administrator event-write trigger.
- `supabase/migrations/20260507132000_return_event_rpc_updated_at.sql`: RPC idempotency, stale role names, returned `updated_at`, and audit writes.
- `supabase/migrations/20260604113000_baronshub_safe_user_preferences.sql` and `src/lib/central-events-lead.ts`: existing unique central-events-lead setting and fallback.
- Installed `resend` 6.12.2 type/runtime definitions: successful and failed API calls resolve through `{ data, error }`.

## Findings index

| ID | Title | Status | Priority | Type |
|---|---|---|---|---|
| F01 | The core “one email” acceptance rule is ambiguous | Confirmed issue | P0 | Functional / Scope |
| F02 | The proposed claim does not close RC5 | Confirmed issue | P0 | Reliability / Data |
| F03 | The proposed claim does not close all of RC4 | Confirmed issue | P0 | Concurrency / Reliability |
| F04 | `announced_at` is not an isolated marker on this table | Confirmed issue | P0 | Data / Integration |
| F05 | Claim-before-send can permanently lose notifications | Confirmed issue | P0 | Reliability / Error handling |
| F06 | Awaiting the fan-out violates the delivery architecture | Confirmed issue | P0 | Architecture / Performance |
| F07 | Phase 1 leaves the live audience problem unresolved | Confirmed issue | P0 | Security / Delivery |
| F08 | The migration backfill is wrong for real event lifecycles | Confirmed issue | P0 | Migration / Functional |
| F09 | The targeted-recipient contract cannot be implemented as written | Confirmed issue | P1 | Technical / Error handling |
| F10 | ID exclusions do not guarantee one message per inbox | Confirmed issue | P1 | Functional / Data |
| F11 | RC7 is not fixed and may not be a duplicate | Confirmed issue | P1 | Functional / Scope |
| F12 | Phase status contradicts unresolved product decisions | Confirmed issue | P1 | Delivery / Product |
| F13 | Phase 2 audience rules are incomplete | Confirmed issue | P1 | Security / Functional |
| F14 | The new preference can drift from the existing central lead | Confirmed issue | P1 | Data / Simplification |
| F15 | Phase 2 is not independently buildable from this specification | Confirmed issue | P1 | Delivery / Scope |
| F16 | RPC and legacy paths remain inconsistent | Confirmed issue | P1 | Integration / Delivery |
| F17 | Resend failures will be misclassified unless responses are inspected | Confirmed issue | P1 | Integration / Monitoring |
| F18 | Eligible transitions and republish semantics are not enforced | Confirmed issue | P1 | Functional / Data |
| F19 | Evidence claims are stronger than the stored evidence | Confirmed issue | P1 | Evidence / Delivery |
| F20 | The test plan misses the highest-risk cases | Confirmed issue | P1 | Testing / Reliability |
| F21 | Deployment and rollback claims are incomplete | Confirmed issue | P1 | Deployment / Migration |
| F22 | Schema, trigger, function, and type dependencies are incomplete | Confirmed issue | P1 | Technical / Delivery |
| F23 | Monitoring has no failure, retry, or replay contract | Confirmed issue | P2 | Operations / Monitoring |
| F24 | Recipient privacy and communication policy are undefined | Confirmed issue | P2 | Security / Data governance |
| F25 | Capacity and provider limits are not considered | Confirmed issue | P2 | Performance / Integration |
| F26 | Accessibility requirements for the preference change are missing | Confirmed issue | P2 | Accessibility |
| F27 | Build one final recipient plan before sending | Optional improvement | P3 | Simplification / Maintainability |
| F28 | Separate the immediate hotfix from the durable redesign | Optional improvement | P3 | Delivery / Risk |
| F29 | Consider provider batch sending after correctness is fixed | Optional improvement | P3 | Performance / Cost |

## Detailed findings

### F01 — The core “one email” acceptance rule is ambiguous

- **Relevant section:** Reported problem; Summary; Design principle; Open questions
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Scope
- **Description:** The title says one email per new event, the reported problem says one email “out to users,” and the design principle says one email per person per state transition. These are different guarantees. The lifetime `announced_at` marker also conflicts with the per-transition wording.
- **Rationale:** The proposed implementation could still send 17 or more messages for one event while passing its per-person rule. It also permits later targeted emails for later transitions while permanently suppressing later announcements.
- **Impact:** Development and QA can deliver the proposed design while the product owner still sees the original problem.
- **Recommended action:** Add a testable rule and a journey matrix. Define:
  - whether the limit is per normalized email address, per user row, or total sends;
  - which transition counts as “new”;
  - whether the announcement is once per event lifetime;
  - whether targeted messages on later transitions are allowed;
  - what should happen when the preferred targeted message fails.
- **Suggested wording:** “For the initial publication transition, each normalized recipient email address receives at most one selected message. The announcement is sent at most once per event lifetime. Later review decisions are separate transitions.”
- **Open questions:**
  - Does the product owner mean one message per inbox or one outbound message in total?
  - Is “at most one” acceptable if a recipient receives no email after a provider failure?
  - Does a revert-and-republish ever deserve a new announcement?

### F02 — The proposed claim does not close RC5

- **Relevant section:** RC5; Phase 1 step 1
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Reliability / Data
- **Description:** RC5 creates two different event rows. Each row has a different `eventId`, so each row can successfully claim its own `announced_at` value and send its own announcement.
- **Rationale:** Per-event idempotency can deduplicate repeated work for one row. It cannot determine that two rows came from the same user submission.
- **Impact:** A narrow double-submit window can still create duplicate events, duplicate planning/SOP data, and two complete email fan-outs.
- **Recommended action:** Keep RC5 as separate required work. Use the form's persistent idempotency key in the create-and-submit path and enforce it in the database before creating the event and its dependent rows. The client disabled state remains useful but is not the authority.
- **Suggested wording:** Replace “This closes RC3, RC4 and RC5” with “This closes repeated announcement attempts for the same event row. Duplicate event creation requires request-level idempotency.”
- **Open questions:**
  - Should fixing duplicate event creation be part of Phase 1 or tracked as a release blocker in a separate change?
  - What is the retention period for create-operation idempotency keys?

### F03 — The proposed claim does not close all of RC4

- **Relevant section:** RC4; Design principle; Phase 1 call sites
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Concurrency / Reliability
- **Description:** Two concurrent publish actions can both perform the status update, approval/version/audit work, and targeted email before only one wins the announcement claim. `sendReviewDecisionEmail` and `sendEventSubmittedEmail` have no idempotency guard.
- **Rationale:** The announcement claim protects only one template. It is not a state-transition claim and does not serialize the rest of the action.
- **Impact:** A creator or assignee can still receive two targeted emails for one transition. Duplicate approvals, event versions, or audit activity may also remain.
- **Recommended action:** Make the transition itself conditional and idempotent, or assign a stable transition/operation key and enforce a unique notification delivery for each normalized email. The final message choice must be deduplicated before any targeted or announcement send starts.
- **Open questions:**
  - Must duplicate approvals and versions also be fixed in this work?
  - Should a second concurrent request return “already processed” or the stored first result?

### F04 — `announced_at` is not an isolated marker on this table

- **Relevant section:** Phase 1 step 1; Database changes
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data / Integration
- **Description:** `public.events` has `trg_events_updated`, which sets `updated_at` on every update. It also has `events_require_admin_or_service_write`, which rejects non-administrator event writes unless the request is service-role. Claiming `announced_at` therefore changes the event's optimistic-concurrency token and needs an explicitly privileged path.
- **Rationale:** The RPC submit path returns the status-transition `updated_at`. A later announcement claim changes it again, so the form receives a stale token and can report a false edit conflict. The backfill also makes historical events look newly edited.
- **Impact:** Users can hit unexpected save conflicts, event ordering or “last updated” data can change, and manager-triggered claims can fail if the wrong Supabase client is used.
- **Recommended action:** Store notification state in a separate outbox/delivery table. If `events.announced_at` is retained, specify a service-role or audited SECURITY DEFINER claim, prevent notification-only writes from changing the business row version, and return the final concurrency token.
- **Open questions:**
  - Is `events.updated_at` used for ordering, cache invalidation, reporting, or support views beyond optimistic concurrency?
  - Can the migration runner pass the current event write trigger?

### F05 — Claim-before-send can permanently lose notifications

- **Relevant section:** Phase 1 step 1; Error handling; Rollback
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Reliability / Error handling
- **Description:** The design marks the whole event before context loading, recipient resolution, and a multi-recipient provider call. A later query failure, missing Resend configuration, rate limit, provider error, timeout, or partial fan-out leaves the marker set with no supported retry.
- **Rationale:** One timestamp cannot represent separate outcomes for many recipients. Resetting it after a partial failure can resend successful recipients, while leaving it set abandons failed recipients. A process crash after provider acceptance but before local completion also needs provider idempotency.
- **Impact:** The fix trades visible duplicates for silent, permanent email loss and gives support no safe replay path.
- **Recommended action:** Define the required delivery guarantee. Recommended:
  - create one delivery row per final normalized recipient;
  - use `pending`, `processing`, `accepted`, and `failed` states with attempts and timestamps;
  - use a stable Resend idempotency key per delivery;
  - retry transient failures with a limit and backoff;
  - provide a safe replay or manual-resolution path.
- **Suggested wording:** “The system provides retryable, per-recipient delivery with deduplication. A provider-accepted delivery is never intentionally submitted twice with a different idempotency key.”
- **Open questions:**
  - Is at-most-once attempt delivery acceptable, or are transient failures expected to retry?
  - How many attempts and how much delay are acceptable?
  - Does Resend acceptance count as success, or is delivered webhook status required?

### F06 — Awaiting the fan-out violates the delivery architecture

- **Relevant section:** Phase 1 call-site changes
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Architecture / Performance
- **Description:** The specification changes three calls to `await` and puts the entire external fan-out on the event action's critical path. Project guidance explicitly says not to await email sends in critical paths and to queue them for background work.
- **Rationale:** `Promise.allSettled` prevents rejection propagation, but it does not make network work fast, durable, or observable. The action can wait on every Resend request and still return success after all requests failed.
- **Impact:** Publishing becomes slower and more likely to hit serverless timeouts or provider rate limits as the audience grows. Users may retry a successful event transition because the response is slow.
- **Recommended action:** Commit an outbox row as part of the event transition where possible, return the event result, and process the outbox in a bounded background worker. A framework `after()` callback is safer than an untracked `void` promise but is not a substitute for a durable queue if retries are required.
- **Open questions:**
  - What maximum publish-action latency is acceptable?
  - What background worker or cron frequency should process queued announcements?
  - Must enqueue failure block the event transition, return a warning, or be reconciled later?

### F07 — Phase 1 leaves the live audience problem unresolved

- **Relevant section:** Summary; RC1; Phase 1; Phase 2; Rollout
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security / Delivery
- **Description:** RC1 is described as a live root cause, but Phase 1 still sends the announcement to almost every active user. Excluding the actor and one targeted recipient reduces the count slightly; it does not scope the audience.
- **Rationale:** If “multiple emails out to users” refers to the number of outbound messages visible in Resend, Phase 1 will not fix it. It also continues distributing event title, venue, time, and venue-space information to a group the spec says should not have been included.
- **Impact:** The release can be declared successful while the main operational complaint and over-broad distribution remain.
- **Recommended action:** Resolve the audience decision before rollout, or ship a conservative temporary rule such as disabling the broadcast or limiting it to the existing central events lead and venue-matched users. Do not call Phase 1 a complete fix if broad fan-out remains.
- **Open questions:**
  - Is the current audience merely noisy or also unauthorized?
  - Is it safer to pause announcements until the audience is approved?
  - Who owns the final recipient decision?

### F08 — The migration backfill is wrong for real event lifecycles

- **Relevant section:** Database changes
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Migration / Functional
- **Description:** `status <> 'draft'` does not mean “already announced.” `pending_approval` and `approved_pending_details` proposal rows have not reached the current announcement call, yet the backfill marks them and suppresses their later first publication. Conversely, an event that was announced and then reverted to `draft` remains null and can be announced again.
- **Rationale:** Current code moves approved proposals through `approved_pending_details` and then `draft`. Revert-to-draft can also put a previously announced event back in `draft`.
- **Impact:** Some legitimate future announcements are permanently skipped while some historical announcements can still be repeated. The update also changes `updated_at` for every touched row.
- **Recommended action:** Define a migration truth table for every status and prior transition. Prefer a separate delivery ledger. If historical delivery cannot be reconstructed, choose and document a safe cutoff policy, for example suppressing every event created before deployment while allowing only post-deploy event IDs to enqueue.
- **Open questions:**
  - Are there currently any `pending_approval`, `approved_pending_details`, or reverted draft rows?
  - Can audit history or Resend exports identify previously announced event IDs reliably?
  - Is suppressing some pre-deploy draft announcements safer than risking a re-broadcast?

### F09 — The targeted-recipient contract cannot be implemented as written

- **Relevant section:** `notifyNewEvent` signature; Call-site changes
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Technical / Error handling
- **Description:** The spec says to capture recipient IDs returned by `sendReviewDecisionEmail` and `sendEventSubmittedEmail`, but both functions currently return `void`, skip silently in several cases, and catch provider failures internally.
- **Rationale:** “Targeted recipient” can mean intended, attempted, provider-accepted, or delivered. Those are not equivalent. The caller currently cannot know any of them.
- **Impact:** A failed targeted send may still suppress the announcement, giving the recipient no email, or a successful send may not be excluded if the return contract is implemented inconsistently.
- **Recommended action:** Do not send targeted mail first and then report IDs. Resolve recipients and choose the final template centrally before enqueueing. If existing functions remain, replace `void` with a structured result such as `{ recipient, outcome, providerMessageId, errorCode }` and define which outcomes suppress fallback mail.
- **Open questions:**
  - Should an intended targeted recipient suppress the announcement even when no email address exists?
  - Should a provider-rejected targeted message fall back to the announcement template?

### F10 — ID exclusions do not guarantee one message per inbox

- **Relevant section:** Phase 1 steps 2–4
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Data
- **Description:** Actor and targeted recipients are excluded by user ID, then the remaining audience is deduplicated by lower-cased email. Another user row with the actor's or target's email can remain and receive the announcement. `users.email` is unique by PostgreSQL text equality, which does not prevent differently cased duplicates.
- **Rationale:** The promised boundary is an inbox, not a database row. Exclusion and deduplication must use the same normalized identity.
- **Impact:** Shared or differently cased addresses can still receive two messages for the same transition.
- **Recommended action:** Resolve actor and targeted email addresses first. Normalize all addresses with at least `trim().toLowerCase()`, exclude by normalized email, and then select one final message per normalized email. Keep user IDs for audit and authorization only.
- **Open questions:**
  - Are intentionally shared mailboxes supported?
  - Should plus-address aliases be treated as separate inboxes? Usually yes unless product explicitly says otherwise.

### F11 — RC7 is not fixed and may not be a duplicate

- **Relevant section:** RC6 and RC7; Design principle; Phase 1 call sites
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Scope
- **Description:** The central events lead who received a proposal email is not passed to any later `targetedRecipientIds` list. The listed calls pass no target, the creator, or the assignee. The later publication announcement therefore still reaches the lead if they qualify.
- **Rationale:** Proposal and publication also happen at different state transitions, while the stated principle only prevents overlap within one transition.
- **Impact:** The specification claims to close an issue that the proposed code does not address. Trying to close it may also suppress a legitimate later update.
- **Recommended action:** Decide whether RC7 is a bug. If messages from different transitions are allowed, remove RC7 from Phase 1. If the lead should receive only one message for the whole event lifecycle, store recipient/template history and state that broader rule explicitly.
- **Open questions:**
  - Is the publication announcement useful to someone who saw the earlier proposal?
  - What time gap or content difference makes two lifecycle emails acceptable?

### F12 — Phase status contradicts unresolved product decisions

- **Relevant section:** Status; Phase 1; Open questions 1–4
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / Product
- **Description:** Phase 1 is described as requiring no product decision, but it implements the recommended answer to question 2 by excluding the actor. Question 3 affects whether RC6/RC7 work should be included, and question 4 affects whether the proposed Phase 2 audience will work.
- **Rationale:** Recommendations are not confirmed requirements. The document does not record an owner, decision date, or accepted answer.
- **Impact:** Developers may implement behavior that the product owner has not approved and estimate work that may later be removed or expanded.
- **Recommended action:** Add a decision log with owner and status. Mark Phase 1 ready only after the actor rule, delivery guarantee, and RC6/RC7 scope are accepted. Mark Phase 2 blocked on the complete audience and preference model, not only question 1.
- **Open questions:**
  - Who can approve these decisions?
  - By what date are decisions needed to protect the delivery plan?

### F13 — Phase 2 audience rules are incomplete

- **Relevant section:** Phase 2; Open questions
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security / Functional
- **Description:** “Users linked to one of the event's venues” does not explicitly say to compare `users.venue_id` with every `event_venues.venue_id`, using `events.venue_id` only as fallback. Role eligibility, unaccepted invites, users without venues, deactivation during queueing, global opt-in scope, and actor/target suppression are not defined.
- **Rationale:** These choices determine who receives internal event information. Multi-venue behavior is already a first-class part of the event model.
- **Impact:** Different implementations can produce different audiences, and preference changes can widen access unexpectedly.
- **Recommended action:** Add an exact recipient predicate and examples for single-venue, multi-venue, no-venue, central-lead, actor, creator, assignee, deactivated, and shared-email users. State whether the audience is snapshotted at transition time or recalculated by the worker.
- **Open questions:**
  - Can any active user opt into all-venue announcements?
  - Is the preference self-service or administrator-managed?
  - Do users attached to a venue receive announcements even when they opt out?
  - What account state counts as active enough to email?

### F14 — The new preference can drift from the existing central lead

- **Relevant section:** Phase 2 backfill
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data / Simplification
- **Description:** The repository already has `users.is_central_events_lead`, a unique central-lead setting, and a resolver with administrator fallback. Backfilling a separate `receives_event_announcements` flag once does not update it when the central lead later changes.
- **Rationale:** The old lead can remain opted in and the new lead can remain opted out unless every lead-management path also synchronizes the second field.
- **Impact:** Audience membership drifts from the role used to justify it, creating support and privacy surprises.
- **Recommended action:** If the only global exception is the central lead, query `is_central_events_lead` directly and do not add a second flag. Add a separate preference only if multiple ordinary users genuinely need global opt-in, and define it as independent rather than role-derived.
- **Open questions:**
  - Is there ever more than one global announcement subscriber?
  - Should administrator fallback recipients receive announcements when no central lead is configured?

### F15 — Phase 2 is not independently buildable from this specification

- **Relevant section:** Phase 2; Database changes; Testing; Rollout
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / Scope
- **Description:** The database section specifies only `events.announced_at`. Phase 2 has no exact migration, backfill selection, account action changes, UI behavior, validation, audit metadata, permission rule, generated-type changes, tests, rollout check, or rollback plan.
- **Rationale:** The status claims two independently deployable changes, but only Phase 1 is described to implementation depth.
- **Impact:** Phase 2 will require rediscovery and can ship with inconsistent data or access rules.
- **Recommended action:** Either split Phase 2 into its own specification after the audience decision or complete all implementation and acceptance details here. Re-estimate it after deciding whether the existing central-lead flag is sufficient.
- **Open questions:**
  - Is Phase 2 intended for the same release?
  - Does preference history need auditing?
  - Should the UI show the last announcement sent or only the opt-in value?

### F16 — RPC and legacy paths remain inconsistent

- **Relevant section:** Call-site changes; Out of scope
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Delivery
- **Description:** Phase 1 changes both the RPC and legacy branches, but the RPC path still omits targeted submission/decision mail and its deployed authorization still uses `office_worker`. Local Docker enables `EVENT_SAVE_USE_RPC`, while the stated production environment does not.
- **Rationale:** An environment or flag change can silently switch to different status and notification behavior. Calling this out of scope does not remove the dependency from the code being changed.
- **Impact:** Local, test, preview, and future production behavior can disagree. A later flag enablement can reintroduce missing or duplicate notifications.
- **Recommended action:** State a hard precondition: keep the flag false and test that configuration until the RPC is repaired, or bring the RPC path into the same recipient and transition contract now. Add coverage for both flag states.
- **Open questions:**
  - Who owns the feature flag and can change it?
  - Is the RPC path expected to be removed or completed?

### F17 — Resend failures will be misclassified unless responses are inspected

- **Relevant section:** Phase 1 logging; Testing
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Monitoring
- **Description:** With the installed Resend SDK, `emails.send` resolves to either `{ data, error }`; provider and network errors commonly do not reject the promise. `Promise.allSettled` can therefore report a fulfilled promise whose Resend response contains an error.
- **Rationale:** The current code discards every response. Logging only `messageIds` without inspecting `response.error` will undercount failures and may treat missing IDs as success.
- **Impact:** Claims can be marked complete after provider rejection, monitoring can show false success, and tests can pass with the wrong mock behavior.
- **Recommended action:** Inspect each response, record `data.id` only on success, classify safe error codes, and include attempted/accepted/failed/skipped counts in structured logs. Test both resolved-error and thrown-error behavior.
- **Open questions:**
  - Which provider errors are retryable?
  - Should invalid-address failures be terminal while rate limits retry?

### F18 — Eligible transitions and republish semantics are not enforced

- **Relevant section:** Design principle; Phase 1 claim; Database changes
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Data
- **Description:** `notifyNewEvent` accepts only an event ID and recipient context. The claim checks only `announced_at is null`; it does not require a successful eligible transition, an allowed current status, or `deleted_at is null`. It also has no transition identifier despite the per-transition principle.
- **Rationale:** Correctness depends on three call-site snapshots. A future or mistaken call can consume the lifetime marker for a draft, deleted event, or unrelated transition.
- **Impact:** Notifications can be suppressed or sent at the wrong lifecycle point, and later code changes can break the guarantee without changing the claim.
- **Recommended action:** Define eligible source and target statuses in a truth table and enforce them atomically with transition/enqueue work. Use a transition key where later transitions can legitimately notify again.
- **Open questions:**
  - Is the first transition from `draft` to either `submitted` or `approved` the only announcement trigger?
  - Should proposal completion and direct admin creation behave identically?

### F19 — Evidence claims are stronger than the stored evidence

- **Relevant section:** Evidence; Root causes; What confirms the diagnosis
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Evidence / Delivery
- **Description:** The report lists results but not the read-only SQL, time bounds, definitions, or provider export. Database state can prove that a code path was eligible or successfully wrote certain rows, but not that Resend accepted or delivered every message. A zero best-effort audit count cannot prove that no user attempted a flow.
- **Rationale:** `recordAuditLogEntry` catches insert errors. The RPC flag inference proves no successful idempotency rows under stated conditions, not the current environment value in every deployment. The document itself says Resend is the only current source of message counts.
- **Impact:** Delivery decisions and success metrics can rely on conclusions that cannot be independently repeated from the document.
- **Recommended action:** Store the exact aggregate queries in the report or a safe companion file, with project, timestamp, and definitions. Separate “eligible call,” “provider accepted,” “delivered,” and “observed in inbox.” Rephrase absolute proof as evidence unless provider logs confirm it.
- **Open questions:**
  - Were the 94 events checked against Resend subjects and recipients?
  - Are audit and idempotency rows retained indefinitely and immutable?
  - Were any failed manager attempts visible in application logs?

### F20 — The test plan misses the highest-risk cases

- **Relevant section:** Testing
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing / Reliability
- **Description:** The listed tests do not cover the trigger and `updated_at` effects, duplicate targeted sends, duplicate event rows, proposal lifecycle, migration backfill, partial fan-out failure, Resend resolved-error responses, queue retries, or Phase 2.
- **Rationale:** Mocked unit tests cannot prove conditional-update concurrency, trigger behavior, migration correctness, or crash/retry guarantees. Notification mocks also appear in more action test files than the two named regression suites.
- **Impact:** The implementation can pass the proposed suite while still losing mail, duplicating targeted mail, or causing false edit conflicts.
- **Recommended action:** Add:
  - pure recipient-plan tests for actor, creator, assignee, central lead, multi-venue, case/whitespace duplicates, and shared inboxes;
  - real database tests for transition claims, triggers, concurrency, and migration backfill across every event status;
  - action tests for both RPC flag states and duplicate create/submit keys;
  - provider tests for success, `{ data: null, error }`, thrown errors, timeouts, partial success, and retry exhaustion;
  - worker tests for leases, concurrent workers, retries, and provider idempotency;
  - end-to-end checks for admin self-publish, admin publishing another user's event, manager submit, proposal-to-publication, revert/republish, and safe preference changes.
- **Open questions:**
  - Will real Supabase integration tests run in CI?
  - What exact message totals and recipient subjects should each journey assert?

### F21 — Deployment and rollback claims are incomplete

- **Relevant section:** Rollout; Rollback; What confirms the diagnosis
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Deployment / Migration
- **Description:** Application code that expects the new schema must not deploy before the migration. Reverting the code restores the old sender, which ignores `announced_at`; therefore the column does not suppress duplicates after a code rollback. The proposed production smoke test also broadcasts a test event to the still-wide Phase 1 audience.
- **Rationale:** Additive schema reduces destructive risk but does not remove rolling-deploy, trigger, data-backfill, or behavior rollback risk.
- **Impact:** A partial deploy can lose announcements, a rollback can reintroduce duplicates immediately, and a smoke test can email real users unnecessarily.
- **Recommended action:** Specify:
  - migration dry run and trigger/backfill validation;
  - migration-before-code ordering;
  - a backward-compatible or flagged code rollout;
  - a safe test-recipient override or non-production provider environment;
  - rollback behavior for queued/claimed deliveries;
  - post-deploy counts and a go/no-go owner.
- **Suggested wording:** “Rolling back application code re-enables the previous duplicate behavior. The additive data remains for a later forward fix; rollback must also disable the old announcement call or keep the new sender behind a controlled flag.”
- **Open questions:**
  - Can deployment guarantee schema-first ordering?
  - How will queued work be handled during rollback?
  - Is there a safe production email sandbox or allowlisted test address?

### F22 — Schema, trigger, function, and type dependencies are incomplete

- **Relevant section:** Database changes; Testing; Out of scope
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Technical / Delivery
- **Description:** The repository has both `src/lib/supabase/types.ts` and `src/lib/supabase/database.types.ts`. Adding an events column affects `%rowtype` and `to_jsonb(e.*)` use in database functions and event-version payloads. The spec says no function audit is needed because no column is dropped, which is too narrow.
- **Rationale:** An added column can change wildcard row serialization, generated types, fixtures, snapshot expectations, and public/internal adapters even when it does not break SQL compilation.
- **Impact:** Type drift, unexpected version payload changes, failing fixtures, or accidental exposure can be discovered late.
- **Recommended action:** Add both type surfaces, relevant fixtures, `notify pgrst`, trigger inspection, `%rowtype`/`select *` function review, view review, and public API regression checks to the migration checklist. Record whether `announced_at` must remain internal.
- **Open questions:**
  - Which type file is authoritative for new notification code?
  - Does any downstream export serialize the whole event row?

### F23 — Monitoring has no failure, retry, or replay contract

- **Relevant section:** Phase 1 logging; Rollout; What confirms the diagnosis
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Operations / Monitoring
- **Description:** A success log containing event ID, count, and message IDs does not cover claim failures, no-recipient decisions, provider errors, partial success, retry age, final failure, or later delivery/bounce events.
- **Rationale:** The current problem could not be diagnosed without the Resend dashboard. A new marker without a runbook can create equally invisible missing mail.
- **Impact:** Support cannot tell whether an event had no audience, was deduplicated, failed temporarily, or needs manual replay.
- **Recommended action:** Define structured events for planned, queued, claimed, accepted, failed, retried, exhausted, and skipped deliveries. Include event/transition/operation IDs and counts, avoid plaintext email, alert on aged pending rows and failure spikes, and document replay rules.
- **Open questions:**
  - Where are structured logs and alerts viewed today?
  - Who owns failed-delivery follow-up?
  - Are Resend webhooks in scope for delivered/bounced status?

### F24 — Recipient privacy and communication policy are undefined

- **Relevant section:** RC1; Phase 2; Open questions
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Security / Data governance
- **Description:** The audience currently uses only `deactivated_at is null` and an email. The spec does not define whether pending invites, dormant accounts, roles, venue access, or communication preferences make a person eligible. It also does not classify the announcement as required operational mail or optional promotional mail.
- **Rationale:** The email includes internal event timing and venue details. A self-service global opt-in can also outlive later permission-model changes.
- **Impact:** Information may be sent to unintended accounts, and opt-out expectations may be unclear.
- **Recommended action:** Document the data classification, eligible account states, authorization basis, opt-in/opt-out behavior, retention for delivery records, and safe logging fields. Re-check authorization when preference or role rules change.
- **Open questions:**
  - Is the announcement operational, optional, or marketing communication?
  - Must an invited user accept their account before receiving it?
  - How long should provider IDs and delivery history be retained?

### F25 — Capacity and provider limits are not considered

- **Relevant section:** Phase 1; Phase 2; Testing
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Performance / Integration
- **Description:** The code loads all active users, filters in memory, and starts one provider request per recipient with no audience cap or concurrency limit. Phase 2 can add unlimited global opt-ins.
- **Rationale:** Nineteen users is small, but the design has no bound and places the fan-out on a user request. Resend rate limits and serverless duration become more important as users grow.
- **Impact:** Publish latency, provider throttling, memory use, and partial failures grow with the whole user table.
- **Recommended action:** Query only eligible recipients, process queued deliveries in bounded batches, define maximum concurrency and retry backoff, and add a volume test at an agreed future size.
- **Open questions:**
  - What is the expected user count in 12–24 months?
  - What Resend quota and rate limit apply to the production account?

### F26 — Accessibility requirements for the preference change are missing

- **Relevant section:** Phase 2 account preferences
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Accessibility
- **Description:** Phase 2 adds a communication control but does not state its label, explanation, error/status behavior, keyboard behavior, or how the consequence of global opt-in is communicated. Email-client accessibility checks are also absent.
- **Rationale:** The existing account form provides a useful accessible pattern, but new controls still need explicit acceptance criteria to avoid an unlabeled or unclear toggle.
- **Impact:** Users may not understand or be able to operate the preference reliably, especially with assistive technology.
- **Recommended action:** Reuse the existing labeled form pattern with clear help text, inline error association, pending state, and announced success. Test keyboard and screen-reader output. Keep a complete plain-text email and use descriptive links/headings.
- **Open questions:**
  - Should the control say “all venues” explicitly?
  - Is the preference a checkbox, select option, or administrator-only field?

### F27 — Build one final recipient plan before sending

- **Relevant section:** Design; Phase 1 and Phase 2
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification / Maintainability
- **Description:** Current design sends targeted mail separately, then asks the announcement function to subtract IDs.
- **Rationale:** A pure planner can normalize addresses, apply audience rules, assign template priority, and return exactly one final message per address before any side effect.
- **Impact:** Fewer call-site contracts, clearer tests, and less risk of template overlap.
- **Recommended action:** Create a pure `planNewEventNotifications(context)` function and keep persistence/provider work in a separate delivery layer. Test the planner as a table of user journeys.
- **Open questions:** None once the product matrix in F01 is approved.

### F28 — Separate the immediate hotfix from the durable redesign

- **Relevant section:** Complexity; Phase 1; Rollout
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Delivery / Risk
- **Description:** The document combines an urgent visible duplicate fix with lifetime idempotency, concurrency, audience preferences, and observability.
- **Rationale:** A narrow, reversible hotfix can reduce harm while the reliable outbox and audience model are completed.
- **Impact:** Faster risk reduction without pretending the durable guarantee is finished.
- **Recommended action:** Consider:
  1. Immediate hotfix: temporarily disable or conservatively scope the announcement and exclude actor/target by normalized email.
  2. Durable delivery: transition-level recipient planner, outbox, retries, provider idempotency, monitoring.
  3. Preference expansion: only after the audience decision.
- **Open questions:**
  - Is pausing the announcement acceptable for one release?
  - What is the required hotfix date?

### F29 — Consider provider batch sending after correctness is fixed

- **Relevant section:** Phase 1 fan-out
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Performance / Cost
- **Description:** Each personalized announcement currently makes a separate Resend API request.
- **Rationale:** Batch sending may reduce request overhead, but it must not replace per-recipient delivery state, response inspection, or idempotency.
- **Impact:** Lower provider/API overhead for larger audiences.
- **Recommended action:** Evaluate the installed SDK's batch endpoint after recipient planning and retry semantics are correct. Keep deterministic mapping between each batch item and its delivery row, and respect provider batch limits.
- **Open questions:**
  - Does the provider's batch endpoint support the needed idempotency and per-item error detail?
  - Is personalization worth retaining for this operational message?

## Required changes before implementation

1. Confirm the exact “one email” rule and expected message matrix.
2. Decide the approved announcement audience before shipping the live fan-out again.
3. Remove the claim that the event marker fixes duplicate event creation or all concurrent targeted mail.
4. Move notification state off `events`, or fully solve trigger, `updated_at`, privilege, and stale-token effects.
5. Choose an explicit delivery guarantee and design per-recipient retry/idempotency behavior.
6. Queue email work outside the user action with bounded processing.
7. Correct the migration/backfill for proposal and reverted-draft lifecycles.
8. Define the targeted-recipient result/fallback contract and normalize exclusions by email.
9. Either repair/freeze the RPC path or include it in the same behavior contract.
10. Expand tests, deployment sequencing, monitoring, and operational replay requirements.

## Unresolved decisions

- Does “one email” mean per inbox or total outbound messages?
- Who receives the announcement for single- and multi-venue events?
- Should the actor receive any targeted confirmation, announcement, or neither?
- Does a proposal email make the later publication announcement unnecessary?
- Is the announcement once per event lifetime or once per eligible transition?
- Is at-most-once attempt acceptable, or must transient failures retry?
- Does provider acceptance or final delivery define success?
- Is global opt-in self-service, administrator-managed, or replaced by the existing central-lead flag?
- May the announcement be disabled until audience scoping is agreed?
- Is fixing duplicate event creation part of the same release?

## Major risks

- Duplicate targeted emails remain during concurrent publishes.
- Duplicate event rows can still produce two complete broadcasts.
- A claimed event can permanently lose some or all email delivery.
- Runtime and migration marker updates can change event concurrency tokens.
- Phase 1 can continue emailing an over-wide audience.
- The backfill can suppress first-time announcements for proposal-path events.
- Provider errors can be logged as fulfilled work.
- A code rollback can immediately restore the old duplicate behavior.
- RPC and legacy paths can diverge by environment.

## Recommended next steps

1. Hold a short product decision session for the unresolved recipient and lifecycle rules.
2. Confirm the production diagnosis with safe aggregate SQL plus Resend acceptance records for two or three example events.
3. Choose between a narrow emergency suppression/scoping hotfix and the durable outbox design.
4. Draft the recipient journey matrix and delivery-state model before implementation tasks.
5. Prototype the migration against local Supabase, including event triggers, backfill statuses, and concurrent workers.
6. Update the specification with accepted decisions and narrower claims.
7. Re-estimate Phase 1 and Phase 2, assign owners, and define release evidence and rollback steps.
