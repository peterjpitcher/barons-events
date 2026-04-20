# Website Publishing API — PDF Review & Live Test

**Date:** 2026-04-20
**Reviewer:** Claude
**PDF reviewed:** `~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/EventHub Website Publishing API (v1).pdf` (Last updated 21 January 2026)
**Implementation:** `BARONS-BaronsHub` (`src/app/api/v1/**`)

## TL;DR

The PDF given to the developer has the **wrong base URL** and uses the **old product name "EventHub"** throughout. The actual API lives on `baronshub.orangejelly.co.uk`, and `eventhub.orangejelly.co.uk` 308-redirects to it — but **almost every HTTP client strips the `Authorization` header on cross-host redirects**, so the developer sees `401 Missing API key` and assumes the key is wrong. Separately, the live `/api/v1/events` and `/api/v1/events/:id` endpoints **return 500** even when called correctly, so the developer is hard-blocked even after fixing the URL.

## What the developer is hitting

Reproduced with the supplied key `f59081994c386538ea57e794d620193fcdae42a359931903a3faa406a9c995e9`:

| Call | Response |
|---|---|
| `GET https://eventhub.orangejelly.co.uk/api/v1/health` (no follow) | **308** redirect to `baronshub.orangejelly.co.uk/api/v1/health` |
| Same, follow redirect with `fetch` / `curl -L` | **401** `{"error":{"code":"unauthorized","message":"Missing API key"}}` — Authorization header dropped on cross-host redirect |
| Same, with `curl -L --location-trusted` | **200** `{"ok":true}` — proves header stripping is the cause |
| `GET https://baronshub.orangejelly.co.uk/api/v1/health` | **200** `{"ok":true}` |
| `GET https://baronshub.orangejelly.co.uk/api/v1/venues` | **200** (10+ venues returned) |
| `GET https://baronshub.orangejelly.co.uk/api/v1/event-types` | **200** (7 types returned) |
| `GET https://baronshub.orangejelly.co.uk/api/v1/openapi` | **200** (11 KB JSON spec) |
| `GET https://baronshub.orangejelly.co.uk/api/v1/events?limit=1` | **500** `{"error":{"code":"internal_error","message":"Unable to load events"}}` |
| Same with `from=`, `endsAfter=`, `updatedSince=` filters | **500** in every variation |
| `GET https://baronshub.orangejelly.co.uk/api/v1/events/<uuid>` | **500** `Unable to load event` |
| `GET https://baronshub.orangejelly.co.uk/api/v1/events/by-slug/x--<uuid>` | **500** `Unable to load event` |

So `/health`, `/venues`, `/event-types`, `/openapi` all work. **Every events endpoint is 500.**

## Issue 1 — Wrong base URL in the PDF (CRITICAL — fix the doc)

PDF says (page 1):

> **Base URL:** `https://eventhub.orangejelly.co.uk`

Reality (also documented correctly in the repo at [docs/WebsitePublishingAPI.md](docs/WebsitePublishingAPI.md)):

> Production: `https://baronshub.orangejelly.co.uk`

Why this is fatal even though Vercel issues a 308 redirect:
- `fetch` (browsers, Node, Deno, Bun, Cloudflare Workers) strips `Authorization` on **cross-origin** redirects by design (security against credential leaking to an unintended host).
- The two hosts are different origins (`eventhub.…` vs `baronshub.…`), so the bearer token is dropped.
- The developer then sees `401 unauthorized — Missing API key` and reasonably concludes "the key doesn't work" — when in fact they never authenticated against the real host.

**Fix options (pick one):**
1. **(Easiest)** Re-issue the PDF with `https://baronshub.orangejelly.co.uk` everywhere. Update the env-var name (see Issue 2) and product name (Issue 3) in the same pass.
2. **(Platform fix)** In Vercel, add `eventhub.orangejelly.co.uk` as a second domain on the **same project** (not as a redirect). It then serves the API directly with no cross-host hop, and existing PDFs keep working. This is the only option that doesn't require the developer to change anything.

## Issue 2 — Wrong env-var name in the PDF

PDF (page 1):

> EventHub environment variable: `EVENTHUB_WEBSITE_API_KEY`

Code ([src/lib/public-api/auth.ts:11](src/lib/public-api/auth.ts:11)):

```ts
const API_KEY_ENV = "BARONSHUB_WEBSITE_API_KEY";
```

Doesn't directly stop the website integrator (they don't set the server var), but it will mislead anyone reading docs while debugging server config. Update PDF to `BARONSHUB_WEBSITE_API_KEY`.

## Issue 3 — Stale product name throughout the PDF

PDF says "EventHub" everywhere; the product is **BaronsHub** (the OpenAPI spec at `/api/v1/openapi` is even titled `"BaronsHub Website API"`). The PDF reads like an early draft from before the rename. Find/replace EventHub → BaronsHub and re-export.

## Issue 4 — `/api/v1/events*` is 500 in production (FIXED in 20260420180000)

Confirmed via Vercel function logs (export `baronshub-log-export-2026-04-20T12-15-07.json`):

```
Public API: failed to list events {
  code: '42501',
  message: 'permission denied for function current_user_role'
}
```

Postgres error 42501 = `insufficient_privilege`. Anon's EXECUTE on
`public.current_user_role()` was deliberately revoked in
[20260414160004_revoke_anon_current_user_role.sql](supabase/migrations/20260414160004_revoke_anon_current_user_role.sql)
for security hardening.

Bug source: [20260415180000_rbac_renovation.sql:174](supabase/migrations/20260415180000_rbac_renovation.sql#L174) created the `admins manage events` policy with `FOR ALL` but **no `TO` clause**:

```sql
CREATE POLICY "admins manage events"
  ON public.events
  FOR ALL                                          -- applies to SELECT too
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');
```

Without `TO`, Postgres defaults the policy to `PUBLIC` — every role, anon
included. On anon SELECT, Postgres OR's this policy with
`anon_events_select`, evaluates `current_user_role()` for any row that
doesn't match the anon filter (drafts, submissions etc.), → 42501.

**Why /venues and /event-types still worked:** their anon policy is
`USING (true)` — every row matches, so Postgres can short-circuit and never
call the second policy. The events anon policy filters by status +
deleted_at, so non-public rows force evaluation of the management policy.

**Fix:** [20260420180000_fix_public_api_events_access.sql](supabase/migrations/20260420180000_fix_public_api_events_access.sql) adds `TO authenticated` to the management policies on `events`, `venues`, and `event_types`. Behaviour for real users (administrators / office_workers / executives) is unchanged.

## Issue 5 — Doc/code minor mismatches worth tightening

The PDF's `PublicEvent` shape doesn't list every field the API actually returns. The OpenAPI spec at `/api/v1/openapi` is the source of truth and includes these extras (already shipped):

- `highlights: string[]`
- `eventImageUrl: string | null`
- `bookingType: "ticketed" | "table_booking" | "free_entry" | "mixed" | null`
- `ticketPrice: number | null`
- `checkInCutoffMinutes`, `agePolicy`, `accessibilityNotes`, `cancellationWindowHours`, `termsAndConditions`

Either expand the PDF's `PublicEvent` block or just point integrators at `GET /api/v1/openapi` and let them generate types.

## Recommended action list (in priority order)

1. ✅ **Done:** [20260420180000_fix_public_api_events_access.sql](supabase/migrations/20260420180000_fix_public_api_events_access.sql) restores anon SELECT on events. Apply with `npx supabase db push`.
2. **Re-issue the PDF** per [tasks/2026-04-20-pdf-corrections.md](tasks/2026-04-20-pdf-corrections.md): `baronshub.orangejelly.co.uk` base URL, `BARONSHUB_WEBSITE_API_KEY` env var, "BaronsHub" product name, and a pointer to `/api/v1/openapi` for the full schema.
3. **Optional but kind:** add `eventhub.orangejelly.co.uk` as an alias domain on the BaronsHub Vercel project so the old PDF keeps working for anyone who already has it.
