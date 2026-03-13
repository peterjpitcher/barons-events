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

The grid continues to initialise from the first selected venue's existing hours as a sensible baseline. No other behaviour changes.

### Files affected

- `src/components/opening-hours/opening-hours-page-shell.tsx` — remove tab rendering, add reference note

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

On click, calls `resolveOpeningTimes()` — the existing pure function in `src/lib/opening-hours.ts` — directly in the browser using data already loaded on the page (`allHours` + `localOverrides`). No network call, no server action. The date range starts from today (using `getTodayIsoDate()`).

#### Output table

- **Rows:** one per date, labelled with day name + date (e.g. "Fri 14 Mar")
- **Columns:** one per service type (e.g. Bar, Kitchen), ordered by `display_order`
- **Cell content:**
  - Open/close times if the venue is open (e.g. "12:00 – 23:00")
  - A "Closed" pill if `is_closed = true`
  - A dash (—) if no entry exists for that service on that day
- **Override indicator:** a small coloured dot on cells sourced from an override (not the weekly template), so the user can see at a glance which days have been manually adjusted

#### States

| State | Display |
|-------|---------|
| Initial | Prompt text: "Select a venue and time window, then click Preview." |
| Loading | Disabled button + spinner while `useTransition` resolves |
| Results | Scrollable table as described above |
| No data | "No opening hours configured for this venue." |

#### Component

New `OpeningTimesPreview` client component in `src/components/opening-hours/opening-times-preview.tsx`.

Props:
```typescript
type OpeningTimesPreviewProps = {
  venues: { id: string; name: string }[];
  serviceTypes: ServiceTypeRow[];
  allHours: OpeningHoursRow[];
  overrides: OpeningOverrideRow[];
};
```

Internal state: `selectedVenueId`, `days` (7 | 30 | 90), `result` (`ResolvedVenueHours | null`), `hasQueried` (boolean to distinguish initial from no-data).

The component is mounted in `opening-hours-page-shell.tsx` and passed the already-loaded page data. It receives `localOverrides` (the live state from the shell) so previewing after adding an override reflects the change without a page reload.

### Files affected

- `src/components/opening-hours/opening-times-preview.tsx` — new component
- `src/components/opening-hours/opening-hours-page-shell.tsx` — mount new card, pass `localOverrides`

---

## Out of scope

- Per-venue page (`/venues/[id]/opening-hours`) — no changes
- Public API testing via HTTP — the preview uses client-side resolution only
- Saving or exporting the preview output
