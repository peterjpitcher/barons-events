# Event Creation Reliability — Discovery & Spec (Rev 2)

**Status:** Spec for review (post-adversarial revision)
**Date:** 2026-05-07
**Author:** Claude (under Peter Pitcher's direction)
**Branch:** `claude/eager-borg-52d3f5`
**Complexity score:** 4 (L) — multi-layer change; will be split into PRs A′, B′, B″, C′

**Revision log**
- **Rev 1** — initial spec.
- **Rev 2 (this doc)** — applied R-1…R-16 from [tasks/codex-qa-review/2026-05-07-event-creation-spec-claude-handoff.md](codex-qa-review/2026-05-07-event-creation-spec-claude-handoff.md). User-confirmed A-1…A-6. Major changes: criticality taxonomy added (§5); Phase A no longer introduces a `warnings[]` channel for Core ops; Phase B's atomicity contract resolved (SAVEPOINT-for-diagnostics-only); RPC signature corrected to use `auth.uid()`; submit and propose flows brought into the new RPC shape; idempotency, optimistic concurrency, and image state machine specified; RLS migration added to Phase A′; test strategy now includes local Supabase integration.

---

## 1. Problem statement

Users across the platform report:

- **A.** Saving a new or edited event sometimes "doesn't take" — they click Save and nothing visibly changes, OR they see a success toast but the data they entered is missing the next time they open the event.
- **B.** They lose work — text they typed disappears, multi-venue selections drop venues, attached artists vanish, or the form rolls back to old values.

This isn't one-off. The save flow has had eight separate fixes in the last 30 days (`b44ee1b`, `5a84fbf`, `7970ddf`, `6d3d909`, `5f845de`, `5674728`, `750303a`, `654d466`) and another bug class is still leaking through. The code is not structurally reliable; we fix the underlying patterns rather than ship a ninth point fix.

## 2. What "Save" actually does today

### 2.1 Entry points

| Path | Component | Action(s) used |
|---|---|---|
| `/events/new` | `EventForm` (mode=`create`) | `saveEventDraftAction` → `submitEventForReviewAction` |
| `/events/propose` | `EventForm` (mode=`create`) + propose-form helper | `proposeEventAction` (RPC) |
| `/events/[eventId]` | `EventForm` (mode=`edit`) | `saveEventDraftAction` → `submitEventForReviewAction` |
| `/events/[eventId]/edit` (status routing) | Same form | Same actions |

No public API endpoints participate in create/save (`/api/v1/events` is read-only).

### 2.2 What `saveEventDraftAction` does today

Performs ~10 sequential operations against multiple tables and an RPC, with **no surrounding transaction**:

1. Auth check (`getCurrentUser`).
2. Permission check (`canEditEvent` / `canProposeEvents`).
3. Zod parse (`eventDraftSchema`).
4. `INSERT` or `UPDATE` `events`.
5. `syncEventArtists` — wraps `event_artists` insert/delete.
6. `syncEventVenueAttachments` — calls `set_event_venues` RPC for multi-venue.
7. `uploadEventImage` — Supabase Storage write.
8. `appendEventVersion` — snapshot row in `event_versions`.
9. `recordAuditLogEntry` — `audit_log` insert.
10. `revalidatePath` — clear Next.js cache.

Each step is awaited. **Most have their own try/catch that swallows the error and logs to console.** A failure in steps 5–9 leaves the parent `events` row written but linked data missing — and the action still returns `{ success: true }`.

### 2.3 What the form does on submit

- `useActionState(saveEventDraftAction)` binds state.
- Two submit buttons share one `<form>` and use `data-intent` plus `formAction=` to switch between draft and submit.
- A `useEffect` watches `draftState.message` and shows a toast — **only if `fieldErrors` is falsy**. If the server returns `{ success: false, fieldErrors: {...} }`, no top-level toast appears.
- Another `useEffect` (line 396 of `event-form.tsx`) **resets every form state value to `defaultValues` on prop change**. If any parent re-render hands a new `defaultValues` object reference, the user's unsaved input is silently overwritten.
- After a successful save, **the form's `isDirty`-equivalent flags are never cleared**.
- There is no `isPending` / disabled state on the submit buttons.

## 3. Failure modes found

> ⚠ Citations below were captured from a discovery-only pass and were not present in the codex review pack — they must be re-verified against current HEAD before implementation begins (per CR-15 in the adversarial review). The diagnostic categories are correct; specific line numbers may have shifted.

### 3.1 CRITICAL — silent partial-write failures

| # | File:Line | What happens | Why the user loses data |
|---|---|---|---|
| C1 | `src/actions/events.ts:35-46` | `syncEventVenueAttachments` calls `set_event_venues` RPC, only `console.error`s on failure, returns `void`. | Multi-venue selections silently drop. |
| C2 | `src/actions/events.ts` (~835-845, ~1070-1078) | Artist sync errors caught, set a `artistSyncWarning` flag, return success anyway. | Artists not persisted; no UI surface. |
| C3 | `src/actions/events.ts` (~880-888) | `appendEventVersion` swallowed; sets `versionWarning`, never surfaces. | History row missing. |
| C4 | `src/actions/events.ts:856,:1084,:1142-1143` | `recordAuditLogEntry({...}).catch(() => {})` — explicit silent swallow on three audit paths. | Mutation committed but unaudited. |
| C5 | `src/actions/events.ts:~924,:1267` | `await syncEventVenueAttachments(...)` not wrapped; thrown errors crash the action AFTER `events` row commit. | Event row exists; venue join rows don't; user retries → duplicates. |
| C6 | `supabase/migrations/20260417200000_add_multi_venue_event_drafts_rpc.sql` | `FOREACH … LOOP` per venue with no `SAVEPOINT`. | Whole-RPC rollback; `event_creation_batches.result` never populated. |
| C7 | `src/components/events/event-form.tsx:396-440` | `useEffect([mode, defaultValues?.id, ...])` resets every controlled state to `defaultValues` whenever reference changes. | Background revalidation wipes user input mid-edit. |

### 3.2 HIGH — broken UX feedback loop

| # | File:Line | What happens | User-visible effect |
|---|---|---|---|
| H1 | `event-form.tsx:~348-365` | Error toast suppressed when `fieldErrors` truthy. | Validation failure → no top-level toast. |
| H2 | `event-form.tsx` (no reset path) | After `success: true`, dirty trackers never cleared. | Persistent unsaved-changes warning. |
| H3 | `event-form.tsx:563-570` | No `isPending` guard on submit. | Double-submit possible. |
| H4 | `events.ts:~1027-1244` | Generic `"Could not submit right now. Please try again."`; real error logged server-side only. | Users get no actionable info; no correlation ID. |
| H5 | `events.ts:1242-1244` | `revalidatePath(...)` and `redirect(...)` inside catch. `redirect` throws; subsequent return unreachable. | Stale cache served on error. |

### 3.3 MEDIUM

| # | File:Line | Issue |
|---|---|---|
| M1 | `supabase/migrations/20260505190000_allow_office_worker_full_form_submit.sql` | RLS asymmetry — `WITH CHECK` allows office_worker submit but `USING` (SELECT) of submitted events still admin-only. Resolved by Phase A′ task A6. |
| M2 | propose-form path | Idempotency key generated client-side; cross-navigation may produce different keys → duplicates. Resolved by Phase B′ idempotency design + Phase B″ propose remediation. |
| M3 | `events.ts` everywhere | `as any` casts on Supabase RPC calls. Resolved by R-14 (typed columns + generated types). |
| M4 | `events.ts:~860-867` | Image upload error returned but events row already committed. Resolved by Phase B′ B4 (image state machine). |
| M5 | `event-form.tsx:370,:414` | `(defaultValues as any)?.manager_responsible_id`. Resolved by R-14 (replace with proper types). |

### 3.4 LOW

L1. Unstructured `console.error` — no correlation ID. Resolved by Phase A′ A5.
L2. Sanitised error messages without a request-id mechanism (commit `654d466`). Resolved by A5 + A7.
L3. No metric on "events that succeeded with warnings". Resolved by Phase C′ C4 structured logging.

## 4. Root causes (the patterns to break)

1. **No transaction boundary** around the multi-write save.
2. **Pervasive error swallowing** — `try/catch (err) { console.error; return success: true }` and `.catch(() => {})`.
3. **Form state reset effect on prop change** — clobbers user input on background revalidation.
4. **No partial-success contract** — `{success, message, fieldErrors}` cannot express "core saved, side-effect failed", so engineers default to "log and pretend".
5. **No double-submit lock** — neither client UI nor server idempotency.
6. **No correlation ID** — when a user complains "save didn't work", support can't find the trace.

## 5. Criticality taxonomy (decision gate, R-1)

This taxonomy gates every fix below. Each save sub-operation is one of three classes; the class determines failure handling.

| Operation | Class | If it fails |
|---|---|---|
| `events` row insert/update | **Core** | Fatal — return `{success: false}`. No warning channel. |
| `event_artists` link writes | **Core** | Fatal |
| `event_venues` link writes | **Core** | Fatal |
| `event_versions` snapshot | **Core** | Fatal (audit-trail integrity) |
| `audit_log` row | **Core** | Fatal |
| Image upload + DB attach | **Compensatable** | `warnings: ['image-…']` + persisted retry token |
| SOP checklist generation | **Compensatable** | `warnings: ['sop-…']` + queued backfill via existing `pending_cascade_backfill` |
| Notification email dispatch | **Optional** | `warnings: ['notification-…']`; no retry |
| Cache `revalidatePath` | **Optional** | `warnings: ['cache-…']`; no retry |

The `warnings[]` channel exists **only** for Compensatable + Optional. Anything Core failing returns `{success: false, message, failed_step, operation_id}`.

User-confirmed (A-1): all four linked-data writes (artists, venues, versions, audit) are Core.

## 6. Proposed remediation

Four sequenced PRs. Each is independently deployable. Every PR is gated by tests written first (TDD).

### Phase A′ — UX guardrails (no contract change) — 1 day

**Goal:** Stop double-submits, prop-reset clobber, silent toast suppression, and the M1 RLS asymmetry. Failures still return `{success: false}` — no `warnings[]` for Core operations.

| Task | Detail |
|---|---|
| A1 | `disabled={isPending}` on Save and Submit buttons. (Acknowledged: this is one layer; full idempotency is in Phase B′ B1.) |
| A2 | Fix toast suppression — replace `else if (!fieldErrors)` with unconditional `else { toast.error(...) }`. Pair colour with icon + text (colourblind safety). |
| A3 | Reset dirty-state sentinels on `success: true`. |
| A4 | Replace the prop-reset `useEffect` (event-form.tsx:396-440) with `<EventForm key={defaultValues?.id ?? 'new'} />` at all 4 parent routes (R-11). React force-unmounts on event-id change; explicit "Discard changes" still works via parent re-render. Audit each consumer first (`/events/new`, `/events/propose`, `/events/[eventId]`, propose-form helper). |
| A5 | Generate `operation_id` (UUID v7, time-orderable) at form mount; send into action; include in every `console.error` line; log alongside outcome (R-12). |
| A6 | **Migration**: extend `events` SELECT RLS so office_workers can read submitted events at their venue (when `users.venue_id` is set) or globally (when `users.venue_id IS NULL`). Single targeted migration. Resolves M1 (R-10, A-4). |
| A7 | Surface `operation_id` in error toasts as the first 8 characters (short opaque hash). Full ID stays in logs and `audit_log.meta.operation_id` (A-5). |

**Acceptance for Phase A′:**
- Validation failures always produce a top-level toast.
- After successful save, "unsaved changes" warning is cleared.
- Switching event-id in edit mode does not preserve the previous event's input.
- Office_worker can re-load own submitted event without 404.
- Every error response includes an `operation_id`; user sees first 8 chars; full ID in logs.
- Double-clicks reduced (not eliminated — that's Phase B′).

### Phase B′ — Atomic save RPC + image state machine — 3 days

**Goal:** Replace the 10-step sequential writes with a single transactional RPC. Image upload uses a compensating workflow.

#### B1 — `save_event_draft` RPC

```
save_event_draft(
  p_payload jsonb,
  p_idempotency_key uuid,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
```

Contract:
- **Identity** derived from `auth.uid()` inside the function. **`user_id` is NOT a parameter** (R-4 / CR-1).
- **Authz**: function looks up caller role from `public.users.role`, calls a SECURITY-INVOKER helper `_can_edit_event(p_event_id, p_target_status)` that mirrors the TypeScript `canEditEvent` / `canProposeEvents` capability functions. RAISE on denial.
- **Payload allowlist**: extract only known fields from `p_payload`; ignore extras. CI test asserts parity with `eventDraftSchema` field list.
- **Idempotency**: new table `event_save_idempotency(idempotency_key uuid, user_id uuid, event_id uuid, response jsonb, created_at timestamptz, primary key (idempotency_key, user_id))`. Unique on `(idempotency_key, user_id)`. Second call with same key returns the stored response.
- **Optimistic concurrency** (R-9 / A-3-aligned): when updating, `WHERE id = ? AND updated_at = p_expected_updated_at`. Mismatch RAISES a structured "conflict" error captured by the action.
- **SAVEPOINT-for-diagnostics-only** (R-3 / CR-3): wrap each artist write and each venue write in a savepoint. On error, ROLLBACK TO SAVEPOINT, capture `{kind, id, reason}` into a temp diagnostic array. After the loop, if the array is non-empty, RAISE so the parent transaction rolls back the whole event. Returns `{success: false, failed: [...]}` with **zero rows committed**.
- **Returns**: `{success bool, event_id uuid, failed jsonb, warnings text[], operation_id uuid}`. `warnings[]` only contains Compensatable / Optional entries.
- **Permissions**: `REVOKE ALL ON FUNCTION save_event_draft FROM PUBLIC; GRANT EXECUTE ON FUNCTION save_event_draft TO authenticated;`

#### B2 — `submit_event_for_review` companion RPC (R-7 / CR-6)

Same shape as `save_event_draft`. The action `submitEventForReviewAction` calls this instead of doing its own multi-write chain. Adds the required-fields CHECK enforcement and status-transition trigger interaction.

#### B3 — Rewire actions

- `saveEventDraftAction` and `submitEventForReviewAction` call the new RPCs. Remove every `.catch(() => {})` from `events.ts`. Audit, version, artist, and venue failures now propagate as `{success: false}`.
- Action shape extension: `{success, message, fieldErrors?, warnings?, operation_id, failed?}`. Existing callers continue to work with `success` + `message`; new fields are additive.

#### B4 — Image state machine (R-6 / CR-4)

- Object naming: `event-images/<event_id>/<timestamp>.<ext>` — owned by event, idempotent on re-upload via `upsert: true`.
- Sequence: RPC commits → upload to storage → second `UPDATE events SET event_image_path = ?` outside the RPC.
- New column `events.pending_image_attach text` (path). If upload succeeds but the second UPDATE fails, set `pending_image_attach` and return `warnings: ['image-attach-pending']`.
- If upload itself fails, return `warnings: ['image-upload-failed']` plus a UI retry affordance.
- New cron at `/api/cron/reconcile-event-images` — reuses the lock/retry pattern from `pending_cascade_backfill`. Reconciles `pending_image_attach` rows; deletes orphaned storage objects after 7 days if no matching event row found.

#### B5 — Feature flag (A-6)

- Env var `EVENT_SAVE_USE_RPC` (boolean). Old and new paths coexist for one release cycle.
- Flip after smoke. Remove old path in next release. No maintenance banner needed; the RPC is purely additive — no locking, no migration of existing rows.

#### B6 — Typed RPC + clean-up (R-14 / CR-13)

- Run `supabase gen types typescript`; commit generated types.
- Replace every `(db as any).rpc(...)` in `events.ts` with the generated typed call.
- Where the canonical event fields are stable, prefer typed RPC parameters (`p_title text`, `p_status text`, …) over jsonb. Use `p_payload jsonb` only for genuinely variable fields (e.g. artist arrays). Add a `CHECK` over `p_payload` mirroring Zod where it applies.

**Acceptance for Phase B′:**
- Killing the DB connection mid-save leaves no orphaned rows.
- Multi-venue with 1 of 5 venues failing creates **0 events** and returns `failed: [{kind:'venue', id, reason}]` (matches A-3).
- Audit insert failure returns `{success: false}`, not silent + success.
- Two concurrent saves with the same `idempotency_key` produce exactly one event row.
- Two concurrent edits to the same event (stale `expected_updated_at`) — the second returns a structured conflict; the form handles it by prompting the user to refresh.
- Image upload failure after successful event save returns `warnings: ['image-…']`, leaves the event saved, shows a retry UI.

### Phase B″ — Propose flow remediation — 1 day

**Goal:** Apply the same atomic shape to `proposeEventAction` (R-8 / CR-7).

| Task | Detail |
|---|---|
| B″1 | New RPC `propose_event_draft` with the same shape as `save_event_draft`. Reuses idempotency, optimistic concurrency, SAVEPOINT-for-diagnostics-only, operation_id propagation. |
| B″2 | Audit cross-navigation idempotency on the propose form. The earlier fix `5a84fbf` made the key stable per-mount; verify with a Vitest test that crossing routes (not just remounts) generates a fresh key only when intended. |
| B″3 | Rewire `proposeEventAction` to call `propose_event_draft`. Remove any `.catch(() => {})` patterns. |

**Acceptance:** Same as Phase B′ acceptance, applied to proposals.

### Phase C′ — Verification & observability — 1.5 days

| Task | Detail |
|---|---|
| C1 | Local Supabase integration tests for the new RPCs (one test file each, ~5 tests): success path, RLS-denial venue, SAVEPOINT rollback, idempotency, optimistic concurrency. |
| C2 | Real-DB concurrency test: two parallel action invocations with the same idempotency_key → exactly one event row. Run 100 times in CI to catch flakiness. |
| C3 | Supabase advisor in CI: fail the build on new migrations that have SECURITY DEFINER without `search_path`, unrestricted GRANTs, or unindexed FKs. Use `supabase db lint` or the advisors MCP. |
| C4 | Structured logging — every action invocation emits `{operation_id, user_id, action, duration_ms, outcome, warning_count, failed_count}`. Pipe to existing log surface. |
| C5 | Audit-coverage CI guard extension — extend `src/actions/__tests__/audit-coverage.test.ts` to also assert no `.catch(() => {})` in `events.ts` (CR-2 reinforcement). |
| C6 | Playwright tests: golden (create draft → edit → submit) + edge (venue RPC failure mid-flight via network intercept; assert no data loss + error toast with operation_id). |

**Acceptance:** All Phase A′ + B′ + B″ criteria covered by automated tests; concurrency test stable across 100 runs; operation_id queryable end-to-end (toast → log → audit_log row).

## 7. Acceptance criteria (master list)

A user is considered to have a reliable save when ALL of the following hold:

- [ ] Clicking Save once produces exactly one event row, even under network retry, double-tab, or programmatic submit (server-side idempotency, not just UI disable).
- [ ] On success: toast visible, dirty state cleared, redirect happens once deterministically.
- [ ] On failure: toast visible with short operation_id; full ID in logs and `audit_log`; form retains every input the user typed.
- [ ] Multi-venue saves are atomic: zero events created on any per-venue failure, with structured `failed[]` naming the offending venue and reason (per A-3).
- [ ] Linked writes (artists, venues, versions, audit) are Core: any failure rolls back the whole save (per A-1).
- [ ] Compensatable side-effects (image upload, SOP checklist) failing produce `warnings[]` plus a retry path; do NOT prevent the event from being saved.
- [ ] Optional side-effects (notifications, cache revalidation) failing produce `warnings[]`; no retry.
- [ ] Concurrent edits to the same event surface a structured "conflict" error; later writer is asked to refresh.
- [ ] Office_worker can SELECT and re-edit own submitted events (per A-4).
- [ ] Background re-render of parent does not reset form (`key={defaultValues.id}` pattern).
- [ ] All Phase A′ / B′ / B″ / C′ tests pass.
- [ ] Audit-coverage CI guard passes including the no-swallow assertion.
- [ ] Migration advisors clean.
- [ ] Definition of Done in `.claude/rules/definition-of-done.md` passes.

## 8. Test strategy (TDD, three layers)

| Layer | What it tests | Limits |
|---|---|---|
| **Vitest (mocked Supabase)** | Action branching, return-shape contracts, UI behaviour. Each numbered finding C1–C7, H1–H5, M1–M5 gets a targeted test. | Cannot validate RLS, RPC transaction semantics, search_path, GRANT scope, storage ordering. |
| **Integration (`supabase start`)** | RLS, RPC transaction behaviour, SAVEPOINT semantics, idempotency, optimistic concurrency. Run on PR; ~30s suite. | Slower than unit; not a substitute for E2E. |
| **Playwright** | Golden create→edit→submit; throttled-network edge case. | Slowest; cover only the user-visible journeys. |

CI gates: all three layers pass + audit-coverage guard + Supabase advisors clean on new migrations.

## 9. Open questions (resolved 2026-05-07)

| ID | Question | Decision |
|---|---|---|
| A-1 | Are `event_artists`, `event_venues`, `event_versions`, `audit_log` writes Core or Compensatable? | **All Core.** Drives §5 taxonomy and Phase A′/B′ contract. |
| A-2 | Image upload failure — keep event + warning, or roll back? | **Keep + retry warning.** Image is Compensatable; reconciliation cron handles orphans. |
| A-3 | Multi-venue partial — zero events or save-the-good-ones? | **Zero events.** Matches A-1 atomicity; clear user-facing model. |
| A-4 | Office_worker SELECT on own submitted events — yes or no? | **Yes.** Migration in Phase A′ A6 resolves M1. |
| A-5 | Operation IDs — user-visible full, or operator-only? | **Split.** Short 8-char hash to user; full UUID v7 in logs and `audit_log.meta.operation_id`. |
| A-6 | Phase B′ deploy — drain banner needed? | **No banner.** Feature flag `EVENT_SAVE_USE_RPC`; old + new paths coexist; flip after smoke. |

## 10. Out of scope (parking lot)

- Pre-event proposal status transitions (`pending_approval` → `approved_pending_details`) — already hardened by recent fixes; quick audit pass only.
- SOP checklist generation algorithm — out of save path; runs as Compensatable side-effect.
- Notification email dispatch internals — already non-blocking by design.
- Public `/api/v1/events` — read-only, unrelated.
- Event delete / hard-delete — separate flow.
- Debrief submission — separate form.

## 11. Risks and rollback

| Risk | Mitigation |
|---|---|
| New RPC introduces a regression. | Feature flag `EVENT_SAVE_USE_RPC`. Both paths coexist for one release cycle; flip after smoke; remove old path next release. |
| Removing the prop-reset effect breaks an edit consumer. | `<EventForm key={defaultValues.id} />` at parent — React force-unmounts on event-id change. Audit all 4 listed consumers in Phase A′ A4. |
| Removing every `.catch(() => {})` exposes audit-log RLS bugs we hadn't seen. | Phase A′ operation_id + Phase C′ structured logging surface them; we triage from the logs. |
| New RPC SECURITY DEFINER bug grants too-wide access. | Supabase advisor CI gate (C3); explicit `EXECUTE` grant only to `authenticated`; `REVOKE ... FROM PUBLIC`; integration tests for RLS + role coverage. |
| Idempotency key collisions across users. | Unique on `(idempotency_key, user_id)` — collision impossible across users. |
| Image cleanup cron deletes a referenced storage object. | 7-day retention before delete; reconciliation only deletes when no matching event row found. |

## 12. Effort estimate

| Phase | Duration | Output |
|---|---|---|
| 0. Spec revision | done | This document, A-1…A-6 resolved |
| A′. UX guardrails | 1 day | UI safe, no contract change |
| B′. Atomic save RPC + image state | 3 days | Save genuinely transactional |
| B″. Propose flow | 1 day | Same shape applied to proposals |
| C′. Verification | 1.5 days | Integration + Playwright tests, advisor CI |
| **Total** | **~6.5 days** | |

(Up from rev 1's 5 days; reflects scope corrections from CR-6/7/9/10/11 and the criticality taxonomy.)

## 13. Pre-implementation checklist

- [x] A-1…A-6 resolved.
- [ ] Re-run codex-qa-review with a pack that includes `src/actions/events.ts`, `src/components/events/event-form.tsx`, and the cited migrations — verifies §3 line-number citations against current HEAD (CR-15).
- [ ] Address any new blocking findings from the second review.
- [ ] Branch named `fix/event-create-reliability-phase-a` for the first PR.
- [ ] Definition of Ready (`.claude/rules/definition-of-ready.md`) passes for Phase A′ before code begins.
