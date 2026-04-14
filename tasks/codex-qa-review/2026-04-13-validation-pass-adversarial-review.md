# Validation Pass: Pre-Training Bug Fixes

**Date:** 2026-04-13
**Mode:** Validation Pass (Code Review, Mode B)
**Engines:** Claude + Codex (3 specialist reviewers)
**Scope:** 11 files changed — permission, audit, revalidation, UI gating, and test fixes

## Inspection Inventory

### Inspected (by Codex)
- All changed files (full content + diff)
- RLS policies: `20260321000001_fix_event_update_rls.sql`
- Role model: `src/lib/roles.ts`
- Auth helpers: `src/lib/auth.ts`
- UI consumers: `events-board.tsx`, `planning-item-card.tsx`, `approve-event-button.tsx`, `revert-to-draft-button.tsx`, `cancel-booking-button.tsx`, `overrides-calendar.tsx`
- Bookings page: `src/app/events/[eventId]/bookings/page.tsx`
- Event detail page: `src/app/events/[eventId]/page.tsx`
- Reviews page: `src/app/reviews/page.tsx`
- Venues pages and opening hours components
- README.md (demo account references)
- All test files for changed actions

### Verification
- `npm run typecheck`: Pass
- `npm test`: 258/258 pass (24 files)
- `npm run build`: Pass

## Validation Results

### Original 10 Fixes

| # | Fix | Codex Verdict |
|---|-----|---------------|
| 1 | `revertToDraftAction` central_planner-only | **CONFIRMED CORRECT** — aligned with RLS and role model |
| 2 | `reviewerDecisionAction` [submitted, needs_revisions] | **CONFIRMED CORRECT** — matches review page, detail page, submit action |
| 3 | `events-board.tsx` approve gating | **CONFIRMED CORRECT** — no remaining draft-approve UI |
| 4 | `planning-item-card.tsx` approve gating | **CONFIRMED CORRECT** — matches server action |
| 5 | Opening hours override revalidation | **CONFIRMED CORRECT** for primary page; venue-specific page not revalidated but uses optimistic state |
| 6 | `cancelBookingAction` role check + DB-derived event_id | **CONFIRMED CORRECT** — role check before DB lookup |
| 7 | Inspiration test mock chain | **CONFIRMED CORRECT** — matches live action shape |
| 8 | Inspiration role mock alignment | **CONFIRMED CORRECT** — matches production `canUsePlanning` |
| 9 | Revert-to-draft permission tests | **CONFIRMED CORRECT** — denies all non-planner roles |
| 10 | Removed console.log statements | **CONFIRMED CORRECT** — no debug logging remains |

### New Issue Found During Validation

| # | Severity | Finding | Source | Status |
|---|----------|---------|--------|--------|
| 11 | High | Executives could access bookings page (PII: names, mobiles, emails) and see cancel buttons | Both Codex reviewers | **FIXED** — bookings page now blocks non-planner/venue-manager; bookings link hidden from executives on event detail |

## Final State

- **11 bugs found and fixed** across two review passes
- All permission checks aligned across server actions, UI, and RLS
- No remaining draft-approve UI surfaces
- No remaining PII exposure to read-only roles
- Full pipeline green: lint, typecheck, 258 tests, build
