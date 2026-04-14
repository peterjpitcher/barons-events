# Claude Hand-Off Brief: Planning Todos Filter

**Generated:** 2026-04-14
**Review mode:** Code Review (Mode B)
**Overall risk assessment:** Medium

## DO NOT REWRITE

These areas are sound and should be preserved:
- Date arithmetic (string comparisons, `addDays` usage)
- `TodoAlertFilter` type definition
- Optimistic update pattern with functional state updates and error rollback
- Collapsible sections implementation
- Alert strip toggle-on/toggle-off with auto-view-switch
- Empty state messaging logic
- Multi-assignee grouping via Map
- `switchView` clearing `todoAlertFilter` on view change
- Auth chain: `currentUserId` server-sourced -> client prop, server actions re-verify

## SPEC REVISION REQUIRED

No spec exists for this change. No spec revisions needed.

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-001 (Medium):** `src/components/planning/planning-todos-by-person-view.tsx:79-88` — Add item-status filtering in `overdue_items` and `due_soon_items` branches. Only include tasks from items where `item.status` is `"planned"`, `"in_progress"`, or `"blocked"` to match server-side alert count logic at `src/lib/planning/index.ts:573`.

- [ ] **IMPL-002 (Low):** `src/components/planning/planning-alert-strip.tsx:74,78` — Replace `<p>` elements inside `<button>` with `<span className="block ...">` for valid HTML nesting.

- [ ] **IMPL-003 (Low):** `src/components/planning/planning-todos-by-person-view.tsx:274` — Add an `AlertTriangle` icon next to the "Overdue" text label for stronger non-colour accessibility signalling (user is colourblind).

## ASSUMPTIONS TO RESOLVE

- [ ] **ASSUMPTION-001:** Alert strip counts are unfiltered (server-computed from all items) but todos view shows search/venue-filtered items. When search is active, clicking an alert card may show fewer tasks than the card number indicates. **Ask:** Is this acceptable UX, or should clicking an alert card clear the search/venue filters? Alternatively, should alert counts be recomputed client-side from filtered items?

- [ ] **ASSUMPTION-002:** Clicking an alert card while viewing "my tasks" only shows the current user's tasks, but alert counts include all users' tasks. **Ask:** Should activating an alert filter auto-switch to "Show everyone" since the counts are computed across all users?

- [ ] **ASSUMPTION-003:** Executive role users see the mark-done checkbox but the server rejects the action (optimistic show then error toast). **Ask:** Should the checkbox be hidden/disabled for read-only users? This requires passing a `canEdit` prop.

## REPO CONVENTIONS TO PRESERVE

- `YYYY-MM-DD` string comparison for dates (used consistently across planning module)
- `addDays` from `src/lib/planning/utils.ts` for date arithmetic
- Functional state updates for React state (not direct mutation)
- `PascalCase` types with `snake_case` union values in `src/lib/planning/types.ts`
- Design token CSS variables (not hardcoded colours)
- Server actions re-verify auth via `ensureUser()` pattern

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] AB-009: Re-verify `overdue_items`/`due_soon_items` filter now matches server-side alert count logic
- [ ] AB-013: Verify `<span>` replacement doesn't break alert strip layout

## REVISION PROMPT

You are revising the planning todos filter based on an adversarial review.

Apply these changes in order:

1. In `src/components/planning/planning-todos-by-person-view.tsx`, update the `overdue_items` filter branch (line ~81) to also check `item.status`:
   ```typescript
   } else if (alertFilter === "overdue_items") {
     const openStatuses = ["planned", "in_progress", "blocked"];
     if (item.targetDate >= today || !openStatuses.includes(item.status)) return;
   ```
   Apply the same pattern for `due_soon_items` (line ~87):
   ```typescript
   } else if (alertFilter === "due_soon_items") {
     const openStatuses = ["planned", "in_progress", "blocked"];
     if (item.targetDate < today || item.targetDate > sevenDaysOut || !openStatuses.includes(item.status)) return;
   ```

2. In `src/components/planning/planning-alert-strip.tsx`, replace `<p>` with `<span className="block">` inside the `<button>` elements (lines 74, 78).

3. In `src/components/planning/planning-todos-by-person-view.tsx`, import `AlertTriangle` from lucide-react and add it next to the "Overdue" text at line ~274:
   ```typescript
   {isOverdue && <span className="mr-1 inline-flex items-center gap-0.5 font-semibold text-[var(--color-antique-burgundy)]"><AlertTriangle className="h-3 w-3" aria-hidden="true" />Overdue</span>}
   ```

4. Preserve these decisions: all date arithmetic, optimistic update pattern, collapsible sections, auth chain, multi-assignee handling.

5. After applying, run: `npm run lint && npx tsc --noEmit && npm run build`

After applying changes, confirm:
- [ ] All implementation changes applied
- [ ] No sound decisions were overwritten
- [ ] Lint, typecheck, and build pass
- [ ] User assumptions flagged for human review (ASSUMPTION-001, -002, -003)
