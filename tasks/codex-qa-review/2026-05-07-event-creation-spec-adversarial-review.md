# Adversarial Review: Event Creation Reliability Spec

**Date:** 2026-05-07
**Mode:** A (Adversarial Challenge)
**Scope:** [tasks/2026-05-07-event-creation-reliability-spec.md](../2026-05-07-event-creation-reliability-spec.md)
**Pack:** [2026-05-07-event-creation-spec-review-pack.md](2026-05-07-event-creation-spec-review-pack.md) (27 KB)
**Reviewers:** Assumption Breaker, Integration & Architecture, Workflow & Failure-Path, Security & Data Risk
**Total raw findings:** 39 → deduped to **15 material**

## Executive summary

The spec correctly diagnoses the user-visible symptoms (no-transaction sequential writes, swallowed errors, prop-reset clobber, no double-submit guard, dirty-flag never cleared) and frames a sensible three-phase shape. However, **as written it is not safe to implement.** Three critical issues recur across all four reviewers:

1. The proposed `save_event_draft(payload, user_id)` RPC takes a caller-supplied `user_id` under `SECURITY DEFINER`. That is a privilege-escalation pattern — it must derive identity from `auth.uid()`.
2. Phase A's `warnings[]` channel turns silent partial failures into *visible* partial failures, but still allows the action to return `success: true`. That institutionalises partial-success in the UI, contracts, and tests, making Phase B harder rather than safer. **Phase A is not independently deployable as written.**
3. Phase B's transaction design is internally contradictory: it claims "all or nothing" *and* "per-row SAVEPOINTs with warnings". Those are mutually exclusive contracts.

There are also material scope gaps: `submitEventForReviewAction` shares the same problems but is not in the new RPC; the propose flow is barely touched; concurrent-editor stale writes are not addressed; the RLS asymmetry (M1) is identified but no phase task fixes it; and the test strategy (mocked Supabase) cannot validate the database-level guarantees the spec promises.

**Overall risk: HIGH.** Spec revision required before any implementation begins.

## What appears solid (preserve in revision)

- Identifying the right root-cause cluster: no transaction boundary, pervasive error swallowing, form-state reset on prop change, no submit lock, no correlation ID, dirty-flag bug ([spec §4](../2026-05-07-event-creation-reliability-spec.md)).
- Keeping Supabase Storage outside the Postgres transaction — correctly recognises the impedance mismatch.
- Keeping notification dispatch non-blocking, matching project convention from `src/lib/notifications.ts`.
- Auth → permission → Zod ordering before any DB write.
- The phased shape (immediate UX guardrails / deeper persistence / observability) is sensible *as a structure* — it just needs different content in Phase A.

## Critical risks (15 deduped findings)

### CR-1 — RPC accepts caller-supplied `user_id` under SECURITY DEFINER
**Severity:** Critical · **Confidence:** High · **Blocking** · **Reviewers:** AB-004, ARCH-002, SEC-001
**Spec line:** [tasks/2026-05-07-event-creation-reliability-spec.md:132](../2026-05-07-event-creation-reliability-spec.md)

The RPC is specified as `save_event_draft(payload jsonb, user_id uuid)` SECURITY DEFINER. A SECURITY DEFINER function bypasses RLS by design, and accepting `user_id` as a parameter means a malicious or buggy caller could assert another user's identity. Combined with `payload jsonb` (no DB-side schema), this is a privileged catch-all entry point.

**What would confirm a fix:** RPC signature changes to `save_event_draft(payload jsonb)` and the body uses `auth.uid()` for identity, with explicit `SET search_path = public, pg_temp`, an EXECUTE grant only to the `authenticated` role, a venue/role authorisation block inside the function, and a payload allowlist that mirrors `eventDraftSchema`.

### CR-2 — Phase A `warnings[]` normalises partial-success; not independently deployable
**Severity:** High · **Confidence:** High · **Blocking** · **Reviewers:** AB-002, ARCH-005, WF-002, SEC-002
**Spec lines:** [§5 Phase A item 5, §6 acceptance](../2026-05-07-event-creation-reliability-spec.md)

The spec's Phase A says "no user thinks a failure was a success" but the proposed mechanism is `warnings: string[]` with `success: true`. Today's bugs cause partial saves; Phase A as written makes them *visible* partial saves, then trains UI, tests, and users to accept them. By the time Phase B arrives, "core saved + audit/venue/artist failed" is part of the contract.

**The fix is a criticality taxonomy that must be added BEFORE Phase A:**

| Operation | Class | Failure handling |
|---|---|---|
| `events` row insert/update | Core | Fatal — return `success: false`, no warning class |
| `event_artists` link writes | Core | Fatal |
| `event_venues` link writes | Core | Fatal |
| `event_versions` snapshot | Core | Fatal (audit trail integrity) |
| `audit_log` row | Core | Fatal |
| Image upload | Compensatable | Warning + persisted retry token |
| Notification email | Optional | Warning, no retry needed |
| Cache `revalidatePath` | Optional | Warning |
| SOP checklist generation | Compensatable | Warning + queued backfill (existing `pending_cascade_backfill` pattern) |

`warnings[]` exists *only* for Compensatable + Optional. Anything in Core failing returns `success: false` with the failed-step name and correlation ID.

### CR-3 — Atomicity vs SAVEPOINT internal contradiction
**Severity:** High · **Confidence:** High · **Blocking** · **Reviewers:** AB-005, ARCH-003, WF-008, SEC-003
**Spec lines:** [§5 Phase B items 1 & 4, §6 acceptance bullet 4](../2026-05-07-event-creation-reliability-spec.md)

Phase B says (a) wrap everything in a single transaction with all-or-nothing semantics; (b) use SAVEPOINT per artist/venue so a single bad row produces a structured error rather than rolling back; (c) acceptance requires multi-venue saves to be all-or-none. Pick one — these contracts can't all hold.

**Recommended resolution:** SAVEPOINTs are used **only to capture diagnostics**, not to commit. Each SAVEPOINT wraps one artist or one venue write; on error, ROLLBACK TO SAVEPOINT, capture the row identifier and Postgres error, raise at the end so the parent transaction rolls back the whole event. The RPC returns `{ success: false, failed: [{venue_id, reason}, ...] }` with **zero rows committed**. This satisfies (a) and (c) and gives users a structured error; it abandons (b)'s "warnings + commit" interpretation.

### CR-4 — Image upload workflow incomplete (split-brain)
**Severity:** High · **Confidence:** High · **Blocking** · **Reviewers:** AB-006, ARCH-004, WF-007, SEC-006
**Spec line:** [§5 Phase B item 1 (last clause), Q1](../2026-05-07-event-creation-reliability-spec.md)

The spec says image upload happens after the RPC and shows a warning on failure. It does not specify: object naming/ownership, the second DB attach step, retry token storage, orphan cleanup, idempotent re-upload, or behaviour when upload succeeds but DB attach fails.

**What's missing:** A complete state machine. Recommended:
- Image path is deterministic per event (`event-images/<event_id>/<random>.jpg`).
- After RPC commits, upload is attempted; on success, a second `UPDATE events SET event_image_path = ?` runs.
- If upload succeeds but UPDATE fails, the orphan path is recorded in a new `events.pending_image_attach` column for a daily cleanup cron (reuses the `pending_cascade_backfill` pattern in the codebase).
- If upload fails, return `warnings: ['image-not-attached']` plus a re-upload affordance in the UI.
- Idempotency: re-uploading uses the same path, overwriting (Supabase Storage supports `upsert: true`).

### CR-5 — Server-side idempotency missing; client `isPending` is insufficient
**Severity:** High · **Confidence:** High · **Blocking** · **Reviewers:** AB-007, WF-003, SEC-004
**Spec line:** [§5 Phase A item 1, §6 acceptance bullet 1](../2026-05-07-event-creation-reliability-spec.md)

`disabled={isPending}` does not satisfy "exactly one server action invocation". Bypasses include: Enter-key submit, browser retry on 502, double-tab, programmatic submit, action being called from a non-disabled path. The codebase already has the right pattern in `event_creation_batches.idempotency_key` for the multi-venue propose flow — extend it to single-venue create and edit.

**What would confirm a fix:** Server action accepts an `idempotency_key` from the form, RPC has a unique index on `(idempotency_key, user_id)`, second call with same key returns the first call's result. Client generates the key once at form mount, regenerates on explicit "new event".

### CR-6 — Submit flow has same problems but isn't covered by new RPC
**Severity:** High · **Confidence:** High · **Blocking** · **Reviewers:** WF-004
**Spec lines:** [§2.1 entry-point table, §5 Phase B](../2026-05-07-event-creation-reliability-spec.md)

The spec maps both `saveEventDraftAction` and `submitEventForReviewAction` as entry points but Phase B's RPC only covers `save_event_draft`. The submit flow ALSO calls artist sync, venue sync, version append, and audit log — same partial-write surface area, same silent failures.

**Recommended:** Either extend `save_event_draft` to take a `target_status` parameter (covering both draft and submit) and call it from both actions, or define a sibling `submit_event_for_review` RPC with the same atomic shape. Don't fix half the problem.

### CR-7 — Propose flow under-specified
**Severity:** High · **Confidence:** Medium · **Blocking** · **Reviewers:** AB-010
**Spec lines:** [§2.1 entry-point table, §3 finding M2, §9 out-of-scope](../2026-05-07-event-creation-reliability-spec.md)

`/events/propose` is listed as an affected entry point and M2 flags cross-navigation idempotency, but the remediation phases barely mention `proposeEventAction`. Recent commit `5a84fbf` ("stable idempotencyKey against double-submit") suggests this is an active bug surface. Either bring it explicitly into the same phases or move it to a separate spec — not in scope limbo.

### CR-8 — Removing prop-reset effect needs consumer audit + reseed contract
**Severity:** High · **Confidence:** Medium · **Blocking** · **Reviewers:** AB-003, ARCH-006, WF-005
**Spec line:** [§5 Phase A item 4](../2026-05-07-event-creation-reliability-spec.md)

The spec says edit mode should mount with `defaultValues` and never re-seed. That's safe only if every parent route unmounts/remounts the form on event-id change. If any parent path swaps `defaultValues` while keeping the component mounted (e.g. master-detail with stable parent + changing detail), removing the effect lets a user save event A's edits into event B.

**Recommended:** Define explicit reseed triggers (event-id change → reseed; explicit "Discard changes" → reseed; successful save with server-canonical values → reseed those specific fields). Add a `key={defaultValues.id}` on the form's parent so React force-unmounts on event-id change. Audit all `EventForm` consumers (the spec lists 4 entry points; should be a quick check).

### CR-9 — No optimistic concurrency for concurrent edits
**Severity:** High · **Confidence:** High · **Blocking** · **Reviewers:** WF-006, SEC-005
**Spec lines:** [§5 Phase B (no mention), §6 acceptance (no mention)](../2026-05-07-event-creation-reliability-spec.md)

If two users (or two tabs) edit the same event, the second save silently overwrites the first. The `events` table has `updated_at`; this is a textbook optimistic-concurrency case. The spec says nothing about it.

**What would confirm a fix:** Form sends `expected_updated_at`; RPC checks `WHERE id = ? AND updated_at = ?`; mismatch returns a structured "conflict" error that the UI handles by showing "this event was changed elsewhere — review and retry".

### CR-10 — RLS asymmetry has no migration in the plan
**Severity:** Medium · **Confidence:** High · **Blocking** · **Reviewers:** SEC-008
**Spec lines:** [§3 finding M1, §6 acceptance bullet 7](../2026-05-07-event-creation-reliability-spec.md)

M1 flags that office_workers can submit but can't re-read submitted events; acceptance requires it resolved. No phase task creates a migration. This will be a missing item when implementation starts.

**Recommended:** Add a Phase A item: `migration: extend events SELECT RLS so office_workers can read submitted events at their venue (or globally if venue_id is null on the user record, per the project's office_worker capability model)`. Single targeted migration, with a Vitest integration test against a local Supabase instance.

### CR-11 — Test strategy can't validate the guarantees the spec promises
**Severity:** High · **Confidence:** High · **Reviewers:** AB-009, WF-009, SEC-007
**Spec line:** [§7 test strategy](../2026-05-07-event-creation-reliability-spec.md)

Mocked Supabase clients cannot prove RLS behaviour, SECURITY DEFINER grants, search_path hardening, transaction rollback, SAVEPOINT semantics, storage/DB ordering, or migration advisor warnings. Phase B's most important guarantees are exactly the ones mocks can't verify.

**Recommended additions:**
- Local `supabase start` integration tests for the new RPC (single test file: success path, RLS-denial venue, partial-failure rollback).
- A concurrency test (two concurrent action invocations against a real DB) for idempotency.
- Migration advisor check in CI (`supabase db lint` or the MCP advisors tool already used in this project).
- Keep Vitest for action branching and UI behaviour — they are still useful, just not sufficient.

### CR-12 — Correlation ID lifecycle under-specified
**Severity:** Medium · **Confidence:** High · **Reviewers:** AB-008, ARCH-008, WF-010, SEC-009
**Spec lines:** [§5 Phase A item 6, §5 Phase C item 1](../2026-05-07-event-creation-reliability-spec.md)

The spec generates a UUID per action, surfaces it in toasts, and logs it. It does not say: where is it stored for support lookup, does it propagate into RPC errors and audit_log rows and storage object metadata, what's its retention, is it user-visible (Q4 asks) or operator-only.

**Recommended:** Define one `operation_id` (UUID v7 for time-orderability) generated client-side, sent into the action, passed into the RPC as a parameter, written into `audit_log.meta.operation_id`, included in every `console.error` line, and retained as long as audit_log. Resolve Q4: my recommendation is operator-only — show users a short opaque hash (first 8 chars) that an operator can grep against the full ID.

### CR-13 — JSONB RPC weakens typed validation boundary
**Severity:** Medium · **Confidence:** Medium · **Reviewers:** ARCH-007
**Spec line:** [§5 Phase B item 1](../2026-05-07-event-creation-reliability-spec.md)

The project convention (`.claude/rules/supabase.md` plus `src/lib/validation.ts`) is that Zod is the source of truth for shape; conversion happens via `fromDb<T>()`. A `payload jsonb` RPC moves part of the validation surface into PL/pgSQL, where it can drift from Zod.

**Recommended:** Either (a) the action validates with Zod, then calls a typed RPC with explicit columns (`save_event_draft(p_event_id, p_title, p_status, ...)`); or (b) keep `payload jsonb` but add a Postgres `CHECK` over the JSON shape mirroring Zod, and run a CI test that loads `eventDraftSchema` and asserts every field has a matching DB constraint. Option (a) is more aligned with the codebase.

### CR-14 — Open questions miss the architectural decision
**Severity:** Medium · **Confidence:** High · **Reviewers:** ARCH-009
**Spec line:** [§8 open questions](../2026-05-07-event-creation-reliability-spec.md)

Q1–Q5 are product decisions. The architectural decision that should precede them is: which save sub-operations are core state versus optional side effects? Without that, none of Q1–Q5 can be answered consistently.

**Recommended new Q0:** "Confirm the criticality taxonomy in CR-2 above. In particular, are `event_artists`, `event_venues`, `event_versions`, and `audit_log` writes Core (fail the save if they fail) or Compensatable (warn and continue)?" Answer this first; Q1–Q5 follow.

### CR-15 — Pack didn't include source files; line:number claims unverified
**Severity:** High · **Confidence:** High · **Process meta-finding** · **Reviewers:** AB-001, ARCH-001, WF-001, SEC-010

All four reviewers flagged that they could not verify my source claims (file:line citations) because the review pack only contained the spec markdown plus session reminders. This is a process issue with this review, not a defect in the spec content — but it means: **before implementation starts, every C1–H5 / M1–M5 finding must be re-verified against current HEAD with a fresh review pack that includes `src/actions/events.ts`, `src/components/events/event-form.tsx`, and the cited migrations.**

## Unproven assumptions in the spec

| Assumption | What would confirm/deny |
|---|---|
| Removing the prop-reset useEffect is safe | Audit of all `EventForm` consumers (4 entry points listed); test of edit-mode behaviour when `defaultValues.id` changes mid-mount |
| `revalidatePath` is the cause of the prop-reset clobber | Reproduce: trigger a `revalidatePath` while form is dirty, observe whether the user's input is wiped |
| Image upload errors are returned, not thrown | Read the actual image upload helper; if it can throw, the action's outer try/catch may swallow it — that path isn't in the spec |
| Multi-venue propose flow uses the same `event_creation_batches` idempotency as drafts | Read `proposeEventAction` and `create_multi_venue_event_proposals` migration |
| The audit-coverage CI guard catches swallowed runtime audit failures | Inspect `__tests__/audit-coverage.test.ts` — likely it tests static call presence, not runtime success |

## Recommended fix order (revised — supersedes spec §10)

The spec's "Phase A then B then C" is wrong as written, because Phase A institutionalises partial-success. Revised sequence:

**0. Spec revision (1 day, no code).** Resolve CR-1, CR-2, CR-3, CR-4, CR-5, CR-12, CR-14. Add the criticality taxonomy. Rewrite Phase A items 5–6 around it. Resolve Q1–Q5 + new Q0 with the user. Re-run this review with a pack that includes the source files (CR-15).

**1. Foundations (Phase A′ — UX guardrails, no contract changes) (1 day).** Disable submit while pending; toast on every failure; clear dirty state on success; `key={defaultValues.id}` on the form parent (CR-8); correlation ID generation client + server; remove the `useEffect` prop-reset. **No `warnings[]` channel yet.** Failures still return `{success: false}`. This Phase is now genuinely safe to ship alone.

**2. Atomic save RPC (Phase B′) (3 days).**
   - Migration: `save_event_draft(p_payload jsonb, p_idempotency_key uuid, p_expected_updated_at timestamptz)` — `auth.uid()`-derived identity, fixed search_path, EXECUTE grant only to `authenticated`, payload constraint mirroring Zod, optimistic-concurrency check, idempotency unique index. SAVEPOINT-for-diagnostics-only pattern. Returns `{ success, event_id, failed[], warnings[] }` where `warnings` is restricted to Compensatable/Optional ops only.
   - Companion RPC for submit (CR-6): `submit_event_for_review` reusing the same shape.
   - Rewire `saveEventDraftAction` and `submitEventForReviewAction` to call the RPCs. Remove every `.catch(() => {})`. Image upload uses the new compensating workflow (CR-4) with `events.pending_image_attach` column + reuse of `pending_cascade_backfill` retry pattern.
   - RLS asymmetry migration (CR-10).

**3. Propose flow (Phase B″) (1 day).** Apply the same atomic RPC shape to `proposeEventAction` and `create_multi_venue_event_proposals` (CR-7).

**4. Verification (Phase C′) (1.5 days).** Local Supabase integration tests; concurrency test; supabase advisors in CI; structured logging with operation_id propagation; Playwright golden + throttled-network edge.

**Total: ~7.5 days.** Up from ~5 in the original spec, but with a defensible contract throughout.

## Minor observations (demoted)

- L1: The spec uses "checkpoint commits" terminology from the workspace CLAUDE.md but doesn't tie it to the phase structure — non-blocking, style.
- L2: Effort estimates ("1–1.5 d", "2.5–3 d") have no breakdown by sub-task; nice-to-have for resource planning.
- L3: The risk table (§10) names a feature flag `EVENT_SAVE_USE_RPC` but doesn't say where it's configured or who owns the flip.
