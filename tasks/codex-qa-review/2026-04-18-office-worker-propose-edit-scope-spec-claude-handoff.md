# Claude Hand-Off Brief: Office Worker Propose & Edit Scope

**Generated:** 2026-04-18
**Review mode:** A (Adversarial Challenge) — spec only, no implementation yet
**Overall risk:** **High** — 7 blocking defects; spec should not be implemented as written

## DO NOT REWRITE

Preserve these decisions from the original spec when revising:

- The split of `canManageEvents` into `canProposeEvents` (role-only) + `canEditEvent` (per-event contextual).
- Reuse of `events.manager_responsible_id` as the per-event authority.
- Shipping app guards and RLS together in one PR.
- The pre-deploy audit query that quantifies how many events become uneditable.
- SELECT RLS becoming a simple role-only check + `deleted_at IS NULL` for all three roles.
- Adding a real capability check to `proposeEventAction` (which currently only verifies `!user`).
- Retaining creator self-service on `draft`/`needs_revisions` events **once R-001 is fixed**.

## SPEC REVISION REQUIRED

Apply these revisions before any implementation begins. Cross-refs to the full report: `2026-04-18-office-worker-propose-edit-scope-spec-adversarial-review.md`.

- [ ] **R-001** Reorder `canEditEvent` so role check precedes creator clause; scope the RLS creator branch to `current_user_role() IN ('administrator','office_worker')`.
- [ ] **R-002** Expand the spec's "page gating" and "server-action changes" sections to explicitly: (a) show all venues in `/events/new` for office_workers, (b) drop the `!user.venueId` hard-stop in `saveEventDraftAction` / `submitEventForReviewAction`, (c) drop the cross-venue rejection. List tests covering office_worker-no-venue-any-venue and office_worker-with-venue-different-venue.
- [ ] **R-003** Specify a shared `loadEventEditContext(eventId)` helper that fetches `{ id, venue_id, manager_responsible_id, created_by, status, deleted_at }` via service-role, used by every action guarded with `canEditEvent`.
- [ ] **R-004** Run `SELECT schemaname, tablename, policyname, ... FROM pg_policies WHERE definition ILIKE '%events%'` now, paste the result into the spec, and record a per-policy decision: keep / tighten / intentionally-different.
- [ ] **R-005** Add a BEFORE UPDATE trigger (or per-column grant strategy) on `public.events` that prevents non-administrator sessions from changing `venue_id`, `manager_responsible_id`, or `created_by`. Include DDL in the migration.
- [ ] **R-006** Inspect the active INSERT policy on `public.events`; include its current body in the spec and, if venue-scoped, add a new INSERT policy permitting `administrator` and `office_worker` for any venue with `WITH CHECK (created_by = auth.uid() AND status IN ('draft','pending_approval'))`.
- [ ] **R-007** Decide: either (a) assert `submitEventForReviewAction` uses the service-role client for the draft→pending_approval transition (and add a test), or (b) widen `WITH CHECK` to include `'pending_approval'` for the creator clause. Bake the choice into the spec.
- [ ] **R-008** Classify each affected call-site explicitly in the spec: edit (use `canEditEvent`) / lifecycle — cancel/delete/restore (decide: `canEditEvent` or admin-only?) / public configuration — booking settings, slug, website-copy (decide scope). Don't leave this to the implementer.
- [ ] **R-009** Delete the "temporary deprecated re-export" sentence in the helper section. Keep the DoD item "`canManageEvents` removed in same PR" as the single authoritative rule.
- [ ] **R-010** Include `deleted_at` in `EventEditContext`; require `canEditEvent` (or the loader) to reject soft-deleted rows.

## IMPLEMENTATION CHANGES REQUIRED (after spec is revised)

Apply in the order R-001 → R-013 listed in the review. Blocking items must all be closed before merge; non-blocking are acceptable as follow-ups.

- [ ] **R-011** Make `preRejectEventAction` atomic: wrap insert-then-update in a single RPC, or check insert errors + verify update row-count. File: [src/actions/pre-event.ts:139](src/actions/pre-event.ts:139).
- [ ] **R-013** Add active/soft-delete validation for `venueIds` in `proposeEventAction` (or confirm RPC does it). File: [src/actions/pre-event.ts:37](src/actions/pre-event.ts:37).
- [ ] **R-012** (follow-up, not this PR) Audit `updateBookingSettingsAction` for atomic write boundaries. File: [src/actions/events.ts:2008](src/actions/events.ts:2008).

## ASSUMPTIONS TO RESOLVE

- [ ] Can any code path insert events with `created_by` pointing to an executive user? Grep: `insert('events')`, `.from('events').insert`, every RPC in `supabase/migrations/` that writes events.
- [ ] For each `canManageEvents` call-site, which client does it use (`createSupabaseActionClient` or `createSupabaseAdminClient`)? Determines whether RLS enforces or bypasses.
- [ ] Does `create_multi_venue_event_proposals` RPC validate venue existence and `deleted_at`? Read the RPC body — attach to spec.
- [ ] For the draft→pending_approval submit transition, is `submitEventForReviewAction` using service-role today? Grep the function body.
- [ ] Should office_workers who are manager_responsible_id be able to toggle public booking (slug generation, SMS reminders, capacity limits)? Product call for R-008 classification.

## REPO CONVENTIONS TO PRESERVE

- Capability helpers live in [src/lib/roles.ts](src/lib/roles.ts); keep new helpers there.
- Server-action return type: `Promise<{ success?: boolean; error?: string; message?: string }>` — maintain.
- Audit logging (`recordAuditLogEntry` / `logAuditEvent`) on every mutation — don't drop for the new paths.
- `fromDb<T>()` snake_case↔camelCase conversion at the data boundary.
- Migration idempotency: `DROP POLICY IF EXISTS … CREATE POLICY …` pattern.
- Defence in depth: UI hide + server action check + RLS predicate, all three.
- Tests: Vitest with mocked Supabase / Resend, in `src/**/__tests__/` co-located with source. Coverage target 90% on `src/lib/roles.ts`.
- British English in all user-facing copy ("Authorise", "Cancel").

## RE-REVIEW REQUIRED AFTER FIXES

After the spec is revised, re-run the adversarial review **focused on the revision** (smaller pack, Mode A). Specifically verify:

- [ ] **R-001**: Test cases exist proving an executive with `created_by` on a draft cannot edit.
- [ ] **R-002**: Tests for office_worker-no-venue-any-venue and cross-venue submission.
- [ ] **R-004**: `pg_policies` output is quoted in the spec with per-row decisions.
- [ ] **R-005**: Trigger DDL is present in the migration.
- [ ] **R-007**: Draft→pending_approval transition has a test proving it works after the RLS change.
- [ ] **R-006**: INSERT policy is documented and updated if needed.

Once the revised spec passes re-review, proceed to implementation. Do not skip the re-review — several of these defects are deeply coupled (R-001, R-005, R-007 all touch the creator-draft path, which is easy to get wrong in combination).

## REVISION PROMPT (ready to use)

Use this prompt to have Claude revise the spec:

```
Revise the spec at docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md to address the findings in tasks/codex-qa-review/2026-04-18-office-worker-propose-edit-scope-spec-adversarial-review.md.

Specifically:
1. Fix the canEditEvent helper so role check precedes creator clause; update the RLS creator branch to require current_user_role() IN ('administrator','office_worker').
2. Expand the "Page Gating Changes" and "Server-Action Changes" sections to explicitly remove office_worker venue pinning in the full-event create path (both /events/new page and saveEventDraftAction / submitEventForReviewAction). Add test cases for no-venue and cross-venue submissions.
3. Introduce a shared loadEventEditContext helper and mandate its use; include deleted_at in the context.
4. Run the pg_policies query now, paste results into the spec, and make a per-policy decision.
5. Add trigger DDL blocking non-admin changes to venue_id / manager_responsible_id / created_by.
6. Document the current INSERT policy on public.events and whether it needs changing.
7. Resolve the draft→pending_approval transition explicitly (service-role assertion or widened WITH CHECK).
8. Classify each affected canManageEvents call-site (edit / lifecycle / public config) and specify which capability it uses.
9. Delete the "temporary deprecated re-export" sentence for canManageEvents.
10. Add the pre-existing preRejectEventAction atomicity fix to the scope.

Keep: the overall capability split, manager_responsible_id authority, shipping app+RLS together, the audit query, and creator self-service (once reordered).

After revising, write a short changelog section at the top of the spec summarising the revisions.
```
