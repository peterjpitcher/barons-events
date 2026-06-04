# Discovery 05 — SOP Checklist System (BaronsHub)

READ-ONLY investigation. No code changed. Project ref `shofawaztmdxytukhozo`.
User is COLOURBLIND — colour-only cues flagged below.

---

## 1. SOP checklist UI — current state

### It IS already a drawer (but not as the client describes)
A right-side drawer already exists:

- `src/components/events/sop-drawer.tsx` — `<SopDrawer>`, a `"use client"` component.
  - Renders a **fixed right-edge vertical handle** (`fixed right-0 top-1/2 … writingMode: vertical-lr`) when closed (lines 41–57).
  - Handle label is **"30/60/90 Planning"** with a `doneCount/total` counter — NOT labelled "SOP", and NOT a button sitting next to "Bookings".
  - Opens a `<Sheet side="right">` containing `<SopChecklistView>` (lines 59–85).
  - Colours used: `bg-[var(--paper)]`, `border-[var(--hair)]`, hover `bg-[var(--canvas-2)]` — neutral paper/grey, **NOT mustard**.
  - `readOnly` wraps the view in `pointer-events-none opacity-80`.

### Underlying Sheet primitive — no pinning support
- `src/components/ui/sheet.tsx` — `<Sheet>` / `<SheetContent side="left"|"right">`.
  - It is a **modal overlay**: full-screen `fixed inset-0 z-50`, scrim `bg-[var(--overlay-scrim)]`, `aria-modal="true"`, focus-trapped, closes on Escape, `max-w-md` panel (lines 197–217).
  - **No non-modal / "pinned open" mode exists.** Pinning will require either a new variant on Sheet (modal=false, no scrim, page padding shift) or a separate pinnable panel component. FLAG — design decision.

### The "Bookings" button (where the new pop-out button should sit)
- `src/app/events/[eventId]/page.tsx` **line 578–582**, inside the "Quick info bar":
  ```tsx
  {canViewEventBookings ? (
    <Button asChild variant="secondary" size="sm">
      <Link href={`/events/${event.id}/bookings`}>Bookings</Link>
    </Button>
  ) : null}
  ```
  Gated by `canViewBookings(user.role)` (page line 94). This is the anchor for the requested new pop-out button.

### Host page & data flow
- Host: `src/app/events/[eventId]/page.tsx`.
  - SOP tasks are server-fetched (lines 125–197): finds the `planning_items` row via `.eq("event_id", eventId)`, then maps its `planning_tasks` (incl. `notes`, line 135/197) into `sopTasks: PlanningTask[]` and `sopPlanningItemId`.
  - `<SopDrawer>` rendered at **line 638–644** only when `sopPlanningItemId && sopTasks.length > 0`. **No `onChanged` prop is passed** (relevant to the notes bug).
- Other SOP UI (inline, not drawer):
  - `src/components/planning/sop-checklist-view.tsx` — the actual checklist; also used inline elsewhere.
  - `src/components/planning/sop-task-row.tsx` — individual row (checkbox, notes, reassign, attachments).
  - `src/components/planning/planning-task-list.tsx`, `planning-item-card.tsx` — planning board hosts.
  - `src/components/dashboard/context-cards/sop-progress-card.tsx` — dashboard summary.
  - `src/components/settings/sop-template-editor.tsx` — template admin.

---

## 2. Mustard palette token

`src/app/globals.css`:
```css
--mustard:        #c8a005;   /* line 17 — primary mustard */
--mustard-bright: #d9b021;   /* line 18 */
--mustard-dark:   #8a6e02;   /* line 19 */
--mustard-tint:   rgba(200, 160, 5, 0.14);  /* line 20 — subtle fill */
--ink-on-mustard: #1a1305;   /* line 27 — readable text on mustard */
```
Semantic aliases mapping to mustard (use these in components per workspace rule "design tokens only"):
- `--color-accent-bronze: var(--mustard)` / `-dark`
- `--color-accent-soft: var(--mustard-tint)` ; `--color-accent-warm: var(--mustard)`
- `--color-warning: var(--mustard)` ; `--color-ring: var(--mustard)` ; `--color-highlight: var(--mustard-bright)`

**Use `--mustard-tint` for a panel fill, `--mustard` for borders/accents, `--ink-on-mustard` for text on solid mustard.** The existing drawer uses `--paper`/`--hair`; making it "mustard" = swap to `--mustard-tint` background + `--mustard` border + `--ink-on-mustard` text.

### Colourblind note
- `sop-task-row.tsx` pairs colour with shape/text in most places: done = green box **with `Check` icon**; not_required = grey box **with `Minus` icon** + "Not required" text; blocked = "Waiting on:" text. Good.
- BUT due-date urgency is **colour-only**: `dueDateColour()` (lines 42–52) returns `text-[var(--burgundy)]` (overdue) vs `text-[var(--mustard)]` (≤7 days) vs `text-subtle` with no icon/label difference — the word "due 5 Jun" looks identical apart from hue. FLAG for the colourblind user.
- The progress bar (`sop-checklist-view.tsx` line 134–139) is a single `--sage-dark` fill — fine (has "% complete" text).

---

## 3. SOP item status model + N/A mapping

- `src/lib/planning/types.ts` line 3: `export type PlanningTaskStatus = "open" | "done" | "not_required";`
- DB `planning_tasks.status` is `text` (no enum/CHECK seen).
- **"N/A" already maps to the existing `not_required` status.** No new status is needed.
  - UI labels `not_required` as "Not required" / "skipped" (badge) and dims the row to `opacity-40`.
  - The actions menu offers "Mark not required" / "Mark required" (`sop-task-row.tsx` lines 382–409).
- **Precedent already exists** for a date-passed N/A sweep:
  - `supabase/migrations/20260528110000_mark_pre_cutover_event_tasks_not_required.sql` does exactly this as a one-off SQL update:
    ```sql
    update public.planning_tasks pt
    set status='not_required', completed_at=coalesce(pt.completed_at, now()), is_blocked=false
    from public.planning_items pi
    where pt.planning_item_id = pi.id
      and pi.target_date < date '2026-06-11'
      and pt.status <> 'not_required';
    ```
  - Also `planning_series.sop_not_required_template_ids uuid[]` (migration 20260528103000) lets a series pre-mark specific template IDs not_required on every occurrence.

**Recommendation: reuse `not_required` (confirm with human — see Questions).**

---

## 4. Date-passed evaluation + debrief-item exclusion

### What "date has passed" keys off
- For **events**: the SOP tasks belong to a `planning_items` row linked by `planning_items.event_id`. The relevant date is **`planning_items.target_date`** (`date` column). The pre-cutover migration uses exactly this column.
- For **planning items** generally: same `planning_items.target_date`.
- Individual task `planning_tasks.due_date` exists too, but the client's wording ("event or planning item date has passed") = the parent item's `target_date`, matching the existing sweep.
- `planning_items` also has `occurrence_on` (for series occurrences) and `status`.

### Identifying the debrief item to EXCLUDE — PROBLEM
- **There is NO "debrief" SOP task template and no `debrief` reference anywhere in SOP code.**
  - `grep -ri debrief` across `src/lib/planning/`, `src/actions/sop.ts`, `src/components/planning/`, SOP migrations → **zero hits**.
  - All 27 rows in `sop_task_templates` are **pre-event** (`t_minus_days` 63 → 3); none post-event, none titled anything like "debrief"/"review". Titles include "Setup Event", "Social media", "Staffing", etc.
- `sop_task_templates` has **no stable key column** — only `id`, `title`, `section_id`, `sort_order`, `t_minus_days`, `expansion_strategy`, `venue_filter`. So a template can only be matched by `title` (fragile, editable in settings UI) or by a new explicit flag/key column.
- "Debrief" in this app is a **separate feature**: route `/debriefs/[eventId]`, an `event.debrief` object (guest_sentiment_notes etc.), and a "Add/Update debrief" link (`page.tsx` line 493). It is NOT a SOP checklist task.

**So "except the debrief SOP item" cannot be satisfied as written — there is no debrief SOP item.** This is the biggest ambiguity. FLAG — see Questions.

---

## 5. Sweep mechanism — cron vs on-read (DESIGN QUESTION)

Both patterns exist in the codebase:
- **Cron**: `src/app/api/cron/*` (12 routes), scheduled in `vercel.json` `"crons"`. Standard shape: `GET`, `verifyCronSecret(request.headers.get("authorization"))` (`src/lib/cron-auth.ts`), `createSupabaseAdminClient()`, JSON logging. A daily "mark passed-date SOP tasks N/A" cron would fit cleanly (e.g. alongside `expire-stale-approvals`, which is a similar "sweep stale rows" job).
  - Note: `expire-stale-approvals` exists as a route but is NOT in `vercel.json` crons — verify scheduling story.
- **On-read**: status/blocked are persisted columns, not computed on read; the UI reads `task.status` directly. There is no precedent for computing N/A on the fly.
- **One-off SQL**: the existing N/A behaviour (cutover) was a migration, run once.

**Recommendation: a daily cron sweep that sets `status='not_required'` where parent `target_date < today` AND status='open' AND (not the debrief item), mirroring the cutover migration.** Computing on-read would fight the existing persisted-status model and the progress %/badges. FLAG — confirm cron vs on-read, and confirm whether already-passed historical items should be swept retroactively or only going forward.

---

## 6. SOP notes-not-saving — ROOT CAUSE HYPOTHESIS (high confidence)

### The save path
- Component: `src/components/planning/sop-task-row.tsx`.
  - Notes editor is an **`<input type="text">`** (NOT a textarea), lines 199–228. `onChange` strips `\r\n`. Local state `notesDraft` initialised from `task.notes` (line 76).
  - Saves via `handleSaveNotes()` (lines 141–156) on Enter and on blur-if-dirty; calls `updatePlanningTaskAction({ taskId, notes })`, shows toast "Notes saved", `setNotesOpen(false)`, then `onChanged?.()`.
- Action: `src/actions/planning.ts` → `updatePlanningTaskAction` (lines 911–983).
  - Validates, ownership check, calls `updatePlanningTask(...)` which **does write `notes`** (`src/lib/planning/index.ts` lines 1065–1066, `updatePayload["notes"] = updates.notes`), writes audit, returns `{ success:true }`.
  - **`revalidatePath("/planning")` ONLY (line 977).**

### Root cause: revalidation targets the wrong route
The notes editor is hosted on **`/events/[eventId]`** (via `SopDrawer`), but `updatePlanningTaskAction` revalidates only **`/planning`** (and the notes/status round-trip never revalidates `/events/[eventId]`). Consequences:

1. The DB write **succeeds** (toast confirms), so this is a *persistence-illusion* bug: it saves, but the UI shows stale data.
2. After save, the server-rendered `sopTasks` prop on the event page is **not refreshed** (route cache not invalidated). `SopChecklistView`/`SopTaskRow` keep no global optimistic notes state — `notesDraft` resets from the stale `task.notes` on next render/remount. On refresh or navigation back to the event, the typed note appears to have "not saved".
3. `SopDrawer` passes **no `onChanged`** (page.tsx line 638–644), so even the client-side `onChanged?.()` refresh hook is a no-op in the drawer context. The same applies to status toggles from the drawer: `togglePlanningTaskStatusAction` revalidates only `/planning` + `/` (lines 1024–1025), never `/events/[eventId]`.

### Secondary contributing factor (the onBlur close path)
`onBlur` (lines 210–217): if `notesDraft !== (task.notes ?? "")` it saves; else closes. Because `task.notes` never updates after a successful save (point 2), if the user re-opens and the prop is stale, dirty-detection is computed against stale data — and clicking away can re-close without the user seeing their saved value reflected, reinforcing the "didn't save" perception.

### Evidence summary
| Evidence | Location |
|---|---|
| Notes editor + save handler | `sop-task-row.tsx:141-156, 199-228` |
| Action writes notes, revalidates only `/planning` | `planning.ts:944-957, 977` |
| Persistence layer writes `notes` | `lib/planning/index.ts:1065-1066` |
| Host page is `/events/[eventId]`, fetches notes server-side | `events/[eventId]/page.tsx:125-197` |
| Drawer passes no `onChanged` | `events/[eventId]/page.tsx:638-644` |
| Status toggle also misses `/events/[eventId]` | `planning.ts:1024-1025` |

**Fix direction (for the build phase, NOT done here): add `revalidatePath("/events/[eventId]", "page")` / revalidate the event route (or the planning item's event) in `updatePlanningTaskAction` + `togglePlanningTaskStatusAction`, and/or pass an `onChanged`/`router.refresh()` through `SopDrawer` → `SopChecklistView`.** Confirm exact revalidation strategy with human (dynamic segment path).

---

## QUESTIONS FOR HUMAN

1. **N/A status:** Confirm "mark as N/A" = set existing `not_required` status (matches the cutover migration and current UI), rather than introducing a new `not_applicable` status? (Recommend reuse — a new status touches type unions, badges, RPCs, RLS.)

2. **The debrief SOP item does not exist.** There is no "debrief" task template and no debrief reference in SOP code — debrief is a separate `/debriefs` feature on the event. So "mark incomplete SOP items N/A except the debrief SOP item" can't be applied literally. Which do you mean:
   - (a) A debrief **does** need to become a SOP task template (so the sweep can skip it) — i.e. add it first? or
   - (b) You mean the separate debrief feature (which is already not a SOP task, so nothing to exclude)? or
   - (c) Exclude a specific existing template by title (which one)?

3. **Identifying the debrief item reliably:** `sop_task_templates` has no stable key — only editable `title`. If a debrief SOP task is introduced, should we add an explicit flag/key column (e.g. `is_debrief boolean` or `template_key text`) so the exclusion isn't title-string-matching? (Recommend a flag column.)

4. **Sweep mechanism:** daily **cron** sweep (recommended, mirrors existing `expire-stale-approvals` pattern and the cutover SQL) vs **computed on read**? And: sweep only going forward, or also retroactively mark already-passed open items?

5. **Pinned-open drawer:** the `Sheet` primitive is modal-only (scrim + focus trap + Escape). Pinning open implies a non-modal docked panel that shifts/coexists with page content. Acceptable to add a non-modal variant to `Sheet` (or a new docked panel), and should the pin state persist (localStorage / per-user)?

6. **Launcher placement & label:** today the launcher is a fixed right-edge vertical handle labelled "30/60/90 Planning". You asked for a button **next to "Bookings"** (event Quick-info bar, `page.tsx:578`). Replace the edge handle with a Bookings-adjacent button, or keep both? And should the button read "SOP" / "SOP checklist" rather than "30/60/90 Planning"?

7. **Colourblind — due-date urgency:** overdue vs due-soon is currently colour-only (`dueDateColour`, `sop-task-row.tsx:42-52`). Want an icon/label added (e.g. "Overdue" / "Due soon" text) while we're in here?
