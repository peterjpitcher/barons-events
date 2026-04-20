# R1 Handoff — Role Helpers & Event Edit-Context Loader

## Status
Complete. Tasks 1–3 of the implementation plan landed across three commits.

## Commits
- `a4931ff` feat(roles): add canProposeEvents helper
- `494aaa0` feat(roles): add canEditEvent + EventEditContext
- `ad3c6c0` feat(events): add loadEventEditContext loader + canEditEventFromRow helper

## Files changed
- `src/lib/roles.ts` — added `canProposeEvents`, `canEditEvent`, and exported `EventEditContext` type. `canManageEvents` left intact (will be deleted in Wave 3 / Task 5).
- `src/lib/auth/__tests__/rbac.test.ts` — added `describe("canProposeEvents")` and `describe("canEditEvent")` blocks plus the corresponding imports. Existing `canManageEvents` block untouched.
- `src/lib/events/edit-context.ts` (new) — exports `loadEventEditContext`, `canEditEventFromRow`, and `EventRowForEdit`.
- `src/lib/events/__tests__/edit-context.test.ts` (new) — three loader tests per the plan.

## Verification
- `npx vitest run src/lib/auth/__tests__/rbac.test.ts src/lib/events/__tests__/edit-context.test.ts` → 118 tests passed (115 RBAC + 3 loader). Includes the 3 new `canProposeEvents` tests and all 15 enumerated `canEditEvent` tests.
- `npx tsc --noEmit` → clean (no new errors).
- TDD discipline followed: each failing test was confirmed FAIL before implementation landed, then re-run to confirm PASS.

## Deviation from plan (single, deliberate)
- Plan snippet for `src/lib/events/edit-context.ts` writes:
  `import { canEditEvent, type EventEditContext, type UserRole } from "@/lib/roles";`
- `UserRole` is not exported from `@/lib/roles` in this codebase — it is the canonical type in `@/lib/types` and `roles.ts` itself imports it from there. Importing `UserRole` from `@/lib/roles` would have failed `tsc`.
- Resolved by splitting the import:
  ```ts
  import { canEditEvent, type EventEditContext } from "@/lib/roles";
  import type { UserRole } from "@/lib/types";
  ```
- No semantic change. Same `UserRole` type (`@/lib/roles` itself uses this import) and the public surface of `edit-context.ts` matches the plan exactly (`loadEventEditContext`, `canEditEventFromRow`, `EventRowForEdit`).

## Self-check
- [x] `canManageEvents` still exists in `src/lib/roles.ts` (intact for later wave).
- [x] All 15 `canEditEvent` tests enumerated in Task 2 exist and pass.
- [x] All 3 `loadEventEditContext` tests enumerated in Task 3 exist and pass.
- [x] `canEditEventFromRow` and `EventRowForEdit` exported from `src/lib/events/edit-context.ts`.
- [x] Three commits present in `git log --oneline -5`.
- [x] No files outside ownership scope modified (only `src/lib/roles.ts`, `src/lib/events/edit-context.ts`, `src/lib/auth/__tests__/rbac.test.ts`, `src/lib/events/__tests__/edit-context.test.ts`).

## Notes for downstream agents (R2–R5 etc.)
- Public API of new helpers:
  - `canProposeEvents(role: UserRole): boolean`
  - `canEditEvent(role, userId, userVenueId, EventEditContext): boolean`
  - `loadEventEditContext(eventId): Promise<EventEditContext | null>` — uses admin client, logs via `console.error("loadEventEditContext: DB error", { eventId, error })` on non-missing-row errors.
  - `canEditEventFromRow(user: { id, role, venueId }, row: EventRowForEdit): boolean` — synchronous; for list/UI gating when the row is already in hand.
- `EventEditContext` and `EventRowForEdit` are both exported types ready to consume.
- Soft-delete check fires before any role/creator branch — admin can edit deleted rows for restore; everyone else is blocked.
