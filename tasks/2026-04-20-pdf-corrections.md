# PDF corrections — `EventHub Website Publishing API (v1).pdf`

Send this list to whoever produces the PDF (or do find/replace + re-export).

## 1. Title and product name

| Where | Wrong | Right |
|---|---|---|
| Title | `EventHub Website Publishing API (v1)` | `BaronsHub Website Publishing API (v1)` |
| Every body mention of "EventHub" | `EventHub` | `BaronsHub` |

The product is BaronsHub. The OpenAPI spec served at `/api/v1/openapi` even calls itself "BaronsHub Website API". The PDF is from before the rename.

## 2. Base URL (page 1, "Values to fill in" + page 1 "Base URL" + page 1 "Quickstart")

| Wrong | Right |
|---|---|
| `https://eventhub.orangejelly.co.uk` | `https://baronshub.orangejelly.co.uk` |

There is currently a 308 redirect from `eventhub.…` to `baronshub.…`, **but `fetch` strips the `Authorization` header on cross-host redirects**, so any developer following the PDF gets `401 Missing API key` and reasonably blames the key.

## 3. Server env-var name (page 1, "Authentication")

| Wrong | Right |
|---|---|
| `EVENTHUB_WEBSITE_API_KEY` | `BARONSHUB_WEBSITE_API_KEY` |

The API key value itself is unchanged. Only the environment-variable name on the BaronsHub server is different — set in `src/lib/public-api/auth.ts:11`.

## 4. Quickstart curl (page 1)

Old:

```
curl -H "Authorization: Bearer <EVENTHUB_WEBSITE_API_KEY>" \
  "https://eventhub.orangejelly.co.uk/api/v1/events?from=2026-01-20T15:00:00.000Z&limit=50"
```

New:

```
curl -H "Authorization: Bearer <BARONSHUB_WEBSITE_API_KEY>" \
  "https://baronshub.orangejelly.co.uk/api/v1/events?from=2026-01-20T15:00:00.000Z&limit=50"
```

## 5. PublicEvent payload (page 4) — incomplete vs reality

The PDF lists 16 fields. The live API returns more. Either expand the table or just add a one-line note:

> The full, authoritative shape is in the OpenAPI spec at `GET /api/v1/openapi`.

Extra fields the API returns that the PDF doesn't mention:

- `highlights: string[]`
- `eventImageUrl: string | null`
- `bookingType: "ticketed" | "table_booking" | "free_entry" | "mixed" | null`
- `ticketPrice: number | null`
- `checkInCutoffMinutes: number | null`
- `agePolicy: string | null`
- `accessibilityNotes: string | null`
- `cancellationWindowHours: number | null`
- `termsAndConditions: string | null`

## 6. Field sourcing table (page 5)

`Source in EventHub` should read `Source in BaronsHub`.

## 7. Source-of-truth tip

The repo already has the corrected version at [docs/WebsitePublishingAPI.md](docs/WebsitePublishingAPI.md) — regenerate the PDF from that file rather than editing the old PDF, so the two stay in sync going forward.
