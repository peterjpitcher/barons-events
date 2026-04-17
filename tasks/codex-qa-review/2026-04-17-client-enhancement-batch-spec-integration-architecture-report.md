# Integration & Architecture Report: Client Enhancement Batch Spec

## Summary

The spec is directionally implementable, but it underestimates three structural changes: a second task-template system beside SOP, a tree shape inside `planning_tasks`, and a new event state that makes formerly required event fields nullable. Those are not additive UI changes; they alter domain ownership, query projections, status routing, and audit boundaries.

The highest-risk items are `cascade_definitions` versus SOP convergence, `planning_tasks.parent_task_id` leaking into flat task views, the DB trigger for cascade completion, and `pending_approval` being specified as a CHECK change rather than a full state-machine change.

## Inspection Inventory

Reviewed: spec, `CLAUDE.md`, recent/SOP migrations, planning library/types/SOP helpers, events/planning/debriefs/venues actions, roles, notifications, settings, event/public API routes, event UI status handling, todo aggregation, and audit-log helpers.

Key code areas: [planning types](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/types.ts:23), [planning board loader](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts:463), [SOP RPC](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120003_add_sop_rpc_functions.sql:26), [event actions](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:591), [public events API](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/v1/events/route.ts:15).

## Architectural Fit Findings

### IA-001: Cascades Duplicate The SOP Template System

- Type / Severity / Confidence / Evidence / Why-may-be-wrong / What-would-confirm / Action-owner / Blocking-or-advisory
- Domain model / High / High / SOP already has sections, task templates, assignees, t-minus scheduling, dependencies, and fan-out into `planning_tasks`: [SOP schema](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120000_add_sop_tables.sql:71), [SOP generation](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120003_add_sop_rpc_functions.sql:106), [dependency mapping](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120003_add_sop_rpc_functions.sql:200). The spec explicitly says cascades are a sibling concept, not a SOP rebuild: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:19), then defines another settings-managed task template and fan-out system: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:514). / May be wrong if cascades are not reusable event/planning checklists but a different operational primitive: venue-distributed child work. / Confirm by asking whether cascades need SOP sections, dependencies, t-minus dates, default assignees, backfill, and admin template lifecycle. / Spec owner + data-model owner / Blocking.
- Description
  `cascade_definitions` currently looks like SOP minus sections/dependencies plus venue filtering. That creates two template lifecycles, two settings UIs, two generation paths, two audit entities, and two ways of explaining “template-created tasks” to users.
- Recommended shape
  Either unify under a broader task-template model with `expansion_strategy = 'single' | 'per_venue'` and optional `venue_filter`, or explicitly define cascades as a distinct “master task with venue child tasks” system that does not try to be a general task template. If divergent, document the boundary: SOP creates checklist tasks for an item; cascades create child responsibilities under a master task and participate in parent completion.

### IA-002: `planning_tasks.parent_task_id` Breaks Flat Task Assumptions

- Type / Severity / Confidence / Evidence / Why-may-be-wrong / What-would-confirm / Action-owner / Blocking-or-advisory
- Projection/data-flow / High / High / `PlanningTask` has no parent/cascade fields: [types](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/types.ts:23). The board query fetches all tasks as a flat nested array: [query](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts:501), then sorts without hierarchy: [mapper](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts:154). Todos flatten all open tasks: [todo conversion](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/utils.ts:282). Load-by-assignee counts every open task: [aggregation](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts:975). / May be wrong if the UI intentionally shows master and children as ordinary peer tasks. / Confirm by testing a master with 12 venue children in planning board, todos, SOP checklist, and dashboard. / Planning owner / Blocking.
- Description
  Adding a self-reference changes the table from a list to a tree, but the codebase projects it as a list everywhere. Masters and children would both count in progress, overdue, and assignee workloads unless every projection defines whether to include parents, children, or both.
- Recommended shape
  Add parent/cascade fields to the domain type and decide per view: hide child tasks under collapsed masters in planning item cards, show only assigned children in “my tasks”, exclude masters from assignee load unless assigned, and include children in attachment roll-ups. Add a uniqueness guard such as `(parent_task_id, cascade_venue_id)` to prevent duplicate venue children.

### IA-003: Cascade Auto-complete Trigger Bypasses The Action/Audit Boundary

- Type / Severity / Confidence / Evidence / Why-may-be-wrong / What-would-confirm / Action-owner / Blocking-or-advisory
- Boundary/audit / High / High / Spec recommends a `SECURITY DEFINER` trigger that updates parent tasks: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:573). Existing project guidance says mutations go through server actions with permission checks: [CLAUDE.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md:44), [CLAUDE.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md:95). Current dependency state is updated by an application helper after status toggle: [planning action](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts:581). Existing security-definer SOP RPCs were later restricted to `service_role`: [hardening migration](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:80). / May be wrong if DB-level invariants are considered authoritative and audit can be trigger-written. / Confirm whether parent auto-completion must produce an actor-scoped audit row and user-visible activity entry. / Data + platform owner / Blocking.
- Description
  A trigger can solve concurrency, but it cannot naturally revalidate Next paths, cannot call the current server action permission path, and has no explicit actor unless designed around `auth.uid()`. The spec also requires audit rows for auto-complete, but the trigger shown only updates the parent.
- Recommended shape
  Put cascade completion in a server-called RPC that locks the parent/siblings, updates deterministically, and writes audit with the actor passed in. Keep the RPC `service_role`-only, matching the hardened SOP RPC pattern. If a trigger remains, it must write audit and be reviewed as privileged database logic, not just “derived state”.

### IA-004: Multi-venue Creation Has No Durable Grouping Model

- Type / Severity / Confidence / Evidence / Why-may-be-wrong / What-would-confirm / Action-owner / Blocking-or-advisory
- State ownership / Medium-High / Medium / Spec stores only an audit `multi_venue_batch_id`: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:404). Existing linked-record patterns use durable links: planning series via `series_id`: [schema](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260223120000_add_planning_workspace.sql:31), one event to one planning item via `event_id`: [migration](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120002_add_event_planning_link.sql:4), and opening overrides use a master row plus venue junction: [schema](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260227000001_venue_opening_times.sql:34). / May be wrong if operations genuinely never edits siblings together. / Confirm with ops whether title, times, copy, cancellation, price, and public listing edits should support “apply to all created venues”. / Product + data owner / Advisory, blocking if bulk maintenance is expected.
- Description
  “N independent rows after creation” is simple, but it makes accidental bulk creation hard to undo and future “update all 5” requests expensive. Audit metadata is not an operational grouping model.
- Recommended shape
  Add an optional `event_batch_id` / `event_group_id` if multi-venue creation should remain traceable beyond audit. Keep sibling events independently editable, but expose an intentional bulk-update affordance for selected fields if the client expects it.

### IA-005: `pending_approval` Is A State-machine Change, Not Just A Status Value

- Type / Severity / Confidence / Evidence / Why-may-be-wrong / What-would-confirm / Action-owner / Blocking-or-advisory
- State machine / High / High / `EventStatus` excludes `pending_approval`: [types](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/types.ts:43). Event validation currently requires `eventType`, `endAt`, and `venueSpace`: [validation](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/validation.ts:99). Submit only accepts `draft`/`needs_revisions`: [events action](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1173). Review decisions only accept `submitted`/`needs_revisions`: [events action](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1380). Review queue filters the same statuses: [events lib](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/events.ts:139). Detail permissions omit pending approval: [event page](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:88). / May be wrong if `pending_approval` is implemented as a completely separate route and not mixed into normal event views. / Confirm all routes: list, detail, edit, review, dashboard, debrief, public API, notifications. / Events owner / Blocking.
- Description
  The spec relaxes `event_type`, `venue_space`, and `end_at` for pre-approval. That ripples into code that treats those fields as strings, including public serialisation types and notification formatting. The current UI often falls back unknown statuses to Draft labels, which would misrepresent proposed events.
- Recommended shape
  Prefer an `event_proposals` table if the pre-event object is intentionally partial. If using `events`, update `EventStatus`, Zod schemas, RLS, status labels, status counts, dashboards, detail permissions, review routes, notifications, and all nullable-field consumers as one state-machine change.

### IA-006: `app_settings.value jsonb` Is Not Earning Its Abstraction Yet

- Type / Severity / Confidence / Evidence / Why-may-be-wrong / What-would-confirm / Action-owner / Blocking-or-advisory
- Data modelling / Medium / High / Spec proposes generic `key text, value jsonb`: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:171), but the concrete value is a numeric labour rate with historical snapshot columns: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:218). Existing settings are strongly typed components/tables, not a generic settings registry: [settings page](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/settings/page.tsx:35). / May be wrong if several unrelated admin-configurable settings are imminent. / Confirm the next three settings and their validation requirements. / Data owner / Advisory.
- Description
  JSONB hides DB-level validation for a money/rate value. Since SLT membership is separately normalised, `app_settings` currently holds one number and a vague future promise.
- Recommended shape
  Use a single-row typed `business_settings` / `app_config` table with `labour_rate_gbp numeric(6,2) CHECK (...)`, `updated_by`, `updated_at`. If a generic table is kept, require setting-specific accessors and DB/action validation per key; do not let callers read raw JSON ad hoc.

### IA-007: SLT Membership Is Sound Only If It Has No Permission Semantics

- Type / Severity / Confidence / Evidence / Why-may-be-wrong / What-would-confirm / Action-owner / Blocking-or-advisory
- Auth boundary / Medium / Medium / Role model is deliberately three roles: [roles](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:3). Spec creates `slt_members` linked to `users`: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:241). Current notification digest emails administrators by role: [notifications](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/notifications.ts:630). / May be wrong if SLT is only a mailing list. / Confirm whether SLT grants visibility, approval, or reporting access. / Product + auth owner / Advisory.
- Description
  A membership table is better than storing SLT users in JSON, but the spec must state that SLT is an email-recipient group, not a fourth role or permission overlay.
- Recommended shape
  Keep `slt_members(user_id unique)` as a mailing-list table, exclude deactivated users in the helper, and avoid any `canX(role) || isSltMember` checks unless the role model is deliberately reopened.

### IA-008: Polymorphic Attachments Lose Referential Integrity

- Type / Severity / Confidence / Evidence / Why-may-be-wrong / What-would-confirm / Action-owner / Blocking-or-advisory
- Relational integrity / High / High / Spec uses `subject_type` + `subject_id` without FKs: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:671). Existing relationship design uses concrete FKs and junction tables: event-planning FK: [migration](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120002_add_event_planning_link.sql:4), event-artists FKs: [migration](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260210120000_add_artists_and_event_artists.sql:36), opening override venue junction: [migration](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260227000001_venue_opening_times.sql:47). / May be wrong if the team accepts soft references for storage metadata. / Confirm deletion, RLS, and roll-up behaviour for deleted/moved tasks. / Data owner / Blocking for schema.
- Description
  Without FKs, the database cannot prevent orphaned attachment metadata, cannot cascade/soft-delete predictably, and RLS policies become hand-written subject lookups for every `subject_type`.
- Recommended shape
  Use either a shared `files` table plus typed join tables (`event_attachments`, `planning_item_attachments`, `planning_task_attachments`), or one `attachments` table with `event_id`, `planning_item_id`, `planning_task_id` nullable FKs and a CHECK that exactly one is present. That keeps integrity while preserving one UI model.

### IA-009: Public API Is Compatible With N Event Rows, But The Contract Should Say So

- Type / Severity / Confidence / Evidence / Why-may-be-wrong / What-would-confirm / Action-owner / Blocking-or-advisory
- API contract / Low-Medium / High / `/api/v1/events` accepts `venueId`: [route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/v1/events/route.ts:22), filters `venue_id`: [route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/v1/events/route.ts:112), and returns a single nested venue object: [route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/v1/events/route.ts:86). Public statuses are only approved/completed: [public API lib](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/public-api/events.ts:6). / May be wrong if external callers expect a multi-venue event as one logical event. / Confirm website integration expectations for duplicate titles/times across venues. / API owner / Advisory.
- Description
  Multi-venue creation as N rows does not break the API mechanically. Each row remains single-venue. The risk is semantic: external consumers may see five separate events with identical copy and different venues.
- Recommended shape
  Update API/docs to state that multi-venue programmes are represented as separate event IDs. Do not expose `pending_approval`; the existing approved/completed filter is correct.

### IA-010: Audit Entity CHECK Expansion Is Already Brittle

- Type / Severity / Confidence / Evidence / Why-may-be-wrong / What-would-confirm / Action-owner / Blocking-or-advisory
- Maintainability / Medium / High / Current final entity CHECK only includes a subset: [migration](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260416000000_user_deactivation.sql:77). The TypeScript audit helper already allows more entities than the latest DB CHECK: [audit helper](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/audit-log.ts:7). Spec wants multiple new CHECK expansions: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:329). / May be wrong because the codebase has precedent for CHECK constraints. / Confirm whether audit insert failures are currently visible in logs for entities like `opening_hours` or `venue`. / Platform owner / Advisory.
- Description
  The codebase does prefer CHECK constraints by precedent, but repeated drop/re-add migrations have already drifted. Adding four more entities across waves increases that maintenance burden.
- Recommended shape
  At minimum, consolidate all audit entity/action additions in one migration and update the TypeScript union at the same time. Better: replace entity/action CHECKs with seeded lookup tables or remove the entity CHECK and enforce values at the application boundary.

### IA-011: “Fire-and-forget” Email Needs An Outbox Or Must Be Awaited

- Type / Severity / Confidence / Evidence / Why-may-be-wrong / What-would-confirm / Action-owner / Blocking-or-advisory
- Async data flow / Medium / High / Project guidance says not to await critical-path email and to queue background jobs: [CLAUDE.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md:120). Existing debrief action awaits the digest email: [debrief action](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/debriefs.ts:195). The notification helper awaits Resend: [notifications](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/notifications.ts:695). Spec says debrief-to-SLT is fire-and-forget: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:238). / May be wrong if the deployment runtime reliably completes detached promises after response, which should not be assumed. / Confirm Vercel/serverless runtime expectations and whether a queue exists. / Platform owner / Advisory, blocking if “within 30 seconds” is contractual.
- Description
  Returning before a detached Resend promise finishes is unreliable in serverless. Awaiting is reliable but blocks the request. The existing implementation blocks and catches failures; the spec asks for non-blocking delivery without introducing infrastructure.
- Recommended shape
  Add a small `notification_jobs` outbox table processed by a cron route/worker, or explicitly keep the existing awaited-send pattern and remove “fire-and-forget” from the acceptance criteria.

## Coupling / Boundary Issues

The proposed cascade system couples venue configuration, planning tasks, SOP-like templates, audit logging, and venue creation hooks. Without a clear boundary, `createVenueAction`, `createPlanningTaskAction`, `togglePlanningTaskStatusAction`, and settings all become cascade-aware.

The DB trigger crosses the current mutation boundary. Existing privileged RPCs are hardened and service-role only; a general trigger on user-driven updates would be a new class of write path.

`pending_approval` couples event proposals to the full event table. If proposals are partial, either the whole event layer must become nullable-aware or proposals should live outside `events` until approval.

## State Ownership Concerns

Task completion state would become split between explicit user action and implicit DB side effect. That needs actor attribution and reversal semantics.

Multi-venue siblings have no owner after creation except individual event rows. If users expect group-level edits, the spec currently discards the only grouping identifier into audit metadata.

SLT membership is acceptable as ownership of notification recipients, but it must not silently become ownership of authorisation.

## Data Flow Mismatches

The public API remains single-venue per event and is compatible with N-row creation, but docs should state this representation.

Planning and dashboard flows consume tasks as flat arrays. Parent/child cascades need explicit projection logic before they can be safely introduced.

Email “fire-and-forget” conflicts with the current awaited Resend pattern and the project guidance to use queues for non-critical notification work.

## Maintainability Risks

Two template systems will double future changes: settings UI, audit coverage, backfill, test fixtures, permission rules, and task projections.

Audit CHECK migrations are already fragile. Adding more entities in separate waves will keep reopening the same constraint.

Generic JSON settings will push type checks out of Postgres and into scattered action code unless constrained by typed accessors.

## What Appears Sound

Venue category as a first-class venue attribute is a reasonable primitive for “All pubs” and cascade filtering, provided the enum is accepted as deliberately small.

Creating separate event rows per venue fits the current public API and single-venue event model.

Snapshotting `labour_rate_gbp_at_submit` on debriefs is the right historical accounting shape.

A normalised `slt_members` table linked to `users` is sound for an email-recipient list, especially with deactivated users excluded.

Keeping attachment storage private and serving short-lived signed URLs matches the intended security boundary; the schema shape needs strengthening, not the access intent.