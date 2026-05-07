# Claude Hand-Off Brief: Event Creation Reliability Spec

**Generated:** 2026-05-07
**Review mode:** A (adversarial, Codex-driven)
**Overall risk:** **HIGH** — spec needs revision before implementation
**Source:** [adversarial-review.md](2026-05-07-event-creation-spec-adversarial-review.md) — full reasoning + reviewer references

## DO NOT REWRITE (preserve from current spec)

- §1 problem statement and §2 flow map — diagnosis is correct.
- §3 findings table (C1–C7, H1–H5, M1–M5) as the bug catalogue. The findings are right; the *remediation* is what needs to change.
- §4 root-cause analysis (no transaction, error swallowing, prop-reset, no submit lock, dirty-flag bug, no correlation ID).
- §9 out-of-scope list (proposal status transitions, SOP gen, notifications, public API, debrief).
- The decision to keep image upload outside Postgres.
- The phased structure (immediate UX guardrails / deeper persistence / observability) — content of phases must change, structure can stay.

## SPEC REVISION REQUIRED (before any code)

- [ ] **R-1.** Insert a **criticality taxonomy** before §5 (see CR-2 in adversarial review). Classify each save sub-operation as Core / Compensatable / Optional. `events`, `event_artists`, `event_venues`, `event_versions`, `audit_log` are Core (fatal on failure). Image upload, SOP checklist generation are Compensatable (warning + retry token). Notifications, cache revalidation are Optional (warning, no retry).
- [ ] **R-2.** Rewrite Phase A so it does **not** introduce `warnings: string[]` for Core ops. Phase A failures still return `{success: false}` with the failed-step name and operation_id. Only Compensatable/Optional failures use `warnings[]` — and only after R-1 lands.
- [ ] **R-3.** Resolve the atomicity contradiction in Phase B (CR-3). Recommended: SAVEPOINTs are diagnostic-only — capture row-level errors then ROLLBACK the parent transaction. RPC returns `{ success: false, failed: [...] }` with **zero rows committed** on any Core failure.
- [ ] **R-4.** Change the RPC signature (CR-1). Drop the `user_id uuid` parameter. Use `auth.uid()` inside the function. Add: `SET search_path = public, pg_temp`, EXECUTE grant only to `authenticated` role, explicit role/venue authz block inside the function, payload allowlist mirroring `eventDraftSchema`.
- [ ] **R-5.** Add an **idempotency design** (CR-5). Action accepts `idempotency_key` from the form. RPC enforces unique `(idempotency_key, user_id)`. Second call with same key returns first call's result. Reuse the existing `event_creation_batches` table pattern, extend to single-venue create + edit.
- [ ] **R-6.** Specify the **image upload state machine** (CR-4). Deterministic path per event; second `UPDATE events SET event_image_path = ?` after upload; `events.pending_image_attach` column for upload-succeeded-but-attach-failed; daily cleanup cron reusing the `pending_cascade_backfill` lock/retry pattern.
- [ ] **R-7.** Bring the **submit flow** into the new RPC (CR-6). Either extend `save_event_draft` with `target_status` parameter or create a sibling `submit_event_for_review` RPC with the same shape.
- [ ] **R-8.** Either **fully cover the propose flow** in the same phases or split it into a separate spec (CR-7). Don't leave it in scope limbo.
- [ ] **R-9.** Add **optimistic concurrency** (CR-9). Form sends `expected_updated_at`; RPC checks `WHERE id = ? AND updated_at = ?`; mismatch returns a structured "conflict" error.
- [ ] **R-10.** Add a Phase A item: **migration to fix the RLS asymmetry** in M1 (CR-10). Office_workers must SELECT submitted events at their venue (or globally if `users.venue_id IS NULL`).
- [ ] **R-11.** Define the **prop-reset replacement** explicitly (CR-8). Use `<EventForm key={defaultValues.id ?? 'new'} />` at the parent. Audit all 4 listed `EventForm` consumers for `defaultValues` change behaviour.
- [ ] **R-12.** Define the **operation_id (correlation ID) lifecycle** end-to-end (CR-12). Generated client-side at form mount (UUID v7), passed into action, into RPC as parameter, written to `audit_log.meta.operation_id`, included in every `console.error`. User-visible form: short opaque hash (first 8 chars). Operator-only full ID.
- [ ] **R-13.** Replace the test strategy (CR-11). Add: local `supabase start` integration tests for the new RPC (success/RLS-denial/SAVEPOINT-rollback/idempotency), a real-DB concurrency test, supabase advisor in CI. Keep Vitest mocks for action branching and UI behaviour only.
- [ ] **R-14.** Reconsider the **JSONB RPC shape** (CR-13). Either typed columns instead of `payload jsonb`, or keep jsonb with a CHECK constraint mirroring Zod plus a CI test that asserts parity. Recommendation: typed columns — better fit for the codebase's typed-validation convention.
- [ ] **R-15.** Add a **Q0 to §8 open questions** (CR-14): "Confirm the criticality taxonomy in R-1." This must be answered before any other Q.
- [ ] **R-16.** Update §10 risk table to reflect the new sequencing (Spec revision → Phase A′ → Phase B′ → Phase B″ propose → Phase C′ verification, ~7.5 days vs the original ~5).

## ASSUMPTIONS TO RESOLVE (with the user, before R-1)

- [ ] **A-1 (was Q0).** Criticality taxonomy — see R-1. Are `event_artists`, `event_venues`, `event_versions`, `audit_log` Core or Compensatable in product terms?
- [ ] **A-2 (was Q1, now answerable after A-1).** Image upload failure — keep event saved with warning + retry, or roll back? Recommendation: keep + retry, given image is Compensatable.
- [ ] **A-3 (was Q2, now answerable after A-1 and CR-3).** Multi-venue partial — all-or-none (recommended; matches CR-3 resolution) or save-the-good-ones?
- [ ] **A-4 (was Q3).** Office_worker SELECT on own submitted events — yes (recommendation; resolves M1) or no?
- [ ] **A-5 (was Q4).** Operation IDs — user-visible short hash + operator-only full ID (recommendation), or operator-only entirely?
- [ ] **A-6 (was Q5).** Deploy drain for Phase B′ — needed (transactional save changes contract)?

## REPO CONVENTIONS TO PRESERVE

- Server actions return `{ success, message, fieldErrors }` per workspace standard. Extend with `operation_id` and (for non-Core failures) `warnings: string[]` — do not break callers.
- DB columns `snake_case`; TypeScript `camelCase` via `fromDb<T>()` helper. RPC parameter names use `p_` prefix (matches existing `set_event_venues`, `create_multi_venue_event_drafts`, `pre_approve_event_proposal`).
- All mutating actions call `logAuditEvent`; CI guard at `src/actions/__tests__/audit-coverage.test.ts` enforces presence — extend it to also assert no `.catch(() => {})` patterns in `src/actions/events.ts` (CR-2 reinforcement).
- Custom RBAC (`administrator` / `office_worker` / `executive`) — use capability functions in `src/lib/roles.ts`. The new RPC's authz block uses these, not raw role string checks.
- Colourblind safety: any new error/warning UI must pair colour with icon + text (per user memory).
- `src/lib/datetime.ts` for any new time fields. UTC in DB.
- New migrations follow the dated convention `supabase/migrations/YYYYMMDDHHMMSS_<slug>.sql`. Verify timestamps don't conflict.

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-15.** Re-build the review pack with `src/actions/events.ts` and `src/components/events/event-form.tsx` and the cited migrations included, then re-run this skill before implementation. The current pack only had the spec markdown — every C1–H5 / M1–M5 line:number claim is unverified by the reviewers.
- [ ] **A-1 closure.** After the user resolves the criticality taxonomy, re-review the revised spec end-to-end (single Assumption Breaker pass is enough; full team only if R-2 / R-3 / R-4 land differently than recommended).

## REVISION PROMPT (ready to execute)

```
Revise tasks/2026-05-07-event-creation-reliability-spec.md per the hand-off brief
at tasks/codex-qa-review/2026-05-07-event-creation-spec-claude-handoff.md.

Apply R-1 through R-16 in order. Stop after R-16 and present the revised spec
plus answers to A-1 through A-6 needed from the user before implementation can
proceed. Do NOT start any implementation; this is a spec-revision pass.

Once the spec is revised, build a fresh review pack INCLUDING the source files
src/actions/events.ts, src/components/events/event-form.tsx, and the cited
migrations under supabase/migrations/, and re-run the codex-qa-review skill in
Mode A with the revised spec. Address any new blocking findings before declaring
the spec ready for implementation.
```
