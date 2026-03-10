# Opening Times API — Developer Integration Guide

This document describes how to fetch venue opening times from the EventHub API for display on the brand website. The endpoint returns fully resolved, day-by-day opening hours with all exceptions already applied — your code never needs to merge templates with overrides.

---

## Authentication

All requests must include your API key as a Bearer token in the `Authorization` header.

```
Authorization: Bearer <your_api_key>
```

The key is a shared secret — keep it server-side only. Never expose it in client-side JavaScript or commit it to version control.

---

## Base URL

```
https://<eventhub-domain>/api/v1
```

Replace `<eventhub-domain>` with the EventHub deployment URL provided to you.

---

## Endpoint

### `GET /api/v1/opening-times`

Returns resolved opening times for all venues (or a single venue) for a rolling window of days starting from today, in the **Europe/London** timezone.

#### Query Parameters

| Parameter | Type | Required | Default | Constraints | Description |
|-----------|------|----------|---------|-------------|-------------|
| `days` | integer | No | `7` | 1–90 | Number of days to return, starting from today |
| `venueId` | UUID | No | — | Valid UUID | Filter results to a single venue |

#### Examples

```
GET /api/v1/opening-times
GET /api/v1/opening-times?days=14
GET /api/v1/opening-times?venueId=3b4e6f82-1a2b-4c3d-8e9f-0a1b2c3d4e5f
GET /api/v1/opening-times?days=30&venueId=3b4e6f82-1a2b-4c3d-8e9f-0a1b2c3d4e5f
```

---

## Response

### Success — `200 OK`

```json
{
  "from": "2026-03-10",
  "to": "2026-03-16",
  "venues": [
    {
      "venueId": "3b4e6f82-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      "venueName": "The Fox",
      "days": [
        {
          "date": "2026-03-10",
          "dayOfWeek": "Tuesday",
          "services": [
            {
              "serviceTypeId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
              "serviceType": "Bar",
              "isOpen": true,
              "openTime": "11:00",
              "closeTime": "23:00",
              "isOverride": false,
              "note": null
            },
            {
              "serviceTypeId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
              "serviceType": "Kitchen",
              "isOpen": true,
              "openTime": "12:00",
              "closeTime": "21:00",
              "isOverride": false,
              "note": null
            }
          ]
        },
        {
          "date": "2026-03-11",
          "dayOfWeek": "Wednesday",
          "services": [
            {
              "serviceTypeId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
              "serviceType": "Bar",
              "isOpen": false,
              "openTime": null,
              "closeTime": null,
              "isOverride": true,
              "note": "Closed for private event"
            }
          ]
        }
      ]
    }
  ]
}
```

### Response Fields

#### Top level

| Field | Type | Description |
|-------|------|-------------|
| `from` | string (date) | First date in the range — always today in Europe/London, format `YYYY-MM-DD` |
| `to` | string (date) | Last date in the range, format `YYYY-MM-DD` |
| `venues` | array | One entry per venue |

#### `venues[]`

| Field | Type | Description |
|-------|------|-------------|
| `venueId` | string (UUID) | Venue identifier |
| `venueName` | string | Display name of the venue |
| `days` | array | One entry per day in the requested range |

#### `venues[].days[]`

| Field | Type | Description |
|-------|------|-------------|
| `date` | string (date) | The date in `YYYY-MM-DD` format |
| `dayOfWeek` | string | Day name: `"Monday"` – `"Sunday"` |
| `services` | array | Resolved opening times per service type for this day |

#### `venues[].days[].services[]`

| Field | Type | Description |
|-------|------|-------------|
| `serviceTypeId` | string (UUID) | Service type identifier |
| `serviceType` | string | Human-readable name, e.g. `"Bar"`, `"Kitchen"`, `"Cafe Hours"`, `"Coffee Trailer"` |
| `isOpen` | boolean | `true` if open on this day, `false` if closed |
| `openTime` | string \| null | Opening time in `HH:MM` (24-hour), or `null` if closed |
| `closeTime` | string \| null | Closing time in `HH:MM` (24-hour), or `null` if closed |
| `isOverride` | boolean | `true` when these hours are a date-specific exception, `false` for standard weekly hours |
| `note` | string \| null | Optional note explaining the exception (e.g. `"Bank holiday hours"`), only ever set when `isOverride` is `true` |

### Key Behaviours

**Exceptions are already applied.** If a venue has special hours or a closure on a specific date, those are returned directly — you do not need to check for exceptions separately. The `isOverride` flag tells you when hours differ from the normal weekly pattern, so you can optionally display a visual indicator (e.g. "Special hours today").

**Missing service types mean not applicable.** If a service type does not appear in a venue's `services` array for a given day, that service has no hours configured at that venue and should not be shown. For example, a venue without a Coffee Trailer will never return a `"Coffee Trailer"` entry.

**Service types are ordered consistently.** The `services` array is always in the same display order (Bar, Kitchen, Sunday Lunch, Carvery, Cafe Hours, Coffee Trailer) — you can render them as-is.

**Closed days are included explicitly.** A service that is configured but closed on a given day appears with `"isOpen": false` and `null` times. This is distinct from a service that simply has no hours configured (which is omitted entirely).

---

## Service Types

These are the current service types configured in EventHub:

| Name | Description |
|------|-------------|
| Bar | Main bar trading hours |
| Kitchen | Hot food service hours |
| Sunday Lunch | Sunday lunch service (often narrower than Kitchen hours) |
| Carvery | Carvery service hours |
| Cafe Hours | Café trading hours |
| Coffee Trailer | Outdoor coffee trailer hours |

Service types are configured centrally in EventHub and may be added to in future. Your integration should render whatever service types are returned rather than hardcoding this list.

---

## Error Responses

All error responses follow the same envelope format:

```json
{
  "error": {
    "code": "error_code",
    "message": "Human-readable description"
  }
}
```

| HTTP Status | Code | Cause |
|-------------|------|-------|
| `400` | `invalid_params` | `days` is not an integer, or is outside 1–90, or `venueId` is not a valid UUID |
| `401` | `unauthorized` | Missing or invalid `Authorization` header |
| `404` | `not_found` | The supplied `venueId` does not exist |
| `429` | `rate_limit_exceeded` | Too many requests — see `Retry-After` response header |
| `500` | `internal_error` | Database query failed |
| `503` | `not_configured` | Server configuration error — contact EventHub |

---

## Caching

The API sets the following cache header on successful responses:

```
Cache-Control: max-age=300, stale-while-revalidate=3600
```

This means a CDN or HTTP cache may serve a cached response for up to 5 minutes, and may serve a stale response for up to 1 hour while revalidating in the background. This is appropriate for a venue hours feed that changes infrequently.

---

## Rate Limiting

The API applies a sliding-window rate limit of **120 requests per IP per 60 seconds**. If you exceed this limit the API returns `429` with a `Retry-After` header indicating how many seconds to wait.

For a website integration, a single server-side fetch on page load or via a background revalidation (e.g. Next.js ISR, SWR) is well within these limits.

---

## Code Examples

### Node.js / server-side fetch

```javascript
const response = await fetch(
  'https://<eventhub-domain>/api/v1/opening-times?days=7',
  {
    headers: {
      Authorization: `Bearer ${process.env.EVENTHUB_API_KEY}`,
    },
    next: { revalidate: 300 }, // Next.js ISR — revalidate every 5 minutes
  }
);

if (!response.ok) {
  const { error } = await response.json();
  throw new Error(`Opening times API error: ${error.code} — ${error.message}`);
}

const { from, to, venues } = await response.json();
```

### Filtering to a single venue

```javascript
const venueId = '3b4e6f82-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

const response = await fetch(
  `https://<eventhub-domain>/api/v1/opening-times?days=7&venueId=${venueId}`,
  {
    headers: { Authorization: `Bearer ${process.env.EVENTHUB_API_KEY}` },
  }
);

const { venues } = await response.json();
const venue = venues[0]; // Will be undefined if venueId not found (check response.ok first)
```

### Rendering example (React)

```jsx
function VenueOpeningTimes({ venue }) {
  return (
    <section>
      <h2>{venue.venueName}</h2>
      {venue.days.map((day) => (
        <div key={day.date}>
          <h3>{day.dayOfWeek} <span>{day.date}</span></h3>
          {day.services.length === 0 ? (
            <p>No opening times available.</p>
          ) : (
            <ul>
              {day.services.map((service) => (
                <li key={service.serviceTypeId}>
                  <strong>{service.serviceType}</strong>
                  {service.isOpen
                    ? ` ${service.openTime} – ${service.closeTime}`
                    : ' Closed'}
                  {service.isOverride && (
                    <span className="special-hours">
                      {service.note ? ` (${service.note})` : ' Special hours'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
```

---

## FAQ

**Q: What timezone are the times in?**
The `from`/`to` dates are computed in the Europe/London timezone (accounting for BST/GMT). The `openTime`/`closeTime` values are wall-clock times as entered by venue staff — treat them as local (Europe/London) times.

**Q: Can a service close after midnight?**
Yes. A bar open until 2 AM will show `closeTime: "02:00"`. The times are not normalised to a 24-hour day boundary — render them as-is.

**Q: What if `isOpen` is false but the service appears in the list?**
This means the venue is explicitly marked as closed on that day for that service (e.g. the kitchen doesn't open on Mondays). It is intentionally included so you can display "Closed" rather than showing nothing.

**Q: How far ahead can I request?**
Up to 90 days (`?days=90`). For a website showing the current week or fortnight, 7–14 days is typical.

**Q: How do I know if hours have changed?**
The `isOverride: true` flag indicates any day where hours differ from the normal weekly schedule. You can use this to show a badge like "Special hours" or "Exception" next to that day.
