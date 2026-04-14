# Claude Hand-Off Brief: Venue Default Manager Responsible & Table Fix

**Generated:** 2026-04-14
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** Medium (one critical spec defect, otherwise sound)

## DO NOT REWRITE

- Database schema change (new `default_manager_responsible` column) — sound
- Server action Zod validation pattern — follows existing conventions
- Data threading from venues to event form — `listVenues()` selects `*`, no changes needed
- `VenueRow` type auto-derives from Supabase — will pick up new column after migration
- Auto-populate concept — architecturally correct, venue data available in EventForm

## SPEC REVISION REQUIRED

- [x] **SD-1: Table alignment fix approach is wrong.** The spec says "Replace the `colSpan` + grid pattern with individual `<td>` cells matching header columns." This is invalid HTML — a `<form>` cannot wrap inputs across sibling `<td>` cells. The current `<form className="contents">` inside `<td colSpan={N}>` pattern is correct. **Revise to:** Keep `<td colSpan={N}>` + `display: contents` form. Fix the `colSpan` value to match the full column count (6). Adjust the CSS grid template columns inside to visually align with the header column widths.

- [x] **SD-2: Add colspan update.** With the new Manager Responsible column, the header now has 6 columns. The body `<td>` must use `colSpan={6}` (currently `colSpan={3}`). The CSS grid inside must be updated to have 6 tracks matching header proportions.

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1:** `supabase/migrations/` — Add `default_manager_responsible TEXT` column with 200-char CHECK constraint
- [ ] **IMPL-2:** `src/actions/venues.ts` — Add `defaultManagerResponsible` to create/update Zod schemas and DB operations
- [ ] **IMPL-3:** `src/components/venues/venues-manager.tsx` — Update `colSpan` to 6, add Manager Responsible input to grid, update CSS grid template to match 6 header columns, make action buttons icon-only
- [ ] **IMPL-4:** `src/components/venues/venues-manager.tsx` — Add Manager Responsible to VenueCreateForm (4-column grid)
- [ ] **IMPL-5:** `src/components/events/event-form.tsx` — Auto-populate `manager_responsible` from venue's `default_manager_responsible` with manual-edit tracking

## ASSUMPTIONS TO RESOLVE

- [ ] **UA-1:** Event form input pattern — verify whether `manager_responsible` uses controlled (`value` + `onChange`) or uncontrolled (`defaultValue`) inputs. If uncontrolled, `useRef<boolean>` tracking works. If controlled, use state instead. → Check `src/components/events/event-form.tsx`

## REPO CONVENTIONS TO PRESERVE

- `<form className="contents">` pattern inside table cells — this is the established pattern, not a hack
- Zod schema: empty string → undefined → null for optional text fields
- `SubmitButton` with `hideLabel` prop for icon-only buttons
- `aria-label` on all icon-only buttons for accessibility
- Design tokens for colours/borders — no hardcoded hex

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CR-1: Re-review table alignment after implementation to confirm columns align visually
- [ ] Codex reviewer reports — check `tasks/codex-qa-review/2026-04-14-venue-default-manager-*` when they complete

## REVISION PROMPT

You are revising the venue default manager responsible spec based on an adversarial review.

Apply these changes in order:

1. **Spec revision (Section 2):** Replace "Replace the `colSpan` + grid pattern with individual `<td>` cells" with: "Keep the existing `<td colSpan={N}>` + `<form className="contents">` pattern. Update `colSpan` from 3 to 6 to match the new 6-column header. Update the CSS grid template inside the form to have 6 tracks matching header column proportions."

2. **Spec revision (Files Changed table):** The fix is within the existing file structure — no DOM restructuring needed.

3. Preserve all other spec sections — they are sound.

After applying changes, confirm:
- [x] Table fix approach corrected to use existing display:contents pattern
- [x] ColSpan update documented
- [ ] No sound decisions were overwritten
- [ ] Assumptions flagged for verification during implementation
