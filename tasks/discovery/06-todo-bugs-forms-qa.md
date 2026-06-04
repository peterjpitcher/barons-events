# Discovery 06 — To-do reliability bugs, Forms QA, Planning-item creation failure

**Scope:** READ-ONLY diagnosis. No code changed.
**Project:** BaronsHub (Supabase ref `shofawaztmdxytukhozo`).
**Date:** 2026-06-04

---

## 0. Architecture facts established (load-bearing for every hypothesis)

- **`createSupabaseActionClient()` = anon + cookie session (RLS-enforced).** `src/lib/supabase/server.ts:28`. So `createPlanningItem`, `updatePlanningItem`, `updatePlanningTask`, `togglePlanningTaskStatus`, `createPlanningTask` all run **under RLS as the logged-in user**.
- **`createSupabaseAdminClient()` = service role (RLS-bypass).** Used by the *ownership-check* helpers (`loadPlanningItemAccess`, `ensureOwnsParentItemOfTask`) and the SOP/venue-sync RPCs.
- **Consequence:** there are *two* authorisation layers with **different logic**:
  1. App layer (in `src/actions/planning.ts`) via `src/lib/visibility.ts` + `src/lib/roles.ts`.
  2. DB layer via RLS policy functions `planning_item_writable_to_current_user` / `planning_item_visible_to_current_user`.
  Where they disagree, behaviour is confusing (one blocks with a friendly message, the other throws a raw RLS error).

### Live schema confirmed (no missing-column bugs in task/item write paths)
`planning_tasks` columns include `status`, `completed_at`, `completed_by`, `notes`, `is_blocked`, `manually_assigned`, `parent_task_id`, `cascade_venue_id` — every column the code writes exists. `planning_items` has `venue_id`, `status`, `target_date`, `event_id`, etc. — all present.

CHECK constraints (verified live):
- `planning_tasks_status_check` = `('open','done','not_required')` → the three-state `not_required` is **valid**, no constraint mismatch.
- `planning_items_status_check` = `('planned','in_progress','blocked','done','cancelled')` → matches `planningStatusSchema`.

### RLS policy functions (verified live)
```
planning_item_writable_to_current_user(item_id, primary_venue_id):
  administrator                         -> true
  office_worker WITH venue_id:
       primary_venue_id = my_venue  OR  EXISTS row in planning_item_venues for my_venue -> else FALSE
  office_worker WITHOUT venue_id        -> FALSE
  anything else                         -> FALSE
```
`planning_tasks` UPDATE/DELETE/INSERT RLS all delegate to `planning_item_writable_to_current_user(pi.id, pi.venue_id)` of the parent item. `planning_items` INSERT check and UPDATE/DELETE using-clause are the same gate (INSERT additionally hard-requires `venue_id = current_user_venue_id()` for office_worker).

**Critical asymmetry:** for an **office_worker with a venue**, a **GLOBAL planning item** (`venue_id IS NULL`, no `planning_item_venues` rows) is **NOT writable** — they cannot update the item *or any of its tasks* (RLS `false`). They *can* still SELECT it (visible function returns true when their venue matches OR... but global still requires a venue link; an office_worker with venue can't even see a global item unless linked — `planning_item_visible_to_current_user` returns true only for admin/exec, or office_worker whose venue matches/links). Admins are unaffected.

---

## 1. To-do EDIT flow — root-cause hypotheses

**UI entry points** (all client components):
- `src/components/planning/planning-item-card.tsx` — inline field edits (title/type/status/target/owner/**venue**/description) → `updatePlanningItemAction`.
- `src/components/planning/planning-task-list.tsx` — task title/assignee/due/**notes** edits → `updatePlanningTaskAction`; status → `togglePlanningTaskStatusAction`.
- `src/components/planning/sop-task-row.tsx` + `sop-checklist-view.tsx` — SOP task status → `togglePlanningTaskStatusAction`.
- `src/components/todos/unified-todo-list.tsx` — dashboard "Todos by person" → `togglePlanningTaskStatusAction` and embeds `SopTaskRow`.

All show failures as a Sonner `toast.error(result.message ?? "Could not update …")`.

### Hypothesis E1 (HIGH) — office_worker + "Global item" venue edit is rejected by the app layer
`planning-item-card.tsx:282-299` `saveField("venueId")` sends `venueIds: selectedVenueIds`. The `VenueMultiSelect` is rendered for **all roles** on the detail page (not gated by `isAdmin`) and explicitly offers `emptyLabel="Global item"`; the field help text (line 630) says *"Pick no venues for a global item…"*. If an office_worker clears all venues, `venueIds = []`.
In `updatePlanningItemAction` (`src/actions/planning.ts:241`): `canCreatePlanningForVenueSelection(user, [])` returns **false** for office_worker (`src/lib/visibility.ts:` requires `length>0 && every===my_venue`). Result: `{ success:false, message:"You can only assign planning items to your assigned venue.", fieldErrors:{venueIds:"Choose your assigned venue"} }`.
**Symptom:** "error when editing a to-do" = friendly toast blocking the save whenever an office_worker tries to make an item global. The UI invites the exact action the server forbids.

### Hypothesis E2 (HIGH) — office_worker editing tasks/notes on an item not writable to them → RLS throw
`updatePlanningTaskAction` (`planning.ts:911`) ownership check uses **admin-client** `ensureOwnsParentItemOfTask` → `canEditVenueLinkedPlanning` (returns true if item is linked to their venue). It then calls `updatePlanningTask` which runs the UPDATE under the **anon RLS client**. The two checks *mostly* agree, BUT:
- `canEditVenueLinkedPlanning` (`visibility.ts`) checks `isLinkedToVenue` which includes the **primary `venue_id`** AND `planning_item_venues`.
- RLS `planning_item_writable_to_current_user` checks the **same set**, so for venue-linked items they agree.
- Divergence risk: if `planning_item_venues` is **out of sync** with the denormalised `planning_items.venue_id` (e.g. an item edited before `set_planning_item_venues` ran, or a partial sync — note `syncPlanningItemVenueAttachments` swallows RPC errors at `planning.ts:90`), the admin-side check can pass while the RLS UPDATE returns 0 rows / error. `updatePlanningTask` then throws `Could not update planning task: <rls msg>` → caught → toast "Could not update task." This is a plausible intermittent "edit error."

### Hypothesis E3 (MEDIUM) — assignee-only RLS path can't satisfy WITH CHECK
There is an extra policy `planning_tasks_assignee_update` (USING only: the current user is in `planning_task_assignees`). It has **no WITH CHECK**. Postgres requires a WITH CHECK to be satisfied for the *new* row; with multiple permissive UPDATE policies, the row passes if **any** USING matches AND **any** applicable WITH CHECK matches. The "writable" policy supplies a WITH CHECK that an assignee at a different venue will **fail**. Net: a user who is only an *assignee* of a task on an item **outside their venue** can read+select-for-update via the assignee USING clause, but the UPDATE's WITH CHECK (from the scoped policy) fails → RLS error on save. Edge case but matches "edit/complete error" for cross-venue assignees.

### Not a cause
- No missing column. No bad enum. `updatePlanningTask` (`index.ts:1035`) correctly uses `!== undefined` semantics (won't null out `completed_at` on a notes-only save — comment at 1040 documents a prior fix).

---

## 2. MARK-COMPLETE flow — root-cause hypotheses

Path: `togglePlanningTaskStatusAction` (`planning.ts:985`) → ownership check (admin client) → if status≠open, reads `is_blocked` (admin client) and blocks with *"Complete the blocking tasks first."* → `togglePlanningTaskStatus` (`index.ts:1084`, **anon RLS** UPDATE setting `status`, `completed_at`, `completed_by`) → `updateBlockedStatus` (admin client, dependency recompute).

### Hypothesis C1 (HIGH) — same RLS-vs-app asymmetry as E2/E3
The completion UPDATE runs under RLS. For office_workers on items not writable to them (global items, or items whose `planning_item_venues` is out of sync), the UPDATE fails and `togglePlanningTaskStatus` throws → `togglePlanningTaskStatusAction` catch returns `{success:false, message: err.message}` → optimistic row un-hides and toast shows the raw error. This is the most likely "error when marking complete" for non-admins.

### Hypothesis C2 (MEDIUM) — "Complete the blocking tasks first." surfaced as an error
SOP per-venue **master tasks** are deliberately set `is_blocked = true` once child tasks exist (see `generate_sop_checklist_v2`: after fanning out children it runs `update planning_tasks set is_blocked=true where id=v_master_id`). Master rows are therefore **uncompletable directly** and the checkbox returns `{success:false, message:"Complete the blocking tasks first."}`. If the UI exposes a tick on a blocked master (sop-task-row gates on `isActionable`, but the dashboard `unified-todo-list` `handleToggle` calls complete directly), the user sees a confusing "error" that is actually a business rule. Worth confirming whether blocked masters appear as tickable in any surface.

### Hypothesis C3 (LOW) — `completed_by` FK / null
`togglePlanningTaskStatus` writes `completed_by = userId ?? null`. `userId` is always passed from the action (`user.id`). No issue found; `completed_by` is nullable uuid with FK to users.

### Three-state `not_required`
Handled consistently: schema allows it, both `updatePlanningTask` and `togglePlanningTaskStatus` set `completed_at`/`completed_by`, and reopening (`open`) clears them. `sop-task-row.tsx` renders "Mark not required" only when `isActionable`. No defect in the state machine itself; failures here reduce to C1.

---

## 3. PLANNING ITEM CREATION (Charlotte's scenario) — analysis

**IMPORTANT correction:** Charlotte Whindle (`charlotte.whindle@baronspubs.com`, id `56e41865-79be-4807-a472-b5d1173ac092`) is role **`administrator`**, `venue_id = NULL`. So the office_worker "can't create global" gate does **NOT** apply to her. Her create path:

`PlanningItemEditor.submitSingleItem` (`planning-item-editor.tsx:114`) → `createPlanningItemAction` → `ensureUser` (admin passes) → `createItemSchema` parse → `canCreatePlanningForVenueSelection(admin, …)` = true → `createPlanningItem` (anon RLS insert; admin INSERT policy passes) → `syncPlanningItemVenueAttachments` (admin RPC, errors swallowed) → `generateSopChecklist` (admin RPC, **wrapped in try/catch**, errors swallowed) → audit → success.

Because SOP + venue-sync errors are swallowed, **the create itself rarely hard-fails for an admin**. Confirmed: most recent successful create "TEST EVENT" (2026-06-02, `venue_count:1`); audit log only records successes. Recent Postgres logs show **no** application INSERT/UPDATE errors.

### Candidate failure paths for an ADMIN create (ranked)
- **CR1 (MEDIUM):** Zod rejection surfaced as a generic toast. `createItemSchema` requires `title ≥2`, `typeLabel ≥2`, and `targetDate` matching `^\d{4}-\d{2}-\d{2}$`. The client pre-check (`submitSingleItem:115`) only checks non-empty. If "planning type" is left blank or 1 char, server returns `{success:false, message:"Check the highlighted fields.", fieldErrors:{typeLabel:…}}`. The editor's `runAction` (`planning-item-editor.tsx:75`) shows only `result.message` ("Check the highlighted fields.") and **discards `fieldErrors`** — so Charlotte would see a vague error with no field highlight. This is a real UX failure mode and could be "the planning item wouldn't save."
- **CR2 (LOW-MED):** The insert runs under the **anon RLS client**, so it depends on a *valid logged-in Supabase session cookie*. If Charlotte's session token was stale/expired at submit, `current_user_role()` returns NULL → INSERT WITH CHECK fails → `createPlanningItem` throws → caught → toast "Could not create planning item." Plausible if the failure was a one-off after idle.
- **CR3 (LOW):** `generate_sop_checklist_v2` no longer fails the create (try/catch), but if Charlotte expected the SOP checklist to appear and it silently failed (e.g. a `per_venue` template with venues missing `default_manager_responsible_id`, which the RPC *skips* and records in `skipped_venues`), she might perceive the item as "not saved correctly" even though the row exists. The RPC itself is robust.
- **CR4 (LOW):** Admin uses `VenueMultiSelect` (`itemVenueIds`). An empty selection is a valid global item for admins, so no block here.

**Cannot reproduce Charlotte's exact error from code/DB alone.** Need her actual symptom (see Questions).

---

## 4. Major forms — health table

| Form | Action (file) | Schema | Client/RLS | Health |
|---|---|---|---|---|
| Planning item — create | `createPlanningItemAction` (`actions/planning.ts:126`) | `createItemSchema` | anon insert (RLS) + admin RPCs | **At risk** — office_worker "Global" selection blocked by `canCreatePlanningForVenueSelection`; `fieldErrors` dropped by editor's `runAction`. |
| Planning item — edit | `updatePlanningItemAction` (`planning.ts:212`) | `updateItemSchema` | anon update (RLS) | **At risk** — same global-venue block (E1); RLS-vs-app asymmetry (E2). |
| Planning task — create/edit/complete | `createPlanningTaskAction`/`updatePlanningTaskAction`/`togglePlanningTaskStatusAction` (`planning.ts:623/911/985`) | inline zod | anon write (RLS) | **At risk** — C1/E2/E3 RLS path for non-admins; blocked-master confusion (C2). |
| Event — save draft / submit | `saveEventDraftAction`/`submitEventForReviewAction` (`actions/events.ts:775/1312`) | `eventDraftSchema`/`eventFormSchema` (`lib/validation.ts`) | anon + optional RPC behind `EVENT_SAVE_USE_RPC` flag; `set_event_venues` RPC | Looks healthy; dual-path (RPC vs legacy) adds risk surface but out of this scope. |
| Venue — create/update | `createVenueAction`/`updateVenueAction` (`actions/venues.ts:54/109`) | `venueSchema` (`category` enum `['pub','cafe']`) | admin-gated; `createVenue`/`updateVenue` | Healthy. Note: `category` enum only `pub`/`cafe` — DB also referenced `cafe`/`coffee` service types in migration 20260310; verify no third category is offered in UI. |
| Debrief — submit | `submitDebriefAction` (`actions/debriefs.ts:43`) | `debriefSchema` (`lib/validation.ts:172`) | anon read of event + `upsertDebrief`; permission via `canSubmitDebriefForEvent` | Healthy. Only first zod issue surfaced (`error.issues[0]`). |
| Booking (public) — create | `createBookingAction` (`actions/bookings.ts:192`) | `createBookingSchema` | Turnstile + rate-limit + `createBookingAtomic` RPC | Healthy/robust (atomic RPC, dedup best-effort, E.164 normalise). |
| User — update/invite/deactivate | `updateUserAction`/`inviteUserAction`/`deactivateUserAction` (`actions/users.ts:25/124/458`) | `userUpdateSchema`/`inviteSchema` | admin-gated; `reassign_and_deactivate_user` RPC | Healthy. |
| Business settings | `updateBookingSettingsAction` (`events.ts:2527`) etc. | `bookingSettingsSchema` | — | Not deeply inspected; no obvious breakage. |

No form references a **missing DB column** or a **stale RPC signature** (verified `generate_sop_checklist_v2(uuid,date,uuid)` and `set_planning_item_venues(uuid,uuid[])` exist with matching args; `createBookingAtomic`, `set_event_venues`, `reassign_and_deactivate_user` all called consistently).

---

## 5. The single highest-value fix theme

Both to-do bugs and the office_worker planning-create failure share **one root cause**: the UI offers a **"Global item" / empty-venue** option to **all** users (create editor for office_workers via single Select default `""`; detail-page `VenueMultiSelect` for everyone), but the server (`canCreatePlanningForVenueSelection`) and RLS (`planning_item_writable_to_current_user`) **forbid office_workers from creating or writing global items**. Either:
(a) hide the Global option from office_workers and default their venue selection to their own `venue_id`; or
(b) relax the policy to let a venued office_worker own global items.
Plus: the create editor's `runAction` should surface `fieldErrors` (currently dropped), so validation failures aren't shown as vague "Check the highlighted fields." with nothing highlighted.

---

## QUESTIONS FOR HUMAN

1. **Charlotte is an `administrator` (venue_id null), not an office_worker.** What *exactly* did she see when "planning item creation failed"? Specifically:
   - (a) A red toast — and what did it say verbatim? ("Check the highlighted fields." / "Could not create planning item." / "You can only create planning items for your assigned venue." / something else)
   - (b) Which form: the **/planning/new** create editor, or the **inline create** somewhere else?
   - (c) Did she leave the **Planning type** field blank? (Most likely admin failure = CR1: required `typeLabel` rejected, with the editor dropping the field-level highlight.)
   - (d) Did the item actually get created but with no SOP checklist (CR3), i.e. "saved but looked wrong"?
2. For the **to-do edit** and **mark-complete** errors: which **role** was the user (admin vs office_worker), and what was the **exact toast text**? This decides between E1 (friendly block on going global), C2 ("Complete the blocking tasks first." on a blocked SOP master), and C1/E2/E3 (raw RLS error like *"new row violates row-level security policy"* / *"Could not update task."*).
3. Were the failing to-do edits on **global** planning items or **venue-linked** ones? (Confirms the global-write asymmetry vs a `planning_item_venues` sync drift.)
4. Is it **intended** that a venued office_worker cannot create/edit **global** planning items at all? If so, the UI should stop offering "Global" to them; if not, the RLS + `canCreatePlanningForVenueSelection` need relaxing.
