# Form Surgeon — Wave 1 / Phase A′ handoff

**Owner:** Form Surgeon (this session)
**Branch:** `claude/eager-borg-52d3f5`
**Tasks completed:** A1, A2, A3, A4, A5, A7 (A6 was already landed by a parallel agent — commit `411b6bf`)

## Commits (in order)

| Hash | Task | Subject |
|------|------|---------|
| `cb16668` | A1 | fix(events): disable save and submit buttons while action is pending |
| `e75616f` | A2 | fix(events): always show error toast on action failure |
| `22e569c` | A3 | test(events): cover dirty-state reset on successful save |
| `00c47cc` | A4 | fix(events): replace defaultValues reset effect with parent-side key prop |
| `5451a91` | A5 | feat(events): propagate operation_id from form mount to action returns and audit meta |
| `1f41aa9` | A7 | feat(events): surface 8-char operation_id in error toasts |

## Files touched

- `src/components/events/event-form.tsx`
- `src/components/events/__tests__/event-form.create.test.tsx` (extended)
- `src/components/events/__tests__/event-form.edit-isolation.test.tsx` (new)
- `src/actions/events.ts`
- `src/actions/__tests__/events-operation-id.test.ts` (new)
- `src/lib/types.ts`
- `src/app/events/[eventId]/page.tsx`
- `src/app/events/new/page.tsx`

## Verification

- `npm run lint` → 0 errors, 2 pre-existing warnings (unrelated, in `session-monitor.tsx`)
- `npm run typecheck` → clean
- `npm test -- events` → 8 test files / 56 tests pass

## Deviations from the plan

1. **UUID library:** plan says check for `uuid >= 9` and use `uuidv7` if present, else `crypto.randomUUID()`. `package.json` has no `uuid` dep, so I went straight to `crypto.randomUUID()` (with a guarded fallback for ancient runtimes). Same UUID format and validity, just v4 instead of v7 — time-orderability is nice-to-have, not load-bearing per the spec.
2. **A3 (dirty-state reset):** investigation showed the existing `setIsDirty(false)` in the success-branch effects already handled this correctly. No code change required; only added a regression test. Commit message reflects this.
3. **`fireEvent.click(submitButton)` did not engage React 19's form-action handler in JSDOM** — the form's action attribute is rewritten to a `javascript:throw` sentinel that is only intercepted by React's own dispatcher. Switched the toast tests to call `form.requestSubmit(button)` directly. Documented in a comment in the test file.
4. **Disable-button test had to run last** — the never-resolving mock used in the disable test put `useActionState` into a sticky pending state that survived `vi.resetAllMocks()` (because the pending Promise was not GC'd). Moving that describe block to the bottom of the file fixed it without forcing a custom `vi.useFakeTimers()` setup.
5. **Toast useEffect line numbers** in the original spec said 245-251, my edit confirmed it was 242-281 (4 useEffect blocks total) plus an `artistCreateState` block at line 338. All five gating patterns removed.

## What I left for later waves

- `idempotency_key` is **emitted** into the form (hidden input, ref, rotation on success) but the server actions do **not** read it yet — the spec told me to wire only `operation_id` here and let the Action Rewirer (Wave 3) consume `idempotency_key` when the atomic-save RPC lands.
- `warnings?: string[]` is in `ActionResult` but unused. The Image State Engineer (Wave 3) will populate it.
- Propose flow uses `ProposeEventForm`, not `EventForm` — left untouched for the Propose Surgeon (Wave 4).
- The two `.catch(() => {})` calls on `recordAuditLogEntry` in `saveEventDraftAction` and `submitEventForReviewAction` were left in place — Action Rewirer (Wave 3) owns those per the brief.

## Key behaviour notes for downstream agents

- **`key={defaultValues?.id ?? "new"}` is now contractual.** Any new EventForm mount must include it, otherwise a parent revalidation could leak stale defaults. The in-component prop-reset useEffect has been deleted; the parent key is the only seam.
- **`operationId` will always be present in `ActionResult` from `saveEventDraftAction` and `submitEventForReviewAction`** (even on permission-denied, missing-event, validation-fail, etc. — every return path has it). Code that constructs other `ActionResult` payloads is free to omit it.
- **The form rotates `operationIdRef` and `idempotencyKeyRef` on every successful save**, so a re-submission gets a fresh pair. This is critical for the upcoming RPC path — re-saves must not deduplicate as the same logical operation.

## Route-file changes recorded

The harness recorded structural changes for `src/app/events/[eventId]/page.tsx` and `src/app/events/new/page.tsx`. The orchestrator should run `/session-setup partial` before the next wave to refresh the architecture snapshot.

## Self-check (per brief)

- [x] All 6 commits exist on branch
- [x] `npm run lint && npm run typecheck && npm test -- events` all pass
- [x] No new `as any` introduced (all 11 hits are pre-existing)
- [x] No `console.log` added to production paths
- [x] No `else if (!.*?fieldErrors)` patterns remain in `event-form.tsx`
- [x] `handoff.md` lists every commit hash + file touched (this file)
