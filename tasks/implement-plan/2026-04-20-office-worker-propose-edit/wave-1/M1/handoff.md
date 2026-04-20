# M1 Handoff — Database Migrations & Integration Tests

**Agent:** M1 (Database Migrations & Integration Tests)
**Date:** 2026-04-18
**Plan:** `docs/superpowers/plans/2026-04-18-office-worker-propose-edit.md` — Tasks 4, 5, 6, 7.
**Status:** Migrations + tests written; syntax verified; migrations NOT applied (local Supabase unavailable).

---

## Deliverables

| File | Status |
|------|--------|
| `supabase/migrations/20260420170000_office_worker_event_scope.sql` | Written, dry-run parse OK |
| `supabase/migrations/20260420170500_propose_any_venue.sql` | Written, dry-run parse OK |
| `supabase/migrations/20260420171000_reject_event_proposal_rpc.sql` | Written, dry-run parse OK |
| `supabase/migrations/__tests__/office_worker_event_scope.test.ts` | Written; 10 tests, gated `describe.skip` |
| `tasks/implement-plan/2026-04-20-office-worker-propose-edit/wave-1/M1/handoff.md` | This file |

SQL is copy-pasted verbatim from the plan's Task 4, 5, 6 blocks — no rewrites.

## Verification performed

- `npx supabase db push --dry-run` → exit 0, lists all three migrations (remote server only; no schema change).
- `npx tsc --noEmit` on the test file → clean.
- `npx eslint` on the test file → clean.
- `npx vitest run supabase/migrations/__tests__/office_worker_event_scope.test.ts` → 10 tests skipped (expected, gated).
- `npx vitest run` full suite → **599 passed, 10 skipped** — no regressions.

## Migrations NOT applied

Reason: The local Supabase stack is not running (Docker daemon is down), and `.env.local` points to the remote project `shofawaztmdxytukhozo.supabase.co`. Applying these migrations via `npx supabase db push` would push to the real backing database, which falls under the "explicit approval" bar in the project's safety rules (RLS replacement + trigger creation + RPC body swap). Per the agent brief, this is the documented fallback: migrations are written and parse-checked, application is left to the next step.

**Action for next operator:** When Docker is running or you are explicitly authorised to push to the linked project, run `npx supabase db push`. The dry-run output confirms the three files will be picked up in the correct order.

## Fixture assumptions (integration tests)

The 10 integration tests are defence-in-depth sanity checks; they hit a live Supabase with the migrations applied. Running them requires these env vars (all four gate the suite):

- `RUN_MIGRATION_INTEGRATION_TESTS=1`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optional; falls back to service role for client construction)
- `SUPABASE_OW_JWT` — a valid JWT for an `office_worker` user whose `users.venue_id` is set
- `SUPABASE_OTHER_OW_JWT` — a valid JWT for a **different** `office_worker` at a **different** venue

If any are missing, `describe.skip` takes over and the suite passes silently. This is intentional: the project does not yet have a reusable live-DB fixture harness, and dummy fixtures baked into the test file would require writing a whole auth bootstrap. `beforeAll` bootstraps the remaining fixtures against service role:

- Resolves `owId` / `otherOwId` from their JWTs via `admin.auth.getUser()`.
- Reads `venueA` / `venueB` from each OW's `users.venue_id`; asserts they are distinct.
- Finds or provisions an `office_worker` row with `venue_id = null` for the cross-venue RPC test.
- Creates a soft-deleted venue for the "deleted venue" RPC test.
- Creates a `pending_approval` event for the reject-RPC test.

`afterAll` deletes events and batch rows created during the run. Soft-deleted fixture venue is also cleaned up. No-venue OW row is intentionally left in place (likely pre-seeded and shared with other tests).

## Self-check

- [x] SQL matches the plan's exact text (verified by re-reading the plan after writing).
- [x] "managers create events" INSERT policy from `20250218000000_initial_mvp.sql:190` was NOT modified.
- [x] Proposal RPC preserves the `GRANT EXECUTE ... TO service_role` line.
- [x] `reject_event_proposal` validates `p_admin_id` against the `users` table and raises on non-admin.
- [x] Handoff honestly reports the "migrations not applied + tests skipped" status with reason.
- [x] No TypeScript files in `src/` were touched. Only the test file under `supabase/migrations/__tests__/` was added (that's SQL-tier owned by M1 per the brief).

## Commits produced

1. `feat(rls): office-worker event scope (SELECT/UPDATE + sensitive-updates trigger + event_artists)` — migration 1 only
2. `feat(rpc): proposal RPC any-venue + venue validation + re-entrant idempotency` — migration 2 only
3. `feat(rpc): atomic reject_event_proposal with admin validation` — migration 3 only
4. `test(rls): migration integration tests for office_worker event scope` — test file + this handoff

Each migration is in its own commit per the plan. Tests + handoff are the fourth commit.
