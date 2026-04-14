# Claude Hand-Off Brief: Calendar Past Items Visibility

**Generated:** 2026-04-14
**Review mode:** Code Review (Mode B)
**Overall risk assessment:** Low

## DO NOT REWRITE
- Calendar view component — works correctly with the change
- The widened `lowerBound` approach — simplest solution to the stated requirement
- Existing bucket/sort logic in board and list views

## SPEC REVISION REQUIRED
None.

## IMPLEMENTATION CHANGES REQUIRED
None blocking. All findings are advisory.

## ASSUMPTIONS TO RESOLVE
None — user explicitly requested past items on calendar. The shared loader approach is acceptable.

## REPO CONVENTIONS TO PRESERVE
- `listPlanningBoardData` remains the single data loader for all planning views
- Planning items still exclude `done`/`cancelled` status by default (line 531)

## RE-REVIEW REQUIRED AFTER FIXES
None — no fixes required.
