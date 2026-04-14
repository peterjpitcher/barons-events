# Workflow & Failure-Path Review: Planning Todos by Person Filter

**Date:** 2026-04-14
**Reviewer:** Workflow & Failure-Path Reviewer (Adversarial)
**Scope:** `planning-todos-by-person-view.tsx`, `planning-alert-strip.tsx`, `planning-board.tsx`

---

## User Workflow Walk-Through

### 1. Default View

User opens `/planning` -> page.tsx fetches user, passes `currentUserId={user.id}` -> clicks "Todos by person" tab -> `switchView("todos_by_person")` called -> `todoAlertFilter` set to `null` (already null) -> `PlanningTodosByPersonView` renders with `showEveryone=false` -> `visibleGroups` filters to only groups where `key === currentUserId` -> default date filter: `task.dueDate > today` excluded -> user sees only their own tasks due today or overdue.

**Verdict:** Works correctly. Current user's section sorts first via the comparator at line 131-133.

### 2. Toggle Everyone

User clicks "Show everyone" -> `setShowEveryone(true)` -> `visibleGroups` returns all `grouped` entries -> user sees all people's tasks. Clicks "Show my tasks" -> `setShowEveryone(false)` -> filtered back.

**Verdict:** Works correctly. The toggle button only renders when `currentUserId` is truthy (line 188).

### 3. Alert Card Click

User clicks "Overdue tasks" card -> `onFilterClick` in board.tsx (line 381) fires -> `setTodoAlertFilter(current => current === filter ? null : filter)` toggles -> also `setViewMode("todos_by_person")` if not already on that view -> `PlanningTodosByPersonView` receives `alertFilter="overdue_tasks"` -> date filter changes to `task.dueDate >= today` return (line 84) -> only truly overdue tasks shown.

Clicking same card again -> toggle sets `todoAlertFilter` back to `null` -> default filter resumes.

Clicking "Due soon tasks (7d)" -> filter switches to `due_soon_tasks` -> tasks where `task.dueDate >= today && task.dueDate <= sevenDaysOut` shown.

**Verdict:** Works correctly. React 18+ batches both `setTodoAlertFilter` and `setViewMode` in the same event handler.

### 4. Mark Task Done

User checks task -> `handleMarkDone(taskId)` -> `setOptimisticallyDone` adds taskId -> task vanishes from `grouped` (filtered at line 76) -> `startTransition` calls server action -> on success: `router.refresh()` reloads data -> on failure: taskId removed from `optimisticallyDone` set, toast shown, task reappears.

**Verdict:** Works correctly. The `optimisticallyDone` set is a dependency of the `grouped` useMemo, so removal triggers re-computation.

### 5. Collapse/Expand

User clicks section header button -> `toggleSection(key)` -> `collapsedSections` set updated -> `isCollapsed` checked at line 251 -> tasks hidden/shown.

**Verdict:** Works. Collapse state is independent of data; sections remain collapsed even after data changes.

### 6. View Switching with Alert Filter

User has `todos_by_person` with alert filter active -> clicks "Board" -> `switchView("board")` -> line 298-299 clears `todoAlertFilter` to `null` -> switches back to "Todos by person" -> filter is cleared, default view shown.

**Verdict:** Works as designed. `switchView` correctly clears the filter when leaving `todos_by_person`.

### 7. Search + Filter Combo

User types in search box -> `filteredPlanningItems` filters by text (line 112-129) -> this filtered set is passed to `PlanningTodosByPersonView` as `items` (line 491) -> alert filter further filters within the component -> both filters compose.

**Verdict:** Works correctly. Search operates at board level, alert filter at component level.

### 8. Open Planning Item

User clicks "Open" on a task -> `onOpenPlanningItem(task.planningItem)` called -> board receives it via `(item) => setActiveItemId(item.id)` (line 495) -> `activeItem` computed -> modal opens with `PlanningItemCard`.

**Verdict:** Works correctly.

---

## Failure Paths

### WF-001: `currentUserId` undefined fallback

| Field | Value |
|---|---|
| **Type** | Logic gap |
| **Severity** | Low |
| **Confidence** | High |
| **Evidence** | `planning-todos-by-person-view.tsx:142-144` |
| **Failure scenario** | If `currentUserId` is `undefined`, `visibleGroups` returns all `grouped` (line 143: `if (showEveryone || !currentUserId) return grouped`). The toggle button is hidden (line 188). User sees everyone's tasks with no way to filter. This is actually correct defensive behaviour since the page.tsx always provides `currentUserId` from the authenticated user (line 40). |
| **Blocking/Advisory** | Advisory |

**Finding:** When `currentUserId` is undefined, the component degrades gracefully to showing all tasks with the toggle hidden. No crash. However, the "(you)" label never appears and the current-user-first sort has no effect. This is acceptable since page.tsx guarantees `currentUserId` is always provided via auth redirect.

### WF-002: Rapid mark-done on multiple tasks

| Field | Value |
|---|---|
| **Type** | Race condition |
| **Severity** | Medium |
| **Confidence** | Medium |
| **Evidence** | `planning-todos-by-person-view.tsx:162-178` |
| **Failure scenario** | User rapidly checks 3 tasks. Each call adds to `optimisticallyDone` via `new Set(current).add(taskId)` which is safe (functional update). `isPending` from `useTransition` is shared -- only one transition runs at a time in React. Second and third clicks while `isPending` is true will hit the `disabled={isPending}` guard on the checkbox button (line 266), preventing the click. |
| **Blocking/Advisory** | Advisory |

**Finding:** The `disabled={isPending}` on the checkbox button prevents concurrent mark-done operations. This means the user must wait for each server round-trip before marking the next task. This is UX-limiting but safe. A concern: if the first transition takes 3+ seconds, the user cannot mark other tasks during that window. Consider using separate pending states per task or `useOptimistic` for better UX.

### WF-003: Toggle "Show everyone" during pending mark-done

| Field | Value |
|---|---|
| **Type** | State interaction |
| **Severity** | Low |
| **Confidence** | High |
| **Evidence** | `planning-todos-by-person-view.tsx:64-66, 162-178` |
| **Failure scenario** | User marks task done (optimistically removed) -> immediately toggles "Show everyone" -> `visibleGroups` recomputes using current `optimisticallyDone` set -> task remains hidden in all views. If server fails, `optimisticallyDone` removes the taskId -> task reappears in the correct group regardless of toggle state. |
| **Blocking/Advisory** | Advisory |

**Finding:** No issue. The `grouped` memo depends on `optimisticallyDone`, and `visibleGroups` depends on `grouped` and `showEveryone`. Both recompute correctly regardless of toggle timing.

### WF-004: Collapsed sections after mark-done removes last task

| Field | Value |
|---|---|
| **Type** | UX ghost state |
| **Severity** | Low |
| **Confidence** | High |
| **Evidence** | `planning-todos-by-person-view.tsx:128, 151-159` |
| **Failure scenario** | User has a section with 1 task, marks it done -> `grouped` recomputes -> `.filter((group) => group.tasks.length > 0)` at line 128 removes the empty group -> section vanishes from render. Collapsed state for that key remains in `collapsedSections` set (stale entry). |
| **Blocking/Advisory** | Advisory |

**Finding:** The stale key in `collapsedSections` is a minor memory leak but causes no functional issue. The section simply disappears. If the group later reappears (e.g., server failure reverts the mark-done), it will still be collapsed, which is actually good UX continuity. No action needed.

### WF-005: Alert filter active, last task in group marked done

| Field | Value |
|---|---|
| **Type** | UX edge case |
| **Severity** | Low |
| **Confidence** | High |
| **Evidence** | `planning-todos-by-person-view.tsx:76-94, 128, 211-215` |
| **Failure scenario** | Alert filter "overdue_tasks" active -> user marks the last overdue task done -> all groups become empty -> `visibleGroups.length === 0` -> empty state message shows: "No open tasks found for the current filters." (line 215). The alert strip still shows the old count until `router.refresh()` completes. |
| **Blocking/Advisory** | Advisory |

**Finding:** Brief inconsistency between the alert strip count and the empty todo view. The alert strip counts come from `data.alerts` which is server-provided and only updates on `router.refresh()`. The todo view filters optimistically. This temporal mismatch lasts only until the refresh completes (typically < 1 second). Acceptable.

### WF-006: `addDays(today, 7)` unexpected format

| Field | Value |
|---|---|
| **Type** | Correctness check |
| **Severity** | None |
| **Confidence** | High |
| **Evidence** | `planning/utils.ts:49-53` |
| **Failure scenario** | `addDays` calls `parseDateOnly` (validates YYYY-MM-DD format strictly, rejects invalid dates) then adds days via UTC date math, returns `formatDateOnly` (ISO slice). If `today` is a valid ISO date string, this always returns a valid ISO date string. |
| **Blocking/Advisory** | Not a finding -- confirmed safe |

**Finding:** `addDays` is robust. It validates input, uses UTC arithmetic, and returns ISO format. No risk of unexpected format.

### WF-007: React state batching for alert card clicks

| Field | Value |
|---|---|
| **Type** | Framework behaviour |
| **Severity** | None |
| **Confidence** | High |
| **Evidence** | `planning-board.tsx:381-385` |
| **Failure scenario** | `onFilterClick` calls `setTodoAlertFilter(...)` and conditionally `setViewMode(...)` in the same synchronous event handler. React 18+ automatic batching guarantees a single re-render for both state updates. |
| **Blocking/Advisory** | Not a finding -- confirmed safe |

**Finding:** Both state updates are batched. No intermediate render with inconsistent state.

---

## Edge Cases

### WF-008: User has no tasks assigned

| Field | Value |
|---|---|
| **Type** | UX edge case |
| **Severity** | Low |
| **Confidence** | High |
| **Evidence** | `planning-todos-by-person-view.tsx:211-215` |
| **Failure scenario** | `grouped` produces no entry for `currentUserId` -> `visibleGroups` (filtered to current user) is empty -> empty state: "No open tasks assigned to you. Click \"Show everyone\" to see all tasks." (line 213, when `allTotalOpen > 0`). If nobody has tasks: "No open tasks found for the current filters." |
| **Blocking/Advisory** | Advisory |

**Finding:** Both empty states are handled with appropriate messaging. The conditional at line 213 correctly distinguishes between "you have nothing but others do" vs "nobody has anything."

### WF-009: Tasks only via multi-assignees, not legacy assigneeId

| Field | Value |
|---|---|
| **Type** | Data model edge case |
| **Severity** | Medium |
| **Confidence** | High |
| **Evidence** | `planning-todos-by-person-view.tsx:106-118` |
| **Failure scenario** | When `task.assignees.length > 0`, the code iterates through `task.assignees` and creates a bucket per assignee (line 113-117). The legacy `assigneeId` path (line 106-110) is only used when `assignees` array is empty. A task with both `assigneeId` set AND `assignees` populated will only use the `assignees` array, ignoring `assigneeId`. |
| **Blocking/Advisory** | Advisory |

**Finding:** This is correct behaviour -- multi-assignees supersede legacy single assignee. However, if a task has `assignees = [{id: "abc", name: "Alice"}]` AND `assigneeId = "xyz"`, the task appears under Alice, not xyz. This is intentional but worth documenting.

**Potential issue:** A task with multiple assignees appears in multiple person groups. If the user marks it done from one group, it optimistically vanishes from ALL groups (since `optimisticallyDone` filters by `task.id` at line 76, which is the same across all groups). This is correct.

### WF-010: All tasks optimistically done, server hasn't confirmed

| Field | Value |
|---|---|
| **Type** | UX edge case |
| **Severity** | Low |
| **Confidence** | High |
| **Evidence** | `planning-todos-by-person-view.tsx:76, 266` |
| **Failure scenario** | Due to `disabled={isPending}`, only one task can be marked done at a time. The user cannot create a state where "all tasks are optimistically done but server hasn't confirmed" for more than one task simultaneously. After each server confirmation + `router.refresh()`, the page data updates. |
| **Blocking/Advisory** | Advisory |

**Finding:** The `isPending` guard serialises mark-done operations, preventing a scenario where multiple tasks are in an unconfirmed optimistic state simultaneously. This is safe but limits throughput.

### WF-011: "tbd" group with no currentUserId

| Field | Value |
|---|---|
| **Type** | Logic edge case |
| **Severity** | Low |
| **Confidence** | High |
| **Evidence** | `planning-todos-by-person-view.tsx:107, 129-138, 142-144` |
| **Failure scenario** | If `currentUserId` is undefined: `visibleGroups = grouped` (all groups shown). The "tbd" group sorts last (line 135-136). No "(you)" annotation appears anywhere. The "tbd" group label shows "To be determined" (line 108). |
| **Blocking/Advisory** | Advisory |

**Finding:** Correct behaviour. The "tbd" group is always last, and without `currentUserId` no group gets special treatment.

---

## Summary

| Severity | Count |
|---|---|
| Blocking | 0 |
| Medium (Advisory) | 2 (WF-002, WF-009) |
| Low (Advisory) | 7 |
| Not a finding | 2 |

### Key Recommendations

1. **WF-002 (Medium):** Consider per-task pending state instead of global `isPending` from `useTransition`. Currently users must wait for each server round-trip before marking the next task. Using individual pending states or `useOptimistic` would allow rapid multi-task completion.

2. **WF-009 (Medium):** Document the multi-assignee vs legacy assigneeId precedence rule. The current logic is correct but the implicit priority could confuse future developers.

3. **WF-005 (Low):** The brief alert count / empty view mismatch after optimistic mark-done is cosmetic and resolves on refresh. No action needed unless UX polish is desired.

### Overall Assessment

The implementation is solid with good defensive patterns. All critical workflows complete without errors. The optimistic update pattern with revert-on-failure is correctly implemented. State interactions between `showEveryone`, `collapsedSections`, `optimisticallyDone`, and `alertFilter` are orthogonal and compose correctly via React's memo/state system. No blocking issues found.
