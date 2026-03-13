# Opening Hours UX Improvements — Design Spec

**Date:** 2026-03-13
**Scope:** Global `/opening-hours` page only

---

## Background

The opening hours page lets central planners manage standard weekly schedules and date-specific overrides across multiple venues. Two improvements have been identified:

1. The venue tabs inside the weekly hours card are redundant and confusing.
2. There is no way to verify what the resolved schedule actually looks like over a real date range — making it hard to confirm changes have been applied correctly.

---

## Change 1 — Remove Venue Tabs from Weekly Hours Card

### Problem

When multiple venues are selected in the Venues card, the weekly hours card currently shows a row of tab buttons (one per selected venue) to switch which venue's hours are displayed in the grid. This implies you are editing one venue at a time, but saving overwrites **all** selected venues — a misleading affordance.

Because venues almost always share the same schedule, these tabs provide little reference value and actively create confusion about what will be saved.

### Design

Remove the tab row entirely.

Replace it with a single line of contextual text shown only when more than one venue is selected:

> *"Showing [First Venue]'s current hours as reference — save will apply to all X selected venues."*

**Grid initialisation:** The grid continues to initialise from the first selected venue's existing hours. The shell's existing `activeVenueHours` memo already filters `allHours` to `resolvedActiveVenueId` — this behaviour is unchanged. With tabs removed, `resolvedActiveVenueId` always resolves to `selectedVenues[0]?.id`.

**Zero venues selected:** Already handled by the existing empty state in the weekly hours card — "Select one or more venues above to view and edit their standard weekly hours." No change needed here.

**State cleanup:** Remove the `activeVenueId` state variable and `setActiveVenueId` setter from `opening-hours-page-shell.tsx`. The `resolvedActiveVenueId` memo simplifies to `selectedVenues[0]?.id ?? ""`.

### Files affected

- `src/components/opening-hours/opening-hours-page-shell.tsx` — remove tab rendering, remove `activeVenueId` state, simplify `resolvedActiveVenueId`, add reference note

---

## Change 2 — Opening Times Preview Card

### Problem

After editing weekly hours and overrides, there is no way to verify what the resolved schedule actually looks like for a specific venue over a real date range. This makes it difficult to confirm that the weekly template and overrides are combining correctly.

### Design

Add a new **"Preview resolved times"** card at the bottom of the global page, below the overrides calendar.

#### Controls

Displayed inline in the card header area:

| Control | Type | Details |
|---------|------|---------|
| Venue | Single-select dropdown | All venues listed; defaults to first venue |
| Time window | Toggle buttons | 7 days / 30 days / 90 days; defaults to 7 |
| Preview button | Primary button | Triggers resolution |

#### Resolution

On click, calls `resolveOpeningTimes()` — a **pure synchronous function** in `src/lib/opening-hours.ts` that takes pre-fetched data with no Supabase calls or server-only imports. It is safe to call directly in a client component.

The date range starts from today in the **Europe/London** timezone, using the existing `getTodayIsoDate()` utility. The end date is `today + days - 1` (inclusive), so a 7-day window covers today through 6 days hence.

Because the function is synchronous, **no loading state is needed** — the call is instant. The result is set directly in state with a plain `useState` setter.

#### Output table

- **Rows:** one per date, labelled with day name + short date (e.g. "Fri 14 Mar")
- **Columns:** one per service type, ordered by `display_order` ascending, then `name` alphabetically, then `id` as a final stable tiebreaker (matching the order returned by `listServiceTypes()`; the DB unique constraint on `name` means ties beyond `display_order` cannot occur in practice)
- **Cell content:**
  - Open/close times if the venue is open (e.g. "12:00 – 23:00")
  - A "Closed" pill if `is_closed = true`
  - A dash (—) if the service type is absent from `services` for that day (no template and no override)
- **Override indicator:** `ResolvedServiceHours.isOverride` is already populated by `resolveOpeningTimes()`. Cells where `isOverride = true` show a small coloured dot so the user can see at a glance which days have been manually adjusted.

#### States

| State | Display |
|-------|---------|
| Initial (not yet queried) | Prompt text: "Select a venue and time window, then click Preview." |
| Results — has rows | Scrollable table as described above |
| Results — empty (`days` array is empty) | "No opening hours are configured for this venue for the selected period." |

There is no async loading state — the resolution is synchronous.

#### Empty state distinction

- If `result.venues[0].days` is an empty array, the venue has no hours configured (no weekly template and no overrides) for the selected window. Display: "No opening hours are configured for this venue for the selected period."
- A non-empty `days` array with some service columns showing dashes is a normal result (some services not configured for certain days).

#### Component

New `OpeningTimesPreview` client component in `src/components/opening-hours/opening-times-preview.tsx`.

Props:
```typescript
type OpeningTimesPreviewProps = {
  venues: { id: string; name: string }[];
  serviceTypes: ServiceTypeRow[];
  allHours: OpeningHoursRow[];
  overrides: OpeningOverrideRow[];  // shell passes its localOverrides live state here
};
```

Internal state: `selectedVenueId` (string, defaults to `venues[0]?.id`), `days` (7 | 30 | 90, defaults to 7), `result` (`ResolvedVenueHours | null`), `hasQueried` (boolean, to distinguish the initial state from an empty result).

The component receives `overrides` from the shell's **full, unfiltered `localOverrides`** live state (not `filteredOverrides`). This is necessary because the preview has its own independent venue dropdown — passing a pre-filtered slice would silently hide overrides for venues outside the shell's current venue selection. Passing the full set ensures the preview can correctly resolve any venue regardless of what the shell's venue filter is set to.

**Data boundary — saved vs unsaved state:** The `allHours` prop reflects the server-fetched value (the last full page load or `router.refresh()`). Unsaved edits in the weekly hours grid are **not** reflected in the preview — the preview shows what the public API would return right now based on saved data. This is the intended behaviour: the purpose of the preview is to verify the current saved state, not to preview hypothetical unsaved changes. Users should save weekly hours changes before previewing.

### Files affected

- `src/components/opening-hours/opening-times-preview.tsx` — new component
- `src/components/opening-hours/opening-hours-page-shell.tsx` — mount new card, pass `localOverrides` as the `overrides` prop

---

## Out of scope

- Per-venue page (`/venues/[id]/opening-hours`) — no changes
- Public API testing via HTTP — the preview uses client-side resolution only
- Saving or exporting the preview output
