# Adversarial Review: SOP Checklist Filter — currentUserId Threading Fix

**Date:** 2026-04-14
**Mode:** Code Review (Mode B) with adversarial framing
**Engines:** Claude + Codex
**Scope:** `src/app/planning/page.tsx`, `src/components/planning/planning-board.tsx`, `src/components/planning/planning-item-card.tsx`, `src/components/planning/sop-checklist-view.tsx`
**Spec:** N/A

## Inspection Inventory

### Inspected
- All 4 changed files read completely
- `src/lib/planning/types.ts` — PlanningTask type, assignees shape
- `src/lib/auth.ts` — getCurrentUser implementation, user.id format
- `src/lib/planning/index.ts` — data loading, assignee mapping from junction table
- `src/app/events/[eventId]/page.tsx` — existing currentUserId pattern
- `src/components/planning/planning-list-view.tsx` — no SOP filter dependency
- `src/components/planning/planning-todos-by-person-view.tsx` — assignee fallback pattern
- `src/components/planning/sop-task-row.tsx` — receives but doesn't use currentUserId
- `src/components/planning/planning-task-list.tsx` — no filter dependency
- `src/actions/planning.ts` — server-side mutation auth
- `supabase/migrations/20260408120001_add_planning_task_columns.sql` — junction table schema
- `supabase/migrations/20260408120003_add_sop_rpc_functions.sql` — SOP generation inserts junction rows

### Not Inspected
- Workflow & Failure-Path Codex report did not complete within timeout
- No browser-level testing — cannot verify CSS rendering of active button state
- No Playwright/E2E verification of actual filter behaviour

### Limited Visibility Warnings
- Cannot verify whether the user's "nothing changes" report was about data filtering, button styling, or both
- Cannot verify the actual task data in the user's environment to determine if all filters naturally produce the same result

## Executive Summary

Claude's fix is **mechanically correct** — `currentUserId` was indeed missing from the planning board's component chain and now threads correctly through all 3 levels. However, the **root cause diagnosis is incomplete**: the missing prop only explains why "My Tasks" was broken, not why "Actionable Now" or "Hide Not Required" appeared broken too. Those filters don't depend on `currentUserId` at all. The most likely explanation for those is that the user's task data naturally produced identical results across all filters (all tasks open, unblocked, and none marked not_required).

## What Appears Solid

- **Fix is mechanically correct.** The prop threading from `PlanningPage` → `PlanningBoard` → `PlanningItemCard` → `SopChecklistView` is properly implemented.
- **All usage sites covered.** Both `PlanningItemCard` render paths in `planning-board.tsx` (compact board tile at line 425 and modal at line 500) receive `currentUserId`. The event detail page already had it.
- **Type compatibility verified.** `user.id` is a `string` (UUID). `PlanningTask.assignees` is `Array<{ id: string; name: string; email: string }>`. The comparison `a.id === currentUserId` works correctly.
- **No security risk.** `currentUserId` is used purely for client-side filtering. The full task list is already sent to the client. No new data exposure.
- **Follows established pattern.** The event detail page already passes `currentUserId={user.id}` — this fix aligns the planning board with that existing convention.

## Critical Risks

None. This is a low-risk UI fix with no server-side, data, or security implications.

## Implementation Defects

### IMPL-001: Root cause diagnosis is overclaimed
- **Type:** Plausible but unverified
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `sop-checklist-view.tsx:75-78` — only the `my_tasks` branch uses `currentUserId`. The `actionable` filter (line 77) and `hideNotRequired` toggle (line 81) are independent. If the user reports ALL four buttons "do nothing", this fix only addresses one of the four.
- **Why it may be wrong:** The user may have only tested "My Tasks" and reported generically. Or the task data naturally produced identical results for all filters.
- **What would confirm it:** Ask the user to test after the fix. If "Actionable Now" and "Hide Not Required" still appear to do nothing, the data itself is the cause (all tasks open, unblocked, none marked not_required).
- **Blocking or advisory:** Advisory — the fix is still correct; the diagnosis was just overclaimed.

### IMPL-002: "My Tasks" filter silently degrades to "All" when currentUserId is undefined
- **Type:** Repo-convention conflict
- **Severity:** Low
- **Confidence:** High
- **Evidence:** `sop-checklist-view.tsx:75` — `if (filterMode === "my_tasks" && currentUserId)` short-circuits to showing all tasks instead of showing a warning or empty state.
- **Why it may be wrong:** This is an intentional graceful degradation pattern — showing all tasks is arguably better than crashing or showing nothing.
- **What would confirm it:** Design decision — acceptable as-is for a planning tool where all users can see all tasks anyway.
- **Blocking or advisory:** Advisory

### IMPL-003: Potential assignee data inconsistency between legacy and junction table paths
- **Type:** Plausible but unverified
- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:** `planning-todos-by-person-view.tsx:58` falls back to `assigneeId/assigneeName` when `task.assignees` is empty. But `sop-checklist-view.tsx:76` only checks `task.assignees`. If a task has `assignee_id` set but no corresponding `planning_task_assignees` junction row, "My Tasks" will miss it. Generic create/update helpers write only `assignee_id` (`planning/index.ts:846, 872`), while SOP generation and explicit reassignment insert junction rows.
- **Why it may be wrong:** SOP tasks (which is what this checklist view shows) are generated by the SOP RPC function which does insert junction rows. Non-SOP tasks don't go through `SopChecklistView`.
- **What would confirm it:** Check whether any SOP tasks can have `assignee_id` set without a junction row. If SOP generation always creates junction rows, this is a non-issue for this component.
- **Blocking or advisory:** Advisory

## Architecture & Integration Defects

None. The fix correctly follows the existing prop-threading pattern used by the event detail page.

## Security & Data Risks

**No security findings.** Per Codex security review:
- `currentUserId` is sourced from authenticated server context
- Used purely for client-side filtering of already-loaded data
- No new data exposure or authorization boundary changes
- Established pattern in the codebase (event detail page)

## Unproven Assumptions

1. **The user's issue was specifically about "My Tasks" not filtering.** If their issue was about ALL filters appearing to do nothing, the root cause may be the task data itself (all tasks matching all filter criteria), not the missing prop.

2. **Button styling was changing.** Claude claimed the active/inactive pill styling should have been toggling even without the fix. This is likely correct (React state controls the class), but cannot be verified without browser testing.

## Recommended Fix Order

1. **Merge the current fix as-is** — it's correct and necessary regardless of whether the root cause diagnosis is complete.
2. **Ask the user to test** — specifically check whether "Actionable Now" and "Hide Not Required" now appear to work after the fix.
3. **If they still report "nothing changes"** — the issue is the task data, not the code. All tasks being open/unblocked/not-marked-as-not-required would produce this UX.

## Follow-Up Review Required

- Verify the fix works in the user's browser after deployment
- If IMPL-003 (assignee data inconsistency) proves real, consider adding a fallback to `assigneeId` in the "My Tasks" filter
