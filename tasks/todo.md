# Client Enhancement Backlog — 2026-04-17

Source: client request list, 2026-04-17. Session-context: `.claude/session-context.md`.

## Triage

| # | Request | Size | Verified reality | Status |
|---|---------|------|------------------|--------|
| 1 | Notes on a task | S | `planning_tasks` has no `notes` column today. | Ready |
| 2 | Mark todo as "not required" on todos page | XS–S | `not_required` already exists for SOP tasks in [types.ts:3](src/lib/planning/types.ts), [planning.ts:37](src/actions/planning.ts), and [sop-task-row.tsx:244](src/components/planning/sop-task-row.tsx). Need to surface the same action on the general todos page. | Ready (verify where "todos page" is) |
| 3 | Audit logging across all changes | M | Only `src/actions/events.ts` imports `logAuditEvent`. 11 other action files lack it. `audit_log.entity` CHECK already permits `customer, booking, user, venue, sop_template, planning_task, auth`. | Ready (gap audit → batched patches) |
| 4 | "Proof read menus" task under food category | XS | No "food" SOP section seeded — SOP sections are UI-managed. Need the section to exist first. | Clarify |
| 5 | Simpler pre-event entry form (date + description only, admin green-lights, then full details) | M | New status/workflow state. `events.status` today: draft, submitted, needs_revisions, approved, rejected, completed. | Clarify (see Q1) |
| 6 | Multi-select venues instead of one/all | S–M | `venue_id` is scalar on `events`, filters typically scalar too. Needs scope: which screens? | Clarify (see Q2) |
| 7 | Upload attachments to tasks + roll up to event/planning item | L | No Supabase Storage integration exists. Needs bucket, schema, RLS, upload UI, size/MIME limits, virus policy. | Clarify (see Q3) + architectural |
| 8 | Task cascade across multiple venues (one Easter POS task → one child per venue) | L | Data model change. `planning_tasks` is singular today. Needs parent/child model and per-venue expansion. Depends on #1, #2 landing first. | Clarify (see Q4) + architectural |
| 9 | Debriefs email SLT on submission | S | [notifications.ts](src/lib/notifications.ts) uses Resend. SLT list source not defined. | Clarify (see Q5) |
| 10 | Labour hours in debrief at £12.71/hr | S | `debriefs` has wet/food takings, attendance, promo_effectiveness, highlights, issues. No labour hours column. | Clarify (see Q6 — rate policy) |

## Implementation status (2026-04-17 end-of-session)

### Wave 0 — Audit prerequisite ✅ COMPLETE & DEPLOYED

- `20260417120000_audit_entities_and_actions.sql` — entity + action CHECK widened to cover every repo usage; `cascade_internal_bypass()` helper added. **Pushed.**
- `20260417130000_audit_actions_batch_a.sql` — 4 new action values for Wave 0.3 patches. **Pushed.**
- `tasks/audit-gap-map.md` — survey of 13 action files, 8 gaps identified.
- Wave 0.3 Batches A/B/C — 8 gaps patched: createBookingAction, movePlanningItemDateAction, togglePlanningTaskStatusAction, reassignPlanningTaskAction, convertInspirationItemAction, dismissInspirationItemAction, refreshInspirationItemsAction, updateUserAction (partial — now logs user.updated alongside auth.role.changed), plus deleteCustomerAction (stale direct-insert bug caught by the guard).
- Wave 0.4 — `src/actions/__tests__/audit-coverage.test.ts` CI guard. 75 assertions, allowlist empty.

### Wave 1 — Quick wins: BACKEND COMPLETE & DEPLOYED; UI deferred

- **1.1 Task notes** — `planning_tasks.notes` column + schema + helper + action + audit. Migration pushed. UI (textarea on task detail) deferred to follow-up.
- **1.2 Not-required on todos page** — status column already supports it from prior SOP work; generic updater now also sets `completed_at` for `not_required`. UI exposure (three-state control on todos page) deferred.
- **1.3 Proof-read menus task** — migration pushed. Appears automatically in SOP checklist for new events.
- **1.4 Labour hours + rate** — `business_settings` singleton (£12.71 default); `debriefs.labour_hours` + `labour_rate_gbp_at_submit`; `submitDebriefAction` reads + snapshots rate on save; new `updateBusinessSettingsAction` (admin-only). Migration pushed. UI (form field + settings page editor) deferred.
- **1.5 SLT email** — `slt_members` table + RLS; `addSltMemberAction`/`removeSltMemberAction`; `getSltRecipients()`; `sendDebriefSubmittedToSltEmail()` with `SLT_FROM_ALIAS` BCC / one-per-recipient fallback; wired into `submitDebriefAction`. Migration pushed. UI (settings picker) deferred.

### Waves 2-5 — NOT STARTED

Spec is at v6 and has been adversarially reviewed. Implementation requires:
- Wave 2: `venues.category` + Heather Farm Cafe default + `VenueMultiSelect` component + multi-venue creation RPCs (drafts + planning items).
- Wave 3: pre-event status extension + `create_multi_venue_event_proposals` RPC + `pre_approve_event_proposal` RPC + status-transition trigger + 14-day reaper.
- Wave 4: SOP template expansion columns + `planning_tasks` cascade columns + `generate_sop_checklist_v2` RPC + cascade guard/sync triggers + backfill queue.
- Wave 5: `attachments` FK-based table + Storage bucket + per-FK RLS + signed-URL actions + roll-up queries + cleanup cron.

See [docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md](../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md) for the complete spec.

## Deferred UI work (next session)

For the already-deployed backend features, the following UI pieces are outstanding:

1. **Task notes textarea** — add to the task detail / expanded row component. Existing pattern: see how title edit works in `src/components/planning/sop-task-row.tsx`.
2. **"Not required" three-state control on todos page** — extend `src/components/todos/unified-todo-list.tsx` to expose the `not_required` status alongside `done`. Update the mapper in `src/lib/planning/utils.ts` to optionally include resolved tasks.
3. **Labour hours field** in the debrief form (`src/components/debriefs/*`). Live-cost readout using the rate from `business_settings`.
4. **Settings page** — add a "Labour cost" row and an "SLT members" picker at `src/app/settings/page.tsx` or similar.

---

## Execution plan

### Wave 1 — Quick wins (one PR each, no blockers)
Target: land in a single day.

- [ ] **#4** Add "Proof read menus" SOP task template — depends on confirming the food section exists (or creating it).
- [ ] **#1** Add `notes text` column to `planning_tasks` + form field + display. New migration, update `src/lib/planning/types.ts`, Zod schema in [planning.ts:37](src/actions/planning.ts), server action, task row UI. Audit log the note edits (use `planning_task` entity).
- [ ] **#2** Surface `not_required` action on the general todos page. Reuse existing server action `togglePlanningTaskStatus` (or sibling). Visual spec already defined in [2026-04-08-sop-checklist-design.md:267](docs/superpowers/specs/2026-04-08-sop-checklist-design.md) — faded row, dash icon, strike-through. Colourblind-safe by design.
- [ ] **#10** Add `labour_hours numeric(6,2)` column to `debriefs`. Derive `labour_cost_gbp = labour_hours * 12.71` server-side (or via generated column). Form field + displayed summary. Keep rate as a config constant for now (see Q6).
- [ ] **#9** Email SLT on debrief submission. Extend [notifications.ts](src/lib/notifications.ts) with a `sendDebriefSubmittedEmail(debrief, event)` helper. Recipient list source = Q5.

### Wave 2 — Cross-cutting: audit logging coverage
Target: 1–2 PRs.

- [ ] **#3a** Audit gap map: enumerate every server action and confirm whether it calls `logAuditEvent`. Produce `tasks/audit-gap-map.md`.
- [ ] **#3b** Patch each action file to log its mutations with a consistent `{entity, entity_id, action, meta}` shape. Prioritise: `bookings`, `customers`, `planning`, `users`, `sop`, `debriefs`, then the rest.
- [ ] **#3c** Add a Vitest guard that any new `'use server'` action must call `logAuditEvent` when it performs a `.from(...).insert/update/delete/upsert` — either runtime or static ESLint rule.

### Wave 3 — Needs scoping (awaiting clarifications)

- [ ] **#6** Venue multi-select — scope depends on Q2.
- [ ] **#5** Pre-event form — workflow depends on Q1.

### Wave 4 — Architectural (multi-PR each)

- [ ] **#7** File attachments. PR plan:
  - PR1: Supabase Storage bucket + RLS + migration for `task_attachments` / `attachments` table with polymorphic `subject_type/subject_id` (task | planning_item | event).
  - PR2: Server action upload/delete + presigned URL generation.
  - PR3: Upload UI on task editor.
  - PR4: Roll-up display on event + planning item (aggregated from child tasks).
- [ ] **#8** Task cascade. PR plan:
  - PR1: Schema — add `parent_task_id` to `planning_tasks` OR dedicated `task_cascades` table with venue selector; decide after #6 lands.
  - PR2: Cascade-expansion server action (given a master task + venue set, create one child per venue).
  - PR3: UI to mark a task as "cascade across venues" + view the children.
  - PR4: Completion roll-up (mark master done when all children done/not_required).

## Client answers (2026-04-17) — all resolved

- **#5 pre-event flow**: NEW status. Proposing `pending_approval` (draft → pending_approval → submitted → needs_revisions / approved / rejected / completed).
- **#6 multi-venue**: expanded — see "Refined scope" below. On event and planning item forms, venue picker becomes multi-select with an "All pubs" quick-select. Also requires adding **venue categories** (pub / cafe) on the `/venues` page so "All pubs" can exclude Heather Farm.
- **#7 attachments**: agreed — 250 MB per file, PDF / Office / JPG+PNG+HEIC / MP4+MOV, private bucket.
- **#8 task cascade**: master auto-completes when all children done, and new venues auto-generate missing children. Cascade definitions configured in settings. Cascaded child tasks assigned to the venue's `default_manager_responsible_id`.
- **#9 SLT**: SLT people picker in settings. New `slt_members` table (user FKs) + settings page + `getSltRecipients()` helper used by notifications.
- **#10 labour rate**: settings screen to update the rate. `app_settings` (or similar) row `labour_rate_gbp` defaulting to `12.71`, administrator-only settings UI.

## Refined scope — #6 venue multi-select (now M → L)

**New requirement: venue categories**
- Add `venues.category text NOT NULL DEFAULT 'pub' CHECK in ('pub','cafe')` via migration.
- Extend `/venues` page with a category dropdown (create + edit).
- Seed existing venues to `pub`; Heather Farm to `cafe`.

**Event creation form**
- Replace single venue dropdown with multi-select checkbox list.
- Add "Select all pubs" quick-action (ticks every venue where `category = 'pub'`).
- On submit: create **N event rows**, one per selected venue, all sharing title / event_type / start_at / end_at / description, etc. Each gets its own `id` and `venue_id`. No schema change to `events`.
- UX: return to the list with a summary banner "Created 5 events across 5 venues".

**Planning item creation form**
- Today `planning_items.venue_id` nullable = global. Keep that option, but also allow multi-select.
- Same pattern: create N `planning_items`, one per venue.
- Keep "Global" (no venue) as a distinct option alongside multi-select.

**Filters on list pages**
- Out of immediate scope unless the client comes back on it. Current plan is creation-form first; filters can follow if needed.

## Refined scope — #8 task cascade (L, multi-PR)

**Data model**
- Add to `planning_tasks`: `parent_task_id uuid REFERENCES planning_tasks(id) ON DELETE CASCADE` (nullable; identifies a cascade child), `cascade_venue_id uuid REFERENCES venues(id) ON DELETE SET NULL` (which venue this child is for).
- New table `cascade_definitions`:
  - `id uuid PK`
  - `title text NOT NULL`
  - `description text`
  - `default_due_offset_days int` (for applying to planning items)
  - `venue_filter text CHECK in ('all','pub','cafe') DEFAULT 'pub'` (which venues receive children)
  - `created_by → users(id)`, `created_at / updated_at`
- RLS: administrators manage, readable by everyone with planning access.

**Settings UI** (`/settings/cascades` or similar)
- Administrators only.
- CRUD for cascade definitions.

**Cascade expansion logic**
- When a master task is created with a cascade definition, enumerate venues matching the filter and create one child per venue.
- Each child's `assignee_id` = that venue's `default_manager_responsible_id`. If a venue has no default manager, skip that venue and log the gap.
- Each child's `cascade_venue_id` = the venue.
- Each child's `parent_task_id` = the master task's id.

**Master auto-complete**
- When a child task status changes to `done` or `not_required`, check siblings. If all siblings are done or not_required, mark the master `done` with a system-generated completion.
- Implement as a DB trigger on `planning_tasks` update, or server-action hook inside `togglePlanningTaskStatus`.

**Auto-regenerate on new venue**
- Option A (preferred, simpler): when a venue is created with a matching category, server-action fans out and creates a child task for each open master task that has a cascade. Run synchronously inside the create-venue action.
- Option B (safety net): nightly cron `regenerate-cascade-children` reconciles missing children across open masters.
- Start with A; add B if we spot gaps.

**Audit**
- One `audit_log` row per child task creation (`entity = 'planning_task'`, `action = 'cascade_spawn'`, `meta = { master_task_id, venue_id }`).

## Execution waves (revised)

### Wave 1 — Quick wins (today)
Independent, additive, low risk. Order:

- [ ] **#4** Add "Proof read menus" task — after confirming or creating the food SOP section.
- [ ] **#1** `planning_tasks.notes` text column + form field + audit.
- [ ] **#2** Expose the existing `not_required` status on the todos page for non-SOP tasks.
- [ ] **#10** Settings table + UI for `labour_rate_gbp` (£12.71 default) + `debriefs.labour_hours` column + computed cost display.
- [ ] **#9** `slt_members` table + settings picker + `getSltRecipients()` helper + debrief-submitted email.

### Wave 2 — Audit coverage (#3)
- [ ] Audit gap map across `src/actions/*.ts`.
- [ ] Patch each action with `logAuditEvent`.
- [ ] Add a Vitest guard against new unaudited mutations.

### Wave 3 — Venue categories + multi-venue creation (#6)
- [ ] Migration: `venues.category` + seed Heather Farm to `cafe`.
- [ ] `/venues` page category dropdown.
- [ ] Shared `<VenueMultiSelect>` component with "All pubs" shortcut.
- [ ] Event form + create action: accept `venue_ids[]`, create N rows.
- [ ] Planning item form + create action: same pattern + keep "Global" option.

### Wave 4 — Pre-event status (#5)
- [ ] Migration: extend `events.status` CHECK with `pending_approval`.
- [ ] Pre-event create form (date + description only).
- [ ] Admin approval action → promotes to `draft` for full details.
- [ ] Gate full form fields until status is no longer `pending_approval`.

### Wave 5 — Cascade (#8)
- [ ] `cascade_definitions` table + RLS.
- [ ] `planning_tasks.parent_task_id` + `cascade_venue_id`.
- [ ] Settings UI for cascade definitions.
- [ ] Cascade expansion on master-task create.
- [ ] Master auto-complete trigger / hook.
- [ ] Auto-regenerate on new venue (server action).
- [ ] Audit logging of child creation.

### Wave 6 — Attachments (#7)
- [ ] Supabase Storage bucket: `task-attachments` (private), 250 MB limit.
- [ ] Migration: `attachments` table with polymorphic `subject_type` in (`planning_task`, `planning_item`, `event`), `subject_id uuid`, `storage_path`, `mime_type`, `size_bytes`, `uploaded_by`, `created_at`.
- [ ] RLS: read inherits from subject; administrators can manage.
- [ ] Server actions: upload, delete, list, get signed URL.
- [ ] Task editor upload UI.
- [ ] Roll-up display on event and planning item pages (aggregate children).
- [ ] Audit logging.

## Safe defaults if client does not respond today

- **Q1**: Reuse `draft` with a new boolean `events.is_pre_approval`; admin transition sets the flag false and promotes to the normal draft flow.
- **Q2**: Start with (a) — venue multi-select on list filters only. Defer assigning one event to many venues until client confirms.
- **Q3**: Private bucket, 10 MB/file cap, MIME allow-list of PDF/JPEG/PNG/DOCX/XLSX. Office workers see attachments only for events in their venue (same RLS as parent event).
- **Q4**: Master completes when all children complete OR not_required. Cascade does NOT auto-regenerate on venue add (explicit re-cascade action).
- **Q5**: Start with env var `SLT_EMAILS`; revisit after a few debriefs.
- **Q6**: Ship £12.71 as a constant in `src/lib/finance.ts`; schema-ready to migrate to per-venue later.

## Colourblind considerations (user note)

For #2 "not required" and any new status UI: always pair colour with a non-colour cue (icon, strikethrough, text). The existing spec for `not_required` already does this via dash icon + strike-through — reuse verbatim.

## Risks to flag

- **Dropping columns**: #1 (add), #10 (add) are additive. No destructive changes in Wave 1.
- **RLS coverage for #7**: new bucket needs explicit policies — defaulting to private + signed URLs avoids leaks.
- **Audit trigger**: the `audit_log.entity` CHECK currently allows `planning_task` but NOT `task_attachment`. Wave 4 will need a migration to extend the CHECK.
- **#8 cascade + #3 audit**: make sure the cascade expansion logs one audit row per child, not per parent, so a deactivation review can find every venue-task affected.
