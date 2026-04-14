# Assumption Breaker Report: Planning Todos Filter Changes

**Date:** 2026-04-14
**Scope:** Alert-filter interaction, "my tasks" toggle, collapsible sections, overdue indicators in the Todos by Person view
**Files reviewed:** `src/lib/planning/types.ts`, `src/components/planning/planning-alert-strip.tsx`, `src/components/planning/planning-todos-by-person-view.tsx`, `src/components/planning/planning-board.tsx`, `src/lib/planning/utils.ts`, `src/lib/planning/index.ts`, `src/lib/utils/format.ts`, `src/app/planning/page.tsx`

---

## 1. Assumption Mining

### AB-001: `task.dueDate` always exists and is a valid YYYY-MM-DD string
- **Classification:** Verified
- **Evidence:** `supabase/migrations/20260223120000_add_planning_workspace.sql:80` declares `due_date date not null`. The `PlanningTask` type at `src/lib/planning/types.ts:29` types it as `string` (not nullable). The mapper at `src/lib/planning/index.ts:130` assigns `task.due_date` directly with no fallback, which is correct given the NOT NULL constraint.
- **Severity:** N/A
- **Action required:** None

### AB-002: String comparison works correctly for YYYY-MM-DD date filtering
- **Classification:** Verified
- **Evidence:** All dates are stored as ISO `YYYY-MM-DD` strings. Lexicographic comparison (`<`, `>`, `>=`, `<=`) produces correct chronological ordering for this format. This pattern is used consistently in `src/lib/planning/utils.ts` (lines 61-67, `minDate`/`maxDate`) and the server-side alert computation at `src/lib/planning/index.ts:573-580`.
- **Severity:** N/A
- **Action required:** None

### AB-003: `addDays` from planning/utils works correctly for the 7-day window
- **Classification:** Verified
- **Evidence:** `src/lib/planning/utils.ts:49-53` — uses `parseDateOnly` (which validates input) then `setUTCDate` with delta, reformats via `formatDateOnly`. Works correctly for month/year boundaries because UTC date arithmetic handles rollover. The server-side code uses the identical function at `src/lib/planning/index.ts:570`.
- **Severity:** N/A
- **Action required:** None

### AB-004: `currentUserId` always gets passed through correctly
- **Classification:** Verified
- **Evidence:** `src/app/planning/page.tsx:40` passes `currentUserId={user.id}` after auth check. `user` is guaranteed non-null at that point (line 15-17 redirects if null). The prop is typed as `string | undefined` in `PlanningBoardProps` (`src/components/planning/planning-board.tsx:35`) and `PlanningTodosByPersonViewProps` (`src/components/planning/planning-todos-by-person-view.tsx:15`), correctly handling the optional case even though the planning page always provides it.
- **Severity:** N/A
- **Action required:** None

### AB-005: Alert filter toggle (on/off) and clear-on-view-switch behave correctly
- **Classification:** Verified
- **Evidence:** `src/components/planning/planning-board.tsx:381` toggles: `setTodoAlertFilter((current) => (current === filter ? null : filter))` — clicking the same filter deselects it, clicking a different one switches. Line 382-384 auto-switches to `todos_by_person` view. `switchView` at line 296-301 clears the filter when switching away from `todos_by_person`. The alert strip only shows active state when `viewMode === "todos_by_person"` (line 379).
- **Severity:** N/A
- **Action required:** None

### AB-006: Multi-assignee tasks are correctly handled with the "my tasks" filter
- **Classification:** **UNVERIFIED -- potential issue**
- **Evidence:** `src/components/planning/planning-todos-by-person-view.tsx:106-118` handles multi-assignees by iterating `task.assignees` and creating a bucket for each assignee. However, the `visibleGroups` filter at line 143 filters by `group.key === currentUserId`. This means a task assigned to the current user via the `assignees` array WILL correctly appear. But there is a subtle duplication concern: if a task has `assigneeId` set to user X AND user X is also in the `assignees` array, the code at line 106 checks `task.assignees.length === 0` first. If `assignees` is populated, it only uses `assignees` (line 113), ignoring `assigneeId`. This is correct behaviour -- the `assignees` array supersedes the legacy `assigneeId` field.
- **Severity:** Low
- **Confidence:** 85%
- **Action required:** Confirm that the data layer always populates `assignees` when multi-assignment is used, and that `assigneeId` is only relied upon for legacy single-assignee tasks where `assignees` is empty.

### AB-007: `optimisticallyDone` set interaction is safe with filters
- **Classification:** Verified
- **Evidence:** `optimisticallyDone` is checked at line 76 in the `grouped` useMemo, which excludes done tasks before any filter logic runs. The set is included in the useMemo dependency array (line 139). When a task is optimistically marked done, the useMemo recomputes and the task disappears from all filtered views. On error rollback (line 168-171), the task reappears. No stale closure risk because `handleMarkDone` uses functional state updates (`setOptimisticallyDone((current) => ...)`) at lines 163 and 168.
- **Severity:** N/A
- **Action required:** None

---

## 2. Completeness Testing

### AB-008: All four alert filter modes implementation correctness
- **Classification:** Verified with caveats
- **Evidence:** `src/components/planning/planning-todos-by-person-view.tsx:79-94` implements all four modes:
  - `overdue_items`: filters on `item.targetDate < today` -- matches server logic at `index.ts:573`
  - `overdue_tasks`: filters on `task.dueDate < today` -- matches server logic at `index.ts:579`
  - `due_soon_items`: filters on `item.targetDate >= today && item.targetDate <= sevenDaysOut` -- matches server logic at `index.ts:574-576`
  - `due_soon_tasks`: filters on `task.dueDate >= today && task.dueDate <= sevenDaysOut` -- matches server logic at `index.ts:580`
- **Severity:** N/A
- **Action required:** None

### AB-009: "overdue_items" filter does NOT check item status
- **Classification:** **CONTRADICTED -- count mismatch risk**
- **Evidence:** The server-side alert count at `src/lib/planning/index.ts:573` filters by `openItemStatuses.has(item.status)` -- only counting items with status `planned`, `in_progress`, or `blocked`. But the client-side filter at `src/components/planning/planning-todos-by-person-view.tsx:81` only checks `item.targetDate >= today` -- it does NOT check item status. Similarly for `due_soon_items` at line 87.
  
  **Impact:** Items with status `done` or `cancelled` that have a past `targetDate` will have their tasks shown in the client-side filtered view, but those items are NOT counted in the alert strip number. This creates a **count mismatch**: the alert strip might say "3 overdue items" but clicking it shows tasks from more items (including done/cancelled ones).
  
  **However**, there is a partial mitigation: line 76 filters out tasks with `status === "done"` or `"not_required"`. So only open tasks from done/cancelled ITEMS would show. But those tasks should arguably not appear under "overdue items" since the item itself is complete.
- **Severity:** **Medium**
- **Confidence:** 95%
- **Action required:** Add item status filtering in the client-side `overdue_items` and `due_soon_items` branches. Check `item.status` against the same `["planned", "in_progress", "blocked"]` set used server-side.

### AB-010: What happens when currentUserId is undefined
- **Classification:** Verified (safe)
- **Evidence:** If `currentUserId` is undefined:
  - `src/components/planning/planning-todos-by-person-view.tsx:188`: the "My tasks / Show everyone" toggle button is hidden (wrapped in `{currentUserId && ...}`)
  - Line 143: `!currentUserId` causes `visibleGroups` to return all `grouped` entries (no user filter applied)
  - Line 131-132: current user sorting is skipped when `!currentUserId`
  - This is a graceful degradation -- all tasks shown, no user-specific features.
- **Severity:** N/A
- **Action required:** None

### AB-011: Empty state messaging correctness
- **Classification:** Verified
- **Evidence:** `src/components/planning/planning-todos-by-person-view.tsx:211-215` shows:
  - When `!showEveryone && currentUserId && allTotalOpen > 0`: "No open tasks assigned to you. Click \"Show everyone\" to see all tasks." -- correct, user has no tasks but others do.
  - Otherwise: "No open tasks found for the current filters." -- correct generic fallback.
  - When filter is active, the description updates via `getFilterDescription()` (line 40-53) -- each mode has a specific message.
- **Severity:** N/A
- **Action required:** None

### AB-012: Overdue visual indicator and colourblind accessibility
- **Classification:** **UNVERIFIED -- accessibility concern**
- **Evidence:** The overdue indicator at `src/components/planning/planning-todos-by-person-view.tsx:259` uses a burgundy border (`border-[rgba(110,60,61,0.3)]`) AND at line 274 adds the text "Overdue" in bold alongside the colour. The text label "Overdue" is the non-colour indicator, which satisfies the colourblind accessibility requirement. The border colour difference alone would not be sufficient, but the explicit text label is present.
  
  **However**, the border colour change from default `border-[var(--color-border)]` to `border-[rgba(110,60,61,0.3)]` is the ONLY visual difference on the card container level. If the user misses the small "Overdue" text in the subtitle, the border colour alone might not register. Consider adding an icon (e.g., AlertTriangle) as an additional non-colour indicator at the card level.
- **Severity:** Low
- **Confidence:** 75%
- **Action required:** Consider adding an icon (AlertTriangle or similar) next to the "Overdue" text label for stronger non-colour signalling. The current text label is technically sufficient per WCAG 1.4.1, but an icon would be a stronger signal for colourblind users.

---

## 3. Codebase Fit

### AB-013: `<article>` to `<button>` change in alert strip
- **Classification:** **UNVERIFIED -- potential semantic concern**
- **Evidence:** `src/components/planning/planning-alert-strip.tsx:67` changed from `<article>` to `<button type="button">`. The styling is inline Tailwind classes, not targeted by tag name, so no CSS breakage. The `<button>` is semantically better for interactive elements. `text-left` is applied to override button's default centre alignment. `disabled:cursor-default` handles non-clickable state.
  
  **Concern:** The button contains block-level content (`<p>` tags at lines 74 and 78). While browsers tolerate `<p>` inside `<button>`, this is technically invalid HTML per the spec (buttons should only contain phrasing content). Use `<span className="block ...">` instead of `<p>` for valid HTML.
- **Severity:** Low
- **Confidence:** 90%
- **Action required:** Replace `<p>` elements inside the `<button>` with `<span className="block ...">` for valid HTML nesting.

### AB-014: TodoAlertFilter type follows existing patterns
- **Classification:** Verified
- **Evidence:** `src/lib/planning/types.ts:96` defines `TodoAlertFilter` as a union of string literals, matching the pattern of `PlanningItemStatus`, `PlanningTaskStatus`, `PlanningBucketKey`, etc. in the same file. Naming convention (`PascalCase` for types, `snake_case` for values) is consistent.
- **Severity:** N/A
- **Action required:** None

### AB-015: `switchView` function pattern consistency
- **Classification:** Verified
- **Evidence:** The `switchView` function at `src/components/planning/planning-board.tsx:296-301` is a simple state-setting helper that also clears dependent state. This pattern is consistent with how the component manages related state (e.g., `setActiveItemId(null)` in the useEffect at line 291-294). The function is used by all view-switching buttons.
- **Severity:** N/A
- **Action required:** None

---

## 4. Hidden Risks

### AB-016: Alert count vs. filtered task count mismatch
- **Classification:** **CONTRADICTED -- confirmed mismatch**
- **Evidence:** This extends AB-009. The alert strip counts are computed server-side across ALL planning items (unfiltered). But the todos view receives `filteredPlanningItems` (line 490 in planning-board.tsx), which is filtered by search query and venue filter. 
  
  **Scenario:** User searches for "Marketing" in the search bar. The alert strip still shows "5 overdue tasks" (server-computed, unfiltered). Clicking "overdue tasks" switches to todos view, which only shows overdue tasks from items matching "Marketing" -- perhaps only 2 tasks. The number "5" in the strip does not match the "2 open tasks" shown in the view.
  
  This is a confusing UX -- the alert strip promises N items but the view shows fewer because of the search/venue filter.
- **Severity:** **Medium**
- **Confidence:** 95%
- **Action required:** Either (a) recompute alert counts client-side from `filteredPlanningItems` when search/venue filters are active, or (b) clear search/venue filters when an alert is clicked, or (c) display a notice that search filters are reducing the visible results.

### AB-017: Performance of multiple useMemo chain with 5900+ items
- **Classification:** Unverified
- **Evidence:** The todos view has two useMemo passes: `grouped` (line 70-139) iterates all items and their tasks with nested loops and Map operations. `visibleGroups` (line 142-145) is a simple filter. The `grouped` memo depends on `optimisticallyDone` which creates a new Set on every mark-done, triggering full recomputation. For 5900 items each with ~5-10 tasks, this is ~30-60K iterations per recomputation.
  
  **Assessment:** This is likely fine for modern browsers. JavaScript can handle 60K simple iterations in under 10ms. The `optimisticallyDone` Set creating a new object on each toggle is standard immutable React pattern. No performance concern at this scale.
- **Severity:** Low
- **Confidence:** 80%
- **Action required:** None immediately. Monitor if users report sluggishness.

### AB-018: Stale closure risk in toggle/mark-done handlers
- **Classification:** Verified (safe)
- **Evidence:** `handleMarkDone` at line 162 uses functional state updates (`setOptimisticallyDone((current) => ...)`) which always receive the latest state. `toggleSection` at line 150 also uses functional updates. `startTransition` wraps the async operation. `router.refresh()` is called on success to sync server state. No stale closure risk.
- **Severity:** N/A
- **Action required:** None

### AB-019: Clicking alert when already on todos view does not reset "Show everyone" toggle
- **Classification:** **UNVERIFIED -- UX concern**
- **Evidence:** When a user clicks an alert card while already on the todos view, the `onFilterClick` handler at `src/components/planning/planning-board.tsx:381-385` toggles the filter but does NOT reset `showEveryone` state (which lives inside the `PlanningTodosByPersonView` component). If the user was viewing "my tasks only" and clicks "overdue tasks", they might miss overdue tasks assigned to others.
  
  The alert strip counts are computed across ALL users' tasks, so the count might include tasks not assigned to the current user. But the todos view, defaulting to "my tasks", would only show the current user's subset.
- **Severity:** Low-Medium
- **Confidence:** 85%
- **Action required:** Consider auto-switching to "Show everyone" when an alert filter is activated, since alert counts are computed across all users. Alternatively, note in the filter description that it shows only the current user's tasks.

---

## What Appears Sound

1. **Date arithmetic** -- All string-based YYYY-MM-DD comparisons are correct and consistent with the server-side implementation.
2. **Type safety** -- `TodoAlertFilter` union type is well-scoped and follows existing naming conventions.
3. **Optimistic updates** -- The `optimisticallyDone` pattern with functional state updates and error rollback is solid React.
4. **Collapsible sections** -- Clean implementation with Set-based state management and proper keyboard accessibility (clickable buttons with chevron icons).
5. **Alert strip toggle** -- The toggle-on/toggle-off mechanic with auto-view-switching is intuitive and correctly implemented.
6. **Empty states** -- All filter combinations produce meaningful empty state messages.
7. **Multi-assignee handling** -- Tasks with multiple assignees correctly appear in each assignee's group, with proper deduplication via Map keys.
8. **View switch cleanup** -- `switchView` correctly clears `todoAlertFilter` when navigating away from the todos view.

---

## Summary of Findings Requiring Action

| ID | Severity | Finding |
|----|----------|---------|
| AB-009 | Medium | Client-side `overdue_items`/`due_soon_items` filters don't check item status, causing count mismatches with server-computed alert numbers |
| AB-016 | Medium | Alert strip counts are unfiltered (all items) but todos view shows `filteredPlanningItems` (search/venue filtered), causing visible count discrepancy |
| AB-013 | Low | `<p>` elements inside `<button>` is invalid HTML; use `<span className="block">` |
| AB-019 | Low-Medium | Alert filter activation doesn't reset "my tasks" toggle, potentially hiding relevant tasks from other users |
| AB-012 | Low | Overdue card border colour relies partly on colour alone; consider adding an icon alongside the text label |
| AB-006 | Low | Confirm `assignees` array vs. `assigneeId` data layer contract for multi-assignment scenarios |
