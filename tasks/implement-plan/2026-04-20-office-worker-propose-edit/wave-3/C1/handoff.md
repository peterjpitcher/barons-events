# Wave 3 / C1 — Cleanup & Verification Pipeline — Handoff

## Mission
Delete the now-unused `canManageEvents` helper (and its test block), fix any residual imports, and run the full verification pipeline (lint, typecheck, vitest, build).

## Files touched

1. **`src/lib/roles.ts`** — Deleted the `canManageEvents` function (lines 20-25 per pre-edit view) and its JSDoc comment.
2. **`src/lib/auth/__tests__/rbac.test.ts`** — Deleted:
   - `canManageEvents` from the imports block (was line 43).
   - The entire `describe("canManageEvents (venue_id-dependent)", ...)` block (was lines 700-707, six tests).
3. **`src/actions/events.ts`** — Removed `canManageEvents` from the import list on line 9. (Wave 2 / S1 already migrated all call-sites; only the stale import remained.)

No other files referenced `canManageEvents` — verified via `Grep` across `src/` and `supabase/`.

## Verification — four commands in order

All four exited 0, no failures. Pipeline transcript captured in `../../verification/pipeline.md`.

| # | Command | Result | Final line |
|---|---------|--------|------------|
| 1 | `npm run lint` | PASS | `> eslint` (no warnings, no errors emitted) |
| 2 | `npx tsc --noEmit` | PASS | (no output — zero errors) |
| 3 | `npx vitest run` | PASS | `Test Files 46 passed \| 1 skipped (47) ... Tests 617 passed \| 10 skipped (627)` |
| 4 | `npm run build` | PASS | `✓ Compiled successfully in 3.3s` |

Skipped tests: only `supabase/migrations/__tests__/office_worker_event_scope.test.ts` (10 tests, gated behind `RUN_MIGRATION_INTEGRATION_TESTS=1` — expected per brief).

## Post-cleanup invariants

- `grep -r canManageEvents src/ supabase/ --include='*.ts' --include='*.tsx' --include='*.sql'` → **no matches**.
- References to `canManageEvents` only remain in historical handoff docs under `tasks/implement-plan/` and `tasks/codex-qa-review/` (deliberate — context for the migration).
- `src/lib/roles.ts` retains: `isAdministrator`, `canProposeEvents`, `canEditEvent`, `EventEditContext`, `canViewEvents`, `canReviewEvents`, plus all non-event capability functions. Structure is coherent.

## Issues uncovered
None. All Wave 1 / Wave 2 call-site migrations were complete; only the stale import in `src/actions/events.ts` (and the self-referential test block) needed removal.

## Next step for caller
Ready for commit as `chore(roles): remove canManageEvents (fully superseded)` and PR. No follow-up fixes required.

## Self-check
- [x] `canManageEvents` gone from `src/lib/roles.ts` and tests.
- [x] No imports of `canManageEvents` anywhere in `src/`.
- [x] Lint: zero warnings.
- [x] Typecheck: zero errors.
- [x] Vitest: all pass (10 migration integration tests skipped as expected).
- [x] Build: clean.
- [x] `handoff.md` and `pipeline.md` written.
