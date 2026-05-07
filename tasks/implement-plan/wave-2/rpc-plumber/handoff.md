# Wave 2 — RPC Plumber (B0 + B1 + B2) Handoff

## Summary

Landed three migrations that move event draft save and submit operations
into atomic SECURITY DEFINER RPCs, plus the persistent idempotency table
that backs both. All three are deployed to the linked BaronsHub project
(`shofawaztmdxytukhozo`) and visible in regenerated TypeScript types.

## Migrations & Commits

| Phase | Migration File | Commit |
|-------|---------------|--------|
| B0 | `supabase/migrations/20260507120000_event_save_idempotency_and_image_pending.sql` | `24deb69` |
| B1 | `supabase/migrations/20260507120001_save_event_draft_rpc.sql` | `b214345` |
| B2 | `supabase/migrations/20260507120002_submit_event_for_review_rpc.sql` (+ regenerated `src/lib/supabase/database.types.ts`) | `b011aa8` |

Timestamps `20260507120000`, `20260507120001`, `20260507120002` — sequential,
no collisions in `supabase/migrations/`.

## Deployment Verification

Verified in remote DB via MCP:

- `public.event_save_idempotency` table present with expected columns
  (`idempotency_key uuid`, `user_id uuid`, `event_id uuid nullable`,
  `response jsonb`, `created_at timestamptz`).
- `public.events.pending_image_attach text` column present and nullable.
- Routines `public.save_event_draft` and `public.submit_event_for_review`
  both registered (alongside the pre-existing `public.set_event_venues`
  helper used by B1).
- `event_artists` already has `UNIQUE (event_id, artist_id)`
  (`event_artists_event_id_artist_id_key`), so B0 did not need to add
  the constraint suggested in the brief — `ON CONFLICT (event_id, artist_id)
  DO NOTHING` in B1 binds to the existing key.

## Advisor Output (1-line summary)

`get_advisors({ type: "security" })`: 2 expected WARNs on each new RPC
(`anon_security_definer_function_executable`,
`authenticated_security_definer_function_executable`) — these are the
generic Supabase pattern WARN for any SECURITY DEFINER + EXECUTE-to-role
combination; both functions defend themselves via `auth.uid()` +
role/venue checks internally and explicitly REVOKE EXECUTE from public
then GRANT to authenticated. No other new advisors. All other warnings
are pre-existing (RLS-no-policy on `app_sessions`/`login_attempts`,
mutable `search_path` on legacy helpers, public `event-images` bucket,
auth leaked-password protection — same set seen in Wave 1 handoff).

## Typecheck

`npm run typecheck` exits 0. Regenerated `database.types.ts` (2689 lines)
exposes:

- `Tables.event_save_idempotency` (Row/Insert/Update + FK refs to
  `users.id` and `events.id`)
- `Tables.events.Row.pending_image_attach: string | null` (with matching
  Insert/Update permissivity)
- `Functions.save_event_draft` (4-arg signature)
- `Functions.submit_event_for_review` (5-arg signature including
  `p_assignee_id`)

## Schema Deviations from Plan Draft

1. **`event_artists` already had a unique constraint.** Brief said "if
   no existing PK/unique covers it, add one in B0." Live schema query
   showed `event_artists_event_id_artist_id_key UNIQUE (event_id,
   artist_id)`. B0 needed no constraint addition.

2. **`audit_log.entity_id` is `text`, not `uuid`.** Both RPCs cast
   `v_event_id::text` / `p_event_id::text` when inserting audit rows.
   This is documented in each migration's header comment.

3. **`events.created_by` is nullable.** The B1 INSERT explicitly sets
   `created_by = v_user_id` on create.

4. **B2 pre-validates required fields before UPDATE.** Plan draft let
   the `events_required_fields_after_proposal` CHECK constraint surface
   as a generic 23514. B2 inspects `event_type`, `venue_space`, `end_at`
   on the loaded row and returns `{ success: false, missing_fields: [...] }`
   before issuing the UPDATE.

5. **B2 per-row authz check added inline.** Plan only checked role; B2
   mirrors B1's full check (admin / creator / office_worker scoped to
   venue or global) so an office_worker cannot submit another venue's
   draft.

6. **B2 version snapshot computed in two steps.** Plan draft used
   `select to_jsonb(e.*) ... group by e.id, e.*` which is not valid
   PostgreSQL. Replaced with a `select coalesce(max(version)+1, 1)`
   then a separate `INSERT … SELECT to_jsonb(e.*)` from `events`.

## Self-Check

- [x] 3 commits in `git log --oneline -5` (`b011aa8`, `b214345`, `24deb69`).
- [x] `git status` shows only orchestration artifacts untracked
  (`tasks/implement-plan/plan.md`, `tasks/implement-plan/wave-1/`,
  this new handoff dir) plus the unrelated `next-env.d.ts` Next.js
  dev-server artifact.
- [x] `npm run typecheck` clean.
- [x] handoff.md written.
- [x] All three RPCs / table / column verified live in DB.
- [x] Advisors run; no new regressions beyond the expected
  SECURITY DEFINER WARN pattern that already covers every other RPC
  in this project.

## Notes for Wave 3 / Action-Layer Caller

- Both RPCs return `jsonb` with shape:
  `{ success: bool, event_id?: uuid, operation_id: uuid, ...,
     conflict?: true, missing_fields?: [...], failed?: [...] }`.
- On idempotent replay, the stored `response` is returned verbatim —
  including the original `operation_id`. Callers that propagate
  `operation_id` to UI toasts will see the *original* op id on retry,
  not the new one. This is intentional (the operation already happened).
- `save_event_draft` consumes `p_payload` keys in **snake_case** (the
  events column names). The action layer must translate camelCase form
  values via the existing `toDb()` helper before invoking.
- `set_event_venues` is only called when `array_length(v_venue_ids, 1) >= 1`
  to avoid silently orphaning a single-venue event during partial saves.
- Optimistic concurrency: pass `p_expected_updated_at` to lock to the
  client's last-known revision. NULL skips the check (use for first
  save of a new draft).
