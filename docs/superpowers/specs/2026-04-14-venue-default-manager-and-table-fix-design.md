# Venue Default Manager Responsible & Table Fix

**Date:** 2026-04-14
**Status:** Approved

## Summary

Three changes to the venues system:

1. **Fix venues table alignment** — body rows don't align with header columns due to `colSpan` + CSS grid pattern
2. **Add "Default Manager Responsible" per venue** — free-text field stored on the venues table
3. **Auto-populate event form** — when creating/editing an event, pre-fill "Manager Responsible" from the venue's default

## 1. Database & Data Layer

### New column

```sql
ALTER TABLE public.venues
  ADD COLUMN default_manager_responsible TEXT;

-- Match the existing constraint on events.manager_responsible
ALTER TABLE public.venues
  ADD CONSTRAINT venues_default_manager_responsible_len
    CHECK (char_length(default_manager_responsible) <= 200);
```

No RLS changes needed — venues already have appropriate read/write policies scoped to `central_planner`.

### Server actions (`src/actions/venues.ts`)

- `createVenueAction`: accept optional `defaultManagerResponsible` string, max 200 chars
- `updateVenueAction`: accept optional `defaultManagerResponsible` string, persist to DB
- Zod validation: `z.string().max(200).optional()` (empty string maps to `null`)

### Venue data type (`src/lib/venues.ts`)

- `VenueRow` type updated to include `default_manager_responsible: string | null`
- `listVenues()` already selects `*`, so no query change needed

## 2. Venues Page UI Changes

### Table alignment fix (`src/components/venues/venues-manager.tsx`)

**Problem:** `VenueRowEditor` renders `<td colSpan={3}>` with a CSS grid inside. The header has 5 columns. Body content doesn't align with headers.

**Fix:** Replace the `colSpan` + grid pattern with individual `<td>` cells matching header columns.

### New table structure — 6 columns

| Column | Header | Cell Content | Width Hint |
|--------|--------|--------------|------------|
| 1 | Venue | `<Input>` name | ~18% |
| 2 | Manager Responsible | `<Input>` free text | ~18% |
| 3 | Default Reviewer | `<Select>` dropdown | ~16% |
| 4 | Google Review URL | `<Input>` url | ~28% |
| 5 | Hours | Icon-only `<Button>` link (Clock icon) | auto |
| 6 | Actions | Icon-only Save + Delete buttons | auto |

### Action buttons — icon-only

- **Save**: `<SubmitButton>` with `Save` icon, `hideLabel` prop, `aria-label="Save {venue.name}"`
- **Hours**: `<Button>` with `Clock` icon only, `aria-label="Opening hours for {venue.name}"`
- **Delete**: `<Button>` with `Trash2` icon only, `aria-label="Delete {venue.name}"`

### "Add a venue" form

- Add "Default manager responsible" input between venue name and default reviewer
- Grid changes from 3 to 4 columns: `md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_auto]`

## 3. Event Form Auto-Population

### Pre-fill logic (`src/components/events/event-form.tsx`)

When `manager_responsible` is empty and a venue is selected:
- Pre-fill with `venue.default_manager_responsible`
- Track manual edits with a `useRef<boolean>` flag, set `true` on `onChange`

On venue change (dropdown selection):
- If user has NOT manually edited the field → update to new venue's default
- If user HAS manually edited → leave as-is

### Data threading

- Event form already receives venue data — extend to include `default_manager_responsible`
- The venue list passed to the form component must include this field (already selected via `*`)

### Edge cases

- Venue has no default → field stays empty (as today)
- User clears pre-filled value → respected, not re-populated (counts as manual edit)
- User switches venue → updates only if not manually touched
- Existing events → no backfill; default only applies to new events or blank fields on edit

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDD_add_venue_default_manager.sql` | Add column + constraint |
| `src/lib/supabase/types.ts` | Update auto-generated types |
| `src/lib/venues.ts` | Update `VenueRow` type |
| `src/lib/validation.ts` | Add venue validation for new field |
| `src/actions/venues.ts` | Accept + persist `defaultManagerResponsible` |
| `src/components/venues/venues-manager.tsx` | Fix table alignment, add column, icon-only buttons |
| `src/components/events/event-form.tsx` | Auto-populate manager responsible from venue default |

## Out of Scope

- Converting `manager_responsible` from free-text to a user FK
- Backfilling existing events with venue defaults
- Changes to SOP checklist behaviour
- Changes to the `assignee_id` / reviewer assignment flow
