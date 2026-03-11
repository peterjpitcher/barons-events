# Planning Inspiration Items — Design Spec

**Date:** 2026-03-11
**Project:** BARONS-EventHub
**Status:** Approved

---

## Overview

A monthly cron job generates a list of UK hospitality-relevant occasions up to 180 days ahead and surfaces them on the `/planning` board as **inspiration items** — inline suggestions that planners can convert to planning items with one click or permanently hide. The feature helps the team proactively plan for upcoming occasions without relying on memory or manual calendar checking.

---

## Goals

- Surface UK-centric occasions (bank holidays, seasonal events, floating occasions, major sporting fixtures) up to 180 days out
- Present them as low-friction suggestions on the existing planning board
- Allow one-click conversion to a planning item
- Allow permanent organisation-wide dismissal with audit trail
- Allow admins to manually trigger a refresh
- Never show US-centric events (e.g. Thanksgiving, Super Bowl)

---

## Out of Scope

- Per-user dismissal preferences (dismissal is organisation-wide)
- Editing inspiration items before converting (convert is silent, one-click)
- Inspiration items appearing in calendar or list views (board view only, inline in buckets)
- Un-dismiss UI (data model supports it; UI deferred)
- Local/venue-specific events

---

## Data Model

### `planning_inspiration_items`

Stores the current 180-day window of generated occasions. Fully replaced on each monthly run.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `event_name` | `text NOT NULL` | Display name, e.g. "Father's Day" |
| `event_date` | `date NOT NULL` | The date of the occasion |
| `category` | `text NOT NULL` | `bank_holiday \| seasonal \| floating \| sporting` |
| `description` | `text` | Brief context, e.g. "England vs Ireland, Twickenham" |
| `source` | `text NOT NULL` | `gov_uk_api \| computed \| openai` |
| `generated_at` | `timestamptz NOT NULL` | When this batch was generated |
| `created_at` | `timestamptz` | Default `now()` |

**RLS:** Authenticated users can read (defence-in-depth — the board data query uses the service-role/admin client, consistent with `listPlanningBoardData()`). Only the service-role client writes (cron + server actions).

### `planning_inspiration_dismissals`

Organisation-wide audit log of dismissed or converted items.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `inspiration_item_id` | `uuid NOT NULL` | Plain `uuid` column — no FK constraint (see note below) |
| `dismissed_by` | `uuid NOT NULL` | FK → users |
| `dismissed_at` | `timestamptz` | Default `now()` |
| `reason` | `text NOT NULL` | `dismissed \| converted` |

**No FK constraint on `inspiration_item_id`** — the monthly cron deletes all rows in `planning_inspiration_items` and reinserts a fresh batch with new UUIDs. A hard FK would cause the delete to fail with a constraint violation. Instead, `inspiration_item_id` is a plain `uuid` column. Orphaned dismissal rows (pointing at deleted items) are harmless — the `NOT IN` filter on non-existent IDs matches nothing. The `generateInspirationItems` function deletes orphaned dismissal rows as part of the upsert transaction (i.e. `DELETE FROM planning_inspiration_dismissals WHERE inspiration_item_id NOT IN (SELECT id FROM planning_inspiration_items)`).

**RLS:** Authenticated users can read and insert. No update or delete (immutable audit log).

---

## Generation Pipeline

**File:** `src/lib/planning/inspiration.ts`
**Function:** `generateInspirationItems(windowStart: Date, windowEnd: Date): Promise<InspirationItem[]>`

The function merges three sources and deduplicates before upserting.

### Source 1 — Bank Holidays (gov.uk API)

```
GET https://www.gov.uk/bank-holidays.json
→ england-and-wales.events[].{ title, date }
```

Filter to window. Source = `gov_uk_api`. If the API is unreachable, log a warning and continue without bank holidays (do not abort the run).

### Source 2 — Fixed Seasonal & Floating Occasions (computed)

No external calls. All computed in TypeScript.

**Fixed dates** (iterate each year in the window):

| Occasion | Date |
|---|---|
| Valentine's Day | 14 Feb |
| St Patrick's Day | 17 Mar |
| Halloween | 31 Oct |
| Bonfire Night | 5 Nov |
| Christmas Eve | 24 Dec |
| Christmas Day | 25 Dec |
| Boxing Day | 26 Dec |
| New Year's Eve | 31 Dec |

**Floating dates:**

- **Mother's Day (UK — Mothering Sunday):** 21 days before Easter Sunday (4th Sunday of Lent). Easter computed via the Anonymous Gregorian algorithm — no API required.
- **Father's Day:** 3rd Sunday of June.

Source = `computed`.

### Source 3 — Sporting Events (OpenAI)

Single call using the existing `OPENAI_API_KEY` pattern from `src/lib/ai.ts`:

- Model: `process.env.OPENAI_WEBSITE_COPY_MODEL ?? "gpt-4o-mini"`
- Structured JSON output via `json_schema` response format
- Prompt includes: today's date, the exact 180-day window, and the bank holidays already gathered (as date anchors to ground the model)
- Asks for major UK sporting fixtures only: Six Nations, FA Cup, Wimbledon, British GP, Ashes, etc.
- Each item returned as `{ event_name: string, event_date: string (YYYY-MM-DD), description: string }`
- **Validation:** reject any item whose `event_date` does not parse as a valid ISO date or falls outside the window
- Source = `openai`

If OpenAI fails, log the error and continue with bank holidays + computed dates only.

### Merge & Upsert

1. Combine all three source arrays
2. Deduplicate by `event_date + normalised(event_name)` (lowercase, trim)
3. Delete all existing rows in `planning_inspiration_items`
4. Insert the fresh batch in a single transaction
5. Log: source counts, total items, any errors

---

## Board Integration

### Data Fetching

`listPlanningBoardData()` in `src/lib/planning/index.ts` is extended to query:

```sql
SELECT i.*
FROM planning_inspiration_items i
WHERE i.event_date BETWEEN :today AND :today + 180 days
  AND i.id NOT IN (
    SELECT inspiration_item_id FROM planning_inspiration_dismissals
  )
ORDER BY i.event_date ASC
```

Result added as `inspirationItems: PlanningInspirationItem[]` to `PlanningBoardData`.

**First-deploy / empty state:** Before the cron has ever run, `planning_inspiration_items` is empty and `inspirationItems` will be an empty array. The board renders normally with no inspiration cards shown — no error, no broken state.

### Type

```typescript
type PlanningInspirationItem = {
  id: string;
  eventName: string;
  eventDate: string;       // YYYY-MM-DD
  category: 'bank_holiday' | 'seasonal' | 'floating' | 'sporting';
  description: string | null;
  source: 'gov_uk_api' | 'computed' | 'openai';
};
```

### Bucket Placement

Inspiration items slot into the existing `0_30`, `31_60`, `61_90`, and `later` buckets (matching the `PlanningBucketKey` enum) using the same `bucketForDayOffset()` utility as planning items.

### Card Appearance

New variant in `planning-item-card.tsx`:

- Amber/yellow dashed border (`border-2 border-dashed border-amber-400`)
- ✨ icon prefix
- Event name (bold) + formatted date
- Small category badge (e.g. "Bank Holiday", "Sporting")
- Two action buttons:
  - **"Add to plan"** — primary/small, calls `convertInspirationItemAction`
  - **"Hide"** — ghost/small, calls `dismissInspirationItemAction`
- No drag-and-drop, no status change, no task list

---

## Server Actions

All in `src/actions/planning.ts` following the existing pattern.

### `convertInspirationItemAction(id: string)`

Permitted roles: any role where `canViewPlanning(user.role)` is true (i.e. all roles that can access the planning board).

1. Auth check via `ensureUser()` — use `canViewPlanning()` guard (not `canUsePlanning()`) so all board viewers can act on inspiration items
2. Fetch the inspiration item by ID
3. Insert a `planning_item` with `title = event_name`, `target_date = event_date`, `status = 'planned'`, `type_label = 'Occasion'`, `created_by = user.id`
4. Insert a `planning_inspiration_dismissals` row with `reason = 'converted'`
5. `revalidatePath('/planning')`
6. Return `{ success: true, message: 'Added to your plan.' }`

### `dismissInspirationItemAction(id: string)`

Permitted roles: any role where `canViewPlanning(user.role)` is true.

1. Auth check via `ensureUser()` — use `canViewPlanning()` guard
2. Insert a `planning_inspiration_dismissals` row with `reason = 'dismissed'`
3. `revalidatePath('/planning')`
4. Return `{ success: true }`

### `refreshInspirationItemsAction()`

Permitted roles: `central_planner` only (not `executive` — executive is read-only by role convention).

1. Auth check — `central_planner` role only; return `{ error: 'Unauthorised' }` otherwise
2. Call `generateInspirationItems(today, today + 180 days)`
3. Return `{ success: true, message: 'Inspiration items refreshed — X occasions found.' }`

---

## Admin Refresh Button

- Visible only to `central_planner` role (consistent with all other mutations in the planning workspace)
- Location: planning board header area, alongside existing controls
- Shows a spinner/disabled state while the server action is in flight
- Displays the success toast on completion
- Displays an error toast if the action fails

---

## Cron Route

**File:** `src/app/api/cron/refresh-inspiration/route.ts`

```
GET /api/cron/refresh-inspiration
Authorization: Bearer <CRON_SECRET>
```

Vercel's cron scheduler always issues GET requests — the route exports a `GET` handler. A `POST` handler may also be exported to support manual curl invocations during development.

1. Validate `Authorization` header against `process.env.CRON_SECRET` — return `401` if missing or wrong
2. Call `generateInspirationItems(today, today + 180 days)`
3. Return `200 { success: true, count: N }`

**`vercel.json`** — add cron entry:

```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-inspiration",
      "schedule": "0 6 1 * *"
    }
  ]
}
```

---

## Environment Variables

| Variable | Purpose | Required |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API calls for sporting events | Already in place |
| `OPENAI_WEBSITE_COPY_MODEL` | Model override (default: `gpt-4o-mini`) | Already in place |
| `CRON_SECRET` | Secures the cron endpoint | New — add to `.env.example` |

---

## Migration

New file: `supabase/migrations/YYYYMMDDHHMMSS_add_planning_inspiration.sql`

Creates:
- `planning_inspiration_items` table with indexes on `event_date` and `generated_at`
- `planning_inspiration_dismissals` table with index on `inspiration_item_id`
- RLS policies for both tables

---

## Error Handling

| Failure | Behaviour |
|---|---|
| gov.uk API unreachable | Log warning, continue with computed + OpenAI |
| OpenAI API fails | Log error, continue with bank holidays + computed |
| Both external sources fail | Generate computed-only set (still useful — covers ~60% of occasions) |
| Cron secret missing/wrong | Return 401, Vercel logs the failure |
| Admin refresh unauthorised | Return `{ error: 'Unauthorised' }`, show error toast |

---

## Testing

- Unit tests for the Easter algorithm and floating date calculations
- Unit tests for `generateInspirationItems` with mocked gov.uk API and mocked OpenAI
- Unit tests for `convertInspirationItemAction` and `dismissInspirationItemAction`
- Unit test for the cron route: valid secret passes, invalid/missing secret returns 401
- All external services mocked (gov.uk, OpenAI) — never hit real APIs in tests

---

## Complexity Score

**4 (L)** — new DB tables, new lib module, new API route, new server actions, UI changes, cron infra.
