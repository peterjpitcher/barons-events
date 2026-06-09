---
generated: true
last_updated: 2026-06-09
source: session-setup
project: baronshub
---

# Routes

Full route inventory derived from App Router conventions. See [[overview]] for counts and [[server-actions]] for mutations invoked from these pages. Auth flow detail in [[relationships]].

**Totals:** 36 pages · 28 route handlers (13 cron) · 1 root layout.

## Auth type legend

| Tag | Meaning |
|-----|---------|
| Middleware (session) | Protected by `middleware.ts` — requires Supabase JWT **and** valid app-session cookie. Default for all non-public pages. |
| Public | Allow-listed in middleware `PUBLIC_PATH_PREFIXES` — no auth required. |
| Page guard | Page additionally calls `getCurrentUser()` / capability fn and `redirect()`s on failure. |
| Website API key | `requireWebsiteApiKey()` — `BARONSHUB_WEBSITE_API_KEY` bearer token. |
| Rate limited | `checkRateLimit` / `checkBookingRateLimit` (Upstash, per IP/key). |
| Cron secret | `verifyCronSecret()` — `CRON_SECRET` header. |
| Stripe signature | `stripe-signature` header verified before processing. |
| Twilio signature | Twilio request validation on inbound webhook. |
| Turnstile | Cloudflare Turnstile CAPTCHA token verified. |

## Pages (App Router → URL)

All pages below sit behind `middleware.ts` session auth unless marked Public. Those flagged "Page guard" re-check role/capability server-side via the helpers in `src/lib/roles.ts` (see [[server-actions]]).

| URL Path | Auth Type | Source File |
|----------|-----------|-------------|
| `/` | Middleware + Page guard (redirect by role) | `src/app/page.tsx` |
| `/login` | Public + Turnstile | `src/app/login/page.tsx` |
| `/forgot-password` | Public + Turnstile | `src/app/forgot-password/page.tsx` |
| `/reset-password` | Public | `src/app/reset-password/page.tsx` |
| `/unauthorized` | Public | `src/app/unauthorized/page.tsx` |
| `/deactivated` | Public | `src/app/deactivated/page.tsx` |
| `/account` | Middleware | `src/app/account/page.tsx` |
| `/activity` | Middleware + Page guard | `src/app/activity/page.tsx` |
| `/artists` | Middleware + Page guard | `src/app/artists/page.tsx` |
| `/artists/[artistId]` | Middleware + Page guard | `src/app/artists/[artistId]/page.tsx` |
| `/bookings` | Middleware + Page guard | `src/app/bookings/page.tsx` |
| `/customers` | Middleware + Page guard | `src/app/customers/page.tsx` |
| `/customers/[id]` | Middleware + Page guard | `src/app/customers/[id]/page.tsx` |
| `/debriefs` | Middleware + Page guard | `src/app/debriefs/page.tsx` |
| `/debriefs/[eventId]` | Middleware + Page guard | `src/app/debriefs/[eventId]/page.tsx` |
| `/events` | Middleware + Page guard | `src/app/events/page.tsx` |
| `/events/new` | Middleware + Page guard | `src/app/events/new/page.tsx` |
| `/events/pending` | Middleware + Page guard | `src/app/events/pending/page.tsx` |
| `/events/propose` | Middleware + Page guard | `src/app/events/propose/page.tsx` |
| `/events/[eventId]` | Middleware + Page guard | `src/app/events/[eventId]/page.tsx` |
| `/events/[eventId]/bookings` | Middleware + Page guard | `src/app/events/[eventId]/bookings/page.tsx` |
| `/links` | Middleware + Page guard | `src/app/links/page.tsx` |
| `/more` | Middleware + Page guard | `src/app/more/page.tsx` |
| `/opening-hours` | Middleware + Page guard | `src/app/opening-hours/page.tsx` |
| `/planning` | Middleware + Page guard | `src/app/planning/page.tsx` |
| `/planning/new` | Middleware + Page guard | `src/app/planning/new/page.tsx` |
| `/planning/[planningItemId]` | Middleware + Page guard | `src/app/planning/[planningItemId]/page.tsx` |
| `/reviews` | Middleware + Page guard | `src/app/reviews/page.tsx` |
| `/settings` | Middleware + Page guard | `src/app/settings/page.tsx` |
| `/settings/event-types` | Middleware + Page guard | `src/app/settings/event-types/page.tsx` |
| `/users` | Middleware + Page guard | `src/app/users/page.tsx` |
| `/venues` | Middleware + Page guard | `src/app/venues/page.tsx` |
| `/venues/[venueId]/opening-hours` | Middleware + Page guard | `src/app/venues/[venueId]/opening-hours/page.tsx` |
| `/l/[slug]` | Public (event landing page) | `src/app/l/[slug]/page.tsx` |
| `/l/checkout/success` | Public | `src/app/l/checkout/success/page.tsx` |
| `/l/checkout/cancel` | Public | `src/app/l/checkout/cancel/page.tsx` |

> The `l.baronspubs.com` host is rewritten in middleware: slug paths → `/l/[path]`, 8-hex paths fall through to the `[code]` short-link handler.

## Route handlers

### Short links & auth

| URL Path | Method | Auth Type | Source File |
|----------|--------|-----------|-------------|
| `/[code]` | GET | Public (short-link redirect, admin client lookup) | `src/app/[code]/route.ts` |
| `/auth/confirm` | GET | Public token exchange (sets session) | `src/app/auth/confirm/route.ts` |
| `/api/auth/session-check` | GET | Session (`@supabase/ssr` user check) | `src/app/api/auth/session-check/route.ts` |

### Public v1 API — Website API key + Rate limited

All under `requireWebsiteApiKey()` + `checkRateLimit()`. Responses use `{ success, data?, error? }`.

| URL Path | Methods | Auth Type | Source File |
|----------|---------|-----------|-------------|
| `/api/v1/events` | GET | Website API key + Rate limited | `src/app/api/v1/events/route.ts` |
| `/api/v1/events/[eventId]` | GET | Website API key + Rate limited | `src/app/api/v1/events/[eventId]/route.ts` |
| `/api/v1/events/by-slug/[slug]` | GET | Website API key + Rate limited | `src/app/api/v1/events/by-slug/[slug]/route.ts` |
| `/api/v1/event-types` | GET | Website API key + Rate limited | `src/app/api/v1/event-types/route.ts` |
| `/api/v1/venues` | GET | Website API key + Rate limited | `src/app/api/v1/venues/route.ts` |
| `/api/v1/opening-times` | GET | Website API key + Rate limited | `src/app/api/v1/opening-times/route.ts` |
| `/api/v1/health` | GET | Website API key + Rate limited | `src/app/api/v1/health/route.ts` |
| `/api/v1/openapi` | GET | Website API key + Rate limited | `src/app/api/v1/openapi/route.ts` |

> Non-GET verbs export a shared `methodNotAllowed` handler (405), which is why the scanner reported GET/POST/PUT/PATCH/DELETE on each — only GET is functional.

### Bookings, search & webhooks

| URL Path | Method | Auth Type | Source File |
|----------|--------|-----------|-------------|
| `/api/bookings/payment/create-order` | POST | Rate limited + Turnstile (public booking) | `src/app/api/bookings/payment/create-order/route.ts` |
| `/api/search` | GET | No explicit handler-level auth detected — verify (likely intended for session users) | `src/app/api/search/route.ts` |
| `/api/webhooks/stripe` | POST | Stripe signature | `src/app/api/webhooks/stripe/route.ts` |
| `/api/webhooks/twilio-inbound` | POST | Twilio signature | `src/app/api/webhooks/twilio-inbound/route.ts` |

### Cron jobs — `CRON_SECRET` (GET + POST)

| URL Path | Auth Type | Source File |
|----------|-----------|-------------|
| `/api/cron/attachments-cleanup` | Cron secret | `src/app/api/cron/attachments-cleanup/route.ts` |
| `/api/cron/cascade-backfill` | Cron secret | `src/app/api/cron/cascade-backfill/route.ts` |
| `/api/cron/cleanup-auth` | Cron secret | `src/app/api/cron/cleanup-auth/route.ts` |
| `/api/cron/expire-stale-approvals` | Cron secret | `src/app/api/cron/expire-stale-approvals/route.ts` |
| `/api/cron/monthly-sales-report` | Cron secret | `src/app/api/cron/monthly-sales-report/route.ts` |
| `/api/cron/payment-cleanup` | Cron secret | `src/app/api/cron/payment-cleanup/route.ts` |
| `/api/cron/reconcile-event-images` | Cron secret | `src/app/api/cron/reconcile-event-images/route.ts` |
| `/api/cron/refresh-inspiration` | Cron secret | `src/app/api/cron/refresh-inspiration/route.ts` |
| `/api/cron/sms-booking-driver` | Cron secret | `src/app/api/cron/sms-booking-driver/route.ts` |
| `/api/cron/sms-post-event` | Cron secret | `src/app/api/cron/sms-post-event/route.ts` |
| `/api/cron/sms-reminders` | Cron secret | `src/app/api/cron/sms-reminders/route.ts` |
| `/api/cron/sop-not-required-sweep` | Cron secret | `src/app/api/cron/sop-not-required-sweep/route.ts` |
| `/api/cron/weekly-digest` | Cron secret | `src/app/api/cron/weekly-digest/route.ts` |

> `/api/*` is excluded from the middleware matcher — each route owns its auth. Any new session-protected API route must implement its own check.
