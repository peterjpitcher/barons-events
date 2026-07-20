# Venue Calendar Notes: Design Spec

**Date:** 2026-07-20
**Status:** Awaiting review
**Complexity:** M (one migration, one lib module, one actions module, touches to two calendars, the event form and the conflicts card)

## Problem

Venues host things that are handled entirely outside BaronsHub (a wedding, a private hire, a brewery visit). These need no planning workspace, tasks or publishing, but they occupy the venue. Today they are invisible in the tool, so staff can plan an event on a date the venue is already committed.

## Goals

1. Record a lightweight, date-marked note against a venue.
2. Show notes on the planning calendar and the events calendar.
3. Warn (not block) when an event is created or edited on a date that clashes with a note at the same venue.
4. Surface event-vs-note clashes on the dashboard Conflicts card.

## Non-goals (out of scope)

- No recurrence, attachments, notifications, tasks, statuses or SOP checklists.
- No public API exposure: notes never appear in any `/api/v1` response.
- No hard blocking of event creation.
- No dedicated notes page or navigation changes: notes are managed from the calendars.

## Decisions taken (confirmed 2026-07-20)

| Decision | Choice |
|---|---|
| Storage | New dedicated table, not reuse of `planning_items` or `events` |
| Dates | `start_date` plus optional `end_date` (null means single day) |
| Clash behaviour | Warn on the event form and dashboard; saving still proceeds |
| Permissions | Administrators anywhere; managers for their own venue only |

## Data model

New migration `supabase/migrations/<timestamp>_add_venue_calendar_notes.sql`:

```sql
create table if not exists public.venue_calendar_notes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  start_date date not null,
  end_date date null,
  title text not null,
  detail text null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint venue_calendar_notes_end_after_start
    check (end_date is null or end_date >= start_date)
);

create index if not exists idx_venue_calendar_notes_venue_dates
  on public.venue_calendar_notes (venue_id, start_date);
```

- RLS enabled with the project's standard `auth.role() = 'authenticated'` policy (matching `planning_items`); real permission enforcement lives in capability functions and server actions, consistent with the rest of the codebase.
- `set_updated_at()` trigger, matching the planning tables.
- `deleted_at` soft delete, matching `events`.
- Dates are plain `date` columns interpreted as Europe/London calendar dates. No time component. Conversion via the existing `londonDateString` helpers in `src/lib/planning/utils.ts`.
- Migration ends with `notify pgrst, 'reload schema';`, matching existing migrations.

## Permissions

New capability functions in `src/lib/roles.ts`, following the existing `canManageX(role, venueId?)` pattern:

- `canManageCalendarNotes(role, venueId?)`: true for `administrator`; true for `manager` only when `venueId` is provided and matches the note's venue.
- Viewing requires no new capability: anyone who can see the planning or events calendars sees notes on them.

Server actions re-check capability server-side (defence in depth). A manager without a `venue_id` cannot create or edit notes.

## Code structure

### `src/lib/calendar-notes.ts` (new)

- `CalendarNote` type (camelCase): `id`, `venueId`, `venueName`, `startDate`, `endDate`, `title`, `detail`, `createdBy`, `createdAt`, `updatedAt`.
- `listCalendarNotes({ from?, to?, venueId? })`: returns non-deleted notes, joined to venue name, mapped snake_case to camelCase manually (project convention, no `fromDb` helper).
- `findNoteClashes()`: returns `Array<{ event: EventSummary; note: CalendarNote }>` for events in the next 90 days (same window as `findConflicts` in `src/lib/events.ts`) whose venue and London-date range intersect a note.
- Clash semantics: `event.venue_id === note.venue_id` and the event's occupied London dates intersect `[start_date, end_date ?? start_date]`. An event's occupied dates run from its start date to its end date, except that an event ending in the early hours of the next day counts only for its start date, reusing the existing `endsInEarlyHoursNextDay` convention from `events-board.tsx` (extracted to a shared helper rather than duplicated).
- Notes are venue-wide: `venue_space` is ignored. A note clashes with any event at that venue regardless of room.

### `src/actions/calendar-notes.ts` (new)

Server actions following the project pattern (auth check, capability check, Zod validation, audit log, `revalidatePath`):

- `createCalendarNote(input): Promise<{ success?: boolean; error?: string }>`
- `updateCalendarNote(id, input): Promise<{ success?: boolean; error?: string }>`
- `deleteCalendarNote(id): Promise<{ success?: boolean; error?: string }>` (sets `deleted_at`)

Zod schemas live in `src/lib/validation.ts`: title required (trimmed, max 200), detail optional (max 2000), dates must be valid ISO dates, `endDate` must be on or after `startDate`, `venueId` required.

All three actions call `logAuditEvent` with `resource_type: 'calendar_note'`.

## UI changes

Notes are always rendered with a pin icon and the text label "Note" alongside the title. Distinction is never carried by colour alone (accessibility requirement).

### Planning calendar (`src/components/planning/planning-calendar-view.tsx`)

- `PlanningViewEntry` (`src/components/planning/view-types.ts`) gains a fourth source: `"note"`. `SOURCE_RANK` places notes after inspiration.
- `src/app/planning/page.tsx` fetches notes via `listCalendarNotes` in its existing `Promise.all` and passes them into `PlanningBoard`; manager visibility follows the same venue filtering the board already applies.
- Note entries are not draggable and do not open the planning item editor. Clicking one opens the note modal (edit if permitted, read-only otherwise).

### Events calendar (`src/components/events/event-calendar.tsx` via `events-board.tsx`)

- The page rendering `EventsBoard` fetches notes for the visible window and passes them down. Day cells render note entries beneath events with the same pin-plus-label treatment.

### Note modal (new, `src/components/calendar-notes/calendar-note-dialog.tsx`)

- One dialog component shared by both calendars, opened from an "Add note" button in each calendar's header and from clicking an existing note entry.
- Fields: venue (select, limited to the manager's own venue where applicable), title, start date, optional end date, optional detail.
- Standard form behaviour: inline validation errors, disabled submit while pending, server errors surfaced, focus trapped, closes on Escape.
- Delete lives inside the edit state of the dialog behind a confirmation step.

### Event form warning (`src/components/events/event-form.tsx`)

- The server parent passes upcoming notes (next 12 months, all venues the user can see; the data volume is trivial) into the form.
- When the selected venue(s) and date intersect a note, an inline warning renders near the date field: warning icon plus text naming the note, for example "Heads up: 'Wedding (private hire)' is noted at The Star on this date." Submission is unaffected.
- Applies to `event-form.tsx` (create and edit) and `propose-event-form.tsx`. The reschedule wizard is explicitly out of scope for this pass; a follow-up can add the same warning there if it proves useful.

### Dashboard Conflicts card (`src/components/dashboard/context-cards/conflicts-card.tsx`)

- `src/app/page.tsx` additionally calls `findNoteClashes()` alongside `findConflicts()`.
- The card accepts a second optional prop `noteClashes` and renders them in the same list style with the pin icon and wording "clashes with note: <title>". The existing `ConflictPair` type is untouched.

## Error handling and edge cases

- `end_date` before `start_date`: rejected by Zod and by the DB check constraint.
- Manager with no `venue_id`: create and edit rejected server-side with a clear error.
- Deleted notes (`deleted_at` set) are excluded from every query.
- Calendar with no notes: no change to current rendering (no empty-state needed; notes are additive).
- `findNoteClashes` failure on the dashboard: wrapped in the existing `safeFetch` pattern so the dashboard still renders.
- Past notes are retained and visible when navigating the calendar backwards, matching event behaviour.

## Testing (Vitest, Supabase mocked)

1. Clash logic (highest value): single-day note, multi-day note, event ending in early hours of the next day, different venue no clash, same venue different date no clash, deleted note no clash.
2. Server actions: permission matrix (administrator, manager own venue, manager other venue, manager without venue), validation failures, audit log called on success.
3. Date mapping: snake_case to camelCase conversion and London date handling.

Happy path plus error cases per action, following the existing test layout in `src/actions/__tests__/`.

## Rollout

- Migration is purely additive (new table only): no rollback risk to existing data. Rollback is dropping the table.
- No feature flag needed; the feature is inert until a note is created.
- Verify with the standard pipeline: lint, typecheck, test, build, then `npm run advisors` for the new table's RLS posture before merging.
