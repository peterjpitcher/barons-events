# Venue Calendar Notes: Developer Specification Review

**Specification reviewed:** `2026-07-20-venue-calendar-notes-design.md`  
**Review date:** 2026-07-20  
**Review scope:** Technical design, functional completeness, security, data, delivery, testing, rollout, and operational readiness  
**Source specification changed:** No

## Overall assessment

**Readiness: Not ready for implementation.**

The product idea is clear and a dedicated table is a sensible starting point. However, four blocking issues must be resolved before development:

1. The proposed RLS policy does not match the current role model or the current `planning_items` policies.
2. The clash rule only considers `events.venue_id`, but events can be linked to several venues through `event_venues`.
3. The named audit function and payload do not exist, and the current audit constraints do not allow the proposed resource.
4. Fetching notes for the “visible window” is not compatible with either calendar's current client-side month navigation.

The specification also contradicts its own “created or edited” warning goal by excluding the reschedule flow and limiting form data to the next 12 months. Multi-day rendering, visibility, failure behaviour, dashboard ownership, mobile use, concurrency, migration sequencing, and acceptance criteria remain unclear.

The stated complexity of **M** is optimistic. The likely size is **L** because the work crosses the database, RLS, audit allow-lists, role helpers, two calendar state models, two event forms, the dashboard, shared types, cache invalidation, and several test layers.

## Classification

- **Confirmed issue:** A contradiction, missing requirement, or incompatibility confirmed against the current repository.
- **Optional improvement:** Not required for basic correctness, but likely to improve usability, maintainability, or delivery safety.
- **P0:** Resolve before implementation starts.
- **P1:** Resolve in the specification before the feature is considered build-ready.
- **P2:** Resolve before production release.
- **P3:** Optional improvement.

## Unconfirmed assumptions

| Assumption | Why it needs confirmation | Related finding |
|---|---|---|
| Note volume will remain trivial | No expected volume, retention period, row-limit check, or maximum date range is given. | F20 |
| Every signed-in user may read every note title and detail | Private-hire notes may contain personal or commercially sensitive information. | F09, F17 |
| Server-loaded warning data is fresh enough | A note can be added or changed while an event form remains open. | F10, F21 |
| Desktop-only calendar management is acceptable | Both named calendar surfaces are hidden on mobile. | F14 |
| Concurrent edits will be rare | No optimistic concurrency or conflict response is designed. | F19 |
| Venue deletion is rare and cascade loss is acceptable | Hard venue deletion would permanently remove note history. | F18 |
| The existing early-hours rule is correct for venue occupancy | The 05:00 threshold was designed for event display and has not been reconfirmed for external bookings. | F07 |
| Dashboard conflicts remain administrator-only | Current dashboard code is administrator-only, but the new spec does not state an audience. | F11 |

## Findings index

| ID | Title | Status | Priority | Type |
|---|---|---|---|---|
| F01 | RLS design is incorrect for the current role model | Confirmed issue | P0 | Security / Data |
| F02 | The proposed capability cannot prove “manager owns venue” | Confirmed issue | P0 | Security / Permissions |
| F03 | Clash detection ignores multi-venue events | Confirmed issue | P0 | Functional / Data |
| F04 | Audit logging contract is incompatible with the code and schema | Confirmed issue | P0 | Integration / Data |
| F05 | “Visible window” fetching cannot work with current calendar navigation | Confirmed issue | P1 | Architecture / Performance |
| F06 | Warning coverage contradicts the stated goal | Confirmed issue | P1 | Functional / Scope |
| F07 | Clash semantics are incomplete | Confirmed issue | P1 | Functional / Data |
| F08 | Multi-day note rendering is undefined | Confirmed issue | P1 | Functional / UX |
| F09 | Note visibility rules contradict the current calendar behaviour | Confirmed issue | P1 | Permissions / Functional |
| F10 | Calendar and form failure behaviour is unsafe and unspecified | Confirmed issue | P1 | Reliability / Error handling |
| F11 | Dashboard audience and remediation journey are unclear | Confirmed issue | P1 | Functional / UX |
| F12 | Adding a fourth planning source affects more code than specified | Confirmed issue | P1 | Technical / Delivery |
| F13 | Filter, search, ordering, and overflow rules are incomplete | Confirmed issue | P1 | Functional / UX |
| F14 | Mobile note management is missing | Confirmed issue | P1 | Functional / Accessibility |
| F15 | Dialog accessibility requirements are incomplete | Confirmed issue | P2 | Accessibility |
| F16 | Date and text integrity rules are not strong enough | Confirmed issue | P1 | Data / Validation |
| F17 | Privacy, content, and retention rules are missing | Confirmed issue | P2 | Security / Data governance |
| F18 | Soft-delete and venue-delete behaviour are incomplete | Confirmed issue | P1 | Data / Audit |
| F19 | Concurrent editing can silently lose changes | Confirmed issue | P2 | Reliability / Data |
| F20 | Query bounds, indexes, and data-volume assumptions are unconfirmed | Confirmed issue | P2 | Performance / Data |
| F21 | Cache invalidation and refresh behaviour are incomplete | Confirmed issue | P2 | Integration / Reliability |
| F22 | Migration and generated-type dependencies are missing | Confirmed issue | P1 | Delivery / Integration |
| F23 | The test plan is not sufficient for the risk | Confirmed issue | P1 | Testing / Security |
| F24 | Rollback and deployment claims are unsafe | Confirmed issue | P1 | Deployment / Migration |
| F25 | Acceptance criteria and delivery boundaries are missing | Confirmed issue | P1 | Delivery / Scope |
| F26 | Monitoring and post-release checks are missing | Confirmed issue | P2 | Operations / Monitoring |
| F27 | Use one pure clash engine for every caller | Optional improvement | P3 | Simplification / Maintainability |
| F28 | Support contextual note creation from a calendar day | Optional improvement | P3 | UX / Simplification |
| F29 | Deliver in small vertical slices | Optional improvement | P3 | Delivery / Risk |

## Detailed findings

### F01 — RLS design is incorrect for the current role model

- **Relevant section:** Data model; Permissions
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security / Data
- **Description:** The specification proposes the project's “standard `auth.role() = 'authenticated'` policy” and says this matches `planning_items`. It does not. The latest planning policies use `public.current_user_role()`, `public.current_user_venue_id()`, and separate read, insert, update, and delete policies. A broad authenticated write policy would allow any signed-in client to bypass the server actions.
- **Rationale:** `supabase/migrations/20260605143000_retire_executive_rename_manager_role.sql` gives global reads to administrators and managers but scopes manager writes by venue. Server-action checks are defence in depth, not a replacement for RLS.
- **Impact:** A manager could create or change notes for another venue by calling Supabase directly. A manager without a venue could also write if the policy grants all authenticated users access.
- **Recommended action:** Specify exact policies:
  - `SELECT`: active rows only, for current app roles.
  - `INSERT`: administrator anywhere; manager only when `venue_id = current_user_venue_id()` and `created_by = auth.uid()`.
  - `UPDATE`: administrator anywhere; manager only when both the existing and new `venue_id` equal their assigned venue.
  - No client `DELETE` policy if deletion is always a soft-delete update.
  - Ensure `deleted_at is null` is part of the normal read policy.
- **Suggested wording:** “RLS must mirror the current administrator/manager model. Authenticated status alone is not sufficient for writes. Server actions repeat the same checks as defence in depth.”
- **Open questions:**
  - Should administrators be able to read soft-deleted notes for support or restoration?
  - Should direct authenticated writes be allowed at all, or should note mutations use a service-role path after explicit authorization?

### F02 — The proposed capability cannot prove “manager owns venue”

- **Relevant section:** Permissions
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security / Permissions
- **Description:** `canManageCalendarNotes(role, venueId?)` receives only one venue value. It cannot compare the signed-in manager's assigned venue with the note's venue. The phrase “when `venueId` is provided and matches the note's venue” leaves out which value belongs to the user.
- **Rationale:** Existing safe patterns pass the full user and resource, for example `canEditVenueLinkedPlanning(user, resource)`, or pass both user venue and target venue explicitly.
- **Impact:** Implementers may accidentally treat any non-empty venue ID as sufficient permission.
- **Recommended action:** Use an unambiguous contract such as:
  - `canCreateCalendarNote(user, targetVenueId)`
  - `canEditCalendarNote(user, { venueId, deletedAt })`
  - or `canManageCalendarNote(role, userVenueId, noteVenueId)`.
  For update and delete, load the existing note first, reject missing/deleted records, check its current venue, and separately validate any requested new venue.
- **Open questions:**
  - Can an administrator move a note to another venue?
  - Can a manager change the venue field, even if the UI normally fixes it to their own venue?

### F03 — Clash detection ignores multi-venue events

- **Relevant section:** `src/lib/calendar-notes.ts`; Event form warning
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Data
- **Description:** The specified rule is `event.venue_id === note.venue_id`. The application supports one event linked to several venues through `event_venues`; `events.venue_id` is only the primary/legacy venue.
- **Rationale:** `EventSummary` can contain `venues`, event forms allow administrators to select several venues, and existing visibility helpers prefer join-table links with legacy fallback.
- **Impact:** A note at a secondary event venue would not warn on the form and would not appear as a dashboard clash.
- **Recommended action:** Define the event venue set as all `event_venues.venue_id` values, with `events.venue_id` as fallback when no links exist. A clash exists when the note venue is in that set. Ensure all clash queries select `event_venues`.
- **Suggested wording:** “Venue overlap is true when the note venue matches any linked event venue. Use `event_venues` first and fall back to `events.venue_id` for legacy rows.”
- **Open questions:**
  - If an event is linked to several venues, should the dashboard show one clash row per event-note pair or one row per venue?

### F04 — Audit logging contract is incompatible with the code and schema

- **Relevant section:** Server actions
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Integration / Data
- **Description:** The specification names `logAuditEvent` with `resource_type: 'calendar_note'`. The project uses `recordAuditLogEntry` with `entity`, `entityId`, and `action`. Its TypeScript union does not include `calendar_note`. The database `audit_log_entity_check` does not allow it, and the action allow-list has no calendar-note update action.
- **Rationale:** Existing `note.created` and `note.deleted` actions belong to the separate internal-notes feature. Reusing them would mix two resource types and still would not support updates.
- **Impact:** The code will not typecheck as described, or audit inserts will fail at runtime. The generic audit coverage test may also fail.
- **Recommended action:** Choose a distinct audit entity such as `calendar_note`; add it to:
  - the migration's `audit_log_entity_check`,
  - `RecordAuditParams["entity"]`,
  - the audit formatting layer if it will be displayed,
  - and action allow-lists for `calendar_note.created`, `calendar_note.updated`, and `calendar_note.deleted`.
  State whether an audit failure is non-blocking, matching the current helper's best-effort behaviour.
- **Open questions:**
  - Will calendar-note history be visible anywhere, or only retained in the database?
  - Should audit metadata include before/after dates and venue IDs? It should avoid copying sensitive detail text.

### F05 — “Visible window” fetching cannot work with current calendar navigation

- **Relevant section:** Events calendar; Planning calendar; `listCalendarNotes`
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Architecture / Performance
- **Description:** Both calendars hold their active month in client state. The server page does not know when the user moves to another month. Therefore, a one-time server fetch for the “visible window” will become stale after navigation.
- **Rationale:** `EventCalendar` receives `monthCursor` from `EventsBoard`, while `PlanningCalendarView` owns `activeMonth` locally. Neither month change currently causes a server request or URL change.
- **Impact:** Notes will disappear or be incomplete after moving outside the initially fetched month.
- **Recommended action:** Pick one explicit model:
  1. Put the active month in URL search parameters and fetch the six-week grid on the server.
  2. Add a bounded server action/route that loads notes when the client month changes, with loading and error states.
  3. Fetch a documented wider range once, accepting the size limit.
  Use overlap bounds, not just `start_date` bounds.
- **Open questions:**
  - Should month navigation be shareable/bookmarkable?
  - How much past and future data may be loaded in one request?

### F06 — Warning coverage contradicts the stated goal

- **Relevant section:** Goals; Event form warning; Non-goals
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Scope
- **Description:** Goal 3 says warn when an event is created or edited on a clashing date. The design excludes the reschedule wizard, which creates a new event on a new date, and only supplies notes for the next 12 months. It also does not cover dates outside that window.
- **Rationale:** Users can navigate calendars outside the next 12 months, create a pre-filled event there, edit old/far-future events, and reschedule approved events. Also, `canProposeEvents()` currently allows only administrators, so any expectation that managers will receive warnings in the proposal flow depends on a separate permission change.
- **Impact:** The same scheduling operation can warn or not warn depending on which user journey is used.
- **Recommended action:** Either include the reschedule wizard and load notes based on the selected event range, or narrow Goal 3 and clearly state the known gaps. Do not rely on a fixed “next 12 months” window for a form that can select any date.
- **Suggested wording:** “In this release, warnings apply only to the full create/edit form and proposal form for dates within [defined range]. Rescheduling is a known gap.” Prefer including rescheduling instead.
- **Open questions:**
  - Is a reschedule warning required for launch?
  - Are past dates and dates more than 12 months away supported event dates?

### F07 — Clash semantics are incomplete

- **Relevant section:** `findNoteClashes`; Error handling and edge cases
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Data
- **Description:** The spec defines inclusive note ranges and an early-hours convention but leaves several cases unresolved:
  - relevant event statuses,
  - proposal rows with a null `end_at`,
  - events already in progress at the start of the 90-day window,
  - exact 90-day boundary handling,
  - cancelled, rejected, completed, and draft events,
  - notes that start before the query window but extend into it,
  - ordering and deduplication of results.
- **Rationale:** The current `findConflicts()` loads every non-deleted status whose start time is within a timestamp window. Repeating that behaviour may produce noisy or missed note clashes.
- **Impact:** Dashboard counts may be misleading, and valid clashes can be missed.
- **Recommended action:** Define one truth table for:
  - included event statuses,
  - null end-time fallback,
  - inclusive date boundaries,
  - early-hours threshold, including 05:00 and 05:01,
  - overlap query bounds,
  - stable result ordering,
  - and one result per event-note pair.
- **Open questions:**
  - Should proposals and drafts count as clashes?
  - Should cancelled/rejected/completed events be ignored?
  - Does a proposal with no end time occupy only its start date?

### F08 — Multi-day note rendering is undefined

- **Relevant section:** Data model; UI changes
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / UX
- **Description:** Notes can have an inclusive `end_date`, but the UI design does not say whether a multi-day note appears on every occupied day, only on its start day, or as a spanning calendar item.
- **Rationale:** `PlanningViewEntry` has one `targetDate`. Both calendars currently group entries by individual date keys.
- **Impact:** Implementers can produce different behaviour in the two calendars, and staff may miss an occupied day in the middle of a range.
- **Recommended action:** Require a note to be visible on every occupied date, or explicitly define a spanning treatment. Define continuation wording and how long ranges are rendered.
- **Open questions:**
  - Should continuation days repeat the title or show “continues”?
  - Is there a maximum allowed note duration?

### F09 — Note visibility rules contradict the current calendar behaviour

- **Relevant section:** Permissions; Planning calendar
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Permissions / Functional
- **Description:** The spec says all calendar viewers can see notes, then says manager visibility follows the board's venue filtering. The current application gives managers global event/planning reads. An assigned manager's venue picker is limited, but the underlying planning data is not automatically restricted to that venue.
- **Rationale:** `canViewVenueLinkedResource()` currently allows both app roles globally. `PlanningPage` narrows the venue options for assigned managers, not the loaded board data.
- **Impact:** It is unclear whether assigned managers see all notes, only their own venue's notes, or an inconsistent mix. Hiding notes for other venues while showing their events would create false confidence.
- **Recommended action:** Make viewing and managing separate explicit rules. Recommended alignment with current calendars:
  - all administrators and managers can view all active notes,
  - administrators can manage all,
  - venue-assigned managers can manage only their venue,
  - managers without a venue are read-only.
- **Open questions:**
  - Is note detail considered safe for global staff visibility?
  - Should the event-form warning include notes from every selected venue even when the user cannot edit those notes?

### F10 — Calendar and form failure behaviour is unsafe and unspecified

- **Relevant section:** Error handling and edge cases
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Reliability / Error handling
- **Description:** Only dashboard failure is covered. A rejected notes fetch in the planning page's `Promise.all` can fail the entire page. Alternatively, silently falling back to no notes can make an occupied venue look free. Event forms also need a defined state when notes cannot be loaded.
- **Rationale:** This feature is advisory safety information. Silent absence is operationally different from a confirmed “no clash”.
- **Impact:** Staff may schedule an event based on incomplete data.
- **Recommended action:** Define visible degraded states:
  - calendar: “Venue notes could not be loaded” banner while preserving existing calendar data,
  - event form: “Clash check unavailable” near the dates,
  - dashboard: distinguish no clashes from query failure.
  Add structured server logging and retry behaviour where appropriate.
- **Open questions:**
  - Should saving still proceed when the clash check is unavailable? The likely answer is yes, with an explicit warning.

### F11 — Dashboard audience and remediation journey are unclear

- **Relevant section:** Dashboard Conflicts card
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / UX
- **Description:** The current Conflicts card is fetched and shown only for administrators. The spec does not say whether managers should see note clashes. It also gives users no direct way to inspect or change the note from the dashboard, and `noteClashes?:` cannot distinguish “not fetched” from “fetch failed”.
- **Rationale:** There is no dedicated notes page. A dashboard warning needs a clear route to resolution.
- **Impact:** Managers may not see relevant conflicts, and administrators may see a warning they cannot act on efficiently.
- **Recommended action:** Define:
  - which roles see the card,
  - whether managers see all or own-venue clashes,
  - a link target such as the relevant calendar month and venue,
  - separate `null`/error and empty states,
  - whether note clashes also contribute to `NeedsAttentionCard`.
- **Open questions:**
  - Should clicking the note title open an editable dialog or only navigate to a calendar?
  - Are note clashes warning or danger severity?

### F12 — Adding a fourth planning source affects more code than specified

- **Relevant section:** Planning calendar; Code structure
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Technical / Delivery
- **Description:** `PlanningViewEntry` is shared by the calendar and continuous list views. Adding `"note"` changes the discriminated union. `PlanningListView` and its `SOURCE_RANK` currently assume the final branch is an event. `PlanningBoard` also has separate source-order maps and entry-building paths.
- **Rationale:** Updating only the files named in the spec will cause a TypeScript error or incorrect event-style rendering for notes.
- **Impact:** The build may fail, or notes may be treated as events in a shared component.
- **Recommended action:** List every exhaustive consumer and decide whether notes belong only to the calendar or also the list. If calendar-only, consider a calendar-specific entry type instead of widening the shared union. If shared, update all switches and source maps explicitly.
- **Open questions:**
  - Should notes appear in the planning continuous list?
  - Should notes affect the header counts and “shown” count?

### F13 — Filter, search, ordering, and overflow rules are incomplete

- **Relevant section:** Planning calendar; Events calendar; UI changes
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / UX
- **Description:** The design does not define how notes interact with:
  - venue filters,
  - event status/type/date filters,
  - planning status/source filters,
  - search,
  - the “planning only” switch,
  - per-day ordering,
  - or overflow.
  Planning cells show only three rows and a non-interactive “+N more”. Events cells show three events with expandable overflow.
- **Rationale:** Placing notes “after inspiration” can hide the warning content behind planning overflow. “Beneath events” does not say whether notes share the three-item limit.
- **Impact:** Notes can technically exist in the data but remain invisible in busy cells.
- **Recommended action:** Define a filter matrix and separate note overflow from event/planning overflow. At minimum, keep a visible note indicator/count when note rows are collapsed. Search should match title and, only if privacy rules allow, detail.
- **Open questions:**
  - Should note rows ignore event status/type filters?
  - Should notes always remain visible when “planning only” is selected?
  - Which source has priority in a full day cell?

### F14 — Mobile note management is missing

- **Relevant section:** UI changes; Note modal
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Accessibility
- **Description:** The planning calendar and desktop events calendar are hidden below the `md` breakpoint. The spec only adds controls to calendar headers and does not describe note display or management in the mobile agenda/month/matrix experiences.
- **Rationale:** “Managed from the calendars” leaves mobile users with no creation or edit journey.
- **Impact:** Mobile staff may be unable to record an external booking when it is agreed, which weakens adoption and data quality.
- **Recommended action:** Either add note display and management to a supported mobile calendar/agenda view or explicitly declare desktop-only management as a launch limitation with a mobile read path.
- **Open questions:**
  - Is mobile creation required for launch?
  - Which mobile event view should show multi-day notes?

### F15 — Dialog accessibility requirements are incomplete

- **Relevant section:** Note modal; UI changes
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Accessibility
- **Description:** Focus trapping and Escape are named, but the spec omits initial focus, return focus, accessible name/description, background inertness, keyboard activation of note entries, live announcement of validation/server errors, and delete-confirmation focus behaviour.
- **Rationale:** There is no general `Dialog` primitive in `src/components/ui`; existing custom modals have different levels of keyboard support. The shared `Sheet` does contain a focus trap and may be safer to reuse.
- **Impact:** Keyboard and screen-reader users may lose focus or be unable to understand and recover from errors.
- **Recommended action:** Require WCAG 2.2 AA behaviour:
  - `role="dialog"`, `aria-modal`, `aria-labelledby`,
  - initial focus and focus restoration,
  - full keyboard operation,
  - labelled fields and described errors,
  - `role="status"` or equivalent for dynamic clash warnings,
  - 44px touch targets,
  - and automated plus manual keyboard testing.
- **Open questions:**
  - Should the shared component use `Sheet` on small screens and a dialog layout on desktop?

### F16 — Date and text integrity rules are not strong enough

- **Relevant section:** Data model; Server actions
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data / Validation
- **Description:** “Valid ISO dates” is not precise. A regex or `Date.parse` can accept or normalise impossible dates. The database permits blank/whitespace titles and text beyond the UI limits if a direct client reaches the table.
- **Rationale:** The repository already has `parseDateOnly()` specifically to reject impossible dates such as 31 February.
- **Impact:** Invalid or inconsistent data may be stored, causing broken ordering and misleading calendar entries.
- **Recommended action:** Define strict `YYYY-MM-DD` round-trip validation using the existing date-only helper or an equivalent Zod refinement. Normalise optional blank detail to `null`. Add database checks for trimmed title length and detail length if direct authenticated writes remain possible.
- **Open questions:**
  - Is a one-character title valid?
  - What is the maximum date range length?
  - Are duplicate notes for the same venue, date range, and title allowed?

### F17 — Privacy, content, and retention rules are missing

- **Relevant section:** Problem; Permissions; Non-goals
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Security / Data governance
- **Description:** Examples such as weddings and private hires may encourage staff to enter customer names, contact details, or sensitive event information. Notes are proposed as globally visible to calendar users and retained indefinitely.
- **Rationale:** “Not in `/api/v1`” does not by itself define internal access, privacy, retention, audit metadata, backups, or subject-erasure handling.
- **Impact:** Personal data may be exposed more widely or retained longer than intended.
- **Recommended action:** Add content guidance (“do not enter contact, payment, or special-category personal data”), confirm the visibility audience, define retention/deletion expectations, and exclude detail text from logs and audit metadata.
- **Open questions:**
  - Can detail contain a customer or organisation name?
  - Must notes participate in any customer erasure process?
  - Are internal venues included?

### F18 — Soft-delete and venue-delete behaviour are incomplete

- **Relevant section:** Data model; Server actions; Rollout
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data / Audit
- **Description:** The table records `deleted_at` but not `deleted_by`. `ON DELETE CASCADE` permanently removes note history when a venue is deleted, which conflicts with the statement that past notes are retained. Update/delete actions do not say how they handle an already deleted or missing row.
- **Rationale:** The event model carries deletion attribution, and audit logging is best-effort. Cascade deletion can remove the only durable record if audit insertion fails.
- **Impact:** History and accountability can be lost, and actions may report false success when zero rows were changed.
- **Recommended action:** Decide whether to:
  - add `deleted_by`,
  - prevent venue deletion while notes exist,
  - retain notes through venue archival,
  - or explicitly accept cascade data loss.
  Require update/delete to target `deleted_at is null`, check the returned row/affected count, and return clear not-found/already-deleted errors.
- **Open questions:**
  - Is note restoration required?
  - Are venues archived or hard-deleted in normal operations?

### F19 — Concurrent editing can silently lose changes

- **Relevant section:** Note modal; Server actions
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Reliability / Data
- **Description:** `updated_at` is returned but not used as an expected version. Two users can edit the same note and the last save silently overwrites the first.
- **Rationale:** The event form already carries `expected_updated_at` for optimistic concurrency.
- **Impact:** Operational booking information can be lost without warning.
- **Recommended action:** Pass `expectedUpdatedAt` on update/delete and include it in the update predicate. If no row matches, return a conflict message and reload the latest note.
- **Open questions:**
  - Is last-write-wins acceptable given the expected team size and edit frequency?

### F20 — Query bounds, indexes, and data-volume assumptions are unconfirmed

- **Relevant section:** Data model; `listCalendarNotes`; Event form warning
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Performance / Data
- **Description:** “The data volume is trivial” is an unconfirmed assumption. The planning calendar wants history, event forms want a year, and long-running notes can overlap a window despite starting before it. Supabase deployments commonly impose a row-return limit, and the proposed index mainly helps venue-plus-start queries.
- **Rationale:** Correct overlap filtering is `start_date <= to AND coalesce(end_date, start_date) >= from`. Loading every note and doing repeated event-note comparisons can grow into an unnecessary quadratic operation.
- **Impact:** Notes may be silently truncated or dashboard/form response times may degrade as data grows.
- **Recommended action:** Document expected volume and service row limits. Use bounded overlap queries and deterministic ordering. Consider a partial active-row index and measure whether `(venue_id, start_date, end_date)` or a PostgreSQL `daterange`/GiST index is justified. Group by venue in memory if volume remains small.
- **Open questions:**
  - Expected notes per venue per year?
  - Maximum note duration and retention?
  - Is pagination required for historical navigation?

### F21 — Cache invalidation and refresh behaviour are incomplete

- **Relevant section:** Server actions; UI changes
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Integration / Reliability
- **Description:** The spec only says actions call `revalidatePath`. It does not list affected routes or require the client to refresh its server props after a successful modal action.
- **Rationale:** A note affects `/planning`, `/events`, `/`, `/events/new`, `/events/propose`, and event detail forms. Client-held month/form state can remain stale even after a server cache is invalidated.
- **Impact:** A saved note may not appear, or an open event form may continue showing an obsolete clash result.
- **Recommended action:** Define an invalidation matrix and client refresh policy. Close the modal only after confirmed success, refresh the current data source, and decide how already-open forms learn about note changes.
- **Open questions:**
  - Is server-rendered data always dynamic in these routes, or will tagged caching be added?
  - Does an event form need live refresh or only a save-time authoritative check?

### F22 — Migration and generated-type dependencies are missing

- **Relevant section:** Data model; Code structure; Rollout
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / Integration
- **Description:** The new table also requires updates to the repository's Supabase type surfaces. Audit constraint changes must ship in the same migration or earlier. The early-hours helper is already in `src/lib/utils/date.ts`, so the stated extraction work is outdated.
- **Rationale:** The repository contains both `src/lib/supabase/types.ts` and generated `src/lib/supabase/database.types.ts`. The current audit constraints are explicit allow-lists.
- **Impact:** Builds, typed row aliases, or audit writes may fail depending on deployment order.
- **Recommended action:** Add to the delivery checklist:
  - new table and RLS,
  - audit entity/action allow-list changes,
  - both applicable Supabase type files regenerated/updated,
  - role tests,
  - schema reload,
  - and confirmation that the existing date helper is reused rather than extracted again.
- **Open questions:**
  - Which Supabase type file is authoritative for new modules?
  - Is type generation available in CI or performed manually?

### F23 — The test plan is not sufficient for the risk

- **Relevant section:** Testing
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing / Security
- **Description:** Mocked Vitest tests cannot prove RLS, database checks, triggers, joins, PostgREST overlap filters, or migration correctness. UI and end-to-end journeys are also absent.
- **Rationale:** The repository already contains migration integration tests against Supabase and component tests. Permission failures are the highest-risk part of this feature.
- **Impact:** Security regressions and production-only query failures can pass the proposed suite.
- **Recommended action:** Add:
  - pure unit tests for overlap logic,
  - real Supabase integration tests for RLS and constraints,
  - action tests for tampering, not-found, deleted, concurrency, DB errors, audit, and revalidation,
  - component tests for multi-day display, warning changes, multiple clashes, filters, overflow, and read-only/edit states,
  - accessibility tests plus manual keyboard checks,
  - one E2E journey: create note → see both calendars → receive event warning → see dashboard clash → edit/delete note.
  - a public API regression test confirming `/api/v1` event responses do not include notes or note detail.
  Include 05:00/05:01, midnight, DST, multi-venue, null end time, and overlapping-window boundaries.
- **Open questions:**
  - Is the local Supabase integration suite required in CI or only before merge?
  - What coverage threshold applies to the new pure clash logic?

### F24 — Rollback and deployment claims are unsafe

- **Relevant section:** Rollout
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Deployment / Migration
- **Description:** “No rollback risk” and “rollback is dropping the table” are only true before any note is created. Dropping the table after use permanently loses data. Deploying application code before the migration can also break pages that query the missing table.
- **Rationale:** Additive schema is low-risk, but data created after launch changes the rollback plan.
- **Impact:** A rollback can destroy operational records or make calendars fail during a rolling deployment.
- **Recommended action:** State:
  - deploy migration first,
  - verify RLS with role-based smoke tests,
  - deploy backward-compatible application code,
  - roll back the application without dropping the table,
  - use a forward-fix migration for schema problems,
  - drop the table only before production use or after an explicit data-retention decision.
- **Suggested wording:** “The migration is additive and low risk to existing tables. After notes are created, table removal is destructive and is not the normal rollback path.”
- **Open questions:**
  - Can the hosting process guarantee migration-before-code order?
  - Who approves destructive rollback after data exists?

### F25 — Acceptance criteria and delivery boundaries are missing

- **Relevant section:** Goals; Complexity; Testing; Rollout
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / Scope
- **Description:** The document has goals but no testable acceptance criteria, definition of done, owner, or explicit browser/device support. The **M** estimate omits audit schema changes, RLS integration, type generation, mobile decisions, and several components.
- **Rationale:** Different developers can complete different interpretations while still claiming the listed tasks are done.
- **Impact:** Estimation, review, QA, and release decisions will be unreliable.
- **Recommended action:** Re-estimate as **L** until scope is narrowed. Add acceptance criteria covering permissions, multi-venue and multi-day behaviour, all supported creation paths, failure states, mobile/desktop, accessibility, RLS, performance bounds, deployment order, and evidence required before release.
- **Open questions:**
  - Who owns product decisions and acceptance?
  - Is mobile support launch scope?
  - Is rescheduling launch scope?

### F26 — Monitoring and post-release checks are missing

- **Relevant section:** Rollout; Error handling
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Operations / Monitoring
- **Description:** The spec has no structured logging, metrics, alerting, or post-deployment validation for note query/action failures.
- **Rationale:** A failed advisory feature may look like an empty result rather than an outage.
- **Impact:** Missing warnings can go unnoticed until a venue is double-booked.
- **Recommended action:** Add:
  - structured logs for list/clash/action failures with operation IDs and no detail text,
  - monitoring for server-action and dashboard query error rates,
  - a post-deploy role/RLS smoke test,
  - an audit-log verification,
  - a calendar/form/dashboard end-to-end smoke test,
  - and `npm run advisors` after the migration is applied to the target environment.
- **Open questions:**
  - What logging/alerting service receives application errors today?
  - What error rate or missing-data signal should trigger action?

### F27 — Use one pure clash engine for every caller

- **Relevant section:** `src/lib/calendar-notes.ts`; Event form warning; Dashboard
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification / Maintainability
- **Description:** The same overlap rule is needed in the event form, proposal form, dashboard, and tests.
- **Rationale:** Separate client and server implementations are likely to drift, especially around multi-venue and early-hours handling.
- **Impact:** Inconsistent warnings and duplicated tests.
- **Recommended action:** Create a pure function that accepts normalized event occupancy and notes, then use thin query/adaptation layers around it. Keep the date and venue truth table in one module.
- **Open questions:** None if both browser and server dependencies remain pure and serializable.

### F28 — Support contextual note creation from a calendar day

- **Relevant section:** Note modal; Calendar UI
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** UX / Simplification
- **Description:** A header-only “Add note” action opens an unscoped form even when the user is looking at a specific date and venue.
- **Rationale:** Calendar day context can safely prefill the date and current venue filter, reducing mistakes.
- **Impact:** Without defaults, note entry takes longer and is easier to misfile.
- **Recommended action:** Allow an “Add note” control on a day cell or pass the current month/filter context into the shared dialog. Managers should have their venue fixed automatically.
- **Open questions:**
  - Is a day-cell action too visually busy on small cells?

### F29 — Deliver in small vertical slices

- **Relevant section:** Complexity; Rollout
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Delivery / Risk
- **Description:** The design combines storage, CRUD, two calendars, two forms, dashboard integration, and clash logic in one release.
- **Rationale:** The security and date rules can be validated before every surface is connected.
- **Impact:** A single large change will be harder to review and roll back safely.
- **Recommended action:** Use three mergeable slices:
  1. Schema, RLS, types, actions, audit, and integration tests.
  2. Shared dialog plus calendar display/management.
  3. Shared clash engine plus forms, reschedule decision, dashboard, monitoring, and E2E.
  Keep the feature hidden from users until the minimum complete journey is ready.
- **Open questions:**
  - Does the deployment process support merging inactive foundation work before the UI?

## Required decisions before implementation

1. Exact read and write visibility for administrators, assigned managers, and managers without a venue.
2. Whether rescheduling is included, or the goal is narrowed to admit the gap.
3. How current-month note data is loaded when month navigation stays client-side.
4. Which event statuses count as clashes and how null event end times behave.
5. How multi-day notes render in each supported calendar and overflow state.
6. Whether mobile users can view, create, edit, and delete notes.
7. Which roles see dashboard note clashes and where the dashboard links for resolution.
8. Whether note detail may contain personal data and how long notes are retained.
9. Whether last-write-wins is accepted or optimistic concurrency is required.
10. The distinct audit entity/actions and required audit presentation.

## Key required specification changes

Before assigning implementation, amend the specification to:

- replace the broad authenticated RLS statement with exact current-role policies;
- define multi-venue clash matching through `event_venues` with legacy fallback;
- replace the invalid audit contract and include audit schema/type changes;
- choose a data-loading model for client-side calendar navigation;
- reconcile form/reschedule/date-window coverage with Goal 3;
- add a complete clash truth table;
- define multi-day, filter, overflow, mobile, and dashboard behaviour;
- add visible degraded states when clash data cannot be loaded;
- add strict data validation, deletion, privacy, and concurrency decisions;
- expand migration, type-generation, deployment, monitoring, and testing plans;
- add acceptance criteria and re-estimate the work.

## Major risks

1. **Authorization bypass:** broad RLS could let managers write notes for other venues.
2. **False negatives:** secondary-venue events, stale form data, navigation outside the fetched month, or range-boundary errors could suppress warnings.
3. **False confidence during outages:** an unavailable notes query could look like “no notes”.
4. **Data loss:** destructive rollback, venue cascade deletion, or last-write-wins editing could remove operational information.
5. **Delivery underestimation:** the current scope is materially larger than the stated **M** estimate.
6. **Low adoption:** desktop-only, header-only entry and unclear remediation may make notes inconvenient to maintain.

## Key dependencies

- The current administrator/manager role helpers and RLS functions.
- `event_venues` as the source of truth for multi-venue event links.
- The audit entity/action constraints and `recordAuditLogEntry` type contract.
- The two calendars' client-side month state and refresh model.
- Supabase migration ordering, schema reload, type generation, and integration-test environment.
- A product decision on rescheduling, mobile support, visibility, privacy, and dashboard audience.

## Recommended next steps

1. Hold a short product/technical decision review for the ten unresolved decisions above.
2. Update the source specification with those decisions and testable acceptance criteria.
3. Produce the exact migration/RLS/audit design and prove it with real Supabase integration tests.
4. Implement one pure, fully tested clash engine with multi-venue and London-date handling.
5. Build the calendar CRUD journey, then add form/reschedule and dashboard consumers.
6. Run lint, typecheck, unit tests, integration tests, E2E, build, Supabase advisors, accessibility checks, and role-based smoke tests before release.
