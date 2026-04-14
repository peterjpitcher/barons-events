**Repo Reality Map**

Ground truth: these 8 uncommitted files sit in a codebase where permissions are enforced in three different places at once: helper-level role checks in [src/lib/roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:1), per-action ownership/assignment checks in server actions such as [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:591) and [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:167), and Supabase RLS policies in migrations such as [20260321000001_fix_event_update_rls.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260321000001_fix_event_update_rls.sql:1) and [20260410120003_venue_manager_event_visibility.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120003_venue_manager_event_visibility.sql:1). Reviewers should read the diff against that layered model, not against the changed files in isolation.

## 1. Inspection Inventory

### Command + diff surface

- Ran `git diff` for the current uncommitted change set.
- Confirmed 8 changed files and read each changed file in full:
  - [.gitignore](/Users/peterpitcher/Cursor/BARONS-BaronsHub/.gitignore:1)
  - [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:1)
  - [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1)
  - [src/actions/opening-hours.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/opening-hours.ts:1)
  - [src/app/events/[eventId]/page.tsx](</Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:1>)
  - [src/actions/__tests__/bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/__tests__/bookings.test.ts:1)
  - [src/actions/__tests__/revert-to-draft.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/__tests__/revert-to-draft.test.ts:1)
  - [src/lib/__tests__/inspiration-actions.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/__tests__/inspiration-actions.test.ts:1)

### Shared auth / role model read

- [src/lib/roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:1)
- [src/lib/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:1)
- [src/lib/auth/__tests__/rbac.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/__tests__/rbac.test.ts:1)
- [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:228)
- RLS migrations:
  - [20260321000001_fix_event_update_rls.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260321000001_fix_event_update_rls.sql:1)
  - [20260410120003_venue_manager_event_visibility.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120003_venue_manager_event_visibility.sql:1)

### Per-file dependency / related-test map

- [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1)
  - Direct dependencies read: [src/lib/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:1), [src/lib/roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:1), [src/lib/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/events.ts:1), [src/lib/audit-log.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/audit-log.ts:1), [src/components/reviews/decision-form.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/reviews/decision-form.tsx:1), [src/components/events/revert-to-draft-button.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/revert-to-draft-button.tsx:1), [src/components/events/approve-event-button.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/approve-event-button.tsx:1), [src/app/reviews/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/reviews/page.tsx:1)
  - Related tests read: [src/actions/__tests__/revert-to-draft.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/__tests__/revert-to-draft.test.ts:1)
  - No direct unit tests found for `reviewerDecisionAction`.

- [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:1)
  - Direct dependencies read: [src/lib/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:1), [src/lib/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:1), [src/lib/audit-log.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/audit-log.ts:1), [src/components/bookings/cancel-booking-button.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/bookings/cancel-booking-button.tsx:1), [src/lib/all-bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/all-bookings.ts:1)
  - Related tests read: [src/actions/__tests__/bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/__tests__/bookings.test.ts:1), [src/lib/__tests__/bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/__tests__/bookings.test.ts:1), [src/lib/__tests__/all-bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/__tests__/all-bookings.test.ts:1)

- [src/actions/opening-hours.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/opening-hours.ts:1)
  - Direct dependencies read: [src/lib/opening-hours.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/opening-hours.ts:1), [src/app/opening-hours/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/opening-hours/page.tsx:1), [src/app/venues/[venueId]/opening-hours/page.tsx](</Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/venues/[venueId]/opening-hours/page.tsx:1>), [src/components/opening-hours/overrides-calendar.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/opening-hours/overrides-calendar.tsx:1)
  - No dedicated tests found for these actions.

- [src/app/events/[eventId]/page.tsx](</Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:1>)
  - Direct dependencies read: [src/lib/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:1), [src/lib/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/events.ts:231), [src/lib/audit-log.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/audit-log.ts:116), [src/lib/roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:1), [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1700)
  - Related tests: no page/component tests found for this route-level gating.

- [src/actions/__tests__/bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/__tests__/bookings.test.ts:1)
  - Direct dependencies read: [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:1), [src/lib/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:1), [src/lib/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:1)

- [src/actions/__tests__/revert-to-draft.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/__tests__/revert-to-draft.test.ts:1)
  - Direct dependencies read: [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1833), [src/lib/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:1), [src/lib/roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:1), [src/lib/audit-log.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/audit-log.ts:1)

- [src/lib/__tests__/inspiration-actions.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/__tests__/inspiration-actions.test.ts:1)
  - Direct dependencies read: [src/actions/planning.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts:1), [src/lib/roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:1)

- [.gitignore](/Users/peterpitcher/Cursor/BARONS-BaronsHub/.gitignore:1)
  - No runtime dependencies or tests.

### Verification reads / runs

- Reviewed targeted Vitest coverage already present around auth and changed actions.
- Verified via targeted runs:
  - `npx vitest run src/lib/auth/__tests__/rbac.test.ts src/actions/__tests__/revert-to-draft.test.ts src/actions/__tests__/bookings.test.ts` passed: 51 tests.
  - `npm test -- src/actions/__tests__/bookings.test.ts src/lib/__tests__/inspiration-actions.test.ts` passed: 23 tests.

## 2. Codebase Patterns Relevant To The Changes

### Permission model

- `getCurrentUser()` is the authoritative auth helper. It builds an `AppUser` from the verified Supabase user plus the `users` table profile, and it fail-closes to `null` on missing profile or unknown role. See [src/lib/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:48).
- `getSession()` is explicitly not safe for authorization because it can return stale or revoked sessions. See [src/lib/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:30).
- Roles are capability-based:
  - `canManageEvents`: `central_planner`, `venue_manager`
  - `canReviewEvents`: `central_planner`, `reviewer`
  - `canUsePlanning`: `central_planner`
  - `canViewPlanning`: `central_planner`, `executive`
  - See [src/lib/roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:15).
- The repo does not use one single scoping rule for venue managers. Some flows scope by `venue_id`, some by `created_by`, and some rely on RLS. Reviewers should not assume `canManageEvents` alone is the whole rule.
  - Bookings cancellation uses venue scope: [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:191)
  - Event submit/delete/edit flows often use creator scope: [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1136), [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1788)

### Event workflow / status model

- The active event states are `draft`, `submitted`, `needs_revisions`, `approved`, `rejected`, `completed`. See [src/app/events/[eventId]/page.tsx](</Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:31>).
- The intended event lifecycle around this diff is:
  - draft/needs_revisions -> submitted via [submitEventForReviewAction](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:934)
  - submitted/needs_revisions -> approved/needs_revisions/rejected via [reviewerDecisionAction](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1309)
  - approved -> draft via [revertToDraftAction](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1833)
- The `reviewerDecisionAction` guard now matches the page and review queue: reviewers only act on `submitted` or `needs_revisions`, not `draft`. See [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1351), [src/app/events/[eventId]/page.tsx](</Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:86>), [src/app/reviews/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/reviews/page.tsx:34).

### Audit logging pattern

- Audit logging is best-effort, not transactional. `recordAuditLogEntry()` catches and logs failures instead of throwing. See [src/lib/audit-log.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/audit-log.ts:32).
- Event actions mostly log event-centric audit records with structured `meta` such as `status`, `previousStatus`, `assigneeId`, `previousAssigneeId`, `feedback`, and `changes`. See [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1276), [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1427), [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1878).
- Booking cancellation intentionally logs against the event stream, not a booking stream, because the event detail page only reads `entity = "event"` audit rows. See [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:213), [src/lib/audit-log.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/audit-log.ts:116), [src/app/events/[eventId]/page.tsx](</Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:238>).

### Revalidation pattern

- Most mutation actions pair the write with route invalidation, but the scope varies by feature:
  - Event submit/revert revalidate detail page plus list/review pages. See [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1298), [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1891)
  - Reviewer decisions revalidate detail page and `/reviews`, but not `/events`. See [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1460)
  - Booking cancellation revalidates the bookings subroute only. The client button also does `router.refresh()`. See [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:221), [src/components/bookings/cancel-booking-button.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/bookings/cancel-booking-button.tsx:21)
  - Opening-hours overrides are different: the UI relies on optimistic local state, and revalidation exists mainly for later server renders/navigation. See [src/components/opening-hours/overrides-calendar.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/opening-hours/overrides-calendar.tsx:448), [src/actions/opening-hours.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/opening-hours.ts:209)

### Test pattern

- Tests here are mostly unit-style action tests with hoisted module mocks and chainable Supabase doubles.
- The diff’s new mocks follow an established pattern:
  - Server actions mock `next/navigation`, `next/cache`, auth helpers, and Supabase clients before importing the module under test.
  - Supabase chain mocking is explicit and method-shape-sensitive, for example `.insert().select().single()` vs `.select().eq().single()`. See [src/lib/__tests__/inspiration-actions.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/__tests__/inspiration-actions.test.ts:48).
- Coverage is still narrow around the changed logic:
  - `revertToDraftAction` has focused action-level tests.
  - `cancelBookingAction` only has unauthenticated + central planner success/failure coverage.
  - Opening-hours override actions have no direct tests.
  - The event detail page has no page/component test around the changed button gating.

## 3. Risks Or Context Other Reviewers Should Know About

### Event permission / ownership mismatches remain

- The diff improves `revertToDraftAction` by blocking reviewers and executives, but it still gates only on `canManageEvents()`, which includes `venue_manager`. See [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1842).
- The page now matches that same broad rule: `event.status === "approved" && canManageEvents(user.role)`. See [src/app/events/[eventId]/page.tsx](</Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:98>).
- That is broader than the repo’s normal venue-manager event-edit rules, which usually require creator ownership and a `draft`/`needs_revisions` status. It is also broader than update RLS, which only allows venue-manager updates on their own draft/revision events. See [20260321000001_fix_event_update_rls.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260321000001_fix_event_update_rls.sql:8).
- Net effect: the app/UI can now offer a revert action to a venue manager in situations where the rest of the codebase treats that role as non-owner or where the database will still refuse the update. That is important review context even if the diff itself is “role tightening.”

### Event detail visibility is broader than event-list visibility

- `listEventsForUser()` narrows venue managers to `created_by = user.id`, reviewers to assigned events, and executives to a limited slice. See [src/lib/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/events.ts:164).
- But the event detail page does not do an explicit application-layer visibility check; it simply calls `getEventDetail(eventId)`. See [src/app/events/[eventId]/page.tsx](</Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:75>).
- RLS now allows venue managers to read any event at their venue. See [20260410120003_venue_manager_event_visibility.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120003_venue_manager_event_visibility.sql:9).
- Reviewers should therefore read page-level button gating in the context of direct URL access, not only from what appears on `/events`.

### Reviewer decision change is correct, but it exposes adjacent gaps

- The status guard change from `draft` to `needs_revisions` is aligned with both the review queue and page gating. This is a real correctness fix. See [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1351), [src/app/reviews/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/reviews/page.tsx:34).
- There is still no direct test coverage for `reviewerDecisionAction`, so regressions around assignee handoff, website copy generation, or stale list invalidation would not be caught by the changed tests.
- The action revalidates `/reviews` and the detail page, but not `/events`, so list views can remain stale after decision writes. See [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1460).

### Revert-to-draft is lighter-weight than other status transitions

- `revertToDraftAction` clears `assignee_id`, writes an event audit record, and revalidates pages. See [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1869), [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1878).
- Unlike submit/decision flows, it does not append an event version and does not include assignee metadata in the audit payload, even though assignee is changed. Compare [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1451) with [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1878).
- Other reviewers should treat the new permission test coverage as partial; it does not cover version-history or audit-trail completeness.

### Booking cancellation fix closes a real integrity issue

- `cancelBookingAction` now always looks up the booking’s real `event_id` before permission checks, audit logging, and revalidation. See [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:176).
- That matters because `cancelBooking()` is a service-role helper and is intentionally unscoped. Caller-side checks are the real guard. See [src/lib/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:83).
- Remaining test gap: changed booking tests do not cover venue-manager denial/success paths, audit payload contents, or revalidation using the derived event id.

### Opening-hours diff fixes one invalidation gap, not all of them

- Adding `revalidatePath("/opening-hours")` to override create/update/delete is consistent with the global opening-hours page, which server-loads overrides. See [src/actions/opening-hours.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/opening-hours.ts:209), [src/app/opening-hours/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/opening-hours/page.tsx:17).
- It does not revalidate the venue-specific route that also consumes override data. See [src/app/venues/[venueId]/opening-hours/page.tsx](</Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/venues/[venueId]/opening-hours/page.tsx:35>).
- The override calendar also fabricates a local UUID after create because the action returns no persisted id. Editing/deleting that row before a refresh can target a fake id. See [src/components/opening-hours/overrides-calendar.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/opening-hours/overrides-calendar.tsx:456), [src/lib/opening-hours.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/opening-hours.ts:216).

### Inspiration test change fixes mocking shape, but the role mocks drift from production

- The new `.insert().select().single()` mock shape is needed because `convertInspirationItemAction()` creates a planning item and then generates an SOP checklist. See [src/actions/planning.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts:567), [src/actions/planning.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts:585).
- The test’s mocked `canUsePlanning` currently allows `venue_manager`, while production `canUsePlanning` allows only `central_planner`. See [src/lib/__tests__/inspiration-actions.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/__tests__/inspiration-actions.test.ts:10), [src/lib/roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:50).
- That means this test file is useful for import/mocking stability, but it is not a trustworthy RBAC oracle.

### `.gitignore` change

- The `.gitignore` addition for `.claude/session-context.md` is review-noise reduction only. It has no runtime effect. See [.gitignore](/Users/peterpitcher/Cursor/BARONS-BaronsHub/.gitignore:26).

## 4. Key Architectural Constraints

- `createSupabaseAdminClient()` bypasses RLS. Any action or helper using it must do its own authorization correctly. This is the most important constraint for booking flows and any system helper path. See [src/lib/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:44), [src/lib/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/events.ts:547).
- `createSupabaseActionClient()` and `createSupabaseReadonlyClient()` still run under the logged-in user and therefore interact with RLS. App-layer permission logic and DB policy logic can diverge, and both matter. See [src/lib/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:48), [20260321000001_fix_event_update_rls.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260321000001_fix_event_update_rls.sql:8).
- Middleware can inject a trusted `x-user-id`, so server components and server actions often rely on `getCurrentUser()` without repeating JWT validation. API routes are excluded from that fast path. See [src/lib/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:51), [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:275).
- Audit logging is intentionally non-blocking. Reviewers should not assume “audit write exists” is part of transaction success semantics.
- Event history is split across `events`, `event_versions`, `approvals`, and `audit_log`. Some transitions update all of them; others do not. This is why “status change” reviews in this repo need to check all four, not just the main row.
- Opening-hours override writes are multi-step and non-transactional: override row plus join-table rows are written separately. See [src/lib/opening-hours.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/opening-hours.ts:216), [src/lib/opening-hours.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/opening-hours.ts:250).
- Existing tests are action-unit tests with mocked chains, not end-to-end coverage. A passing Vitest file here is useful, but it does not prove route-level gating or RLS alignment.

## Bottom Line

- The booking change is a real integrity improvement.
- The reviewer decision status-guard change is also a real correctness fix.
- The revert-to-draft change is only a partial permission fix; it narrows by role, but it still lives inside a broader event-permission model that is inconsistent across page gating, action gating, and RLS.
- The opening-hours change improves cache invalidation for the global page, but the feature still relies heavily on optimistic client state and has unresolved stale-id / venue-route gaps.
