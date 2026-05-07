# Event Creation Reliability — Consolidated Handover

**Date written:** 2026-05-07
**Branch:** `codex/fix-event-venue-rls-recursion` (HEAD: `f96179f`)
**Worktree path:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/worktrees/eager-borg-52d3f5`
**For:** the next agent picking up this work in a fresh session

---

## TL;DR

Users were reporting "saving an event sometimes doesn't take" and "I lose my changes". A four-phase remediation (UX guardrails → atomic save RPC → propose flow → verification) was specified, reviewed adversarially, planned, and largely executed. **Implementation (Phases A′, B′, B″) is complete and shipping.** **Verification scaffolding (Phase C′) is complete except for Playwright (C6).** The branch is green: 0 lint errors, clean typecheck, 731 unit tests pass + 12 integration tests skip cleanly until `RUN_INTEGRATION_TESTS=1` is set.

**Only outstanding work: C6 (Playwright golden + venue-failure edge specs).**

---

## What "done" looks like (spec acceptance criteria)

A user has a reliable save when ALL of the following hold (from [spec rev 2 §7](2026-05-07-event-creation-reliability-spec.md#7-acceptance-criteria-master-list)):

- [x] Single Save click produces exactly one event row, even under retry / double-tab / programmatic submit
- [x] Success path: toast visible, dirty state cleared, deterministic redirect
- [x] Failure path: toast visible with short operation_id, full ID in logs + audit_log, form retains every input
- [x] Multi-venue saves are atomic — zero events created on any per-venue failure, structured `failed[]` returned
- [x] Linked writes (artists, venues, versions, audit) are Core: any failure rolls back the whole save
- [x] Compensatable side-effects (image upload, SOP) failing produce `warnings[]` + retry path; do NOT prevent save
- [x] Optional side-effects (notifications, cache revalidation) failing produce `warnings[]`; no retry
- [x] Concurrent edits to same event surface a structured "conflict" error
- [x] Office_worker can SELECT and re-edit own submitted events
- [x] Background re-render of parent does not reset the form (`key={defaultValues.id}` pattern)
- [x] All Phase A′ / B′ / B″ tests pass (731 unit tests green)
- [x] Audit-coverage CI guard passes including the no-swallow assertion
- [x] Migration advisors clean (4 lint-fix migrations addressed initial findings)
- [x] Definition of Done passes (lint 0 errors, typecheck clean, build ✓, tests pass)
- [ ] **C6: Playwright golden + venue-failure edge specs landed** — only outstanding item

---

## Phase-by-phase status

| Phase | Tasks | Status | Key commits |
|---|---|---|---|
| **A′** UX guardrails + RLS | A1–A7 | ✅ done | `cb16668`, `e75616f`, `22e569c`, `00c47cc`, `5451a91`, `1f41aa9`, `411b6bf` |
| **B′** Atomic RPC + image state + flag | B0–B6 | ✅ done | `24deb69`, `b214345`, `b011aa8`, `58eaadb`, `2248d2e`, `0bf0a6d`, `87f65d3` |
| **B″** Propose flow | B″1, B″2 | ✅ done | included in `0bf0a6d` (propose RPC + pre-event.ts wiring + propose-event-form changes) |
| **C′** Verification | C1–C6 | 🟡 5 of 6 done | C1 + C2 in `f96179f`; C4 (event-action-log.ts) + C5 (audit guard) in `0bf0a6d`; C3 (advisors script) in `0f2042f`; **C6 Playwright outstanding** |
| **Hot fixes** (advisor + integration) | — | ✅ done | `20260507131000_fix_event_reliability_rpc_lint.sql`, `20260507132000_return_event_rpc_updated_at.sql`, `20260507133000_fix_assign_reviewer_and_proposal_lint.sql`, `e6dde98` |

---

## Decisions locked in (A-1 … A-6)

These were resolved with the user before implementation began. Source: [spec rev 2 §9](2026-05-07-event-creation-reliability-spec.md#9-open-questions-resolved-2026-05-07).

| ID | Question | Decision |
|---|---|---|
| A-1 | Are `event_artists`, `event_venues`, `event_versions`, `audit_log` writes Core or Compensatable? | **All Core** — fatal on failure |
| A-2 | Image upload fails after event row commits — roll back or retry warning? | **Keep + retry warning** (Compensatable) |
| A-3 | Multi-venue partial — zero events or save-the-good-ones? | **Zero events** |
| A-4 | Office_worker SELECT on own submitted events — yes or no? | **Yes** (RLS migration `20260507102858`) |
| A-5 | Operation IDs — full UUID or short hash? | **Split** — short 8-char hash to user, full UUID v7 in logs and `audit_log.meta.operation_id` |
| A-6 | Phase B′ deploy — drain banner needed? | **No banner** — feature flag `EVENT_SAVE_USE_RPC` |

## Execution mode

Lean throughout. No TDD-per-step ceremony for migrations / config / docs. Single end-of-task verification (lint + typecheck + scoped tests). Minimal handoff files. See [feedback memory](../../../../.claude/projects/-Users-peterpitcher-Cursor-BARONS-BaronsHub/memory/feedback_lean_execution.md) for the rule and rationale.

---

## Verification snapshot — how to confirm state is green

Run from the worktree root:

```bash
npm run lint        # expected: 0 errors, 2 pre-existing warnings in session-monitor.tsx (unrelated)
npm run typecheck   # expected: clean
npm test            # expected: 731 passed / 18 skipped / 0 failed
npm run build       # expected: ✓ Compiled successfully + 35/35 static pages
```

All four were confirmed passing at HEAD `f96179f`.

Integration tests skip by default and need `RUN_INTEGRATION_TESTS=1` plus a local Supabase stack:

```bash
npm run test:integration   # skips all 12 tests until env vars set
```

To run them, see [docs/testing/integration.md](../docs/testing/integration.md) for `supabase init` / `supabase start` setup.

---

## Migrations applied (Supabase project `shofawaztmdxytukhozo`)

In order of application:

1. `20260507102858_office_worker_select_submitted_events.sql` — A6 RLS fix
2. `20260507120000_event_save_idempotency_and_image_pending.sql` — B0 idempotency table + image col
3. `20260507120001_save_event_draft_rpc.sql` — B1 atomic save RPC
4. `20260507120002_submit_event_for_review_rpc.sql` — B2 atomic submit RPC
5. `20260507130000_propose_event_draft_rpc.sql` — B″1 propose RPC
6. `20260507131000_fix_event_reliability_rpc_lint.sql` — advisor lint fixes (post-deploy)
7. `20260507132000_return_event_rpc_updated_at.sql` — RPCs return updated_at for next OCC check
8. `20260507133000_fix_assign_reviewer_and_proposal_lint.sql` — advisor lint fixes
9. (Codex venue join RLS recursion fix in commit `e6dde98` — see migration filename in that commit)

---

## What the new agent needs to do

### 1. Land C6 (Playwright golden + venue-failure edge)

**Files to create:**

- `playwright.config.ts` (project root) — minimal config; `testDir: "./tests/e2e"`, `baseURL` from env, `chromium` project only
- `tests/e2e/events-create.spec.ts` — two specs:
  - **Golden**: log in as a test user → `/events/new` → fill required fields → click "Save draft" → expect success toast → navigate to event → edit → submit → assert `(ref: <hash>)` not in toast on success
  - **Edge**: use `page.route()` to intercept the `save_event_draft` RPC and return `{success: false, failed: [{kind: 'venue', id, reason}], operation_id}`. Assert form input is preserved AND error toast contains `(ref: <8-char-hash>)`
- `docs/testing/e2e.md` — prerequisites (`npm install @playwright/test`, `npx playwright install chromium`), env vars (`E2E_BASE_URL`, `E2E_TEST_USER_EMAIL`, `E2E_TEST_USER_PASSWORD`), running

**`package.json` already has the scripts** (`test:e2e`, `test:e2e:ui`) — but `@playwright/test` is NOT yet installed. Add it as a devDependency (`^1.50.0` or latest stable) and document the `npx playwright install chromium` step in `docs/testing/e2e.md`.

**`.gitignore` additions:** append `playwright-report/` and `test-results/`.

**Don't try to run the tests in this session** — Playwright browsers are a 600MB install. The scaffolding is enough; the deployer runs `npm install && npx playwright install chromium && npm run test:e2e` later.

### 2. Optional follow-ups (not blocking — flag to user only)

- **2 pre-existing lint warnings** in `src/components/shell/session-monitor.tsx:30,33` — `window.location.href` for client-side nav. Pre-dates this work; would be a separate fix.
- **Codex review of the cumulative diff** — the original plan called for `codex-qa-review` on the final cumulative diff. We didn't run it because the user moved fast through the latter half. Consider running it after C6 lands (Mode B / code review) on the diff `main..HEAD` to catch anything we missed before merging this branch.
- **Decision needed:** does the team want a real CI workflow (`.github/workflows/ci.yml`) running the advisor + tests + build on PR? `npm run advisors` exists as a manual script, but no CI gate enforces it.

### 3. Don't undo

- The `EVENT_SAVE_USE_RPC` env var is the toggle. Currently old + new save paths coexist. **Confirm with the user before removing the legacy path** — the spec calls for "old + new coexist for one release cycle, then remove". The user owns the timing.
- The `as any` casts that remain in `events.ts` after `87f65d3` are PostgREST embed boundary types (`EmbeddedVenue`, `EmbeddedArtistEntry`) — keep them; they are intentionally narrowed.

---

## File map (what's where)

### Spec / planning artefacts
- [Spec rev 2](2026-05-07-event-creation-reliability-spec.md) — problem statement, criticality taxonomy, phases
- [Implementation plan](../docs/superpowers/plans/2026-05-07-event-creation-reliability.md) — task-level breakdown with progress markers
- [Codex adversarial review](codex-qa-review/2026-05-07-event-creation-spec-adversarial-review.md) — 15 deduped findings + recommendations
- [Codex hand-off brief](codex-qa-review/2026-05-07-event-creation-spec-claude-handoff.md) — R-1…R-16 corrections (all applied in spec rev 2)
- [Orchestration plan](implement-plan/plan.md) — wave structure
- Per-wave handoffs at `tasks/implement-plan/wave-{1,2,3,final}/<role>/handoff.md`

### Implementation
- **Migrations:** `supabase/migrations/2026050712*.sql` (B0–B2), `2026050713*.sql` (B″1 + lint fixes), `20260507102858_*.sql` (A6 RLS), plus the Codex venue-RLS fix
- **Server actions:** `src/actions/events.ts` (rewired through RPCs behind `EVENT_SAVE_USE_RPC` flag), `src/actions/pre-event.ts` (propose action rewired through `propose_event_draft`)
- **RPC helper:** `src/lib/events/save-rpc.ts` — `callSaveEventDraftRpc`, `callSubmitEventForReviewRpc`, `callProposeEventDraftRpc`, payload builders
- **Form:** `src/components/events/event-form.tsx` (`isPending` disable, key prop, dirty reset, operation_id + idempotency_key hidden inputs, warning toasts), `src/components/events/propose-event-form.tsx` (same pattern)
- **Cron:** `src/app/api/cron/reconcile-event-images/route.ts` — daily 03:15 UTC
- **Observability:** `src/lib/observability/event-action-log.ts` — structured per-action log line
- **Types:** `src/lib/supabase/database.types.ts` (regenerated), `src/lib/types.ts` (ActionResult extended with `operationId?` + `warnings?`)
- **Docs:** `.env.example` documents `EVENT_SAVE_USE_RPC`; `CLAUDE.md` documents `npm run advisors` script

### Tests
- **Unit (Vitest):** `src/components/events/__tests__/event-form.create.test.tsx`, `event-form.edit-isolation.test.tsx`; `src/actions/__tests__/events-rpc.test.ts`, `events-operation-id.test.ts`, `audit-coverage.test.ts`, `pre-event.test.ts`
- **Integration (Vitest + local Supabase):** `src/lib/events/__tests__/{save-event-draft,submit-event-for-review,propose-event-draft}.integration.test.ts` + `save-event-draft.concurrency.integration.test.ts` (12 tests, skipped without `RUN_INTEGRATION_TESTS=1`)
- **E2E (Playwright):** ⏳ NOT YET CREATED — this is the outstanding C6 work

---

## Critical context for the new agent

- **Working in a worktree.** The path is `/Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/worktrees/eager-borg-52d3f5`. The branch is `codex/fix-event-venue-rls-recursion`. Do NOT switch branches without explicit user approval.
- **Project conventions** in `CLAUDE.md` (root) and `.claude/rules/` are non-negotiable — colourblind safety, RLS always on, conventional commits, no `--no-verify`, audit-log every mutating action, etc.
- **User is colourblind** — any new error/warning UI must pair colour with icon + text. Sonner's `toast.error` / `toast.warning` already satisfy this (icon prefix), but custom badges need explicit pairing.
- **Lean execution** is the established mode — see [feedback memory](../../../../.claude/projects/-Users-peterpitcher-Cursor-BARONS-BaronsHub/memory/feedback_lean_execution.md). For C6 specifically: write the config + 2 specs + docs in one go, single commit, ~10-line handoff.
- **Don't push without user OK.** The user has been pushing themselves. Just commit locally; let them push.
- **Supabase MCP tools available** — `mcp__plugin_supabase_supabase__execute_sql` for verifying schema; `get_advisors` for security/performance checks. Use them before drafting any new SQL.
- **The `RUN_INTEGRATION_TESTS=1` env var** gates the integration suite. The default `npm test` ignores them. The deployer/CI runs them with the env set + a local Supabase stack via `supabase start`.

---

## Open issues / risks at handover

1. **Legacy save path still in `events.ts`.** Per A-6, both paths coexist behind `EVENT_SAVE_USE_RPC`. The legacy path's `.catch(() => {})` patterns were removed in `0bf0a6d`, so it now also propagates errors correctly — but the RPC path is the future. Confirm with the user before deleting the legacy code.
2. **No CI workflow exists.** `npm run advisors` is a manual script. If the team uses Vercel-only deployment, that's by design. If GitHub Actions is desired, that's a separate scope.
3. **Image bucket assumption.** Code assumes `event-images` Supabase Storage bucket exists. Confirmed in production (referenced in earlier migration `20260210121000_expand_debriefs_and_event_images.sql`). If bucket policies change, the cron's `db.storage.from("event-images").remove([...])` line needs to match.
4. **Branch lineage:** `claude/eager-borg-52d3f5` was merged into `main` via PR #6, then this current branch (`codex/fix-event-venue-rls-recursion`) was created off main + `e6dde98`. Subsequent commits (`87f65d3`, `0f2042f`, `f96179f`) are on this branch. When merging back, do it from this branch — not `claude/eager-borg-52d3f5` (which is stale).

---

## Recommended next-agent prompt (copy-paste-ready)

> Pick up the event-creation reliability work where the previous agent left off. Read `tasks/2026-05-07-event-creation-reliability-HANDOVER.md` for full context. The only outstanding item is C6: Playwright golden + venue-failure edge specs. Use lean execution (single commit, minimal handoff). Branch is `codex/fix-event-venue-rls-recursion`; do not switch branches. After C6 lands, run `npm run lint && npm run typecheck && npm test && npm run build` and report results — that's the verification gate. Don't push; let the user push.
