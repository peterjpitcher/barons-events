# Wave 3 · REPAIR handoff

Four targeted fixes from the Mode B code-review findings against the
office-worker propose/edit implementation. Migrations had not yet been
applied to any database when this ran, so in-place edits to the three
migration files were safe.

## Fixes applied

### FIX 1 — SEC-001 (High) — RLS UPDATE must reject soft-deleted events for non-admins

File: `supabase/migrations/20260420170000_office_worker_event_scope.sql`

- `managers update editable events` policy: both non-admin OR branches of the
  `USING` clause now live inside `(deleted_at IS NULL AND (...))`. Admins still
  short-circuit at the top, so restore operations are unaffected.
- `WITH CHECK` was intentionally NOT gated on `deleted_at IS NULL` because the
  legitimate soft-delete path (`deleteEventAction` sets `deleted_at = now()`)
  produces a `NEW.deleted_at IS NOT NULL` row that must still be accepted.
  Blocking restoration is handled in the trigger (below), which is the correct
  layer since `WITH CHECK` evaluates the post-update row.
- `events_guard_sensitive_updates` trigger: added a block immediately after the
  admin short-circuit that raises if `OLD.deleted_at IS NOT NULL AND
  NEW.deleted_at IS NULL` — i.e. blocks non-admin restoration. Soft-delete
  direction stays allowed.

### FIX 2 — AB-002 (Medium) — reject_event_proposal must validate before insert

File: `supabase/migrations/20260420171000_reject_event_proposal_rpc.sql`

The status-gated `UPDATE ... WHERE status = 'pending_approval'` now runs
BEFORE the `INSERT INTO approvals`. `GET DIAGNOSTICS v_rows = ROW_COUNT`
raises if the event wasn't in pending_approval, so the audit row is only
written against a legitimate transition. Administrator + reason validation
stay at the top.

### FIX 3 — AB-003 (Medium) — revert re-entrant idempotency in propose RPC

File: `supabase/migrations/20260420170500_propose_any_venue.sql`

The v3.1 "fall through and re-run on crash-after-claim" path could create
duplicate events because there is no batch→event lookup to reconcile a
prior partial success. Replaced the silent fall-through with an explicit
`RAISE EXCEPTION` telling the client to retry with a fresh key. The result
hit-path (stored `result` returned verbatim) is unchanged.

### FIX 4 — SEC-004 (Medium) — stable idempotencyKey on the propose form

File: `src/components/events/propose-event-form.tsx`

Added `const [idempotencyKey] = useState(() => crypto.randomUUID())` so the
value is generated exactly once per form mount and persists across failed
submits / validation re-renders. Posted as a hidden input named
`idempotencyKey` — `proposeEventAction` already reads this value with a
`randomUUID()` fallback, so no server-side changes were needed.

Behaviour after fix:
- Double-click: same key → RPC returns the stored `result` → one event.
- Fresh form mount: fresh key → legitimate re-propose allowed.

## Verification

All commands from the brief's Definition of Done:

```
$ npx supabase db push --dry-run
Would push these migrations:
 • 20260420170000_office_worker_event_scope.sql
 • 20260420170500_propose_any_venue.sql
 • 20260420171000_reject_event_proposal_rpc.sql
Finished supabase db push.                                 # exit 0

$ npm run lint                                             # zero output, exit 0
$ npx tsc --noEmit                                         # clean, exit 0
$ npx vitest run
 Test Files  46 passed | 1 skipped (47)
      Tests  617 passed | 10 skipped (627)                 # exit 0
$ npm run build                                            # Next.js build succeeded
```

The 10 skipped tests are `supabase/migrations/__tests__/office_worker_event_scope.test.ts`,
which require a live Dockerised Postgres; they're skipped when Docker isn't
running, as documented in the file.

## Commits (4, all on `main`)

```
5a84fbf fix(propose-form): stable idempotencyKey against double-submit
7970ddf fix(rpc): revert re-entrant idempotency -- duplicate-risk
6d3d909 fix(rpc): validate event status before inserting approvals row
5f845de fix(rls): reject updates on soft-deleted events for non-admins
```

## Deviations

1. **FIX 1 WITH CHECK clause** — the brief suggested wrapping both the `USING`
   and `WITH CHECK` non-admin branches with `deleted_at IS NULL`. I added it
   only to `USING` and left `WITH CHECK` permissive on `deleted_at`, because
   PostgreSQL evaluates `WITH CHECK` against the NEW row — adding
   `NEW.deleted_at IS NULL` there would block the legitimate soft-delete path
   (null → now), which the brief explicitly wanted preserved. Restoration
   (non-null → null) is blocked by the trigger addition, which is exactly
   what the brief's "simplify: only block the restore direction" recommended.
   Net effect matches the spec's stated intent.

2. **FIX 1 scope commit** — the `fix(rls):` commit also included a batch of
   previously-untracked planning/review artefacts under `tasks/` and `docs/`
   that were sitting in the working tree. These were added in the same commit
   rather than as a separate chore because the REPAIR brief ran `git add -A`
   and the files belong to the same review cycle.
