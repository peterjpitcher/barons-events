# BaronsHub Fix List — Discovery Summary & Open Questions

Date: 2026-06-04. Read-only discovery. No code changed. Per-area detail in `01`–`08` in this folder.
Phasing per client: **functional first** → RBAC review (separate effort) → E2E (last). RBAC below is **inventory only**.

---

## Headline reframes (current code ≠ the assumptions in the fix list)

1. **"Events appear twice" is a display bug, not a data problem.** DB already enforces exactly one planning_item per event (unique partial index on `planning_items.event_id`). The planning board renders each linked event twice because `listPlanningBoardData` (`src/lib/planning/index.ts:496`) queries events and planning_items separately and `planning-board.tsx` concatenates them with no dedup on `event_id`. **33 events double-show today.** Fix is read-side dedup — contained (S/M), no schema change.

2. **Planning detail pages do NOT have website/booking/ticketing/booking-settings sections today.** Those live only on the event detail page. "Remove them from planning pages" only makes sense if planning detail is first rebased onto the event-detail design. The real ask = "rebuild planning detail on the event-detail template, without carrying the commercial sections across."

3. **There is no "debrief SOP item."** All 27 `sop_task_templates` are pre-event (`t_minus_days` 63→3). Debrief is a separate `/debriefs` feature (`events.debrief`), not a SOP checklist task. So "mark incomplete SOP items N/A except the debrief item" has nothing to exclude — unless the intent is to ADD a debrief step to the SOP list.

4. **Audit trail is already largely done.** Helper is `recordAuditLogEntry` (not `logAuditEvent`). Every file in `src/actions/` logs; a CI guard (`audit-coverage.test.ts`) enforces it. `audit_log.entity` already allows `attachment`; actions already include `attachment.uploaded`, `attachment.deleted`, `planning_task.notes_updated`. The genuinely new audit work is a **`note` entity**. (todo.md's "allowlist empty" note is stale — it has 3 entries.)

5. **"Uplift %" already exists** as `debriefs.sales_uplift_percent` — a generated column = (event takings − baseline)/baseline ×100, **null when no baseline**. Only decision is null-handling. NB: `debriefs` table is currently empty in prod (0 rows).

6. **Charlotte is an `administrator`** (venue_id NULL), not an office_worker — so the office_worker permission theories don't apply to her. Most likely cause: a blank required field (`typeLabel`/`targetDate`) plus the editor dropping `fieldErrors` (`planning-item-editor.tsx:75`) so she saw a vague error with nothing highlighted. Need her exact symptom.

7. **A right-side SOP drawer already exists** (`src/components/events/sop-drawer.tsx`, rendered `events/[eventId]/page.tsx:638`). It's just not mustard, opens from a "30/60/90 Planning" edge handle (not a button by "Bookings" at `page.tsx:578`), and the underlying `Sheet` is modal-only (no pinned-open). So the ask = restyle + move trigger + add pin, not build from scratch.

8. **Event status and planning status have zero overlap.** Events: `draft/submitted/needs_revisions/approved/rejected/completed`, moved only via the guarded approval workflow. Planning items: `planned/in_progress/blocked/done/cancelled`, inline dropdown → `updatePlanningItemAction`. "Make event status changes in /planning match planning behaviour" cannot mean applying planning statuses to events (violates `events_status_check` + bypasses approval).

---

## Per-area status (mapped to the fix list)

### Weekly emails (detail: 01)
- Cron `/api/cron/weekly-digest` exists but runs **Mon–Fri 08:00 UTC**, not Tuesday, and only emails users who HAVE tasks.
- "Active user": uses `deactivated_at IS NULL` (verify `is_active` column usage during impl).
- Approved-events & debriefed-events sections: **not built**. Approval data in `approvals` (`decision`, `decided_at`); no `events.approved_at`.
- To-do window currently 7 days incl. overdue; spec wants 14.
- No-todo positive email: not built (current code skips task-less users).
- Email rendering infra (`renderEmailTemplate` + Resend) is solid and reusable.

### Proposal flow (detail: 01, 02)
- `proposeEventAction` (`src/actions/pre-event.ts`) exists; gated to administrator + office_worker (executive excluded); creates events at `pending_approval`.
- No proposal email is sent today; "helen.pillinger@baronspubs.com" appears nowhere. Config precedent: `business_settings.accountant_sales_report_email` (admin-editable singleton).

### RBAC inventory (detail: 02) — SEPARATE EFFORT
- 28 capability fns in `src/lib/roles.ts`; view helpers already return true for everyone.
- Only 1 executive user (no venue). Conversion to office_worker-no-venue preserves global read, already denies writes. ~23 live code refs + 6 RLS policies + 2 SECURITY DEFINER fns name `executive`.
- Middleware does auth only; authz lives in pages/actions/RLS.

### Event/planning model + status from /planning (detail: 03)
- See reframes 1 & 8. Event cards on the board (`EventOverlayCard`) expose only Approve/Archive/Manage — no status dropdown. No generic event-status setter action exists.

### Detail pages + UI cleanup (detail: 04)
- Event detail = `src/app/events/[eventId]/page.tsx`. Cards (inline): Assignment (`:342/631`), Reviewer timeline (`:398/632`), Post-event debrief (`:474/634`) with the "Add debrief" button at `:492`. No card titled "Event details" — core fields are in `EventForm`.
- Per-user prefs precedent = columns on `public.users` (e.g. `todo_digest_*`). No pin pattern exists (net-new). localStorage used only for per-browser toggles.

### SOP system (detail: 05)
- See reframes 3 & 7. Mustard token `--mustard: #c8a005` (globals.css:17) + tints. N/A already = `not_required`; a sweep migration precedent exists (`20260528110000`). Date-passed keys off `planning_items.target_date`.
- **Notes-not-saving root cause (high confidence):** `updatePlanningTaskAction` (`planning.ts:977`) revalidates only `/planning`, never the event route where the notes editor lives → DB write succeeds but server-rendered prop stays stale → note looks lost. Status toggles share the gap.

### To-do bugs / forms QA (detail: 06)
- RLS asymmetry: action ownership checks use service-role, but the actual write runs under RLS as the user. `planning_item_writable_to_current_user` = false for an office_worker on a global (venue-null) item — yet the UI offers "Global/empty venue" to everyone. This produces the edit/complete errors for office_workers.
- Mark-complete: blocked master tasks (per-venue `is_blocked=true` from `generate_sop_checklist_v2`) return "Complete the blocking tasks first."
- Forms otherwise structurally healthy (RPC signatures match live schema).

### Attachments / notes / audit (detail: 07)
- See reframe 4. Attachments table has **no `version`, no `display_name`**; `original_filename` is the shown name. No rename/new-version UI. Both need a new action + a new audit action value.
- Internal notes: only `planning_tasks.notes` (single overwritten textarea). Net-new multi-entry feature (table + RLS + action + `note` entity + UI). Natural hosts: events & planning detail pages (where AttachmentsPanel/AuditTrailPanel already mount).

### Mobile / booking notes (detail: 08)
- Menu/body overlap: `mobile-nav.tsx:35` never locks body scroll (every other overlay does). Clear fix.
- Opening planning items on mobile: planning cards use native HTML5 `draggable` (no dnd-kit/PointerSensor) which intercepts taps; AND open handlers are only wired for roles with edit rights, so view-only roles get a no-op.
- Customer notes = event flag **`booking_notes_enabled`** (separate from `booking_enabled`). Toggles in `booking-settings-card.tsx` → `updateBookingSettingsAction` (`events.ts:2527`). Default-on hook point identified; no migration needed.

---

## OPEN QUESTIONS (see chat for lettered options + recommendations)

Blocking design: weekly-digest replace-vs-add; uplift null-handling; "one item per event" keep-which-card; what status changes are wanted on /planning; planning-detail rebase intent; the "debrief SOP item" intent; internal-notes host entities; attachment versioning model; Charlotte's exact symptom; which card "Event Details" refers to.

Default-unless-corrected: send time; 14-day window + overdue; approved-7d definition; helen address config-vs-hardcode; customer-notes default mechanism + new-events scope; mobile depth; attachment-rename mechanism; pin persistence (per-user column).

RBAC cross-effort conflicts (affect functional design now): does admin-only-create remove office_worker propose rights; can office_workers change event status from /planning at all; does "operations admin-edit-only" revoke office_worker write on bookings/customers/artists.
