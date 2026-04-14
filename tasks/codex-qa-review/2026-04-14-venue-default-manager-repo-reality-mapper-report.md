I inspected the spec at [2026-04-14-venue-default-manager-and-table-fix-design.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-venue-default-manager-and-table-fix-design.md:1) and the requested files, plus a few supporting callers to trace venue data into the event form.

**Repo Reality Map**
1. [src/components/venues/venues-manager.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/venues/venues-manager.tsx:37)
Today: the create form is a 3-column grid with `name`, `defaultReviewerId`, and an icon-only add button; the table header has 5 columns, but each body row is a single `<td colSpan={3}>` containing a 6-track CSS grid and a `form className="contents"` (`lines 61-94`, `109-126`, `160-243`). Save/Hours/Delete are not icon-only today: Save has text, Hours has text, Delete has text.
Spec: add a default-manager column/input, move to a true 6-column table, and make Save/Hours/Delete icon-only.
Reality gap: the misalignment bug is real, but the constraint is bigger than `colSpan`; the current single-form-across-grid pattern will not drop cleanly into separate `<td>` cells. A real table-row rewrite needs either `form` ids/attributes or a different row structure, because one form cannot validly wrap multiple `<td>`s.
Pattern to follow: per-row `useActionState`, toast on success/error, `router.refresh()`, separate delete form with `ConfirmDialog`, and inline field errors currently only wired for `name`.

2. [src/actions/venues.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/venues.ts:11)
Today: venue validation is inline in this file, not shared from `src/lib/validation.ts`. `createVenueAction` reads only `name` and `defaultReviewerId`; `updateVenueAction` reads `venueId`, `name`, `defaultReviewerId`, and `googleReviewUrl` (`lines 40-43`, `78-83`). Both actions are planner-only and `revalidatePath("/venues")`.
Spec: both actions should accept `defaultManagerResponsible` with max 200 and map blank to `null`.
Reality gap: the spec assumes a simple optional string, but current form parsing does not normalize blank text to `undefined`; if you want blank-to-null, you need preprocess logic or the current `or(z.literal(""))` style. Also, create does not currently accept `googleReviewUrl` even though the shared schema includes it.
Pattern to follow: camelCase form field names in actions, explicit extraction from `FormData`, Zod + `getFieldErrors`, then mapping into the lib layer.

3. [src/lib/venues.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/venues.ts:4)
Today: `VenueRow` is a direct alias to `Database["public"]["Tables"]["venues"]["Row"]`; `listVenues()` does `select("*").order("name")`; `createVenue()` accepts `name`, `address`, `defaultReviewerId`; `updateVenue()` accepts `name`, `address`, `defaultReviewerId`, `googleReviewUrl` and conditionally adds optional fields with `hasOwnProperty` checks (`lines 6-15`, `17-58`).
Spec: add `default_manager_responsible` to `VenueRow`; no list query change; persist the new field in create/update.
Reality gap: the query part is accurate, but the persistence part still needs explicit threading through both helper signatures and the snake_case payload.
Pattern to follow: keep caller payloads camelCase and convert to snake_case only at the Supabase boundary; use readonly client for reads and action client for writes.

4. [src/lib/validation.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/validation.ts:1)
Today: this file only contains event/debrief/decision schemas. There is no venue schema. The closest reusable helper is `optionalText(max)`, which trims blank strings to `undefined`; `eventDraftSchema` already allows `managerResponsible` up to 200 chars (`lines 12-20`, `99-131`).
Spec: add venue validation here for the new field.
Reality gap: that would be a new pattern for venues; current venue validation lives in `src/actions/venues.ts`. Also, existing event manager handling does not normalize empty strings to `null` before persistence.
Pattern to follow: if validation is centralized here, `optionalText(200)` is the repo’s closest existing helper for “blank input means absent”.

5. [src/components/events/event-form.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/event-form.tsx:32)
Today: the form receives `venues: VenueRow[]` directly. `managerResponsible` is local state initialized from `(defaultValues as any)?.manager_responsible ?? ""`, rendered as a controlled `<Input maxLength={200}>`, and `handleVenueChange()` only updates `selectedVenueId` (`lines 302-323`, `347-381`, `439-441`, `766-780`). There is no venue-based manager auto-fill. The manager field is reused in both edit and create layouts (`lines 1762-1769`, `1863-1867`).
Spec: prefill from `venue.default_manager_responsible`, then stop overwriting once the user manually edits.
Reality gap: the spec is compatible with the component shape, but typing is already loose here: `defaultValues` is typed as `EventSummary`, yet `manager_responsible` is read through `any` because generated event types are already stale. Also, venue managers usually cannot change venue, so initial-prefill-on-mount matters as much as dropdown-change logic.
Pattern to follow: local `useState`/`useEffect` client-side orchestration. The nearest existing “auto-fill until user edits” precedent is `endDirty` for the end time (`lines 318-320`, `443-453`), even though the spec suggests a ref.

6. [supabase/migrations](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20250218000000_initial_mvp.sql:21)
Today: `venues` is created in [20250218000000_initial_mvp.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20250218000000_initial_mvp.sql:21) with `name`, `address`, `capacity`, `default_reviewer_id`, timestamps, trigger, and RLS; [20250315090000_events_assignee_refactor.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20250315090000_events_assignee_refactor.sql:26) re-adds `default_reviewer_id if not exists`; [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:15) adds `google_review_url`; [20260408120002_add_event_planning_link.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120002_add_event_planning_link.sql:12) adds `events.manager_responsible` with `char_length <= 200`.
Spec: add `venues.default_manager_responsible` with the same 200-char check; no RLS changes.
Reality gap: “venues already have read/write policies scoped to `central_planner`” is only half true. Writes are planner-only, but reads are currently `using (true)` in [initial_mvp.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20250218000000_initial_mvp.sql:171). No RLS change looks necessary, but the spec overstates current read scoping.
Pattern to follow: additive timestamped migrations, usually `add column if not exists` for later schema evolution. The newest existing migration is [20260410120003_venue_manager_event_visibility.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120003_venue_manager_event_visibility.sql:1), so the new file needs a later sortable timestamp.

7. [src/lib/supabase/types.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/types.ts:23)
Today: `venues.Row` includes `default_reviewer_id` and `google_review_url`, but not `default_manager_responsible` (`lines 23-34`). More importantly, `events.Row` does not include `manager_responsible` even though the migration exists (`lines 68-111`).
Spec: update generated types for the new venues column.
Reality gap: the file is already behind the migrations. Updating only the venues row will not resolve the broader type drift that already forced `any` casts in the event form.
Pattern to follow: local code still consumes these raw snake_case row types directly in UI and data helpers.

8. [CLAUDE.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md:1) and workspace rules
Today: the repo-level `CLAUDE.md` says to use server actions, Zod validation, Supabase helpers, and points to shared workspace conventions one directory up. Repo-local `.claude/rules/` does not exist; the effective rules are in `../.claude/rules/`, especially [ui-patterns.md](/Users/peterpitcher/Cursor/.claude/rules/ui-patterns.md:16), [supabase.md](/Users/peterpitcher/Cursor/.claude/rules/supabase.md:1), [complexity-and-incremental-dev.md](/Users/peterpitcher/Cursor/.claude/rules/complexity-and-incremental-dev.md:1), and [definition-of-done.md](/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md:1).
Spec: no explicit convention changes, but the work spans UI, actions, validation, types, and migrations.
Reality gap: the docs say DB results should be wrapped into camelCase types, but this repo area actually uses raw Supabase row types and snake_case properties in components. For this change, repo-local code patterns are a better source of truth than the convention docs.
Pattern to follow: proper table semantics, `aria-label` on icon-only buttons, server-side auth/RBAC rechecks, and verification through lint/typecheck/tests/build.

**Supporting Paths Inspected**
- [src/lib/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/events.ts:119) to confirm `EventForm` typing/runtime shape and that event persistence already writes `manager_responsible`.
- [src/app/events/new/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/new/page.tsx:43) and [src/app/events/[eventId]/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:105) to confirm both create and edit flows pass `listVenues()` results into `EventForm`.

**Skipped**
- Repo-local `.claude/rules/` content, because that directory does not exist in this repo.
- UI primitive internals such as `Button`, `SubmitButton`, and `Select`; usage in the inspected files was enough to map the change.

**Limited-Visibility Warnings**
- This is repo reality, not live-Supabase reality. I inspected migrations and generated types, but not the remote schema or applied migration state.
- Generated types are already stale relative to migrations, so any type-based assumption in the spec is weaker than it looks.
- I found no existing tests covering `venues-manager`, `actions/venues`, or the event-form manager auto-fill path.