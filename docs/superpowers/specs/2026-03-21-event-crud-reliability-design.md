# Event CRUD Reliability — Full Form Overhaul

**Date:** 2026-03-21
**Status:** Approved
**Author:** Claude (with Peter Pitcher)

## Problem Statement

The event creation and editing flow has multiple reliability failures that cause data loss, silent save failures, and events disappearing from listings. A central planner created a Music Bingo event for May 28th, but:
- The date persisted as April 2nd (not updated on subsequent edit)
- Event notes were lost
- Event type was wrong
- The event auto-approved instead of staying as draft
- The event disappeared from the /events listing (past date + hide-past filter)

Root causes span RLS policies, error handling, timezone conversion, form state management, and UI feedback.

## Success Criteria

1. Saving an event (create or edit) ALWAYS persists all field values correctly
2. If a save fails, the user ALWAYS sees a clear, persistent, actionable error message
3. DateTime values are displayed consistently across the entire application (London timezone)
4. Events never silently disappear from the listing
5. Users always know whether their changes have been saved

---

## Section 1: RLS Policy Fix for Updates

### Problem
The `managers update editable events` RLS policy restricts updates to `status in ('draft', 'needs_revisions')`. A separate `planners manage events` policy with `for all` SHOULD already grant central planners update access to any event (Postgres ORs permissive policies). However, if `current_user_role()` does not resolve correctly in the action client context (e.g. the JWT `role` claim is missing or the `public.users` lookup fails), the planner policy would not match, and the manager policy would block updates to approved events — causing a silent 0-row update.

### Diagnostic step
Add a temporary `console.log` in `saveEventDraftAction` that calls a Supabase RPC to check what `current_user_role()` returns for the current user. This confirms whether the existing `planners manage events` policy is functional. If it IS functional, the migration below is belt-and-braces. If it is NOT, the root cause is in the JWT/user-lookup chain and must be fixed there too.

### Changes

**New migration: `supabase/migrations/20260321000001_fix_event_update_rls.sql`**
- Belt-and-braces: drop and recreate `managers update editable events` to explicitly allow central planners to update regardless of status. This ensures updates work even if the separate `planners manage events` policy has issues:
  ```sql
  drop policy if exists "managers update editable events" on public.events;
  create policy "managers update editable events"
    on public.events
    for update using (
      (auth.uid() = created_by and status in ('draft', 'needs_revisions'))
      or public.current_user_role() = 'central_planner'
    )
    with check (
      auth.uid() = created_by
      or public.current_user_role() = 'central_planner'
    );
  ```
  **Design note:** This intentionally does NOT add `status in ('draft', 'needs_revisions')` to the venue_manager WITH CHECK clause. Venue managers are already restricted by the USING clause (they can only see their own drafts/needs_revisions events). The WITH CHECK only verifies ownership on write, which is correct.

**Rollback:** To revert, re-create the original policy:
  ```sql
  drop policy if exists "managers update editable events" on public.events;
  create policy "managers update editable events"
    on public.events
    for update using (
      auth.uid() = created_by and status in ('draft', 'needs_revisions')
    )
    with check (auth.uid() = created_by);
  ```

**`src/lib/events.ts` — updateEventDraft()**
- After the update query, verify `data` is not null. If it is, throw an explicit error: "Update failed — no rows were affected. Check event status and permissions."
- Add a row-count assertion: the update should affect exactly 1 row.

**`src/actions/events.ts` — saveEventDraftAction()**
- Before calling updateEventDraft, verify the event exists and is accessible by fetching it first. Return a clear error if not found.

---

## Section 2: Save Action Reliability — Pre/Post Verification

### Problem
The save flow is fire-and-hope. Column stripping, normalisation, and RLS can silently drop or alter field values.

### Changes

**`src/lib/events.ts` — createEventDraft() and updateEventDraft()**
- **Column-stripping guard:** When the retry loop strips a column, collect stripped column names into an array. After the loop completes, if any columns were stripped, log a warning AND include the stripped columns in the returned result (or throw with details).
- **Post-save verification:** After a successful create/update, compare critical fields (title, start_at, end_at, venue_id, venue_space, notes, event_type, status) from the returned row against what was sent. If any mismatch is found, log a warning with the mismatched fields.

**`src/actions/events.ts` — saveEventDraftAction()**
- After updateEventDraft returns, check the returned row's critical fields against the form values. If mismatches exist, return a warning in the success message: "Saved, but some fields may not have persisted correctly: [list]."
- If column stripping occurred, surface it to the user: "The following fields could not be saved: [list]."

---

## Section 3: DateTime Handling Fix

### Problem
The event header shows "Thursday 2 April at 19:00" but the form inputs show "02/04/2026, 20:00" — a 1-hour BST/UTC offset. The Intl.DateTimeFormat on the detail page doesn't specify `timeZone: "Europe/London"`, so it uses the server's UTC timezone.

### Changes

**`src/app/events/[eventId]/page.tsx`**
- Add `timeZone: "Europe/London"` to ALL `Intl.DateTimeFormat` instances (the main formatter at ~line 36 and the audit timestamp formatter at ~line 44).

**`src/lib/datetime.ts`**
- Add an exported constant: `export const DISPLAY_TIMEZONE = "Europe/London";`
- `toLondonDateTimeInputValue` already correctly uses `londonPartsFromUtcMillis` with `timeZone: "Europe/London"`. No changes needed — just export the constant.

**`src/components/events/events-board.tsx`**
- Currently imports `dayjs` with only `advancedFormat` plugin — no timezone support. Times parsed via `dayjs(event.start_at)` are interpreted in the server's local timezone (UTC in production).
- Add `dayjs/plugin/utc` and `dayjs/plugin/timezone` (install if not in package.json).
- Replace `dayjs(event.start_at)` with `dayjs.utc(event.start_at).tz("Europe/London")` in the `normaliseEvents` function and any other formatting calls.

**`src/components/events/event-calendar.tsx`**
- Same pattern: add utc/timezone plugins. Ensure all `dayjs()` calls that format event dates use `.tz("Europe/London")`.

---

## Section 4: Form State Management — Never Lose Edits

### Problem
The form uses controlled state (useState) for fields, but on save failure, a re-render from the server could overwrite local state with stale defaultValues. There's no "last saved" indicator.

### Changes

**`src/components/events/event-form.tsx`**
- **State preservation on failure:** Add a `hasLocalEdits` ref that tracks whether the user has modified fields since the last successful save. When `defaultValues` change (from server re-render), only apply them if `hasLocalEdits` is false. This prevents stale server data from overwriting in-progress edits.
- **"Last saved" indicator:** Add a `lastSavedAt` state. Set it to `new Date()` when `draftState?.success` becomes true. Display near the Save button: "Last saved: [relative time]" or "Unsaved changes" when dirty.
- **Dirty field tracking:** Enhance `isDirty` to be a `Set<string>` of field names that have been modified. On save failure, display which fields have unsaved changes.
- **Client-side navigation guard:** The existing `beforeunload` handler catches browser navigation (tab close, URL bar navigation). For Next.js client-side routing (clicking links within the app), wrap navigation links within the form context with an `onClick` interceptor that checks `isDirty` and shows a confirmation dialog before navigating. Specifically: the "Events" breadcrumb link and sidebar navigation links should trigger a "You have unsaved changes" confirmation when the form is dirty. This is scoped to links within the event form page — not a global router guard.

---

## Section 5: Error Surfacing — Impossible to Miss

### Problem
Save failures show transient toasts that are easily missed. Error messages are vague.

### Changes

**`src/components/events/event-form.tsx`**
- **Persistent error banner:** Already added in earlier audit. Verify it works in edit mode. The banner should stay until the user successfully saves or explicitly dismisses it.
- **Persistent success banner:** On successful save, show "Changes saved" with timestamp. Auto-dismiss after 5 seconds. Use a different colour (green/success) from the error banner.
- **Saving state indicator:** When the form is submitting (isPending), show "Saving..." prominently near the button. If it takes more than 8 seconds, change to "Still saving — please don't navigate away."

**`src/actions/events.ts`**
- All error returns include specific, actionable detail:
  - RLS failure: "Update failed — the event's current status may prevent editing. Try reverting to draft first."
  - Column stripping: "Some fields could not be saved: [list]. The database schema may need updating."
  - General: "Could not save: [first 120 chars of error]"

---

## Section 6: Event Visibility — Never Disappear

### Problem
Events with past dates are hidden by default. Date corruption or legitimate past events vanish from the listing with no indication.

### Changes

**`src/components/events/events-board.tsx`**
- **Draft events always visible:** Modify the `listEvents` filter:
  ```typescript
  if (hidePastEvents) {
    return filteredEvents.filter(
      (event) => event.end.isAfter(now) || event.status === "draft"
    );
  }
  ```
- **Hidden event count:** When events are hidden by the past-events filter, show a count below the filter controls: "N past events hidden — toggle to show." Only show when the count is > 0.
- **Recently created safety net:** Events created in the last 24 hours always appear regardless of date:
  ```typescript
  const oneDayAgo = dayjs().subtract(24, 'hours');
  return filteredEvents.filter(
    (event) => event.end.isAfter(now)
      || event.status === "draft"
      || dayjs(event.created_at).isAfter(oneDayAgo)
  );
  ```

---

## Implementation Order

1. **Section 1 (RLS)** — Database migration, must go first
2. **Section 3 (DateTime)** — Independent, can parallel with others
3. **Section 2 (Save reliability)** — Depends on Section 1 being deployed
4. **Section 5 (Error surfacing)** — Depends on Section 2
5. **Section 4 (Form state)** — Independent, can parallel with 2/5
6. **Section 6 (Visibility)** — Independent, can parallel with all

Sections 1, 3, 4, and 6 can be developed in parallel. Sections 2 and 5 are sequential.

## Files Affected

| File | Sections |
|------|----------|
| `supabase/migrations/20260321000001_fix_event_update_rls.sql` | 1 |
| `src/lib/events.ts` | 1, 2 |
| `src/lib/datetime.ts` | 3 |
| `src/actions/events.ts` | 1, 2, 5 |
| `src/components/events/event-form.tsx` | 4, 5 |
| `src/components/events/events-board.tsx` | 6 |
| `src/components/events/event-calendar.tsx` | 3 |
| `src/app/events/[eventId]/page.tsx` | 3 |

## Testing Strategy

### RLS migration tests (SQL-level)
- Central planner can update an approved event (status = 'approved')
- Central planner can update a submitted event (status = 'submitted')
- Venue manager can update their own draft event
- Venue manager CANNOT update their own approved event
- Venue manager CANNOT update another user's draft event

### DateTime unit tests
- `normaliseEventDateTimeForStorage("2026-05-28T19:00")` → `"2026-05-28T18:00:00.000Z"` (BST, UTC+1)
- `normaliseEventDateTimeForStorage("2026-01-15T19:00")` → `"2026-01-15T19:00:00.000Z"` (GMT, no offset)
- `normaliseEventDateTimeForStorage("2026-03-29T01:30")` → correct handling of BST clock change date
- `toLondonDateTimeInputValue("2026-05-28T18:00:00.000Z")` → `"2026-05-28T19:00"` (UTC→BST)

### Post-save verification tests
- updateEventDraft returns matching data for all critical fields
- updateEventDraft throws when 0 rows affected
- Column stripping returns list of stripped column names
- saveEventDraftAction returns warning when column stripping occurs

### Visibility filter tests
- Draft events visible when hidePastEvents is true
- Events created < 24h ago visible regardless of date
- Past approved events hidden when hidePastEvents is true
- Hidden event count accurately reflects filtered count

### Error surfacing tests
- Error banner appears on save failure in edit mode
- Error banner disappears on successful re-save
- Success banner appears on successful save with timestamp
- Specific error messages for RLS failures vs column stripping

### Manual verification
- Create event, edit it, verify ALL fields persist
- Change dates across BST boundary (March 29), verify display consistency
- Edit an approved event as central planner, verify save works
- Attempt edit with slow network, verify "Still saving..." indicator
