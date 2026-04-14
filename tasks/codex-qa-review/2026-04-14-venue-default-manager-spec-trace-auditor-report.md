**Key Findings**
- `R5` is the weakest part of the spec. The current venue row editor relies on a single `<form className="contents">` inside one table cell, so “replace `colSpan` + grid with individual `<td>` cells” is underspecified in this repo unless the spec also defines how one row-level form spans those cells. See [venues-manager.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/venues/venues-manager.tsx:161).
- `R2` and `R3` are not action-only changes here. Both actions delegate persistence to helpers in [venues.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/venues.ts:17), so helper signatures and Supabase payload mapping are required too.
- Generated Supabase types are already stale: `events.manager_responsible` exists in the migration [20260408120002_add_event_planning_link.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120002_add_event_planning_link.sql:12) but is missing from [types.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/types.ts:68). That is why the event form reads it via `as any` in [event-form.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/event-form.tsx:322).

**Requirement Trace**
- `R1` `IMPLEMENTABLE`  
  `venues` has no `default_manager_responsible` today; a new migration is the right place. Current table definition is in [20250218000000_initial_mvp.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20250218000000_initial_mvp.sql:21).

- `R2` `MISSING DEPENDENCY`  
  `createVenueAction` currently parses only `name` and `defaultReviewerId` in [actions/venues.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/venues.ts:40), then calls `createVenue()` in [venues.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/venues.ts:17). The spec needs the helper change called out, not just the action.

- `R3` `MISSING DEPENDENCY`  
  Same pattern as R2. `updateVenueAction` parses fields in [actions/venues.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/venues.ts:78) and persists through `updateVenue()` in [venues.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/venues.ts:30).

- `R4` `IMPLEMENTABLE`  
  `VenueRow` is just `Database["public"]["Tables"]["venues"]["Row"]` in [venues.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/venues.ts:4). Once generated DB types are updated, `VenueRow` updates automatically.

- `R5` `NEEDS REVISION`  
  The bug is real: header has 5 columns, while the body row is one `<td colSpan={3}>` with a grid inside in [venues-manager.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/venues/venues-manager.tsx:114) and [venues-manager.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/venues/venues-manager.tsx:162). But the spec does not define a valid row-form strategy if it wants separate `<td>` cells.

- `R6` `IMPLEMENTABLE`  
  The venues table UI currently has no manager-responsible column; adding a header/cell is straightforward in [venues-manager.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/venues/venues-manager.tsx:114) and [venues-manager.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/venues/venues-manager.tsx:181).

- `R7` `IMPLEMENTABLE`  
  The UI primitives already support this: `SubmitButton.hideLabel` exists in [submit-button.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/ui/submit-button.tsx:14), and `Button` has `size="icon"` in [button.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/ui/button.tsx:11). Current venue buttons already use `Save`, `Clock`, and `Trash2` icons in [venues-manager.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/venues/venues-manager.tsx:207).

- `R8` `IMPLEMENTABLE`  
  The add form is currently a 3-column grid with `name`, `defaultReviewerId`, and submit in [venues-manager.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/venues/venues-manager.tsx:61). Adding one input and expanding the grid is consistent.

- `R9` `IMPLEMENTABLE`  
  `EventForm` already receives `venues: VenueRow[]` in [event-form.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/event-form.tsx:35), and both create/edit pages pass `listVenues()` through in [new/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/new/page.tsx:67) and [events/[eventId]/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:591). The manager field is controlled in [event-form.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/event-form.tsx:766), but there is no venue-driven prefill yet.

- `R10` `IMPLEMENTABLE`  
  `event-form.tsx` already uses refs and controlled state in [event-form.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/event-form.tsx:196) and [event-form.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/event-form.tsx:773). A `useRef<boolean>` guard fits the existing client-side orchestration.

**Missing / Implicit Requirements**
- Update `src/lib/venues.ts` create/update helper signatures and snake_case DB payloads, not just server actions.
- Decide the row form strategy for the venues table if the DOM really moves to separate `<td>` cells.
- Regenerate `src/lib/supabase/types.ts` against the actual schema, including the already-missed `events.manager_responsible`, and remove the `as any` use in the event form.
- Add error-state wiring for the new venue input in the create/edit UI; otherwise new validation exists without visible feedback.
- Reset the manual-edit ref when the event form is reinitialized for a different event/default set.
- Add `notify pgrst, 'reload schema';` to the new migration, matching recent migration patterns.
- Add tests. I found no existing tests covering `actions/venues`, `venues-manager`, or the event manager auto-populate path.

**Spec Wording To Correct**
- “venues already have appropriate read/write policies scoped to `central_planner`” is not fully accurate: writes are planner-only, but reads are `using (true)` in [20250218000000_initial_mvp.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20250218000000_initial_mvp.sql:171).