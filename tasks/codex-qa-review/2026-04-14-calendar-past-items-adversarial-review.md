# Adversarial Review: Calendar Past Items Visibility

**Date:** 2026-04-14
**Mode:** Code Review (Mode B)
**Engines:** Codex (3 reviewers: Repo Reality Mapper, Assumption Breaker, Workflow & Failure-Path)
**Scope:** `src/lib/planning/index.ts` — `listPlanningBoardData` function (3 lines changed)

## Inspection Inventory

### Inspected
- `src/lib/planning/index.ts` — data loader, query construction, alert computation
- `src/components/planning/planning-board.tsx` — all view modes, bucket logic, entry merging
- `src/components/planning/planning-calendar-view.tsx` — rendering, drag-and-drop
- `src/components/planning/planning-list-view.tsx` — sort order, entry rendering
- `src/components/planning/planning-todos-by-person-view.tsx` — task grouping
- `src/components/planning/planning-alert-strip.tsx` — alert counts
- `src/app/planning/page.tsx` — sole caller of `listPlanningBoardData`
- `src/lib/planning/utils.ts` — `addDays`, `daysBetween`
- `src/lib/planning/types.ts` — `PlanningBoardData`, `PlanningEventOverlay`
- Database migration files for index coverage

### Not Inspected
- Production data volumes (cannot determine from repo alone)
- Actual query execution plans

## Executive Summary

Three-line change widens the data loader's date window from -30/+365 days to -365/+365 days and removes the completed-event filter. The calendar view works correctly with these changes. The main concern is that all four views (board, calendar, list, todos) share one data loader, so historical data appears everywhere — not just the calendar. For a small event management app this is acceptable, but the board's "Past / Overdue" bucket will now include completed events alongside genuinely overdue work.

## What Appears Solid

- Calendar view renders correctly — no date assumptions, groups by day, drag-and-drop unaffected
- Database indexes exist on `target_date` and `start_at` — query performance is fine
- `PlanningEventOverlay` type already supports `completed` status badge
- No type errors or breaking changes
- Inspiration items unaffected (separate query window)

## Findings

### Medium: Board Past bucket mixes completed events with overdue work
The "Past / Overdue" bucket will now contain completed events alongside genuinely overdue planning items. Oldest items sort first, potentially burying recent overdue work. **Acceptable trade-off** for the user's stated goal of seeing all items.

### Medium: List view sorts oldest-first
Historical events push current work below the fold. Users can toggle "Planning only" to hide events if needed.

### Medium: Alert counts may increase
Overdue planning items older than 30 days will now appear in alert counts. This is actually *more accurate* — if items are open and overdue, they should be counted.

### Low: 365-day window is arbitrary
Calendar navigation is unbounded but data stops at 1 year. Acceptable pragmatic limit.

### Low: Asymmetric history
Completed events now appear but completed/cancelled planning items are still excluded (line 531). This is by design — done planning items aren't useful to see; completed events are.

## Recommended Actions

No blocking issues. All findings are advisory. The change correctly implements the user's request.
