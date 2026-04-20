# Adversarial Review: Office Worker Propose & Edit Scope

**Date:** 2026-04-18
**Mode:** A (Adversarial Challenge)
**Scope:** Spec at `docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md` covering the `canManageEvents` split, full-form/propose gating changes, and RLS migration for `public.events`.
**Pack:** `tasks/codex-qa-review/2026-04-18-office-worker-propose-edit-scope-spec-review-pack.md` (78 KB — includes the spec and current state of referenced files)
**Reviewers:** Codex — Assumption Breaker, Integration & Architecture, Security & Data Risk, Workflow & Failure-Path (4 of 4 returned structured findings)

## Executive Summary

Direction is sound: splitting `canManageEvents` into `canProposeEvents` + contextual `canEditEvent`, reusing `events.manager_responsible_id`, and moving app and RLS changes in lockstep all fit the project's existing defence-in-depth pattern. However, the spec as written contains **seven blocking gaps** that would either break the new "any venue" propose rule in practice or introduce authorization bypasses at the database layer. The most material gaps cluster around (a) the helper's creator-draft clause leaking to non-editable roles, (b) the full-event create path keeping its old venue-pinning logic, (c) the proposed UPDATE `WITH CHECK` not preventing field-level sensitive-column changes, and (d) INSERT/secondary-table RLS policies being deferred rather than specified. The spec needs a revision round before implementation.

## What Appears Solid

Preserve these decisions:

- **Adding an explicit capability check to `proposeEventAction`** closes the current auth gap where the action only checked `!user` before calling a service-role RPC ([src/actions/pre-event.ts:37](src/actions/pre-event.ts:37)).
- **Moving from a role+venue capability to a per-event contextual capability** is the right shape for the business rule.
- **Reusing `events.manager_responsible_id`** as the per-event authority fits the schema from [supabase/migrations/20260416210000_manager_responsible_fk.sql](supabase/migrations/20260416210000_manager_responsible_fk.sql) instead of introducing a parallel assignment model.
- **Shipping the app guard and RLS together** in one PR, with a pre-deploy audit query to quantify how many events would become uneditable, is the right risk posture.
- **SELECT RLS keeping `deleted_at IS NULL`** while flattening to a role-only check preserves soft-delete protection at the read layer.
- **Retaining creator self-service for `draft`/`needs_revisions`** (once the role-leak bug is fixed) keeps the proposer's pre-approval self-service flow working.

Do not rewrite these during the revision.

## Critical Risks

### R-001 — `canEditEvent` creator clause leaks edit rights to non-editable roles (High, Blocking)

**Reviewers:** AB-001, ARCH-002, SEC-001, WF-008.

The helper returns true for `event.createdBy === userId && status IN ('draft','needs_revisions')` **before** the `if (role !== "office_worker") return false` check. An `executive` — or any future read-only role — who is `created_by` on a draft event can therefore edit it, contradicting the spec's own role matrix ("Executive edit existing event: No") at spec line 36. The same bypass exists in the proposed UPDATE RLS policy, which has no role predicate on the creator clause.

**Why it matters:** Executives may be ruled out today because UI doesn't let them create events, but (a) legacy / imported rows, (b) role downgrades of an existing creator, and (c) future server-side insertion paths all reach the same bypass. "Cannot happen through UI" is not a security argument once the database backstop also misses the check.

**What to fix:** Reorder the helper so the role gate precedes the creator clause, and mirror the change in the RLS policy by scoping the creator branch to `administrator` and `office_worker` explicitly:

```sql
OR (
  public.current_user_role() IN ('administrator', 'office_worker')
  AND auth.uid() = created_by
  AND status IN ('draft', 'needs_revisions')
)
```

### R-002 — Full-event create path still pins office_workers to their own venue (High, Blocking)

**Reviewers:** AB-002, AB-005, ARCH-001, SEC-002, WF-001.

The spec switches the top-level guard at `/events/new` and in `saveEventDraftAction` / `submitEventForReviewAction` from `canManageEvents` → `canProposeEvents`, but it does **not** call out removing the deeper venue-pinning logic. Today:

- [src/actions/events.ts:1048](src/actions/events.ts:1048): `venueIds = user.role === "office_worker" ? (user.venueId ? [user.venueId] : []) : requestedVenueIds` — silently rewrites to `[]` for office_workers without a venue, blocking submission.
- [src/actions/events.ts:1104](src/actions/events.ts:1104): hard-rejects office_workers whose requested venueId differs from their own `user.venueId`.
- [src/app/events/new/page.tsx](src/app/events/new/page.tsx): `availableVenues = ... user.role === "office_worker" ? venues.filter(v => v.id === user.venueId) : venues` — the picker only shows the home venue.

Net effect: changing only the guard leaves the feature half-built. Office_workers without a venue still can't submit; office_workers with a venue still can't pick another one.

**What to fix:** Spec must explicitly list the venue-selection changes:
1. `/events/new` page: show all venues to office_workers, default-select `user.venueId` if present.
2. `saveEventDraftAction` + `submitEventForReviewAction`: honour submitted `requestedVenueIds` for all office_workers; drop the `!user.venueId` hard-stop on create; drop the cross-venue rejection.
3. Tests covering: office_worker without venue submitting for any venue; office_worker with venue submitting for a different venue.

### R-003 — Update actions must load a complete `EventEditContext`, not the partial rows they fetch today (High, Blocking)

**Reviewers:** SEC-003, WF-002.

Several existing update actions fetch a minimal projection before the old `canManageEvents` check:

- [src/actions/events.ts:2022](src/actions/events.ts:2022) `updateBookingSettingsAction` — selects `id, title, start_at, venue_id, seo_slug` only.
- [src/actions/events.ts:1856](src/actions/events.ts:1856) `deleteEventAction` (approx.) — selects `id, created_by, status, event_image_path`.

If the spec's generic "load the event and call `canEditEvent`" is taken literally, `manager_responsible_id` and `status` / `venue_id` respectively will be `undefined` → the helper's `event.managerResponsibleId !== userId` rejects an otherwise-valid office_worker, producing false denies. Alternatively, a lenient implementation might only spot-check what it already fetches, silently leaving the manager-responsible requirement unenforced.

**What to fix:** Introduce a shared helper (e.g. `loadEventEditContext(eventId)`) that always returns `{ id, venue_id, manager_responsible_id, created_by, status, deleted_at }` via the service-role client. Mandate its use in every mutation that guards with `canEditEvent`. Include `deleted_at` so the code can keep enforcing what SELECT RLS used to (see R-010).

### R-004 — Secondary-table RLS policies must be specified, not deferred (High, Blocking)

**Reviewers:** AB-008, ARCH-004, SEC-004, WF-004.

The spec lists `event_artists`, `event_versions`, `approvals`, planning tables, etc. as "to be revisited" and provides only a `pg_policies` discovery query. With SELECT being globally loosened for all three roles, any related-table write policy still keyed on the old "venue_id matches" rule becomes a lateral edit path: an office_worker who cannot edit `events` directly can still mutate artist links, planning rows, or approvals for events they should only read.

**What to fix:** Spec revision — run the discovery query **now** and enumerate the outcome in the spec itself, one row per policy: "keep / tighten to manager_responsible_id match / mark intentionally different". Ship the tightening SQL in the same migration. Do not defer to a follow-up PR.

### R-005 — `WITH CHECK` doesn't constrain field-level changes to `venue_id` or `manager_responsible_id` (High, Blocking)

**Reviewers:** AB-004, SEC-005.

The proposed UPDATE policy evaluates the *new row*'s `venue_id = user.venue_id AND manager_responsible_id = auth.uid()`. It allows two abuse shapes:

1. **Venue transfer:** an office_worker who is `manager_responsible_id` at venue A submits an update that moves the event to venue B **and** keeps themselves as manager. `USING` passes (old row is at venue A where they're the manager), `WITH CHECK` passes iff they set `venue_id = user.venue_id = A` — so B→A moves would fail, but A-stays with side-effects on other columns pass. Worse: if the policy is `WITH CHECK (... AND venue_id = user.venue_id ...)` and `user.venue_id` is still A, then any update that preserves venue_id passes regardless of other mutations.
2. **Draft field escalation:** the creator-draft clause has no field constraint. A creator can set `manager_responsible_id = themselves` on their own draft, guaranteeing continued edit access after admin approval flips status off draft.

**What to fix:** Either (a) add a BEFORE UPDATE trigger on `public.events` that rejects changes to `venue_id`, `manager_responsible_id`, or `created_by` for non-administrator sessions, or (b) split the policy by operation (use per-column grants so non-admins cannot touch those columns). Document which approach is chosen.

### R-006 — INSERT RLS policies not covered by the spec (High, Blocking)

**Reviewer:** AB-003.

The spec updates SELECT and UPDATE policies on `public.events` but shows no INSERT policy review. The new rule requires office_workers without `venue_id` to create drafts and proposals. If the current INSERT policy mirrors the old venue-scoped `canManageEvents` model, non-service-role paths that `INSERT` into `events` will fail at the DB layer even after the app guard is loosened. The `proposeEventAction` uses the service-role client so *that* path works — but `saveEventDraftAction` and `submitEventForReviewAction` use action clients that respect RLS.

**What to fix:** Inspect and document the active INSERT policy on `public.events` in the spec. If it is venue-scoped, add an INSERT policy permitting `administrator` and `office_worker` for any venue, with appropriate `WITH CHECK` bounds on `created_by = auth.uid()` and `status IN ('draft', 'pending_approval')`.

### R-007 — `WITH CHECK` blocks creator draft→submit status transition (High, Blocking)

**Reviewer:** ARCH-003.

The proposed UPDATE policy's `WITH CHECK` requires creator-owned rows to end in `status IN ('draft', 'needs_revisions')`. A creator flipping a draft to `pending_approval` (the normal "submit for review" transition) fails the `WITH CHECK` predicate: the new row has `status = 'pending_approval'` → creator clause fails → unless the administrator clause or office_worker clause passes, the row cannot be written.

**What to fix:** Decide the enforcement strategy and bake it into the spec:
- **Option A:** Rely on `submitEventForReviewAction` using the service-role client to bypass RLS for the submit transition. Requires an explicit assertion in the spec that this path is service-role, plus a test.
- **Option B:** Widen the WITH CHECK to allow the creator→pending_approval transition: `status IN ('draft', 'needs_revisions', 'pending_approval')`.

Option A is cleaner (keeps RLS strict) but requires the action to be audited.

## Architecture & Integration Defects

### R-008 — Not every `canManageEvents` call-site is an "edit" operation (Medium, Blocking)

**Reviewer:** AB-007.

`updateBookingSettingsAction` (slug, booking enablement), cancellation/delete, image upload, and generated website-copy are all currently gated on `canManageEvents`. The spec's one-line rule "migrate every call-site to `canEditEvent`" conflates three classes:

- **Lifecycle** (cancel, delete, restore) — is this `canEditEvent` or should it stay admin-only?
- **Public-facing configuration** (booking settings, slug, website copy) — should an office_worker who is manager_responsible_id be able to toggle public booking?
- **Metadata** (image, description, title) — clear `canEditEvent`.

**What to fix:** Classify each affected action in the spec; don't leave it to the implementer. This is a product/human decision, not a coding one.

### R-009 — Spec contradicts itself on `canManageEvents` removal timing (Medium, Blocking)

**Reviewers:** AB-006, ARCH-006, WF-005.

One section says "Keep the old name as a deprecated re-export temporarily"; the Risks and Definition of Done say "Remove `canManageEvents` in the same PR — no temporary alias". The latter is safer — the compiler becomes the call-site audit tool — but the contradiction lets an implementer pick either.

**What to fix:** Delete the "temporary re-export" sentence. Require removal in the same PR.

## Workflow & Failure-Path Defects

### R-010 — Deleted-row protection shifts from RLS to code without being specified (Medium, Non-blocking)

**Reviewer:** ARCH-005.

Pre-loading the event via service-role client bypasses the `deleted_at IS NULL` protection that SELECT RLS enforces today. The proposed `EventEditContext` has no `deletedAt` field, so a soft-deleted event could pass `canEditEvent` if the edit action doesn't re-check.

**What to fix:** Include `deleted_at` in `EventEditContext` and have `canEditEvent` return false when `event.deletedAt !== null`. Alternatively, require the shared loader to `.is('deleted_at', null)`.

### R-011 — Proposal rejection is non-atomic (Medium, Blocking — pre-existing but in scope)

**Reviewer:** WF-003.

[src/actions/pre-event.ts:139](src/actions/pre-event.ts:139) inserts into `approvals` then updates `events.status` in two separate round-trips without checking the insert error. If the insert succeeds but the status update fails (or matches zero rows because the event moved out of `pending_approval` concurrently), the event stays pending with a stray rejection row.

**What to fix:** Either move rejection into an atomic RPC (`reject_event_proposal(event_id, admin_id, reason)`) or explicitly check the insert error and verify the status update affected exactly one row. Touch this now since the spec is already editing the same file.

### R-012 — Booking-settings atomicity needs verification (Medium, Non-blocking)

**Reviewer:** WF-006.

[src/actions/events.ts:2008](src/actions/events.ts:2008) appears to split slug generation and booking field updates across steps. Out of scope for this PR, but the review flagged it while reading adjacent code — worth a follow-up task.

## Security & Data Risks

### R-013 — `proposeEventAction` doesn't validate that venue IDs are active/selectable (Medium, Non-blocking)

**Reviewers:** AB-009, SEC-006, WF-007.

The action passes caller-supplied `venueIds` to `create_multi_venue_event_proposals` via the service-role client. UUID shape is validated; active/soft-deleted status is not. If the RPC also doesn't validate (body not in pack), office_workers could seed proposals for decommissioned venues.

**What to fix:** Either add a pre-check against `listVenues()` / active criteria in the action, or verify and document that the RPC rejects missing/deleted venues. Follow-up if not already covered.

## Unproven Assumptions

Claims in the spec that depend on things not in the pack — resolve before implementation:

1. **Spec claim:** Executives cannot create events today, so the creator-draft leak is unreachable. **Would resolve by:** grepping all event-insert paths (server actions, RPCs, webhooks, seeders) and confirming none permit executive `created_by`.
2. **Spec claim:** RLS and app code will "ship together" — implicit assumption that the create path uses a RLS-respecting client. **Would resolve by:** enumerating the client type (action vs. admin) for each touched action in the spec.
3. **Spec claim:** `create_multi_venue_event_proposals` RPC handles venue-active validation. **Would resolve by:** reading the RPC body and adding its contract to the spec.
4. **Spec claim:** Secondary-table policies are "mostly already aligned". **Would resolve by:** running the `pg_policies` discovery query and pasting the result.

## Recommended Fix Order

1. **R-001** — reorder `canEditEvent` helper + tighten RLS creator clause (simplest, smallest).
2. **R-009** — delete the `canManageEvents` temporary-alias sentence.
3. **R-007** — decide service-role vs widen `WITH CHECK` for draft→submit transition.
4. **R-005** — add trigger or column grants blocking non-admin changes to `venue_id`/`manager_responsible_id`/`created_by`.
5. **R-002** — enumerate full-event create-path venue-selection changes in spec + tests.
6. **R-003** — introduce `loadEventEditContext` helper + update touched actions.
7. **R-006** — inspect and specify INSERT RLS policy for `public.events`.
8. **R-004** — run `pg_policies` query, enumerate secondary-table outcomes in spec.
9. **R-008** — classify each affected call-site (edit / lifecycle / public config).
10. **R-010** — include `deleted_at` in `EventEditContext`.
11. **R-011** — make proposal rejection atomic (RPC or explicit error checks).
12. **R-013** — document / add venue validity check in propose flow.
13. **R-012** — follow-up task, not in this PR.

## Minor Observations

None beyond the 13 above — reviewers' `empty_categories` were consistent: no schema churn, no new secrets/PII, no performance concerns, no circular-dependency risk, no external API / webhook replay exposure introduced by the change itself.

## Counts

| Reviewer | Findings | Blocking | Severities (C/H/M/L) |
|----------|---------:|---------:|----------------------|
| Assumption Breaker | 9 | 6 | 0 / 4 / 4 / 1 |
| Integration & Architecture | 6 | 4 | 0 / 4 / 2 / 0 |
| Security & Data Risk | 6 | 5 | 0 / 4 / 2 / 0 |
| Workflow & Failure-Path | 8 | 5 | 0 / 2 / 5 / 1 |
| **After dedup** | **13** | **9** | **0 / 7 / 5 / 1** |
