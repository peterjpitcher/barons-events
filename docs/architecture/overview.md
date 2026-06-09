---
generated: true
last_updated: 2026-06-09
source: session-setup
project: baronshub
---

# BaronsHub — Architecture Overview

Event management platform for the Barons pub group: event lifecycle (draft → published → completed), bookings with paid checkout, planning/SOP workflows, opening-hours management, and a rate-limited public API consumed by the Barons website.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript (strict) |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth (JWT + HTTP-only cookies) **plus** a custom app-session layer validated in middleware |
| Styling | Tailwind CSS, `lucide-react` icons, `sonner` toasts |
| Caching / rate limit | Upstash Redis (`@upstash/redis`, `@upstash/ratelimit`) |
| Tests | Vitest |
| Deploy | Vercel (cron via Vercel Cron) |

## At a glance

| Metric | Count |
|--------|-------|
| Pages | 36 → see [[routes]] |
| Route handlers | 28 (13 cron, 8 public v1 API, 4 webhooks/booking/search, 3 short-link/auth) → [[routes]] |
| Root layouts | 1 |
| Server action files | 22 → see [[server-actions]] |
| Database tables | 48 → see [[data-model]] |

## Auth model (summary)

Two stacked layers, both enforced in `middleware.ts`:

1. **Supabase JWT** — validated with `getUser()` (never `getSession()`).
2. **Custom app-session** — `app-session-id` cookie validated via `validateSessionWithRotation()` (`src/lib/auth/session.ts`), with token rotation, user-id binding (anti session-fixation), and fail-closed behaviour. A deactivation check then blocks users with `deactivated_at` set.

Middleware also issues a per-request **CSP nonce**, sets **CSRF** + security headers, and rewrites the `l.baronspubs.com` host for landing pages/short links. `/api/*` is excluded from the matcher — those routes own their auth.

### Roles (custom model — see project CLAUDE.md)

Three domain roles stored in `public.users.role`, gated through capability functions in `src/lib/roles.ts` (`canManageBookings`, `canEditEvent`, `isAdministrator`, …):

| Role | Tier | Capability |
|------|------|-----------|
| `administrator` | admin | Full platform + user management |
| `office_worker` | editor | Venue-scoped write (if `venue_id` set) or global read-only; owns planning/debriefs |
| `executive` | viewer | Read-only across events, planning, reporting |

Only `"administrator"` appears as a string literal in `roles.ts`; office_worker/executive behaviour is expressed through capability functions and the `venue_id` capability switch. Full chain in [[relationships]].

## Integrations

| Service | Package | Primary files | Purpose |
|---------|---------|---------------|---------|
| Supabase | `@supabase/ssr`, `@supabase/supabase-js` | `src/lib/supabase/{server,client,admin}.ts` | DB, auth, storage |
| Resend | `resend` | `src/lib/notifications.ts` | Transactional + operational email |
| Stripe | `stripe` | `src/lib/payments/` (`providers/stripe.ts`, `service.ts`) | Paid public booking checkout + webhooks |
| Twilio | `twilio` | `src/lib/twilio.ts`, `src/lib/sms.ts` | SMS confirmations, reminders, inbound |
| OpenAI | (fetch via `src/lib/ai.ts`) | `src/lib/ai.ts` | Event inspiration + website copy generation |
| Upstash | `@upstash/ratelimit`, `@upstash/redis` | `src/lib/public-api/rate-limit.ts`, `src/lib/redis.ts` | Public-API + booking rate limiting |
| Cloudflare Turnstile | `@marsidev/react-turnstile` | `src/components/turnstile-widget.tsx`, `src/lib/turnstile.ts` | CAPTCHA on login, password reset, booking |
| QR codes | `qrcode` | `src/components/links/utm-dropdown.tsx` | Short-link / UTM QR generation |
| Phone parsing | `libphonenumber-js` | bookings, twilio webhook, payments | E.164 normalisation |
| Password policy | `bcryptjs` | `src/lib/auth/password-policy.ts` | Password hashing / breach check |

## Feature flags & env

Key toggles (full table in [[relationships]]): `EVENT_SAVE_USE_RPC` (atomic event-save RPC path), `BARONSHUB_OPERATIONAL_EMAILS_ENABLED` / `NOTIFICATIONS_DISABLED` / `BOOKING_EMAILS_DISABLED` (email kill-switches), `CRON_SECRET`, `BARONSHUB_WEBSITE_API_KEY`, `BOOKING_UPDATE_TOKEN_SECRET`.

## Related docs

- [[routes]] — full URL + auth table
- [[server-actions]] — mutation inventory
- [[data-model]] — schema (DB-agent populated)
- [[relationships]] — cross-reference & auth chain
- `NOTES.md` — hand-maintained notes (not regenerated)
