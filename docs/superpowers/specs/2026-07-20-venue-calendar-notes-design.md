# Venue Calendar Notes: Design Spec

**Date:** 2026-07-20 (v2, revised same day after independent review `2026-07-20-venue-calendar-notes-design-review.md`)
**Status:** Awaiting review
**Complexity:** L overall, delivered as three independently mergeable slices (see Delivery plan)
**Owner:** Peter Pitcher

## Problem

Venues host things that are handled entirely outside BaronsHub (a wedding, a private hire, a brewery visit). These need no planning workspace, tasks or publishing, but they occupy the venue. Today they are invisible in the tool, so staff can plan an event on a date the venue is already committed.

## Goals

1. Record a lightweight, date-marked note against a venue.
2. Show notes on the planning calendar and the events calendars (desktop and mobile).
3. Warn (not block) when an event is created, edited, proposed or rescheduled onto a date that clashes with a note at the same venue.
4. Surface event-vs-note clashes on the dashboard: all clashes for administrators, own-venue clashes for venue-assigned managers.

## Non-goals (out of scope)

- No recurrence, attachments, notifications, tasks, statuses or SOP checklists.
- No public API exposure: notes never appear in any `/api/v1` response (regression-tested).
- No hard blocking of event creation.
- No dedicated notes page or navigation changes: notes are managed from the calendars.
- No note restoration UI (soft-deleted rows are recoverable via SQL by an administrator).
- No changes to `NeedsAttentionCard`.

## Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Storage | New dedicated table, not reuse of `planning_items` or `events` |
| 2 | Dates | `start_date` plus optional `end_date` (null means single day), inclusive range, max 31 days |
| 3 | Clash behaviour | Warn on forms and dashboard; saving always proceeds |
| 4 | Write permissions | Administrators anywhere; venue-assigned managers for their own venue; managers without a venue are read-only |
| 5 | Read visibility | All signed-in staff (both roles) see all notes, matching global event/planning reads |
| 6 | Launch scope | Reschedule wizard warning and mobile note management are both included |
| 7 | Delivery | Three independently mergeable slices |
| 8 | Dashboard audience | Administrators see all note clashes; venue-assigned managers see own-venue note clashes; managers without a venue see none |
| 9 | Concurrency | Optimistic concurrency via `expectedUpdatedAt`, reusing the event form pattern |
| 10 | Venue deletion | `on delete cascade`, matching `events` and other venue-owned tables; accepted trade-off, see Data integrity |
| 11 | Privacy | Notes must not contain contact, payment or other personal data; dialog carries guidance text; audit metadata never includes title or detail |
| 12 | Data loading | One bounded fetch of all active notes per page load; no refetch on month navigation; hard cap with visible truncation warning |

## Data model

New migration `supabase/migrations/<timestamp>_add_venue_calendar_notes.sql`. One migration carries the table, RLS, and the audit allow-list change so no deploy-order gap exists.

```sql
create table if not exists public.venue_calendar_notes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  start_date date not null,
  end_date date null,
  title text not null,
  detail text null,
  created_by uuid null references public.users(id) on delete set null,
  deleted_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint venue_calendar_notes_end_after_start
    check (end_date is null or (end_date >= start_date and end_date <= start_date + 31)),
  constraint venue_calendar_notes_title_length
    check (char_length(btrim(title)) between 1 and 200),
  constraint venue_calendar_notes_detail_length
    check (detail is null or char_length(detail) <= 2000)
);

create index if not exists idx_venue_calendar_notes_venue_dates
  on public.venue_calendar_notes (venue_id, start_date, end_date)
  where deleted_at is null;
```

- `set_updated_at()` trigger, matching the planning tables.
- Dates are plain `date` columns interpreted as Europe/London calendar dates, validated with the existing `parseDateOnly()` in `src/lib/planning/utils.ts` (rejects impossible dates such as 31 February).
- Duplicate notes (same venue, dates, title) are permitted; no unique constraint.
- Migration ends with `notify pgrst, 'reload schema';`.

### RLS

Policies mirror the current scoped model from `20260605143000_retire_executive_rename_manager_role.sql`, using `public.current_user_role()` and `public.current_user_venue_id()`. The broad `auth.role() = 'authenticated'` pattern is explicitly NOT used; RLS is the enforcement layer and server actions repeat the checks as defence in depth.

- **SELECT:** `current_user_role() in ('administrator','manager') and deleted_at is null`. (Soft-deleted rows are invisible to clients; administrators recover via SQL if ever needed.)
- **INSERT:** administrator anywhere; manager only when `current_user_venue_id() is not null and venue_id = current_user_venue_id() and created_by = auth.uid()`.
- **UPDATE:** administrator anywhere; manager only when the existing row's `venue_id = current_user_venue_id()` (both `using` and `with check`, so a manager cannot move a note to another venue).
- **DELETE:** no client delete policy. Deletion is always a soft-delete UPDATE.

### Audit

The same migration extends the `audit_log_entity_check` constraint with `calendar_note`, and the action allow-list with `calendar_note.created`, `calendar_note.updated`, `calendar_note.deleted`. Application side, `calendar_note` is added to the `RecordAuditParams["entity"]` union in `src/lib/audit-log.ts` and every action calls `recordAuditLogEntry` (best-effort, non-blocking, matching the helper's current behaviour). Audit metadata contains `venueId`, `startDate`, `endDate` and, for updates, the previous dates. It never contains `title` or `detail` (privacy, Decision 11).

### Generated types

Both Supabase type surfaces are updated in the same slice: `src/lib/supabase/types.ts` and regenerated `src/lib/supabase/database.types.ts`.

### Data integrity trade-offs

- **Venue deletion:** `deleteVenue()` in `src/lib/venues.ts` performs a hard delete today, and venue-owned tables (`events`, `venue_areas`, opening times) cascade. Notes follow the same pattern: deleting a venue destroys its note history. Accepted because venue deletion is already destructive across the whole app; the audit log retains the created/deleted trail.
- **Soft delete:** update and delete actions target `deleted_at is null`, check the affected row count, and return explicit "not found or already deleted" errors instead of false success.

## Permissions

New capability functions in `src/lib/roles.ts` with an unambiguous contract (both venues named, no single-parameter ambiguity):

```typescript
canCreateCalendarNote(role: UserRole, userVenueId: string | null, targetVenueId: string): boolean
canManageCalendarNote(role: UserRole, userVenueId: string | null, noteVenueId: string): boolean
```

- Administrator: true for any venue. Administrators may also move a note to another venue.
- Manager with venue: true only when `userVenueId === noteVenueId` (and for create, `userVenueId === targetVenueId`). The venue field is fixed to their venue in the UI and re-validated server-side.
- Manager without venue: always false (read-only).

Update and delete actions load the existing row first, reject missing or deleted rows, check capability against the row's current venue, and separately validate any new venue on update.

Viewing needs no new capability: all staff see all active notes (Decision 5).

## Clash semantics (single source of truth)

One pure module, `src/lib/calendar-notes/clash.ts`, holds the entire truth table. Every consumer (server queries, form warnings, dashboard, tests) uses it; no duplicated client/server logic.

**An event clashes with a note when both of these hold:**

1. **Venue overlap:** the note's `venue_id` is in the event's venue set. The venue set is all `event_venues.venue_id` rows for the event, falling back to `events.venue_id` when no join rows exist (legacy rows).
2. **Date overlap:** the event's occupied London dates intersect the note's inclusive range `[start_date, end_date ?? start_date]`.

**Occupied dates of an event:**

- From the London date of `start_at` through the London date of `end_at`, inclusive.
- Exception: an event ending in the early hours of the next day occupies only its start date, using the existing `endsInEarlyHoursNextDay()` in `src/lib/utils/date.ts` (threshold 300 minutes: an end at exactly 05:00 counts as early hours and occupies the start date only; 05:01 occupies both days).
- Null `end_at` (some proposals): the event occupies its start date only.

**Event statuses that clash:** every status except `cancelled`, `rejected` and `completed`, and never soft-deleted events. The implementation pins this as a named constant `CLASHING_EVENT_STATUSES` derived from the `EventStatus` union in `src/lib/types.ts`, with a test asserting the exclusion list, so a future status addition fails loudly rather than silently.

**Query bounds:** note overlap filtering is `start_date <= :to and coalesce(end_date, start_date) >= :from` (never `start_date` bounds alone, so long notes starting before the window are included). Event bounds for the dashboard follow `findConflicts()`: events in the next 90 days, inclusive boundaries.

**Results:** exactly one clash row per event-note pair, deduplicated, ordered by clash date then event title.

## Code structure

### `src/lib/calendar-notes/` (new)

- `clash.ts`: pure functions (no I/O, serialisable inputs) implementing the truth table above.
- `index.ts`:
  - `CalendarNote` type (camelCase): `id`, `venueId`, `venueName`, `startDate`, `endDate`, `title`, `detail`, `createdBy`, `createdAt`, `updatedAt`. Manual snake_case to camelCase mapping (project convention).
  - `listCalendarNotes()`: all active notes joined to venue name, ordered by `start_date`, hard-capped at 2,000 rows. If the cap is hit, the result is flagged `truncated: true`, a structured server log line is emitted, and consuming UIs show a visible warning banner (no silent truncation). At realistic volume (tens of notes per venue per year) this cap is years away; revisit with bounded windows if it is ever approached.
  - `findNoteClashes(scope)`: clashes for the dashboard, `scope` either `{ all: true }` (administrators) or `{ venueId }` (managers); selects `event_venues` alongside events and delegates to `clash.ts`.

### `src/actions/calendar-notes.ts` (new)

Server actions following the project pattern (auth, capability, Zod, audit, revalidation):

- `createCalendarNote(input): Promise<{ success?: boolean; error?: string }>`
- `updateCalendarNote(input): Promise<{ success?: boolean; error?: string }>` (includes `expectedUpdatedAt`; a mismatch returns a conflict error telling the user to reopen the note)
- `deleteCalendarNote(input): Promise<{ success?: boolean; error?: string }>` (soft delete, sets `deleted_at` and `deleted_by`, includes `expectedUpdatedAt`)

Zod schemas in `src/lib/validation.ts`: `venueId` uuid; `title` trimmed 1 to 200 chars; `detail` optional, max 2000, blank normalised to null via `normaliseOptionalText`; dates strict `YYYY-MM-DD` validated by `parseDateOnly` round-trip; `endDate >= startDate`; range at most 31 days.

Revalidation matrix on success: `revalidatePath` for `/`, `/planning`, `/events`, `/events/new` and the event detail layout. The dialog closes only after confirmed success and then calls `router.refresh()` so the open page's server props reload.

## UI changes

Notes are always rendered with a pin icon and the text label "Note" alongside the title. Distinction is never carried by colour alone (accessibility requirement). Multi-day notes appear on every occupied date with the full title repeated (no "continues" abbreviation).

### Shared note editor (`src/components/calendar-notes/`)

One shared component used by every surface: rendered inside the existing `Sheet` primitive on small screens and as a modal dialog layout on desktop (the `Sheet` already carries a focus trap).

- Fields: venue (select; fixed and disabled for venue-assigned managers), title, start date, optional end date, optional detail.
- Guidance line under detail: "Do not include contact, payment or other personal details."
- Accessibility (WCAG 2.2 AA): `role="dialog"`, `aria-modal`, `aria-labelledby`; initial focus on first field; focus returned to the trigger on close; background inert; Escape closes; all fields labelled; validation and server errors announced via `role="status"`; touch targets at least 44px; delete is a two-step confirmation whose confirm button receives focus.
- Form behaviour: inline validation errors, disabled submit while pending, server errors surfaced, no double-submit.
- Entry points prefill context where available: day-cell actions prefill the date; managers always get their venue.

### Planning calendar (`planning-calendar-view.tsx` and consumers)

- `PlanningViewEntry` in `view-types.ts` gains a `"note"` source. All exhaustive consumers are updated in the same change: `planning-list-view.tsx` (its final branch currently assumes `event`; it gets an explicit `note` branch or filter), `SOURCE_RANK` maps in both views, and `planning-board.tsx` entry-building and count logic.
- Notes appear in the calendar view only. The continuous list view filters them out, and header "shown" counts exclude them.
- Day-cell rendering: the note row renders first in the cell, before planning/event rows, and is never hidden by the "+N more" overflow (notes do not count toward the existing row limit). Clicking a note opens the shared editor (edit if permitted, read-only otherwise). Note entries are keyboard-activatable. Notes are not draggable.
- Filters: notes respect the venue filter and search (title and detail); they ignore status/source filters and remain visible when "planning only" is selected, because they represent venue occupancy rather than planning work.
- Data: `src/app/planning/page.tsx` adds `listCalendarNotes()` to its existing `Promise.all`. A failed notes fetch does not fail the page: the calendar renders with a visible banner "Venue notes could not be loaded" (never a silent empty state).
- "Add note" button in the calendar header, plus prefilled creation from a day cell where the calendar already exposes day interactions.

### Events board (`events-board.tsx`, desktop `event-calendar.tsx` and the mobile views)

- The events page fetches notes once and passes them down. Desktop month cells render note rows with the same first-position, never-collapsed treatment. The mobile (`md:hidden`) views render notes inline on their day groupings.
- "Add note" is available on both desktop and mobile (mobile uses the `Sheet` presentation). Month navigation never refetches: the single bounded fetch covers all months (Decision 12), so navigation cannot show stale gaps.
- Notes ignore event status/type filters; they respect the venue filter and search.

### Event form warning (`event-form.tsx`, `propose-event-form.tsx`, `reschedule-wizard.tsx`)

- The server parent passes all active notes (same single fetch) into each form; the pure clash engine runs client-side as the user picks venue(s) and dates, covering any selectable date with no window gap.
- When the selection clashes, an inline warning renders near the date field: warning icon plus text, for example "Heads up: 'Wedding (private hire)' is noted at The Star on this date." Multi-venue selections warn if any selected venue clashes. Submission is unaffected.
- If notes could not be loaded, the forms show "Clash check unavailable" near the dates (saving still proceeds); absence of data is never presented as absence of clashes.
- Warning data is as-of page load; a note created while a form is open is not live-pushed. Accepted: the dashboard and calendars catch it, and the save-time data path is unchanged.

### Dashboard (`src/app/page.tsx`, `conflicts-card.tsx`)

- Administrators: `findNoteClashes({ all: true })` fetched alongside `findConflicts()` inside the existing admin branch and `safeFetch` wrapper.
- Venue-assigned managers: a new fetch of `findNoteClashes({ venueId })`; the manager's Conflicts card contains note clashes only (no event-vs-event section). Managers without a venue see no card.
- The card takes `noteClashes: NoteClash[] | null` (null means fetch failed and renders the existing error copy; empty array means genuinely none). Rows use the pin icon with wording "clashes with note: <title>", warning severity, icon plus text. Each row links to the event page; the note title links to `/events?month=YYYY-MM`. Because both calendars hold month state client-side, the events board gains a one-time initialiser that reads the `month` search param to set its starting month cursor (no server refetch needed; the note data load is not month-bounded). Delivered in slice 3.
- The existing `ConflictPair` type and admin event-vs-event behaviour are untouched.

## Error handling summary

| Failure | Behaviour |
|---|---|
| Notes fetch fails on a calendar page | Page renders; visible "Venue notes could not be loaded" banner |
| Notes unavailable on an event form | "Clash check unavailable" note near dates; saving proceeds |
| Dashboard clash query fails | Card shows the existing error copy (null state), distinct from "none" |
| Update/delete of a missing or deleted note | Explicit error returned; no false success |
| Concurrent edit | `expectedUpdatedAt` mismatch returns a conflict error; user reopens |
| Note list truncated at cap | Structured log + visible UI warning |
| Audit insert fails | Non-blocking (existing helper behaviour); operation still succeeds |

Structured server logging (`console.error` with an operation tag, no title/detail text) on every list/clash/action failure.

## Delivery plan (three slices)

Each slice passes the full pipeline (lint, typecheck, test, build, `npx supabase db push --dry-run`, advisors) and is independently deployable. Deploy order within each release: migration first, then app code. App rollback never drops the table; schema fixes are forward-only migrations. Dropping the table is only acceptable before any production note exists, with explicit approval.

**Slice 1: Foundation (S/M).** Migration (table, RLS, audit allow-list), both Supabase type files, capability functions, `src/lib/calendar-notes/` including the pure clash engine, validation schemas, server actions. Tests: clash engine unit tests; RLS integration tests following the existing pattern in `supabase/migrations/__tests__/office_worker_event_scope.test.ts` (role matrix: admin, manager own venue, manager other venue, manager without venue, direct-client tampering); action tests (permissions, validation, not-found/already-deleted, concurrency conflict, audit call, revalidation). No user-visible change.

**Slice 2: Calendar management (M).** Shared editor component (Sheet/dialog), planning calendar source plus all `PlanningViewEntry` consumers, events board desktop and mobile rendering, add/edit/delete journeys, filter and overflow rules, degraded-state banners. Component tests: multi-day rendering, read-only vs edit states, overflow non-collapse, filter behaviour, dialog accessibility (automated checks plus a manual keyboard pass).

**Slice 3: Clash surfaces (M).** Form warnings (create, edit, propose, reschedule), dashboard integration for both audiences, public API regression test (no notes in `/api/v1` responses), Playwright E2E journey: create note, see it on both calendars, receive the form warning, see the dashboard clash, edit and delete the note. Post-deploy checklist execution.

## Acceptance criteria

1. A manager assigned to venue A can create, edit and soft-delete notes for venue A only; attempts against venue B fail at both the action layer and directly against PostgREST (RLS), proven by integration tests.
2. A manager without a venue, using a direct Supabase client, cannot write any note.
3. All staff see all active notes on the planning calendar, desktop events calendar and mobile events views; a three-day note appears on all three days in each view.
4. Notes are visible in busy day cells (never behind "+N more") and are identifiable by icon and label without colour.
5. Creating, editing, proposing and rescheduling an event onto a noted date at any linked venue (including secondary `event_venues` links) shows the warning; saving still succeeds. An event at a different venue or ending by 05:00 the next morning does not warn incorrectly.
6. Administrators see all event-note clashes on the dashboard; a venue-assigned manager sees exactly their venue's; failure and empty states are visually distinct.
7. Every note mutation writes an audit row with entity `calendar_note` and metadata free of title/detail text.
8. `/api/v1` event responses contain no note data (regression test).
9. Full pipeline green on every slice; advisors run after the migration reaches each environment; post-deploy smoke test (create, calendars, warning, dashboard, delete) passes in production.

## Post-deploy checks (per slice where relevant)

- `npm run advisors` against the target environment after the migration lands.
- Role-based smoke test of RLS (one write attempt per role class).
- Audit log spot-check for a created and deleted note.
- Slice 3: the E2E journey run against production after deploy (BaronsHub deploys to production from `main`).

## Review disposition (v2)

All 26 confirmed findings from the independent review are addressed above. Three were deliberately scoped down: F26 monitoring (structured logs and post-deploy checks; no alerting service exists in this project), F17 privacy (guidance text, global visibility confirmed as a product decision, no formal retention programme because notes hold no customer records by rule), F20 indexing (partial index and bounded queries; range/GiST indexes rejected as unjustified at expected volume). Optional improvements F27 (single pure clash engine) and F28 (contextual day-cell creation) are adopted; F29 (slices) is adopted as the delivery plan.
