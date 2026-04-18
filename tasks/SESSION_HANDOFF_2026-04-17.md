# Session Handoff — Client Enhancement Batch

**Date:** 2026-04-17
**Status:** ~75% of end-user capability delivered; backend for all six waves deployed; UI integration incomplete for Waves 2, 3, 5.
**Next agent:** Continue from this document. Read the spec, the review artefacts, and this file in full before making any changes.

---

## 1. Context

Client sent a 10-item enhancement list on 2026-04-17. This session:
1. Triaged the list, ran **five rounds of adversarial review** (Codex CLI specialist reviewers) on the spec, resolving 50+ findings.
2. Shipped the spec as v6 at [`docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md`](../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md). **Read this first.** It's long but has concrete SQL + RLS + acceptance criteria for everything.
3. Delivered infrastructure (Wave 0), all five Wave 1 quick wins end-to-end, and DB + server-action backend for Waves 2–5.
4. Committed and pushed **18 migrations** to remote Supabase.

All adversarial review reports live in [`tasks/codex-qa-review/`](./codex-qa-review/) — 20+ files. Don't re-run those; the findings are fully addressed in v6.

---

## 2. What's been shipped (27 commits)

All commits are on `main` and pushed. Start hash: `c7ca1e4`.

```
6c22a8a feat(wave-3): pre-event propose form + admin approval queue UI
f5c9c45 feat(wave-2 + wave-4): venue category UI + SOP per-venue expansion UI
ff85753 feat(wave-4 + wave-5): SOP v2 caller switch + cascade backfill cron + attachments orphan cron
0b1da17 test: update audit allowlist + venue test expectations; refresh todo.md
7926041 feat(wave-5): file attachments backend
871d95a feat(wave-4): SOP per-venue expansion + cascade triggers + v2 RPC
a642966 feat(wave-3): pre-event approval backend
dd21b4a feat(wave-2): venue categories + multi-venue RPCs + VenueMultiSelect
b480b7f feat(wave-1.4, wave-1.5): labour hours + settings page UI
8ad7151 feat(wave-1.1, wave-1.2): task notes UI + not-required status control
870d5f5 chore: fix inspiration action test count + update todo.md progress
e854bf9 feat(wave-1.5): SLT email on debrief submit + members backend
835c111 feat(wave-1.4): labour hours + business_settings backend
52ccd86 feat(wave-1.3): add proof-read menus SOP task template
e5e771e feat(wave-1.1): task notes backend
5df600a feat(wave-0.4): CI guard for audit coverage + close stale customers gap
674b90b feat(wave-0.3): audit coverage patches — Batch C
e88efc2 feat(wave-0.3): audit coverage patches — Batch B
9d27456 feat(wave-0.3): audit coverage patches — Batch A
b4d3e66 docs(wave-0): add audit coverage gap map
4592477 feat(wave-0): audit entity/action CHECK expansion + rename sms_campaign migration
d2722c9 docs: finalise client enhancement spec (v6 + trace fixes)
f70fa47 docs: revise client enhancement spec to v6
cab2eb5 docs: revise client enhancement spec to v5
87c08cb docs: add client enhancement batch spec v4 and adversarial review artefacts
```

### Migrations pushed (all in `supabase/migrations/` prefixed 20260417):

- `...120000_audit_entities_and_actions.sql` — Wave 0.1 audit CHECK expansion + `cascade_internal_bypass()` helper
- `...130000_audit_actions_batch_a.sql` — 4 new action values
- `...140000_add_planning_task_notes.sql` — Wave 1.1
- `...150000_add_proof_read_menus_task.sql` — Wave 1.3
- `...160000_add_business_settings_and_debrief_labour.sql` — Wave 1.4
- `...170000_add_slt_members.sql` — Wave 1.5
- `...180000_add_venue_category.sql` — Wave 2.1 (Heather Farm Cafe seeded as `cafe`)
- `...190000_add_event_creation_batches.sql` — Wave 2.3 idempotency table
- `...200000_add_multi_venue_event_drafts_rpc.sql` — Wave 2.3
- `...210000_add_multi_venue_planning_items_rpc.sql` — Wave 2.4
- `...220000_relax_event_required_fields_and_extend_status.sql` — Wave 3 (**not additive** — CHECK replacement + NOT NULL drops)
- `...230000_enforce_event_status_transitions.sql` — Wave 3.2 trigger
- `...240000_add_multi_venue_event_proposals_rpc.sql` — Wave 2.3b (ships with Wave 3 PR)
- `...250000_add_pre_approve_event_proposal_rpc.sql` — Wave 3.3
- `...260000_extend_sop_for_expansion.sql` — Wave 4.1a
- `...270000_add_planning_task_cascade_columns.sql` — Wave 4.1b
- `...280000_cascade_guard_and_sync_triggers.sql` — Wave 4.3 + 4.4
- `...290000_add_pending_cascade_backfill.sql` — Wave 4.5
- `...300000_generate_sop_checklist_v2.sql` — Wave 4.2 (v1 still in place as reference; all app callers switched)
- `...310000_add_attachments.sql` — Wave 5

Also a rename: `20260417000000_sms_campaign.sql` → `20260416165627_sms_campaign.sql` to match remote history (remote was applied via the dashboard on 16 April with that timestamp; local was committed the next day with a fresh timestamp, causing history drift).

---

## 3. Status per client request

| # | Request | % | State |
|---|---|---:|---|
| 1 | Task notes | **100%** | Column, helper, action, audit, UI (textarea + "Notes" icon in `PlanningTaskList`) all deployed. |
| 2 | Not required on todos page | **100%** | Three-state `Select` (Open/Done/Not required) with colour-independent icons + strikethrough on the same component. Completion-count filters updated. Generic updater now sets `completed_at` for both resolved states. |
| 3 | Audit logging | **100%** | CHECK widened, 8 gaps closed, CI guard in place (allowlist honours RPC-delegating actions with reasons). |
| 4 | Proof-read menus task | **100%** | Deterministic UUID insert under Food Development, ON CONFLICT safe. |
| 5 | Pre-event form | **70%** | Backend fully done. UI: `/events/propose` + `/events/pending` exist. **Remaining:** nav links from main `/events` page; status-consumer sweep (board/calendar/detail may mis-render null `event_type`/`end_at`/`venue_space`). |
| 6 | Multi-select venues | **40%** | `venues.category` column + Heather Farm Cafe seed + venue-form category dropdown + `VenueMultiSelect` component + both multi-venue RPCs (drafts + planning items + proposals) + `event_creation_batches` idempotency all deployed. **Remaining:** existing event create form (`saveEventDraftAction`) and planning item create form still accept a single `venue_id` and do not call the new RPCs. Needs form refactor to accept `venue_ids[]`. |
| 7 | File attachments + rollup | **25%** | Full backend: `attachments` table with three nullable FKs, RLS per parent type, private Storage bucket with MIME allow-list + 250 MB cap, `requestAttachmentUploadAction` / `confirmAttachmentUploadAction` / `deleteAttachmentAction` / `getAttachmentUrlAction`, orphan cleanup cron. **Remaining:** no user-facing UI yet (no upload button, no roll-up section), `file-type` dep not added for server-side MIME sniffing. |
| 8 | Task cascade across venues | **85%** | `sop_task_templates.expansion_strategy` + `venue_filter`, `planning_tasks.parent_task_id`/`cascade_venue_id`/`cascade_sop_template_id`/`auto_completed_by_cascade_at`, cascade parent-sync trigger (auto-complete + reopen + parent-row lock + audit inserts), column-guard trigger, `generate_sop_checklist_v2` RPC (v1 callers switched), `pending_cascade_backfill` queue with retry/lock/dead-letter columns, `/api/cron/cascade-backfill` cron, `venueAction` queueing, settings-UI toggle on SOP task editor. **Remaining:** hasn't been tested against real data end-to-end. |
| 9 | SLT email | **100%** | `slt_members` table, add/remove actions, `getSltRecipients()` helper, `sendDebriefSubmittedToSltEmail()` using `SLT_FROM_ALIAS` env or fallback to one-per-recipient. Settings picker live. Wired into `submitDebriefAction`. |
| 10 | Labour hours + rate | **100%** | `business_settings` singleton seeded with £12.71, `debriefs.labour_hours` + `labour_rate_gbp_at_submit`, live cost readout on debrief form, admin-only settings editor, rate snapshot on submit, drift banner-ready (banner itself not yet rendered). |

**Overall:** 6 of 10 requests fully usable, 4 partially done.

---

## 4. Verification commands (run before starting new work)

```bash
# Baseline state verification
npx tsc --noEmit                              # Type check — expect clean
npm test                                      # Expect 565/565 pass
npm run build                                 # Expect ✓ Compiled successfully
npx supabase migration list | tail -10        # Expect local + remote columns matched
npx vitest run src/actions/__tests__/audit-coverage.test.ts  # Expect 85 pass
```

Pre-existing unrelated issues you'll encounter (not introduced by this session):
- `src/lib/dashboard.ts` has 9 pre-existing ESLint errors about `@typescript-eslint/no-explicit-any` rule being missing from config. Don't chase these.
- `npm run lint` will report those 9. Everything else is clean.

---

## 5. Remaining work (priority-ordered)

### 5.1 Multi-venue wiring into the event + planning item creation forms (Priority: HIGH)
**Why:** Client request #6 is not actually usable — the multi-venue RPCs exist but no form calls them.

**Backend is ready:**
- `create_multi_venue_event_drafts(p_payload jsonb, p_idempotency_key uuid)` — creates N events + planning items + SOP per venue, transactional, idempotent.
- `create_multi_venue_planning_items(p_payload jsonb, p_idempotency_key uuid)` — supports `mode: 'global' | 'specific'`.
- Both authorise caller: administrator, or office worker with `user.venue_id` matching every target. Executives + no-venue office workers blocked.
- `VenueMultiSelect` component at [`src/components/venues/venue-multi-select.tsx`](../src/components/venues/venue-multi-select.tsx) — supports hiddenFieldName for form embedding.

**Files needing changes:**
- [`src/actions/events.ts:591`](../src/actions/events.ts) — `saveEventDraftAction` reads `venueId` (single) from FormData. Extend to read `venueIds[]` as a multi-value; if ≥2, call `create_multi_venue_event_drafts` RPC (generate a client-side idempotency key); if 1, keep existing single-venue path. **Caution:** this function is ~400 lines long and has many callers. Consider adding a new `saveEventDraftsMultiAction` instead of modifying the existing one, keeping existing single-venue path intact.
- [`src/components/events/event-form.tsx`](../src/components/events/event-form.tsx) — currently submits `venueId`. Change to render `VenueMultiSelect` on "Create" mode (detected by absence of `eventId`), continue rendering a single `<Select>` on "Edit" mode.
- [`src/actions/planning.ts:72`](../src/actions/planning.ts) — `createPlanningItemAction` needs similar treatment. Currently takes `venueId` (nullable). Switch to mode toggle: `global` (one row, venue_id null) vs `specific` (N rows via RPC).
- [`src/components/planning/planning-item-editor.tsx`](../src/components/planning/planning-item-editor.tsx) — add the mode radio + VenueMultiSelect.

**Acceptance:**
- Admin picks 3 venues + "Select all pubs" → creates one event per pub.
- Office worker at The Anchor with multi-select showing only their venue → works.
- Executive → rejected (both UI disables submit and RPC rejects if bypassed).

### 5.2 Attachment upload UI (Priority: HIGH)
**Why:** Client request #7 is not usable at all.

**Backend is ready:** `src/actions/attachments.ts` has all actions. Private `task-attachments` Storage bucket live. 250 MB cap.

**Work required:**
1. Add `file-type` dependency: `npm i file-type`. Update `confirmAttachmentUploadAction` in [`src/actions/attachments.ts`](../src/actions/attachments.ts) to sniff the MIME via `fileTypeFromBuffer` on the first 16 KB of the uploaded object before flipping status to `uploaded`. Fail the confirm + delete the storage object if the sniffed type doesn't match the declared `mime_type`.
2. Create `src/components/attachments/attachment-upload-button.tsx`:
   - Accepts `{parentType, parentId}` props.
   - Renders a file picker.
   - On file select: calls `requestAttachmentUploadAction` to get signed URL, uploads via `fetch(uploadUrl, { method: 'PUT', body: file })` with progress via `XMLHttpRequest` if progress UX wanted, then calls `confirmAttachmentUploadAction`.
   - Shows upload progress, success toast, error toast.
3. Create `src/components/attachments/attachment-list.tsx`:
   - Renders a list of attachments with filename, size, uploaded-by, download button, delete button (if permitted).
   - Download button calls `getAttachmentUrlAction` on click and opens `window.open(result.url)`.
4. Integrate into:
   - `src/components/planning/planning-task-list.tsx` — an "Attachments" icon button on each task row, expands to show upload + list.
   - `src/app/events/[eventId]/page.tsx` — a new "Attachments" section using a roll-up query combining event-level + all descendant planning_task attachments.
   - Similar roll-up on the planning item detail page.

**Gotchas:**
- `@supabase/storage-js` exposes `createSignedUploadUrl` + `uploadToSignedUrl`. The action returns the signed URL directly; client can PUT to it. Don't use `uploadToSignedUrl` if the client-side Supabase client is the anon-key one — it won't have upload permission.
- The bucket has no authenticated-user SELECT policy, so downloads MUST go through `getAttachmentUrlAction` (server action issues signed download URL).

### 5.3 Status-consumer sweep for pre-event statuses (Priority: HIGH)
**Why:** If a user creates a proposal via `/events/propose`, the resulting `pending_approval` event has null `event_type`, `venue_space`, `end_at`. Pages that render those directly will crash or display nonsense.

**Files to audit + fix:**
- [`src/components/events/events-board.tsx`](../src/components/events/events-board.tsx) — builds `end` from `event.end_at`; guard with "TBC" if null.
- [`src/components/events/event-calendar.tsx:53`](../src/components/events/event-calendar.tsx) — formats `event.end`; either exclude proposal-state events from the calendar or fall back to `start_at + 2h` for rendering.
- [`src/components/events/event-detail-summary.tsx:107`](../src/components/events/event-detail-summary.tsx) — renders `event.event_type` directly; show "—" when null.
- [`src/app/events/[eventId]/page.tsx:570`](../src/app/events/[eventId]/page.tsx) — formats `new Date(event.end_at)`; guard before the call.
- [`src/app/events/[eventId]/page.tsx:31`](../src/app/events/[eventId]/page.tsx) + `:80` — status label map. Add explicit labels for `pending_approval` + `approved_pending_details` (not "Draft" fallback).
- [`src/lib/events.ts:761`](../src/lib/events.ts) — status counts already have entries for the two new statuses but check whether any consumer iterates and assumes only the old 6.
- [`src/components/events/event-form.tsx`](../src/components/events/event-form.tsx) — if the form is opened on an `approved_pending_details` event, it should prompt "Complete the details" rather than acting like a fresh draft.

### 5.4 Nav links for pre-event flow (Priority: MEDIUM)
**Why:** `/events/propose` and `/events/pending` exist but aren't linked from anywhere.

- On `/events` page: add a "Propose an event" button (all roles with `canManageEvents`).
- On `/events` page for admins: add a "Pending proposals" link with a count badge if any exist.

### 5.5 Status-consumer: venue-manager completion flow (Priority: MEDIUM)
**Why:** The trigger permits `approved_pending_details → draft` for the creator or venue-scoped office worker, but the existing `saveEventDraftAction` may not be setting `status = 'draft'` when the required fields are provided. Needs a read-through.

**Check:** Open [`src/actions/events.ts`](../src/actions/events.ts) and trace `saveEventDraftAction`. When the event is in `approved_pending_details` and all required fields are in the payload, ensure the update payload sets `status = 'draft'`. If it doesn't, the venue manager's completion never transitions status.

### 5.6 MIME sniffing dependency (Priority: LOW)
`npm i file-type`. Integrate into `confirmAttachmentUploadAction` per 5.2 above. Without this, a user could upload a renamed executable and the `mime_type` declared in the request would be taken at face value.

### 5.7 Cascade smoke-testing (Priority: LOW)
Backend is all there, but there's no end-to-end test with real data. Recommend a Playwright or manual run through:
1. Admin toggles a SOP task to "per pub" in Settings.
2. Create a new event → verify each pub has a child task assigned to its `default_manager_responsible_id`.
3. Mark all children done → verify master auto-completes + `auto_completed_by_cascade_at` is set.
4. Reopen one child → verify master reopens + `auto_completed_by_cascade_at` clears.
5. Create a new pub → verify `/api/cron/cascade-backfill` spawns missing children.

### 5.8 Heather Farm Cafe category verification (Priority: LOW)
The migration seeded `category = 'cafe'` for venues named exactly `'Heather Farm Cafe'`. If your production DB has a differently-named row (e.g. just "Heather Farm"), it'll still be `'pub'`. Run:
```sql
SELECT id, name, category FROM venues ORDER BY name;
```
and fix manually if needed.

---

## 6. Important architectural decisions (don't reverse)

These were settled with the client during the session. If you're tempted to rewrite them, check the spec first.

1. **SOP templates absorb cascade** — there is NO `cascade_definitions` table. Cascade config lives on `sop_task_templates.expansion_strategy` + `venue_filter`. One settings screen for everything.
2. **`business_settings` is a typed singleton**, not a generic JSONB key-value store. One row, one `id boolean PK DEFAULT true CHECK (id = true)`. If you add a sensitive column later, put it in a separate `private_business_settings` table.
3. **Attachments use three nullable FKs** (`event_id`, `planning_item_id`, `planning_task_id`) with a CHECK that exactly one is set. NOT polymorphic `subject_type`/`subject_id`.
4. **Multi-venue event creation produces N event rows**, one per venue. Events remain single-venue. Editing an existing event does not allow multi-select.
5. **Cascade-internal bypass flag** (`app.cascade_internal`) is a session-local setting that the SOP v2 RPC and cascade parent-sync trigger set to `'on'` so the guard trigger permits cascade-column writes. This is the documented workspace convention for these privileged internal writes.
6. **Email is never inside a DB transaction.** Approvals, debriefs, etc. do DB work in an RPC, commit, then send email separately. If email fails, DB is authoritative; the failure is logged/audited but doesn't throw.
7. **User is colourblind.** Never rely on colour alone for status. Pair with icons, strikethrough, or opacity. See `PlanningTaskList` three-state control for the pattern.
8. **British English** for all user-facing copy.

---

## 7. Things that might trip you up

1. **The audit-coverage CI guard (`src/actions/__tests__/audit-coverage.test.ts`) is strict.** If you add a new mutating action that doesn't call `recordAuditLogEntry` or `logAuthEvent`, the test fails. Three actions are on the allowlist with reasons:
   - `pre-event.ts:proposeEventAction` — delegates to `create_multi_venue_event_proposals` RPC which audits internally.
   - `pre-event.ts:preApproveEventAction` — delegates to `pre_approve_event_proposal` RPC.
   - `attachments.ts:requestAttachmentUploadAction` — audit fires on confirm, not on pending-row insert.
   If you add another RPC-delegating action, add it to the allowlist with a reason.

2. **Tests mock Supabase clients.** When you add code paths that call `createSupabaseAdminClient`, check the mocks in `src/actions/__tests__/*.test.ts` — specifically `venues.test.ts` added a chainable mock when I added the cascade-backfill queueing.

3. **Pre-existing lint errors** — `src/lib/dashboard.ts` has 9 ESLint errors about a missing rule definition. These are pre-existing and unrelated; don't chase them.

4. **`git mv` renamed** `20260417000000_sms_campaign.sql` → `20260416165627_sms_campaign.sql` early in the session to match remote history. Don't re-rename.

5. **`generate_sop_checklist` (v1) still exists** but no app code calls it — all callers switched to v2 in `ff85753`. Safe to drop in a follow-up migration after a few weeks of v2 being stable.

6. **`app.cascade_internal` session flag:** if you write new code that needs to set cascade columns directly, use `SELECT set_config('app.cascade_internal', 'on', true)` first (the `true` makes it transaction-local). The guard trigger uses `public.cascade_internal_bypass()` to read it.

7. **Spec (v6) is the source of truth** for architectural decisions and acceptance criteria. If anything in this document conflicts with the spec, the spec wins. File: [`docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md`](../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md).

---

## 8. Review artefacts (reference only, don't re-run)

The spec went through five rounds of adversarial review with Codex CLI. All findings are addressed in v6. Read these only if you're confused about why a specific decision was made.

- [`codex-qa-review/2026-04-17-client-enhancement-batch-spec-*`](./codex-qa-review/) — v1 (6 reviewers), v2 (5 reviewers), v3 (2 reviewers), v4 (2 reviewers), v5 (2 reviewers), v6 (2 reviewers).
- [`codex-qa-review/2026-04-17-client-enhancement-batch-spec-claude-handoff.md`](./codex-qa-review/2026-04-17-client-enhancement-batch-spec-claude-handoff.md) — v1 revision brief, now historical.
- [`codex-qa-review/2026-04-17-client-enhancement-batch-spec-v2-claude-handoff.md`](./codex-qa-review/2026-04-17-client-enhancement-batch-spec-v2-claude-handoff.md) — v2 revision brief, now historical.

---

## 9. Suggested next session opening

Start by:
1. Reading this file.
2. Reading the spec (v6) sections relevant to 5.1, 5.2, 5.3 (the three highest-priority remaining items).
3. Running the verification commands in §4 to confirm the baseline.
4. Tackling 5.1 (multi-venue form wiring) first — it unblocks the most client-visible functionality.

**Recommended opening prompt for the next agent:**

> Read `tasks/SESSION_HANDOFF_2026-04-17.md` in full. Then read the relevant sections of `docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md`. Run the verification commands in §4 of the handoff. Then start on §5.1 — the multi-venue form wiring. Open a dev server alongside so you can click through the event create form while you work.

---

## 10. Decisions pending client input

None at this point. All architectural choices were made with the client during v1→v6 review. The remaining work is pure implementation.
