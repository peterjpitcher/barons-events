# Adversarial Review: Venue Default Manager Responsible & Table Fix

**Date:** 2026-04-14
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude (Integration & Architecture). Codex reviewers still running — findings will be appended.
**Scope:** `docs/superpowers/specs/2026-04-14-venue-default-manager-and-table-fix-design.md`
**Spec:** `docs/superpowers/specs/2026-04-14-venue-default-manager-and-table-fix-design.md`

## Inspection Inventory

### Inspected
- `src/components/venues/venues-manager.tsx` — full file, form structure, colSpan pattern, CSS `display: contents`
- `src/actions/venues.ts` — Zod schemas, create/update patterns, optional field handling
- `src/lib/venues.ts` — VenueRow type, listVenues query
- `src/components/events/event-form.tsx` — props, venue selection, manager_responsible field
- `src/app/events/new/page.tsx` — data loading, venue list passed to form
- `src/app/events/[eventId]/page.tsx` — same pattern for edit
- `supabase/migrations/` — venues table schema, constraints
- `src/lib/supabase/types.ts` — auto-generated types

### Not Inspected
- Codex reviewers (Assumption Breaker, Spec Trace Auditor, Workflow & Failure-Path, Security & Data Risk, Repo Reality Mapper) — still running, results pending in `tasks/codex-qa-review/`

### Limited Visibility Warnings
- Full RLS policy analysis pending Codex Security reviewer
- Cross-browser form behaviour with `display: contents` not tested empirically

## Executive Summary

The spec has one **critical structural error**: the proposed fix of replacing `colSpan` + CSS grid with individual `<td>` cells is invalid HTML. The current `<form className="contents">` pattern is architecturally correct — the fix should adjust the grid columns within it, not restructure the table DOM. The data layer changes (new column, server actions, auto-populate) are sound.

## What Appears Solid

- **Database change:** Adding `default_manager_responsible TEXT` to venues is clean and mirrors the existing `manager_responsible` on events
- **Data flow:** `listVenues()` selects `*`, so the new column will be available everywhere venues are used — no additional query changes needed
- **Zod validation pattern:** Existing `empty string → undefined → null` pattern in venue actions is well-established
- **Auto-populate concept:** Event form already receives the full venues array; venue data is available where needed
- **Type safety:** `VenueRow` derives from Supabase auto-generated types, so it will pick up the new column after migration

## Critical Risks

### CR-1: Invalid HTML table structure in proposed fix
- **Type:** Confirmed defect (in spec)
- **Severity:** Critical
- **Confidence:** High
- **Evidence:** Direct observation of `src/components/venues/venues-manager.tsx`

**Problem:** The spec proposes "Replace the `colSpan` + grid pattern with individual `<td>` cells matching header columns." This is invalid HTML — a `<form>` element cannot validly wrap inputs across multiple sibling `<td>` cells. The current pattern uses `<form className="contents">` inside a single `<td colSpan={3}>` with CSS Grid. The `display: contents` removes the form from the rendering tree, allowing the grid to work.

**Root cause of the alignment bug:** The issue is not `colSpan` vs individual cells — it's that the `colSpan={3}` only spans 3 of 5 header columns, and the internal grid columns don't match the header widths.

**Correct fix:** Keep the `<td colSpan={N}>` + `display: contents` form pattern. Update the colspan to match the full column count (now 6 with the new Manager Responsible column). Adjust the CSS grid template inside to visually align with the header column widths.

## Spec Defects

### SD-1: Table fix approach is wrong
See CR-1 above. The spec must be revised to describe the correct fix.

### SD-2: Missing colspan update
The spec doesn't mention updating the `colSpan` value. With the new column, the header has 6 columns. The body `<td>` needs `colSpan={6}` (or however many columns exist).

## Implementation Defects

None identified yet — spec review only, no implementation exists.

## Architecture & Integration Defects

### AI-1: Form state complexity with auto-populate
- **Type:** Plausible but unverified
- **Severity:** Medium
- **Confidence:** Medium

The spec proposes `useRef<boolean>` to track manual edits. This adds a state machine dimension to the form. Need to verify whether the event form uses controlled or uncontrolled inputs — if uncontrolled (which `defaultValue` suggests), the `useRef` approach is correct. If controlled, a different pattern may be needed.

## Workflow & Failure-Path Defects

Pending Codex reviewer results.

## Security & Data Risks

Pending Codex reviewer results.

## Unproven Assumptions

### UA-1: Event form input pattern
The spec assumes `useRef<boolean>` is the right tracking mechanism. Need to confirm whether event form fields are controlled or uncontrolled.

## Recommended Fix Order

1. **Revise spec** — fix the table alignment approach (CR-1, SD-1, SD-2)
2. **Verify event form input pattern** — controlled vs uncontrolled (UA-1)
3. Proceed with implementation after spec revision

## Follow-Up Review Required

- Codex reviewer reports when they complete — check `tasks/codex-qa-review/2026-04-14-venue-default-manager-*`
- Re-review table alignment implementation after coding
