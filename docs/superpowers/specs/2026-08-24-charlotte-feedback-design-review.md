# Charlotte's August Feedback: Developer Specification Review

**Specification reviewed:** `docs/superpowers/specs/2026-08-24-charlotte-feedback-design.md`  
**Review date:** 2026-08-24  
**Review scope:** Functional completeness, architecture, data, security, integrations, performance, accessibility, operations, migration, deployment, testing, and delivery  
**Original specification changed:** No

## Overall assessment

**Readiness: Not ready for implementation as one programme.**

The two main defect diagnoses are credible and well supported by the repository. The planning-form validation hotfix can move forward after its error-handling boundary is agreed. The other slices still contain product decisions, security conflicts, migration gaps, and delivery assumptions that a developer should not be expected to resolve while coding.

The most serious blockers are:

1. The proposed “no venue lock” for manager proposals conflicts with the approved project permission model. The live service-role RPC does not enforce the manager's venue, so widening the UI capability as written would allow a venue-assigned manager to propose for any venue.
2. The task-reopening operation has no authoritative provenance marker, exact selection contract, tested rollback, or internally consistent count. A five-second timestamp heuristic is not enough for a production reversal.
3. Adding a defaulted argument to `pre_approve_event_proposal` changes its PostgreSQL signature. `CREATE OR REPLACE FUNCTION` cannot replace the existing two-argument function with a three-argument function, and leaving both overloads can make PostgREST resolution ambiguous.
4. SOP target dates are currently derived from UTC text or a session-dependent cast rather than explicitly from the London calendar date. This can put early-morning BST events on the previous day's checklist.
5. The template-set proposal is a direction, not a complete data design. Matching, precedence, versioning, dependencies, editing, fallback, deletion, and the four task lists are unresolved.
6. Acceptance criteria, deployment order, rollback, monitoring, and production verification are not defined per slice. The claim that all nine slices are independently deployable is not correct.

### Readiness by slice

| Slice | Assessment | Main reason |
|---|---|---|
| 0 — Planning form hotfix | **Conditionally ready** | Fix can start, but checklist-generation failure and accessible error-summary behaviour must be included. |
| 1 — AI description | **Not ready** | Exact allowed statuses, publication marker, slug policy, overwrite handling, and concurrency are unclear. |
| 2 — Proposal end time | **Conditionally ready** | Product choice is simple, but error handling, deployment order, old null rows, and DST behaviour need acceptance criteria. |
| 3 — Manager proposals | **Blocked** | Venue authorization and the capability/call-site matrix conflict with the current proposal. |
| 4 — Re-enable checklists | **Blocked** | Client workload decision and a safe, reversible backfill contract are missing. |
| 5 — SOP picker | **Not ready** | RPC evolution and the persisted selection/edit model are incomplete. |
| 6 — Dependencies | **Partly defined** | A database-level cycle invariant and a notification delivery contract are missing. |
| 7 — Template sets | **Discovery only** | Data model and client content are incomplete. |
| 8 — Past items and deadlines | **Blocked** | “Past”, debrief visibility, rescheduling, weekend handling, and affected queries are unresolved. |

## Classification

- **Confirmed issue:** A contradiction, missing requirement, unsafe assumption, or repository incompatibility that must be resolved for the affected slice.
- **Optional improvement:** Not required for basic correctness, but likely to simplify delivery or reduce future risk.
- **P0:** Resolve before implementation of the affected slice starts.
- **P1:** Resolve in the specification before the slice is build-ready.
- **P2:** Resolve before production release.
- **P3:** Optional improvement.

## Evidence reviewed

- The full source specification, without modification.
- Current role helpers, proposal actions, event actions, planning actions, event/planning data helpers, notifications, datetime helpers, event board, dashboard queries, and cron routes.
- Current Supabase migrations for proposal RPCs, event status transitions, SOP generation, dependencies, RLS, event/planning venue links, and checklist backfills.
- Current Vitest, integration-test, and Playwright configuration.
- Relevant existing tests for proposals, roles, SOP generation, event listing, the proposal form, and weekly email behaviour.

The following targeted suite was run unchanged during this review:

```text
6 test files passed
148 tests passed
```

This review did not query the live production database. Production figures in the source specification therefore remain claims from that document unless a reproducible query is supplied.

## Unconfirmed assumptions

| Assumption | Why confirmation is needed | Related finding |
|---|---|---|
| Charlotte's seven requested items are fully represented by the nine sections | The source email and referenced SOP document are not included, so scope traceability cannot be checked. | F01, F25 |
| A seven-day grace period is the correct definition of “past” | The document proposes it but does not record client agreement or explain why seven days is right. | F05 |
| Post-event debrief work should remain visible | The request to hide past work directly conflicts with the debrief journey. | F05, F06 |
| Administrators, not proposers, complete approved proposal details | This is listed as a decision, but current user-facing copy says the creator can complete them. | F09 |
| Proposal end time must be required | The delivery table still lists client confirmation as a blocker. | F11 |
| “Published” can be derived reliably from existing history | No authoritative `published_at` field is identified, and audit writes are best effort. | F13 |
| Reopening tasks will not trigger an unacceptable volume of visible work or emails | The document gives counts but no workload owner, staged rollout, or notification policy. | F03, F24 |
| Completion within five seconds proves a task was closed by the kill switch | The same fields can be written by other automated paths, and no reason column records this decision. | F23 |
| Existing task deadlines should or should not be weekend-adjusted | The proposed weekend nudge does not say whether it is prospective only. | F22 |
| Existing event checklists should be re-based when an event date changes | The defect is identified but omitted from decisions and delivery. | F21 |
| Template matching by mutable text labels is acceptable | Event and planning type labels can change and are not stable identifiers. | F25, F34 |
| Email is the right unblock notification channel | Recipient, channel, timing, opt-out, deduplication, and escalation are not confirmed. | F20 |
| Current data volumes are representative | No growth expectation or query-plan evidence is supplied. | F30 |
| The stale-approval route is scheduled externally | It is not present in `vercel.json`. | F10 |

## Findings index

| ID | Title | Status | Priority | Type |
|---|---|---|---|---|
| F01 | Scope, status, and decisions contradict each other | Confirmed issue | P0 | Product / Delivery |
| F02 | Slice-level acceptance criteria are missing | Confirmed issue | P0 | Functional / Testing |
| F03 | Re-enabling checklists has no safe activation contract | Confirmed issue | P0 | Product / Operations |
| F04 | Manager proposal venue scope violates the project permission model | Confirmed issue | P0 | Security / Authorization |
| F05 | “Past” is not defined well enough to implement | Confirmed issue | P1 | Functional / Datetime |
| F06 | The proposed to-do filter can hide required debrief work | Confirmed issue | P1 | Functional / Data |
| F07 | Dashboard query separation is noted but not designed | Confirmed issue | P1 | Architecture / Performance |
| F08 | The manager capability split needs an explicit call-site matrix | Confirmed issue | P0 | Security / Functional |
| F09 | Post-approval ownership conflicts with current UI and workflow copy | Confirmed issue | P1 | Functional / UX |
| F10 | Stale proposal expiry is undefined, unconfirmed as scheduled, and non-atomic | Confirmed issue | P1 | Reliability / Operations |
| F11 | Proposal end-time behaviour and failure handling are incomplete | Confirmed issue | P1 | Functional / Datetime |
| F12 | SOP event dates are not consistently calculated in London time | Confirmed issue | P0 | Data / Datetime |
| F13 | AI status and “published” rules are ambiguous | Confirmed issue | P1 | Functional / Data |
| F14 | Slug freezing needs a durable URL and override policy | Confirmed issue | P1 | Integration / Data |
| F15 | AI generation reliability, cost, and concurrency controls are missing | Confirmed issue | P2 | Reliability / Security |
| F16 | SOP exclusion persistence and edit semantics are undefined | Confirmed issue | P1 | Functional / Data |
| F17 | SOP creation can fail while the user is told the item was created successfully | Confirmed issue | P0 | Reliability / Error handling |
| F18 | The approval RPC signature cannot be evolved as described | Confirmed issue | P0 | Database / Migration |
| F19 | Dependency integrity is left at the application layer | Confirmed issue | P1 | Data / Concurrency |
| F20 | Unblock notifications do not have a delivery contract | Confirmed issue | P1 | Integration / Notifications |
| F21 | Event date changes do not update checklist dates and no slice owns the fix | Confirmed issue | P1 | Functional / Data |
| F22 | Weekend adjustment and manual overrides are not specified | Confirmed issue | P1 | Functional / Migration |
| F23 | The task-reopening population is heuristic and internally unclear | Confirmed issue | P0 | Data / Migration |
| F24 | The production data operation lacks rollback and audit detail | Confirmed issue | P0 | Deployment / Operations |
| F25 | The template-set model and client content are not ready | Confirmed issue | P0 | Product / Data model |
| F26 | Delete protection covers too little of the destructive path | Confirmed issue | P1 | Data integrity / Security |
| F27 | The delivery slices are not independent and estimates lack exit criteria | Confirmed issue | P1 | Delivery / Dependencies |
| F28 | The test plan is inaccurate and incomplete | Confirmed issue | P1 | Testing / Quality |
| F29 | Accessibility requirements are too narrow | Confirmed issue | P2 | Accessibility |
| F30 | Performance and concurrency limits are not defined | Confirmed issue | P2 | Performance / Reliability |
| F31 | Monitoring, success measures, and release verification are missing | Confirmed issue | P1 | Monitoring / Operations |
| F32 | Production evidence is not reproducible from the document | Confirmed issue | P1 | Evidence / Delivery |
| F33 | Centralise event-window and London-date policy | Optional improvement | P3 | Simplification / Maintainability |
| F34 | Prefer archived, versioned template configuration over hard deletion | Optional improvement | P3 | Simplification / Data |
| F35 | Separate hotfix, stabilisation, and discovery workstreams | Optional improvement | P3 | Delivery / Simplification |

## Detailed findings

### F01 — Scope, status, and decisions contradict each other

- **Relevant section:** Header; Sections 3, 4, and 6
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Product / Delivery
- **Description:** The document says it is awaiting review and client confirmation, then records 15 “decisions taken”. It says unresolved client answers are in a covering message that is not part of the specification. It also says Charlotte supplied seven items but presents nine item sections. Finally, it says slices 0, 1, and 2 can start with little or no input while the delivery table marks slices 1 and 2 as blocked by client confirmation.
- **Rationale:** A developer cannot tell which choices are approved requirements, recommendations, or unresolved proposals.
- **Impact:** Work can start on behaviour the client has not accepted, and QA has no authoritative expected result.
- **Recommended action:** Add a decision register with `Proposed`, `Confirmed`, or `Rejected`, decision owner, date, and affected slices. Attach or summarise the missing covering questions. Map every source request to one numbered requirement.
- **Suggested wording:** “**Status:** Draft. Slice 0 may proceed as a defect hotfix. All other slices are blocked until the decisions marked ‘Client confirmation required’ are resolved.”
- **Open questions:** Which of the 15 choices has Peter approved, which has the client approved, and what are items 8 and 9 relative to the stated seven-item source?

### F02 — Slice-level acceptance criteria are missing

- **Relevant section:** Sections 2, 4, and 7
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Testing
- **Description:** The document gives implementation suggestions and test ideas but no Given/When/Then outcomes for each user journey. It does not define success, failure, empty, permission-denied, concurrent, retry, or partial-failure behaviour per slice.
- **Rationale:** A design is not build-ready until product behaviour can be tested without interpreting prose or reading code comments.
- **Impact:** Different developers can implement different meanings of “past”, “editable”, “published”, “unblocked”, or “not required”. Sign-off becomes subjective.
- **Recommended action:** Add acceptance criteria per slice covering roles, statuses, date boundaries, multi-venue rows, null/legacy data, errors, retries, and observable audit/notification results. Give each slice an explicit entry and exit condition.
- **Open questions:** Who signs off each slice: Peter, Charlotte, Georgia, or an operational owner?

### F03 — Re-enabling checklists has no safe activation contract

- **Relevant section:** Defect A; Decisions 2; Slices 4 and 5
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Product / Operations
- **Description:** Changing the kill switch affects every newly created future event immediately, while reopening historical tasks is a separate action. The specification does not define a feature flag, activation date, pilot venue, assignee notification policy, workload owner, or stop condition if task volume is wrong.
- **Rationale:** This is an operational launch, not only a one-line bug fix. It creates dozens of visible obligations per event for named staff.
- **Impact:** Staff can receive a sudden workload spike, overdue counts can jump, and emails or dashboards can become noisy before the backfill decision is settled.
- **Recommended action:** Separate prospective activation from historical reopening. Put prospective activation behind a short-lived server flag or explicit effective date, dry-run the next events and assignees, pilot one venue if practical, then remove the flag after verification. Define whether activation sends any notification.
- **Open questions:** What is the approved activation date, who owns the new tasks, and should events already created but not backfilled remain unchanged until separate approval?

### F04 — Manager proposal venue scope violates the project permission model

- **Relevant section:** Item 2; Decisions 3 and 4
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security / Authorization
- **Description:** The specification recommends no venue lock. Project rules require a manager with `venue_id` to be scoped to that venue, while a manager without `venue_id` may propose for any venue. The current default path calls `create_multi_venue_event_proposals` with the service-role client. That RPC validates the payload's `created_by` role but does not load or enforce the manager's assigned venue.
- **Rationale:** Defaulting a picker is not authorization. The authenticated `propose_event_draft` RPC does enforce assigned-venue scope, but that route is disabled by `EVENT_SAVE_USE_RPC`.
- **Impact:** Widening `canProposeEvents` as proposed would let the one venue-assigned manager submit proposals for other venues through the live path.
- **Recommended action:** Enforce the approved rule in both the server action and the service-role RPC: assigned managers may submit only their assigned venue; unassigned managers may choose any valid venue; administrators may choose any venue. Keep `created_by` authoritative from the authenticated session. Add negative integration tests.
- **Suggested wording:** “Managers with a venue assignment may propose only for that venue. Managers without a venue assignment may propose for any venue. The same rule is enforced in UI, server action, RPC, and tests.”
- **Open questions:** None unless the approved project permission model itself is being changed; that would require a separate security decision.

### F05 — “Past” is not defined well enough to implement

- **Relevant section:** Item 1; Slice 8
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Datetime
- **Description:** The proposal uses “ends within the last 7 days, or later”, but does not define the exact London-time boundary, inclusive/exclusive comparison, handling of null `end_at`, drafts and proposals, multi-day events, events in progress, cancelled/rejected rows, or a past-month deep link. The current list has special exceptions for drafts and recently created rows that the new server filter would remove.
- **Rationale:** Different views currently apply different rules. A server lower bound also changes search, count, filter, and URL behaviour, not only rendering.
- **Impact:** Valid drafts or proposals can disappear, an event can appear in one view and not another, and `?month=` links to old months can open empty unless `past=1` is also supplied.
- **Recommended action:** Add a status/date truth table. Define `past` using an explicit London instant and define fallback behaviour for null end time. Specify how `?past=1`, old month links, browser persistence, search, counts, and all desktop/mobile views interact.
- **Open questions:** Is the grace period 0, 1, or 7 days? Are drafts/proposals always discoverable regardless of date? Should cancelled and rejected events be shown in the normal list?

### F06 — The proposed to-do filter can hide required debrief work

- **Relevant section:** Item 1; Item 8; Slice 8
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Data
- **Description:** The specification says to add the same event lower bound to the planning-task query. Current task queries do not carry a complete event window, include standalone planning items, and also surface post-event debrief tasks. The daily sweep already marks past-event pre-event tasks not required while deliberately preserving debrief tasks.
- **Rationale:** A blanket lower bound either needs a new event join or can only be applied in memory. More importantly, it conflicts with the stated need to keep debriefs visible.
- **Impact:** Staff may lose the only prompt for a required debrief, while non-event campaigns may be filtered incorrectly or not at all.
- **Recommended action:** Define separate policies for pre-event SOP tasks, post-event debrief tasks, and standalone planning tasks. Do not use one generic date filter. Reuse the task phase or template key so debriefs are intentionally included or excluded.
- **Open questions:** Should overdue debriefs remain on the to-do list after their event disappears from `/events`? If yes, for how long and for which users?

### F07 — Dashboard query separation is noted but not designed

- **Relevant section:** Item 1, “Regression risk”
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Architecture / Performance
- **Description:** The document correctly notices that `getDashboardOperationsSnapshot` must not receive the narrowed list, but “give the dashboard its own unbounded query” is not a complete contract. It does not define role visibility, selected columns, event ID bounds, pagination, payment/booking time windows, or failure isolation.
- **Rationale:** Re-loading full `EventSummary` rows with nested venues and artists only to calculate booking metrics is wasteful and can repeat the same scaling problem.
- **Impact:** Dashboard metrics can become incorrect, slower, or wider than the user's authorized event scope.
- **Recommended action:** Add a dedicated, minimal server query for the exact event IDs needed by booking and payment pulse, preserving join-first venue visibility. Capture one calculation cutoff. Add regression tests proving old-event bookings still count when the events list is narrowed.
- **Open questions:** Are booking metrics global for managers or venue-scoped by the same rules as events?

### F08 — The manager capability split needs an explicit call-site matrix

- **Relevant section:** Item 2
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security / Functional
- **Description:** The document lists 11 call sites but does not state which new capability each must use. Widening `canProposeEvents` affects both `/events/propose` and `/events/new` controls, and also affects `generateWebsiteCopyFromFormAction`, an administrator-costed AI server action with no event context.
- **Rationale:** “Repoint accordingly” is too vague for authorization code. Every route, action, menu item, dashboard button, and form action needs a named expected result for administrator, assigned manager, and unassigned manager.
- **Impact:** Managers could see the full new-event route, call an unintended AI action, or encounter a database error after completing a long form.
- **Recommended action:** Define capabilities such as `canCreateEvents`, `canProposeEvents`, `canGenerateDraftWebsiteCopy`, and `canReviewEvents`. Add a call-site matrix and fail-closed tests for direct server-action invocation, not only UI visibility.
- **Open questions:** Should managers ever use AI generation on the quick proposal form, or is it administrator-only until details are completed?

### F09 — Post-approval ownership conflicts with current UI and workflow copy

- **Relevant section:** Item 2; Decision 5
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / UX
- **Description:** Decision 5 says an administrator completes approved proposal details. Current `preApproveEventAction` returns “The creator can now complete the details”, the status name implies add-details work, and older migration comments describe a venue-manager completion path. Current authorization nevertheless makes editing administrator-only.
- **Rationale:** Permission, task ownership, status labels, success messages, emails, dashboard cards, and expiry rules must describe the same journey.
- **Impact:** A manager can be told to complete an event they cannot open for editing, while administrators may not know the work belongs to them.
- **Recommended action:** Confirm ownership, then update every user-facing message and assignment rule. If administrators own completion, route the task/card to administrators and do not tell the proposer they can edit. If managers own it, that is a larger authorization and RLS change and must leave this slice.
- **Open questions:** Who is accountable for details, who is notified on approval, and should the proposer see a read-only progress state?

### F10 — Stale proposal expiry is undefined, unconfirmed as scheduled, and non-atomic

- **Relevant section:** Item 2, “Operational cautions”; Slice 3
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Reliability / Operations
- **Description:** The route uses `max(start_at, updated_at) < now - 14 days`, so it normally expires an item only after the event start is more than 14 days past, not simply after 14 days in a queue. It is not listed in `vercel.json`, so its production schedule is not proved by the repository. It inserts a rejection approval before a conditional event update; a concurrent status change can leave a rejection record even when the event was not rejected.
- **Rationale:** The specification describes it as a backlog risk without defining the intended expiry clock or confirming that it runs.
- **Impact:** Proposals may expire too late, never run, or leave contradictory approval history.
- **Recommended action:** Decide the business rule: age since proposal, time before start, time after start, or inactivity. Put select/decision/update/audit in one transactional RPC with compare-and-set semantics. Add the scheduler explicitly or document the external scheduler and monitor it.
- **Open questions:** Should `approved_pending_details` ever auto-reject? Who is warned before expiry, and can an expired proposal be restored?

### F11 — Proposal end-time behaviour and failure handling are incomplete

- **Relevant section:** Item 3; Slice 2
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Datetime
- **Description:** Required end time and a full datetime control are sensible, but the specification does not cover existing null proposal rows, local three-hour autofill across DST, start edits after the end was manually changed, exact validation error placement, past dates, server normalization errors, or sanitized database failures. The current service-role path returns raw database error text.
- **Rationale:** The client validation, both proposal RPCs, event constraint, email, pending list, and clash check must agree. A client refine alone is not an error-handling contract.
- **Impact:** Users can see technical SQL errors, lose form state, or get different results under the feature flag. Existing null rows can display 1970 if any formatter remains unsafe.
- **Recommended action:** Define client and server acceptance cases for same-time, end-before-start, overnight, spring gap, autumn repeated hour, and existing null rows. Catch datetime normalization errors and return field errors. Deploy compatible RPC changes before code that depends on them, then regenerate database types.
- **Open questions:** Is +3 hours wall-clock time or elapsed time across DST? May an administrator approve one of the two existing null-end proposals without first adding an end time?

### F12 — SOP event dates are not consistently calculated in London time

- **Relevant section:** Items 5 and 8
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data / Datetime
- **Description:** `createEventPlanningItem` derives `targetDate` with `startAt.slice(0, 10)` from a UTC ISO value. `pre_approve_event_proposal` uses `start_at::date`, which depends on the database/session timezone. Neither explicitly derives the `Europe/London` calendar date.
- **Rationale:** An event at 00:30 BST is stored as 23:30 UTC on the previous date. Its SOP deadlines can therefore be one day early. “Zero drift” against stored `target_date` does not prove the target date matches the user's intended London date.
- **Impact:** All T-minus deadlines and the debrief date can be wrong for early-morning events, with different results between creation routes.
- **Recommended action:** Define one London-date helper and SQL expression, for example `timezone('Europe/London', start_at)::date`, and use it on every creation, approval, reschedule, and recalculation path. Add BST/GMT boundary tests.
- **Open questions:** Is the SOP anchor always the local start date, even when an event ends after midnight?

### F13 — AI status and “published” rules are ambiguous

- **Relevant section:** Item 4; Decision 7
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Data
- **Description:** “Any editable status except `pending_approval`” is not an explicit allow-list. It could include `rejected`, `cancelled`, and `completed`, and `canEditEvent` currently checks role rather than status. The proposed slug rule depends on “has ever been published”, but no authoritative field is named.
- **Rationale:** Status transitions can return an approved event to draft. Current status alone cannot prove publication history, and best-effort audit rows are not a safe source of truth.
- **Impact:** AI can be enabled on inappropriate records, or a live URL can change because publication history was misdetected.
- **Recommended action:** Add a complete status matrix for UI and server. Introduce or identify a durable publication marker such as `first_published_at`; define how legacy rows are backfilled. Keep UI and server tests paired.
- **Open questions:** Should generation be allowed for `approved_pending_details`, `draft`, `needs_revisions`, `submitted`, `approved`, and `completed`? What about rejected or cancelled records?

### F14 — Slug freezing needs a durable URL and override policy

- **Relevant section:** Item 4
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Data
- **Description:** Freezing `seo_slug` protects the external brand-site URL, but the specification does not define behaviour when a published event has no slug, when an administrator must correct a bad slug, when two generations race, or when the external site has cached the old URL. No redirect plan is given for slugs that have already changed. Decision 14 says the public API is untouched; that may be true at source-code level, but the slug and URL contract consumed by the public API and brand site is still affected.
- **Rationale:** `events.seo_slug` is unique and consumed by public routes. URL stability is an integration contract, not only a payload choice.
- **Impact:** A correction may be impossible, a concurrent generation may fail on the unique constraint, or external links may break without redirects.
- **Recommended action:** Define: first assignment, freeze point, manual override permission, redirect/history behaviour, uniqueness conflict handling, and legacy backfill. Use optimistic concurrency for regeneration and return a clear conflict message.
- **Open questions:** Is a manual slug edit allowed after publication? If yes, must the old slug redirect permanently?

### F15 — AI generation reliability, cost, and concurrency controls are missing

- **Relevant section:** Item 4; Test plan slice 1
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Reliability / Security
- **Description:** The document covers one overwrite path but not repeated direct server calls, concurrent generate/publish actions, timeout/retry behaviour, rate or cost limits, model-output validation failures, audit detail, or whether internal proposal notes may be sent to the AI provider at an earlier lifecycle stage.
- **Rationale:** Client disabling is not a server-side concurrency or cost control. Earlier generation expands the set of incomplete and potentially internal data sent to the model.
- **Impact:** Copy can be overwritten, costs can spike, or sensitive operational notes can be processed unexpectedly.
- **Recommended action:** Define a server-side in-flight/idempotency rule, expected-update check, safe retry response, output validation, rate limit, and structured success/failure logging. Confirm which fields are sent at each status and exclude fields not required for public copy.
- **Open questions:** What is the accepted model/cost ceiling, and may proposal notes be sent to the AI service before approval?

### F16 — SOP exclusion persistence and edit semantics are undefined

- **Relevant section:** Item 5; Slice 5
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Data
- **Description:** Adding an exclusion array to `planning_items` records the initial choice but does not define it as source of truth or snapshot. The document does not say what happens when an exclusion is later added or removed, when the task is already done, when a template was deleted, when a dependent task remains required, or when per-venue child tasks exist.
- **Rationale:** Persisting a value implies it can be read and edited. Actual task statuses can diverge from that array immediately.
- **Impact:** Editing can reopen completed work, leave stale dependencies, or show a selection that no longer matches the generated checklist.
- **Recommended action:** Choose one contract. The simplest first release is apply-once selection with no edit UI and an explicit immutable snapshot. If editing is required, define status transitions, conflict rules, audit history, deleted templates, dependency checks, and child-task handling.
- **Open questions:** Can users change exclusions after approval? Does unticking N/A reopen a task, and if so who is notified?

### F17 — SOP creation can fail while the user is told the item was created successfully

- **Relevant section:** Defect B; Item 6; Slice 0
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Reliability / Error handling
- **Description:** After validation is fixed, `createPlanningItemAction` catches checklist-generation errors, logs them, and still returns “Planning item created.” Direct event creation follows a similar pattern. The item and venue links can also be committed before the checklist fails.
- **Rationale:** The user's intention includes creating the selected SOP checklist, not only the parent row. Silent partial success is especially dangerous after checklist functionality is re-enabled.
- **Impact:** Users believe the work exists when no tasks were created, and there is no repair prompt or queued retry.
- **Recommended action:** Define the transaction boundary. Prefer one RPC that creates the item, venue links, checklist, exclusions, dependencies, and audit atomically. If atomic creation is impractical, return a visible partial-success state, record a repairable failure, and provide an idempotent retry job.
- **Open questions:** Should a planning item be deleted automatically when checklist generation fails, or kept with a visible “checklist failed” recovery action?

### F18 — The approval RPC signature cannot be evolved as described

- **Relevant section:** Item 5, proposed change 1
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Database / Migration
- **Description:** Adding `sopNotRequiredTemplateIds` as a third defaulted argument creates a new PostgreSQL function signature. `CREATE OR REPLACE FUNCTION` cannot change input argument types/count. If the existing two-argument function remains, a two-argument RPC call can match both the exact function and the new function using its default, creating ambiguous PostgREST behaviour.
- **Rationale:** A default preserves SQL call syntax only after the old overload is safely removed or a new function name/version is used.
- **Impact:** Production RPC calls can fail, schema reload can expose two overloads, and a clean database reset can behave differently from an upgraded database.
- **Recommended action:** Write an explicit migration strategy: create a versioned function or drop the old signature and create the new defaulted signature in a controlled transaction; restore owner, restricted grants, `search_path`, and PostgREST reload; update generated types and every caller. Test both upgrade and clean reset.
- **Open questions:** Is a versioned `pre_approve_event_proposal_v2` safer than changing the existing public RPC?

### F19 — Dependency integrity is left at the application layer

- **Relevant section:** Item 7
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data / Concurrency
- **Description:** Porting a depth-first check into one server action does not protect seed data, migrations, SQL, concurrent requests, or future service-role code. The specification also postpones database maintenance of `is_blocked` unless per-event editing is added, although stale state is already identified as a current risk.
- **Rationale:** No-cycle and blocked-state rules are data invariants. Two individually valid concurrent inserts can create a cycle after both commit.
- **Impact:** Future checklists can be deadlocked or display an incorrect blocked state even though the UI action passed validation.
- **Recommended action:** Enforce template-cycle rejection transactionally in the database, with the application pre-check used only for friendly feedback. Either derive blocked state from dependencies or maintain it in database triggers/RPCs for every status mutation.
- **Open questions:** Are cross-template-set dependencies allowed, and what happens when a prerequisite is absent from the selected set?

### F20 — Unblock notifications do not have a delivery contract

- **Relevant section:** Item 7, proposed change 2
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Notifications
- **Description:** “Batch per recipient” and “exclude the two cron sweep call sites” do not define recipient resolution, channel, delay, batching window, deduplication, retries, provider failure, user preference, audit record, or what happens when a task has several assignees. `updateBlockedStatus` currently returns no newly unblocked IDs and is called from several paths.
- **Rationale:** Sending inside a status helper risks duplicate and slow critical-path emails. Excluding cron paths can also silently unblock work without telling anyone.
- **Impact:** Users may receive a burst of emails, no email, or repeated notifications after retries; task completion can become slow or fail because an integration failed.
- **Recommended action:** Make the status transaction return newly unblocked task IDs. Persist notification claims/outbox entries in the same transaction, then send asynchronously. Define recipients from the assignee junction plus legacy fallback, one notification per task/transition, batching rules, and observability.
- **Open questions:** Email, in-app notification, or Tuesday digest? Should cron-unblocked tasks appear in the next digest instead of being excluded entirely?

### F21 — Event date changes do not update checklist dates and no slice owns the fix

- **Relevant section:** Item 8, gap 2 and 3; Delivery plan
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Data
- **Description:** The document identifies that editing or rescheduling an event does not re-base its planning item, pre-event deadlines, or debrief date, but no decision, slice content, or test owns the fix. Slice 8 lists other deadline changes only.
- **Rationale:** This is a direct correctness failure in the feature being re-enabled. A future event can have all 28 tasks on the wrong schedule after a date change.
- **Impact:** Staff act too early or too late, and overdue reporting becomes misleading.
- **Recommended action:** Add a dedicated slice or explicit scope item. Update event and planning target date together, recalculate open non-overridden pre-event tasks and post-event tasks, preserve completed tasks, and audit the old/new dates. Handle optimistic concurrency and partial failure atomically.
- **Open questions:** Should manually overridden dates remain fixed? Should already completed tasks move? Should a moved event reopen tasks previously made N/A because it had passed?

### F22 — Weekend adjustment and manual overrides are not specified

- **Relevant section:** Item 8; Slice 8; Section 5
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Migration
- **Description:** “Nudge weekend deadlines to Friday” does not say whether Saturday and Sunday both move to the immediately preceding Friday, whether the change applies only to new checklists or all 600 existing open tasks, how it interacts with `due_date_manually_overridden`, or whether a Friday before the event's creation date is acceptable.
- **Rationale:** Prospective calculation is code behaviour; updating existing rows is a production data operation. Section 5 says no other irreversible writes are planned, which is inconsistent if existing deadlines move.
- **Impact:** Deadlines can change without approval or users can see different rules for otherwise identical events.
- **Recommended action:** Record a product decision and define prospective versus retrospective scope. Never move manual overrides. If existing rows change, add them to the approved data-operation plan with before-state capture and per-task audit.
- **Open questions:** Are bank holidays intentionally ignored? Should Friday itself ever move, and should a deadline be allowed before the task/checklist was created?

### F23 — The task-reopening population is heuristic and internally unclear

- **Relevant section:** Section 5, data change 1
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data / Migration
- **Description:** The document says 763 tasks carry the cutover signature, then says the signature “isolates cleanly at 822 of 840 post-cutover rows”. It does not reconcile 763, 822, and 840 or provide the exact SQL. Completion within five seconds is only a heuristic because the kill-switch path did not store a reason/provenance field.
- **Rationale:** `not_required`, `completed_at`, and `completed_by` are also used by legitimate user and automated actions. A timestamp pattern cannot prove intent by itself.
- **Impact:** The backfill can reopen tasks a person intentionally marked N/A or miss tasks closed by the defect under slower execution.
- **Recommended action:** Supply the exact read-only query and a row-level candidate export. Reconcile every count by event, status, due-date bucket, assignee, and audit evidence. Require an allow-listed event/task ID set approved by the operational owner rather than recalculating a heuristic at write time.
- **Open questions:** What explains the three populations, and is there any authoritative audit or batch identifier that can narrow the candidates?

### F24 — The production data operation lacks rollback and audit detail

- **Relevant section:** Sections 4 and 5
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Deployment / Operations
- **Description:** “Recorded before-state and dry-run count” is necessary but not sufficient. The specification does not define backup format/location, transaction and batch size, idempotency key, lock/timeout behaviour, dependency-state recalculation, assignee notification suppression, rollback script, verification queries, operator, maintenance window, or abort thresholds.
- **Rationale:** Reopening hundreds of task rows changes operational state and dependency graphs. A code rollback cannot restore those rows.
- **Impact:** A partial or mistaken run can be difficult to reverse and may notify staff inconsistently.
- **Recommended action:** Create a separate runbook and reviewed SQL artifact. Persist every target row's before-state in a dedicated recovery table keyed by operation ID; update in bounded batches; recalculate blocked state transactionally; suppress notifications until verification; provide and rehearse the inverse update; record one summary audit plus per-row reason.
- **Open questions:** Who executes and approves the operation, what is the acceptable mismatch count, and how long is the recovery snapshot retained?

### F25 — The template-set model and client content are not ready

- **Relevant section:** Item 9; Slice 7
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Product / Data model
- **Description:** “Add a scope to `sop_sections` plus a matching rule” leaves the core model undefined. It does not cover stable set IDs, task reuse across sets, matching precedence, event versus planning type, multi-match behaviour, default fallback, phase, archived sets, dependencies across sets, editing/versioning, existing items, or renaming a type. The food and drinks task lists are missing, and quiz/live-music scope is inferred rather than confirmed.
- **Rationale:** Scoping whole sections may force task duplication and makes shared communication tasks difficult. Mutable labels are poor foreign keys for behaviour.
- **Impact:** A two-migration implementation can create the wrong tasks globally, break dependencies, or require another schema rewrite soon after release.
- **Recommended action:** Treat slice 7 as discovery. Obtain all four signed-off task lists and matching rules. Design normalized template-set and membership/matcher tables with stable identifiers, default fallback, lifecycle/version rules, and validation. Prototype generation against representative events before estimating delivery.
- **Open questions:** Can tasks belong to several sets? Can one event use more than one set? What happens when an event type is renamed or has no match? Do existing events ever adopt a changed set?

### F26 — Delete protection covers too little of the destructive path

- **Relevant section:** Item 9, safety fix
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data integrity / Security
- **Description:** Guarding `deleteSopSectionAction` alone is insufficient. Deleting an individual task template also sets `planning_tasks.sop_template_task_id` to null and removes template dependencies. Because the generator's idempotency check relies on non-null template IDs, either deletion path can make old tasks invisible to the guard and permit duplicate generation.
- **Rationale:** Section deletion cascades through templates, but direct template deletion reaches the same unsafe state.
- **Impact:** Live task provenance and dependency configuration can be lost, followed by duplicated checklists.
- **Recommended action:** Block hard deletion of any used section or task template. Prefer archive/disable with effective dates. If force deletion is retained, show impact counts, require typed confirmation, restrict it to a controlled maintenance action, and prevent backfill from treating null-linked historical tasks as absent.
- **Open questions:** Is hard deletion required at all, or can every template/section be archived?

### F27 — The delivery slices are not independent and estimates lack exit criteria

- **Relevant section:** Section 4
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / Dependencies
- **Description:** Slice 5 depends on slice 4 for one route and changes an RPC signature; slice 7 depends on missing content and a data model; slice 8 depends on past/debrief decisions; slices 1 and 2 are said to be startable but are marked blocked by confirmation. Several slices combine unrelated fixes, data work, UI, email, cron, and migrations under S or M estimates.
- **Rationale:** “Independently mergeable” is not the same as safely deployable. Database compatibility, feature flags, and data activation create ordering constraints.
- **Impact:** Estimates are unreliable, PRs become difficult to review, and a code deploy can depend on a migration or decision not yet present.
- **Recommended action:** Add dependency arrows, migration/code deployment order, feature-flag state, owner, acceptance criteria, rollback, and release gate per slice. Split slice 8 into event visibility, task/debrief visibility, and deadline correctness. Re-estimate after decisions and content are complete.
- **Open questions:** Is the goal one coordinated release or a sequence of independently accepted releases?

### F28 — The test plan is inaccurate and incomplete

- **Relevant section:** Sections 6 and 7
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing / Quality
- **Description:** The statement that changed areas have “close to zero coverage” is too broad. Relevant proposal, role, form, SOP, event-list, dashboard, cron, email, and integration tests exist. More importantly, the existing `shouldMarkEventTodosNotRequired` tests already assert the defective after-cutover behaviour, so they must be changed, not merely supplemented. The table has no slice 7 row and thin coverage for migrations, RLS, notifications, rescheduling, accessibility, and data rollback.
- **Rationale:** A green unit suite can codify the bug. Unit mocks also cannot prove service-role authorization, PostgREST overload resolution, or database constraints.
- **Impact:** The planned tests can pass while venue scope, migrations, and end-to-end workflows remain broken.
- **Recommended action:** Add a test matrix by layer: pure unit, component accessibility, server action, real Supabase/RLS/RPC, clean migration reset, upgrade migration, Playwright smoke, and production read-only verification. Update the existing kill-switch assertions. Run `npm run test:integration` explicitly for database changes.
- **Open questions:** Which test environment represents an upgrade from the current production schema, and who owns client UAT?

### F29 — Accessibility requirements are too narrow

- **Relevant section:** Items 3, 5, 6, and 7; Test plan
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Accessibility
- **Description:** The document mentions text errors and colour-independent blocked messaging, but does not require focus movement to the error summary, `role="alert"`/live-region behaviour, `aria-describedby` links, keyboard use of the SOP picker, announcement of dependency warnings, accessible datetime errors, or focusable explanations for disabled tasks. It also does not include accessibility tests.
- **Rationale:** A visible catch-all is not enough for a screen-reader or keyboard user after an async server-action failure.
- **Impact:** Users can still hear only “check the highlighted fields”, miss dynamic warnings, or be unable to discover why a control is blocked.
- **Recommended action:** Define an accessible error-summary pattern: focus it on failure, link each message to a field/fieldset, preserve typed values, announce async errors, and keep per-field text. Add keyboard and screen-reader-oriented component tests, plus manual checks at desktop and mobile widths.
- **Open questions:** Which browsers and assistive technologies are in the release support matrix?

### F30 — Performance and concurrency limits are not defined

- **Relevant section:** Items 1, 6, 7, and 9
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Performance / Reliability
- **Description:** No expected upper bounds are given for events, tasks, dependency edges, notification fan-out, or template sets. `listEventsForUser` currently selects `*` plus nested venues/artists; dependency status updates perform repeated queries; backfill and notification work can be N+1; template cycle checks can scan the full graph. No query plans or indexes are specified for new matchers or publication fields.
- **Rationale:** Current production size is modest, but these changes create recurring work on every event and task transition.
- **Impact:** Page loads, task completion, cron runs, and data migrations may slow or time out as data grows.
- **Recommended action:** Set volume assumptions and latency/cron budgets. Use bounded/selective queries, set-based dependency updates, indexed matcher/publication columns, paged data operations, and async notification delivery. Capture query plans for new database paths.
- **Open questions:** What are the expected 12- and 24-month event/task volumes and the maximum assignees/dependents per task?

### F31 — Monitoring, success measures, and release verification are missing

- **Relevant section:** Sections 4, 5, and 7
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Monitoring / Operations
- **Description:** The plan has no post-release metrics or alerts for planning save failures, checklist creation counts, tasks reopened, manager proposal denials, proposal expiry, AI failures/latency/cost, newly unblocked tasks, email acceptance, or event-list query size. Console logging alone is not a release verification plan.
- **Rationale:** Several defects were silent for weeks. The new work needs evidence that workflows are operating, not only that deployment succeeded.
- **Impact:** Regressions can repeat without detection, and client feedback remains the first alert.
- **Recommended action:** Define per-slice structured events, dashboards or saved queries, alert thresholds, and a 24-hour/7-day review. Record expected before/after counts. Update the cron and rollback runbooks with exact checks and owners.
- **Open questions:** What monitoring platform is available, and who receives operational alerts?

### F32 — Production evidence is not reproducible from the document

- **Relevant section:** Opening claim; Sections 1, 5, and 8
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Evidence / Delivery
- **Description:** The document gives precise production counts and says every claim was checked, but includes no query appendix, timestamp per query, saved output, commit SHA, database migration version, or explanation of count definitions. Some figures, especially 763/822/840, cannot be reconciled from the prose.
- **Rationale:** Live numbers change. A reviewer and the release operator need to reproduce the exact populations immediately before deployment.
- **Impact:** Decisions and estimates can be based on stale or differently defined data, and the backfill target cannot be independently approved.
- **Recommended action:** Add a read-only evidence appendix or checked-in SQL script with definitions, expected columns, run timestamp, commit SHA, and sanitized results. Re-run it before implementation and immediately before any data operation.
- **Open questions:** Which database role and transaction isolation were used, and were counts taken from the same snapshot?

### F33 — Centralise event-window and London-date policy

- **Relevant section:** Items 1, 3, and 8
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification / Maintainability
- **Description:** Past visibility, ongoing-event checks, proposal end validation, dashboard readiness, and SOP target dates currently use several different date libraries and UTC/local conversions.
- **Rationale:** One small policy module can expose explicit functions such as `eventWindowInLondon`, `eventLocalStartDate`, and `isEventPastForList`, each with boundary tests.
- **Impact:** This reduces view drift and makes future timezone changes safer.
- **Recommended action:** Centralise pure date/window decisions while leaving database filtering in query-specific helpers that use the same documented boundaries.
- **Open questions:** None.

### F34 — Prefer archived, versioned template configuration over hard deletion

- **Relevant section:** Items 7 and 9
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification / Data
- **Description:** Hard deletion, mutable global templates, and historical task snapshots create difficult provenance and backfill behaviour.
- **Rationale:** Archiving a template or set preserves references. Versioning lets new checklists use new rules without rewriting old ones.
- **Impact:** Safer operations, clearer audit history, and simpler idempotency.
- **Recommended action:** Give template sets/tasks an active/archive state and version/effective date. Generated tasks retain the source version. Editing publishes a new version for future checklists only unless an explicit migration is approved.
- **Open questions:** Does the client need draft template changes before publishing them?

### F35 — Separate hotfix, stabilisation, and discovery workstreams

- **Relevant section:** Section 4
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Delivery / Simplification
- **Description:** The current nine-slice list mixes an urgent blocked workflow, latent correctness/security fixes, product decisions, and a new configurable template platform.
- **Rationale:** These have different evidence, review, and sign-off needs.
- **Impact:** Separating them reduces coordination risk and gets the clear hotfix out faster.
- **Recommended action:** Use three workstreams:
  1. **Hotfix:** planning validation and accessible errors.
  2. **Stabilisation:** proposal permissions/end time, checklist activation, date recalculation, dependency integrity, monitoring.
  3. **Discovery/new capability:** template sets and new client-authored SOPs.
- **Open questions:** None.

## Key required changes

Before treating the specification as implementation-ready:

1. Mark every decision as proposed or confirmed and add slice-level acceptance criteria.
2. Replace “no venue lock” with the approved assigned-manager/unassigned-manager rule and define a capability/call-site matrix.
3. Separate prospective checklist activation from historical task reopening and write a reversible data-operation runbook.
4. Fix the London-date source of truth and add event-date recalculation to delivery scope.
5. Specify safe PostgreSQL function evolution for the approval RPC.
6. Define exact past/debrief/task visibility rules and the dashboard's separate query contract.
7. Define AI status, publication, slug, concurrency, and failure rules.
8. Decide whether SOP exclusions are immutable creation snapshots or editable state.
9. Put dependency cycles and blocked-state integrity at the database transaction boundary; define an outbox-style notification flow.
10. Move template sets back to discovery until the data model and four signed-off task lists exist.
11. Expand the test, deployment, monitoring, accessibility, and production-verification plans.

## Unresolved decisions

- Exact event “past” boundary and status/null-end handling.
- Whether debriefs remain visible after events disappear, and for how long.
- Checklist activation date and historical reopening population.
- Proposal completion owner after approval.
- Required proposal end time and treatment of existing null rows.
- AI-enabled statuses and the authoritative publication marker.
- Post-publication slug override and redirect policy.
- Creation-only versus editable SOP exclusion selection.
- Notification channel, recipient, batching, and retry rules for unblocked tasks.
- Event reschedule/recalculation and weekend-deadline behaviour.
- Template-set data model, matching rules, and all four task lists.
- Release ownership, client UAT owner, and monitoring owner.

## Major risks

1. **Authorization risk:** venue-assigned managers can cross venue boundaries on the service-role proposal path if the current recommendation is followed.
2. **Data corruption risk:** heuristic reopening or template deletion can change legitimate task state and break checklist idempotency.
3. **Operational risk:** re-enabling checklists can create a large workload and notification spike without a controlled rollout.
4. **Datetime risk:** UTC-derived event dates can shift SOP schedules by one day.
5. **Integration risk:** ambiguous RPC overloads, unstable slugs, and undefined notification retries can fail only after deployment.
6. **Delivery risk:** template sets and combined slice 8 are materially larger and less defined than their delivery entries suggest.
7. **Regression risk:** existing tests currently encode at least one defective kill-switch behaviour, while high-risk database and end-to-end paths are not covered by the proposed plan.

## Recommended next steps

1. Approve and ship a narrowly scoped slice 0 hotfix, including partial-SOP-failure handling and accessible error summary behaviour.
2. Hold a short product/operations decision session for past/debrief rules, checklist activation/backfill, post-approval ownership, end time, AI statuses, and deadline weekends.
3. Produce two technical notes before coding: the manager proposal authorization matrix and the checklist backfill runbook with reproducible SQL.
4. Add a London-date/recalculation design and a safe RPC migration design.
5. Re-scope slices 1–8 with acceptance criteria, deployment order, rollback, monitoring, and test layers.
6. Treat template sets as a separate discovery item after the four client task lists are supplied and approved.
