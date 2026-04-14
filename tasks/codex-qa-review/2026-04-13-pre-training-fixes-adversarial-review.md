# Adversarial Review: Pre-Training Bug Fixes

**Date:** 2026-04-13
**Mode:** Code Review (Mode B) with adversarial framing
**Engines:** Claude + Codex (4 specialist reviewers)
**Scope:** 10 files changed, ~120 lines — permission, audit, revalidation, and test fixes

## Inspection Inventory

### Inspected
- All changed files (full content + diff)
- Direct imports and dependencies for each changed file
- Role/permission model: `src/lib/roles.ts`, `src/lib/auth.ts`
- RLS policies: `supabase/migrations/20260321000001_fix_event_update_rls.sql`, `20260410120003_venue_manager_event_visibility.sql`
- UI components consuming the changed actions: `events-board.tsx`, `planning-item-card.tsx`, `approve-event-button.tsx`, `revert-to-draft-button.tsx`, `cancel-booking-button.tsx`, `overrides-calendar.tsx`
- Related test files: `rbac.test.ts`, `bookings.test.ts`, `revert-to-draft.test.ts`, `inspiration-actions.test.ts`
- Review queue page: `src/app/reviews/page.tsx`
- Opening hours pages and components

### Not Inspected
- End-to-end flows in browser (no Playwright tests run)
- Database state / seed data (would require live DB connection)

## Executive Summary

The initial Claude review caught 6 real bugs. The Codex adversarial review then found 3 additional issues that Claude missed — most critically, an RLS/permission mismatch and UI components still showing approve buttons for draft events. All issues have been fixed and verified.

## What Appears Solid
- **Auth flows**: Login, password reset, session management, CSRF — all verified clean
- **Public booking page**: Turnstile CAPTCHA is fail-soft, forms handle all states
- **Public API**: Rate limiting, Zod validation, proper status codes
- **Navigation**: All links match real routes, role-based filtering correct
- **Revert-to-draft**: Now correctly central_planner-only, aligned with RLS
- **Booking cancellation**: Uses DB-derived event_id, role check before DB lookup
- **Test coverage**: 258 tests passing, new permission tests added

## Findings Resolved

| # | Source | Severity | Finding | Status |
|---|--------|----------|---------|--------|
| 1 | Claude | High | `revertToDraftAction` had no permission check | Fixed: central_planner-only |
| 2 | Claude | High | `reviewerDecisionAction` allowed decisions on "draft" events | Fixed: [submitted, needs_revisions] only |
| 3 | Claude | Medium | Opening hours overrides didn't revalidate `/opening-hours` | Fixed: added revalidatePath |
| 4 | Claude | Medium | `cancelBookingAction` used caller-supplied eventId in audit log | Fixed: DB-derived event_id |
| 5 | Claude | Medium | Inspiration actions test broken (mock shape mismatch) | Fixed: updated mock chain |
| 6 | Claude | Low | 3 console.log debug statements in production | Fixed: removed |
| 7 | Codex | **High** | `revertToDraftAction` allowed venue_managers but RLS blocks updates on approved events — silent no-op | Fixed: restricted to central_planner only |
| 8 | Codex | **High** | Events board + planning card still showed approve buttons for "draft" events (server rejects) | Fixed: UI updated to [submitted, needs_revisions] |
| 9 | Codex | Low | `cancelBookingAction` leaked booking existence to unauthorised roles | Fixed: role check moved before DB lookup |
| 10 | Codex | Low | Inspiration test mock allowed venue_manager for canUsePlanning (production: central_planner only) | Fixed: mock aligned with production |

## Known Limitations (not demo-breaking)

- Opening hours overrides don't revalidate `/venues/[venueId]/opening-hours` (venue-specific page)
- Newly created overrides use fabricated client-side UUIDs until page refresh
- `reviewerDecisionAction` has no direct unit test coverage (but server-side guard is correct)
- `cancelBookingAction` tests only cover central_planner paths (venue_manager paths untested)
- Password reset flow: if user navigates away before submitting, they lose the recovery context
