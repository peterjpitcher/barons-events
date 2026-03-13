# Opening Times API — Design Spec

**Date:** 2026-03-10
**Status:** Approved

## Summary

A new public API endpoint that returns resolved, day-by-day opening times for one or all venues, with overrides already applied. Consumers receive the effective hours for each date — no client-side merging required.

## Consumer

The BaronsHub public website, authenticated via the existing `BARONSHUB_WEBSITE_API_KEY` bearer token (same pattern as all other `/api/v1/` routes).

## Endpoint

```
GET /api/v1/opening-times
```

### Query Parameters

| Param | Type | Default | Constraints | Description |
|-------|------|---------|-------------|-------------|
| `days` | integer | `7` | 1–90 | Number of days to return, starting from today (Europe/London) |
| `venueId` | UUID | — | optional | Filter to a single venue |

### Response Shape

```json
{
  "from": "2026-03-10",
  "to": "2026-03-16",
  "venues": [
    {
      "venueId": "...",
      "venueName": "The Fox",
      "days": [
        {
          "date": "2026-03-10",
          "dayOfWeek": "Monday",
          "services": [
            {
              "serviceTypeId": "...",
              "serviceType": "Bar",
              "isOpen": true,
              "openTime": "11:00",
              "closeTime": "23:00",
              "isOverride": false,
              "note": null
            },
            {
              "serviceTypeId": "...",
              "serviceType": "Kitchen",
              "isOpen": false,
              "openTime": null,
              "closeTime": null,
              "isOverride": true,
              "note": "Closed for deep clean"
            }
          ]
        }
      ]
    }
  ]
}
```

- `isOverride: true` — signals to the website that these are special/exception hours
- `note` — populated from the override record when present, otherwise `null`
- Service types with no template and no override for a venue are **omitted** from `services`

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/app/api/v1/opening-times/route.ts` | Thin route handler — auth, param validation, response formatting |
| `src/lib/public-api/__tests__/opening-times.test.ts` | Unit tests for merge logic |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/opening-hours.ts` | Add `resolveOpeningTimes(venueId?, from, to)` function |
| `src/app/api/v1/openapi/route.ts` | Document new endpoint in OpenAPI spec |

## Merge Logic

For each date in the range, for each venue, for each service type (in `display_order`):

1. Look up weekly template row for `(venueId, serviceTypeId, dayOfWeek)`
2. Look up override row for `(date, serviceTypeId)` where override `venue_ids` includes this venue
3. **Override wins** — its `open_time`, `close_time`, `is_closed`, and `note` replace the template
4. No template and no override → service type omitted
5. `is_closed = true` on template → `{ isOpen: false, openTime: null, closeTime: null, isOverride: false, note: null }`
6. `is_closed = true` on override → same but `isOverride: true`, `note` from override record

### Data Fetching

Two queries only — no per-day or per-venue round-trips:

1. `listVenueOpeningHours(venueId?)` — all weekly template rows for relevant venues
2. `listOpeningOverrides({ fromDate, toDate, venueId? })` — all overrides in the date window

Results indexed in memory via Maps:
- Weekly template: keyed `venueId|serviceTypeId|dayOfWeek`
- Overrides: keyed `date|serviceTypeId|venueId`

## Error Handling

| Condition | Status | Code |
|-----------|--------|------|
| `days` non-integer or out of 1–90 | 400 | `invalid_params` |
| `venueId` not a valid UUID | 400 | `invalid_params` |
| `venueId` not found in DB | 404 | `not_found` |
| DB error | 503 | `database_error` |
| Rate limit exceeded | 429 | (handled by `checkApiRateLimit`) |
| Missing/invalid API key | 401 | (handled by `requireWebsiteApiKey`) |

## Caching

```
Cache-Control: max-age=300, stale-while-revalidate=3600
```

5-minute fresh cache, 1-hour stale. Overrides are date-specific so stale data risk is low.

## Tests

All in `src/lib/public-api/__tests__/opening-times.test.ts`:

- Override replaces template for matching date + service type + venue
- Template used when no override present
- Service type omitted when neither template nor override exists
- `is_closed = true` on override → `isOpen: false, isOverride: true`
- `is_closed = true` on template → `isOpen: false, isOverride: false`
- Override `note` surfaced; template entry has `note: null`
- `days` defaults to 7 and caps at 90
- `venueId` filter scopes response to one venue
