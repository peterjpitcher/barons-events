---
generated: true
last_updated: 2026-06-09
source: session-setup
project: baronshub
---

# Relationships & Cross-Reference Map

How the pieces in [[overview]], [[routes]], [[server-actions]], and [[data-model]] connect.

## Request → auth → action chain

```
Browser request
  → middleware.ts
      • host rewrite (l.baronspubs.com → /l/* or [code])
      • isPublicPath()? → security headers + CSRF, return
      • Supabase getUser() (JWT)            ── fail → /login
      • app-session cookie validation       ── fail → /login (session_missing/expired/mismatch)
      • deactivation check (users.deactivated_at) ── set → /deactivated
  → src/app/layout.tsx (getCurrentUser() — skipped on auth/public pages)
  → page.tsx (Page guard: capability fn from src/lib/roles.ts → redirect /unauthorized)
  → server action (src/actions/*) — RE-VERIFIES role server-side, mutates DB, logAuditEvent(), revalidatePath()
```

Source files: `middleware.ts`, `src/lib/auth/session.ts`, `src/lib/auth.ts` (`getCurrentUser`), `src/lib/roles.ts`, `src/lib/audit-log.ts`.

## Auth helpers map

| Concern | Helper | Location |
|---------|--------|----------|
| Current user (server) | `getCurrentUser()` | `src/lib/auth.ts` |
| App-session validation + rotation | `validateSessionWithRotation()`, `SESSION_COOKIE_NAME` | `src/lib/auth/session.ts` |
| Role capabilities | `isAdministrator`, `canEditEvent`, `canManageBookings`, `canManageUsers`, `canViewPlanning`, … (26 fns) | `src/lib/roles.ts` |
| Public-API key | `requireWebsiteApiKey()`, `checkApiRateLimit()`, `jsonError()`, `methodNotAllowed()` | `src/lib/public-api/auth.ts` |
| Rate limiting | `checkRateLimit()`, `checkBookingRateLimit()`, `getClientIp()` | `src/lib/public-api/rate-limit.ts` |
| Cron auth | `verifyCronSecret()` | `src/lib/cron-auth.ts` |
| Password policy | `bcryptjs` hashing + breach check | `src/lib/auth/password-policy.ts` |
| CAPTCHA | `verifyTurnstile()` | `src/lib/turnstile.ts` |

## Routes ↔ actions ↔ tables (selected flows)

| Domain | UI pages ([[routes]]) | Actions ([[server-actions]]) | Core tables ([[data-model]]) |
|--------|----------------------|------------------------------|------------------------------|
| Events lifecycle | `/events*` | `events.ts`, `pre-event.ts` | `events`, `event_venues`, `event_versions`, `approvals` |
| Bookings & payments | `/bookings`, `/events/[eventId]/bookings`, `/l/*`, `/api/bookings/payment/create-order` | `bookings.ts` | `event_bookings`, `customers`, `payment_transactions`, `payment_refunds`, `payment_webhooks` |
| Planning & SOP | `/planning*`, `/debriefs*` | `planning.ts`, `sop.ts`, `debriefs.ts`, `internal-notes.ts` | `planning_*`, `sop_*`, `debriefs`, `internal_notes` |
| Venues & hours | `/venues*`, `/opening-hours` | `venues.ts`, `opening-hours.ts`, `business-settings.ts` | `venues`, `venue_*`, `business_settings`, `pending_cascade_backfill` |
| Users & access | `/users`, `/account` | `users.ts`, `account.ts`, `auth.ts`, `user-preferences.ts`, `slt.ts` | `users`, `app_sessions`, `audit_log`, `login_attempts`, `slt_members` |
| Artists / links / types | `/artists*`, `/links`, `/settings/event-types` | `artists.ts`, `links.ts`, `event-types.ts` | `artists`, `short_links`, `event_types` |

## Integration touch-points

| Integration | Triggered by | Files |
|-------------|--------------|-------|
| Stripe checkout | `/api/bookings/payment/create-order` → `bookings.ts`; webhook `/api/webhooks/stripe` | `src/lib/payments/*` |
| Twilio SMS | cron `sms-*` routes; inbound `/api/webhooks/twilio-inbound` | `src/lib/twilio.ts`, `src/lib/sms.ts` |
| Resend email | `notifications.ts` from many actions (gated by email flags) | `src/lib/notifications.ts` |
| OpenAI | `generateWebsiteCopy*`, `generateTermsAndConditions` (events.ts); cron `refresh-inspiration` | `src/lib/ai.ts` |
| Upstash rate limit | public v1 API + booking create-order | `src/lib/public-api/rate-limit.ts`, `src/lib/redis.ts` |
| Public website API | `/api/v1/*` consumed externally via `BARONSHUB_WEBSITE_API_KEY` | `src/lib/public-api/*` |

## Cron jobs → effects

13 `CRON_SECRET`-gated jobs under `/api/cron/*` ([[routes]]): SMS lifecycle (`sms-reminders`, `sms-post-event`, `sms-booking-driver`), email digests (`weekly-digest`, `monthly-sales-report`), maintenance (`attachments-cleanup`, `payment-cleanup`, `cleanup-auth`, `reconcile-event-images`), workflow sweeps (`expire-stale-approvals`, `sop-not-required-sweep`, `cascade-backfill`), and content (`refresh-inspiration`).

## Environment variables (declared in `.env.example` ↔ used in `src/`)

| Var | Scope | Declared | Used | Notes |
|-----|-------|----------|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | public | yes | yes (15) | also in CSP connect/img-src |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | yes | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | server | yes | yes | admin client, deactivation check |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `BOOKING_RESEND_FROM_EMAIL` | server | yes | yes | email |
| `BOOKING_EMAILS_DISABLED` / `BARONSHUB_OPERATIONAL_EMAILS_ENABLED` / `NOTIFICATIONS_DISABLED` | server | yes | yes | email kill-switches |
| `BARONSHUB_WEBSITE_API_KEY` | server | yes | yes (5) | public API auth |
| `BOOKING_UPDATE_TOKEN_SECRET` | server | yes | yes (6) | signs amendment links |
| `NEXT_PUBLIC_SITE_URL` / `VERCEL_URL` / `NEXT_PUBLIC_APP_URL` | mixed | url declared | yes | base-URL resolution |
| `OPENAI_API_KEY` / `OPENAI_WEBSITE_COPY_MODEL` | server | yes | yes | AI copy/inspiration |
| `CRON_SECRET` | server | yes | yes | cron auth |
| `EVENT_SAVE_USE_RPC` | server | yes | yes (12) | atomic event-save flag |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` / `TWILIO_WEBHOOK_URL` | server | yes | yes | SMS |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | server | yes | yes | payments |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | mixed | yes | yes | CAPTCHA |

**Used in `src/` but not in `.env.example`** (verify intentional): `SHORT_LINK_HOST`, `SLT_FROM_ALIAS`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` (Upstash KV), `NODE_ENV` (built-in), and `INTEGRATION_TEST_*` (test-only fixtures).
