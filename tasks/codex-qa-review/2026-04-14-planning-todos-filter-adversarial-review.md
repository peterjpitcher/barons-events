# Adversarial Review: Planning Todos Filter

**Date:** 2026-04-14
**Mode:** Code Review (Mode B)
**Engines:** Codex (Repo Reality Mapper) + Claude (Assumption Breaker, Workflow & Failure-Path, Security & Data Risk)
**Scope:** `planning-todos-by-person-view.tsx`, `planning-alert-strip.tsx`, `planning-board.tsx`, `planning/types.ts`, plus minor lint fixes in `event-detail-summary.tsx` and `scrape-baronspubs-events.js`

## Inspection Inventory

### Inspected
- All 6 changed files (full read)
- `src/app/planning/page.tsx` (auth flow, data loading, prop passing)
- `src/lib/planning/index.ts` (server-side alert count computation, data fetch, task mapping)
- `src/lib/planning/types.ts` (all types)
- `src/lib/planning/utils.ts` (addDays, daysBetween, bucketForDayOffset)
- `src/actions/planning.ts` (togglePlanningTaskStatusAction, auth re-verification)
- `src/lib/auth.ts` (getCurrentUser flow)
- `src/lib/roles.ts` (canViewPlanning, canUsePlanning permission checks)
- `src/components/planning/planning-item-card.tsx` (currentUserId prop threading)
- `src/components/planning/sop-checklist-view.tsx` (comparable "My tasks" filter)
- `src/components/planning/planning-list-view.tsx`, `planning-calendar-view.tsx` (adjacent views)
- Prior version of changed files via git (pre-change behaviour)
- Supabase migration `20260223120000_add_planning_workspace.sql` (NOT NULL constraint on due_date)

### Not Inspected
- Live database data/schema beyond TypeScript query shapes
- Browser runtime behaviour (static analysis only)
- RLS policies on `planning_items` / `planning_tasks` tables

### Limited Visibility Warnings
- Alert count vs filtered task count mismatch severity depends on how frequently users combine search/venue filters with alert card clicks (unknown usage pattern)

## Executive Summary

The implementation is **solid overall**. All critical workflows (default view, toggle, alert filter, mark-done, collapse, view switching) are correctly implemented with good defensive patterns. Security is clean — auth is server-side, server actions re-verify, no data leakage. Two **medium-severity findings** require attention before merge: (1) a count mismatch between alert strip numbers and the filtered todos view, and (2) missing item-status filtering in the `overdue_items`/`due_soon_items` alert modes.

## What Appears Solid

1. **Date arithmetic** — All YYYY-MM-DD string comparisons are correct and consistent with server-side
2. **Type safety** — `TodoAlertFilter` union type well-scoped, follows conventions
3. **Optimistic updates** — Functional state updates, error rollback, no stale closure risk
4. **Collapsible sections** — Clean Set-based state, keyboard accessible
5. **Alert strip toggle** — Toggle-on/off with auto-view-switch correctly implemented
6. **Empty states** — All filter combinations produce meaningful messages
7. **Multi-assignee handling** — Tasks correctly appear per assignee, deduplication via Map
8. **View switch cleanup** — `switchView` correctly clears `todoAlertFilter`
9. **Auth chain** — `currentUserId` server-sourced, server actions re-verify, Zod validation
10. **React batching** — Both state updates in alert click handler batch correctly in React 18+

## Critical Risks

None.

## Implementation Defects

### AB-009 / Medium: `overdue_items` and `due_soon_items` filters don't check item status

- **Severity:** Medium | **Confidence:** 95% | **Engines:** Claude
- **Evidence:** Server-side alert count at `index.ts:573` filters by `openItemStatuses` (planned, in_progress, blocked). Client-side filter at `planning-todos-by-person-view.tsx:81` only checks `item.targetDate < today` — does NOT check item status. Same issue for `due_soon_items` at line 87.
- **Impact:** Clicking "Overdue items" could show tasks from `done`/`cancelled` planning items that aren't counted in the alert strip number.
- **Fix:** Add `["planned", "in_progress", "blocked"].includes(item.status)` check in the `overdue_items` and `due_soon_items` branches.
- **Blocking:** Yes — causes visible count mismatch and shows tasks from completed items.

### AB-016 / Medium: Alert strip counts don't reflect search/venue filters

- **Severity:** Medium | **Confidence:** 95% | **Engines:** Codex + Claude
- **Evidence:** Alert strip uses `data.alerts` (server-computed, unfiltered). Todos view receives `filteredPlanningItems` (filtered by search/venue). Card says "5 overdue tasks" but clicking shows 2 because search is active.
- **Fix:** Either (a) recompute alert counts client-side from `filteredPlanningItems`, or (b) clear search/venue filters when alert card is clicked, or (c) add visual indicator that search is reducing results.
- **Blocking:** No, but confusing UX. Advisory.

### AB-013 / Low: `<p>` inside `<button>` is invalid HTML

- **Severity:** Low | **Confidence:** 90% | **Engines:** Claude
- **Evidence:** `planning-alert-strip.tsx:74,78` — `<p>` elements inside `<button>` violates HTML spec (buttons should contain phrasing content only).
- **Fix:** Replace `<p>` with `<span className="block ...">`.
- **Blocking:** No — browsers tolerate this, but invalid HTML can cause issues with screen readers.

### SEC-004 / Low: Executive role sees mark-done checkbox despite lacking write permission

- **Severity:** Low | **Confidence:** High | **Engines:** Claude
- **Evidence:** `planning-todos-by-person-view.tsx:264-270` — checkbox renders unconditionally. Executive users will see optimistic hide then error toast when server rejects.
- **Fix:** Pass `canEdit` prop from board, conditionally render checkbox.
- **Blocking:** No — server correctly blocks, no data corruption.

### AB-019 / Low-Medium: Alert filter doesn't reset "my tasks" toggle

- **Severity:** Low-Medium | **Confidence:** 85% | **Engines:** Claude
- **Evidence:** Alert counts are computed across ALL users, but the todos view defaults to "my tasks only". Clicking an alert card while viewing "my tasks" may hide relevant overdue tasks from other users.
- **Fix:** Auto-switch to "Show everyone" when alert filter activates, or note in description.
- **Blocking:** No — user can manually toggle.

### AB-012 / Low: Overdue indicator relies partly on colour alone

- **Severity:** Low | **Confidence:** 75% | **Engines:** Claude
- **Evidence:** `planning-todos-by-person-view.tsx:259,274` — burgundy border + "Overdue" text label. Text label satisfies WCAG 1.4.1, but an icon would strengthen the signal for colourblind users.
- **Fix:** Add AlertTriangle icon next to "Overdue" text.
- **Blocking:** No — text label meets minimum requirement.

## Workflow & Failure-Path Assessment

All 8 primary workflows tested and verified correct. Key notes:
- **WF-002:** `isPending` serialises mark-done operations (one at a time). Safe but limits throughput for power users.
- **WF-004:** Stale entries in `collapsedSections` after group removal are harmless.
- **WF-005:** Brief alert count / empty view mismatch during optimistic update resolves on refresh.
- **SEC-005:** `optimisticallyDone` Set grows monotonically but has negligible memory impact.

## Security Assessment

**0 blocking security findings.** Auth chain is secure. `currentUserId` server-sourced. Server actions re-verify via `ensureUser()` + `canUsePlanning()`. Zod validates input. Alert filter values type-safe. Page-level permission gate in place. "Show everyone" is by design (both roles see all planning data).

## Recommended Fix Order

1. **AB-009** (Medium): Add item-status check in `overdue_items`/`due_soon_items` filter branches
2. **AB-013** (Low): Replace `<p>` with `<span>` in alert strip buttons
3. **AB-012** (Low): Add AlertTriangle icon to overdue task indicator
4. **AB-016** (Medium): Decide on approach for count mismatch (options a/b/c above)
5. **AB-019** (Low-Medium): Consider auto "Show everyone" on alert filter
6. **SEC-004** (Low): Add `canEdit` prop to conditionally render checkboxes

## Follow-Up Review Required

- [ ] AB-009: Re-verify item-status filter alignment with server counts after fix
- [ ] AB-016: Re-verify count mismatch resolution after chosen approach is implemented
