# Wave 2 / S1 Handoff — Server Action Capability Migration

**Agent:** S1 (Server Actions)
**Date:** 2026-04-18
**Scope:** Plan Tasks 8, 9, 10, 11

## Summary

All four tasks landed as separate commits on `main`. Every `canManageEvents`
call-site in `src/actions/events.ts` has been migrated to the new capability
helpers; `src/actions/pre-event.ts` now uses the atomic `reject_event_proposal`
RPC and overwrites the client-supplied `created_by` on proposals.

## Commits

| SHA | Task | Message |
|---|---|---|
| `a79ccd8` | 8 | `feat(propose): capability check, created_by override, venue validation` |
| `17b5cdf` | 9 | `feat(events): any-venue create + canEditEvent-guarded update paths` |
| `c184557` | 10 | `feat(events): migrate delete/booking/website-copy to canEditEvent / canProposeEvents` |
| `bfab33e` | 11 | `refactor(reject): use atomic reject_event_proposal RPC` |

## Files Changed

| Path | Change |
|---|---|
| `src/actions/pre-event.ts` | `proposeEventAction` → capability + server-authoritative `created_by` + venue pre-validation; `preRejectEventAction` → atomic `reject_event_proposal` RPC |
| `src/actions/events.ts` | Six `canManageEvents` call-sites migrated per spec classification table; venue-pinning and cross-venue rejection blocks removed from `saveEventDraftAction` and `submitEventForReviewAction` |
| `src/actions/__tests__/pre-event.test.ts` | New — 4 tests for `proposeEventAction` (executive rejection, SEC-001 `created_by` override, WF-003 retryable venue query error, venue not-available) |
| `src/actions/__tests__/events-edit-rbac.test.ts` | New — 20 tests covering create-path (any-venue), update-path (canEditEvent), delete, website-copy, and booking-settings guards |

## Call-Site Migrations (R-008 classification applied)

| Original line | Function | New guard |
|---|---|---|
| `saveEventDraftAction` create | `canProposeEvents(user.role)` |
| `saveEventDraftAction` update | `loadEventEditContext` + `canEditEvent(...)` |
| `submitEventForReviewAction` create | `canProposeEvents(user.role)` |
| `submitEventForReviewAction` update | `loadEventEditContext` + `canEditEvent(...)` |
| `generateWebsiteCopyFromFormAction` | `canProposeEvents(user.role)` |
| `generateTermsAndConditionsAction` | `canEditEvent(...)` when `eventId` supplied, else `canProposeEvents` |
| `deleteEventAction` | `loadEventEditContext` + `canEditEvent(...)` |
| `updateBookingSettingsAction` | `loadEventEditContext` + `canEditEvent(...)` (server guard is sole enforcement — admin client below) |

### Blocking lines removed

Per plan, from **both** `saveEventDraftAction` and `submitEventForReviewAction`:

1. `if (!canManageEvents(...)) return {...}` — swapped per create/update classification.
2. `if (user.role === "office_worker" && !user.venueId) return {...}` — **deleted**.
3. `if (user.role === "office_worker" && requestedVenueIds.some(id => id !== user.venueId)) return {...}` — **deleted**.
4. `venueIds = user.role === "office_worker" ? [user.venueId] : requestedVenueIds` → `venueIds = requestedVenueIds`.

## Definition of Done

- [x] `git grep -c 'canManageEvents' src/actions/` returns only the import line (no call-sites). Kept per plan's self-check preference — Wave 3 deletes the helper + import together.
- [x] `npx vitest run src/actions/__tests__/pre-event.test.ts src/actions/__tests__/events-edit-rbac.test.ts` → all 24 pass.
- [x] `npx vitest run src/actions/` → **163/163 pass** across 9 test files.
- [x] `npx tsc --noEmit` → clean (exit 0).
- [x] Four commits landed with messages matching the plan.
- [x] Self-check items all satisfied (SEC-001 override, WF-003 error branch, admin guard retained before RPC, venue guards removed, all 6 call-sites migrated).

## Self-Check Verification

| Check | Status | Notes |
|---|---|---|
| `proposeEventAction` overwrites `p_payload.created_by` with `user.id` before RPC | ✅ | Inline comment references SEC-001 v3.1 |
| Venue pre-validation has explicit `if (venueErr)` error branch | ✅ | Returns "We couldn't verify venues right now. Please try again." |
| `preRejectEventAction` keeps `user.role === "administrator"` guard before RPC | ✅ | Lines 139–141 of pre-event.ts; RPC also re-validates on the server |
| Both save/submit actions have top-level venue guards removed | ✅ | No "not linked to a venue" or "venue mismatch" strings remain in events.ts |
| All 6 `canManageEvents(user.role, user.venueId)` call-sites migrated | ✅ | Grep confirms only the import symbol remains |
| `canManageEvents` import retained for Wave 3 to delete atomically with helper | ✅ | `src/actions/events.ts:9` |

## Deviations from Plan

**None substantive.** Minor note on `generateTermsAndConditionsAction` (Task 10):
the plan's classification table marks line 1731 as "Event update (metadata) →
`canEditEvent(...)`", but the current action accepts `eventId` as optional (it
generates terms for unsaved drafts too). I implemented a conditional guard:
`canEditEvent` when `eventId` is supplied, `canProposeEvents` when it is not.
This matches the spirit of the classification (edit when editing, propose when
drafting) without tightening the contract for unsaved drafts.

## Test Mock Patterns Used

- `vi.hoisted()` shared-state pattern so factory closures safely reference mocks
  during Vitest's hoisting phase (the naive `const foo = vi.fn()` + `vi.mock(... () => foo)`
  pattern hits `ReferenceError: Cannot access 'foo' before initialization`).
- Valid UUID v4 strings in test data (`550e8400-e29b-41d4-a716-…`) because
  Zod v4's `.uuid()` enforces strict RFC 4122 version/variant bits — the
  `11111111-1111…` synthetic pattern from the plan's examples fails the strict check.

## What's Next (Wave 3)

- Delete `canManageEvents` from `src/lib/roles.ts`.
- Remove the `canManageEvents` symbol from the import at `src/actions/events.ts:9`.
- Run final `npm run build` (this agent intentionally did not run it — the
  build will fail until U1/U2 finish migrating UI pages; per the plan Wave 3
  owns the final green build).
