# Orchestration Plan: Event Creation Reliability

**Source plan:** [docs/superpowers/plans/2026-05-07-event-creation-reliability.md](../../docs/superpowers/plans/2026-05-07-event-creation-reliability.md)

## Plan Summary
Execute the 4-phase event-creation reliability remediation: UX guardrails (A′), atomic save RPC + image state machine (B′), propose flow (B″), verification + observability (C′). 7 agents across 4 waves; ~26 commits.

## Work streams

| # | Role | Wave | Depends On | Owns | Outputs |
|---|------|------|------------|------|---------|
| 1 | Form Surgeon | 1 | None | A1–A5, A7 in event-form.tsx + parents + ActionResult type | UI behaviour fixes, operation_id propagation, dirty-state reset, key prop |
| 2 | RLS Migrator | 1 | None | A6 RLS migration | New migration loosening events SELECT for office_workers |
| 3 | RPC Plumber | 2 | Wave 1 | B0 (idempotency + image col) + B1 (save_event_draft) + B2 (submit_event_for_review) | 3 migrations, regenerated types |
| 4 | Action Rewirer | 3 | Wave 2 (RPCs), Wave 1 (operation_id) | B3 (rewire behind flag) + B5 (docs) + B6 (typed cleanup) | events.ts updated, save-rpc.ts helper, env docs |
| 5 | Image State Engineer | 3 | Wave 2 (pending_image_attach col) | B4 image state machine + reconcile cron | Cron route, image flow updates, retry UI |
| 6 | Propose Surgeon | 4 | Wave 3 (helper pattern) | B″1 + B″2 — propose RPC + rewire | New RPC + rewired proposeEventAction |
| 7 | Verification Engineer | 4 | Wave 3 | C1–C6 — integration tests, concurrency, advisor CI, logging, audit guard, Playwright | New tests, CI workflow, structured logger |

## Wave structure
- **Wave 1** (parallel): Form Surgeon, RLS Migrator. Independent file domains.
- **Wave 2** (single agent): RPC Plumber. SQL chain depends on no other work.
- **Wave 3** (parallel): Action Rewirer, Image State Engineer. Different files.
- **Wave 4** (parallel): Propose Surgeon, Verification Engineer. Different files.

## Workspace
- Each agent writes a `handoff.md` under `tasks/implement-plan/wave-N/<role>/handoff.md`
- All code lands directly in src/ and supabase/migrations/ committed to branch `claude/eager-borg-52d3f5`
- Final adversarial review via `codex-qa-review` (Mode B) on the cumulative diff

## Verification gates
- After every wave: orchestrator runs `npm run lint && npm run typecheck && npm test` to confirm cumulative state is green
- After all waves: orchestrator triggers codex-qa-review on the final diff
- Apply blocking findings as repair agents
