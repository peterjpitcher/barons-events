# BaronsHub

BaronsHub is the internal event, planning, booking, and venue-operations workspace for the Barons pub group. It manages event proposal, draft, review, approval, booking, debrief, SOP/planning, customer, venue, artist, public API, SMS, and email workflows.

## Stack

- Next.js 16.3 canary, App Router, React 19.1, TypeScript
- Supabase PostgreSQL, Auth, Storage, and RLS
- Tailwind CSS v4
- Vitest
- Resend, Twilio, Upstash Redis, Cloudflare Turnstile, OpenAI, QR code generation

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill the keys needed for your task. Minimum app boot keys are:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SITE_URL`
3. Start the app:
   ```bash
   npm run dev
   ```

`npm run supabase:reset` resets the linked Supabase project. Do not run it against shared/staging/production data unless you are intentionally rebuilding that environment.

## Core Routes

- `/events`, `/events/new`, `/events/propose`, `/events/pending`, `/events/[eventId]`
- `/events/[eventId]/bookings`, `/bookings`, `/customers`
- `/planning`, `/planning/[planningItemId]`
- `/debriefs`, `/debriefs/[eventId]`
- `/artists`, `/venues`, `/opening-hours`, `/links`, `/users`, `/settings`
- Public: `/login`, `/forgot-password`, `/reset-password`, `/l/[slug]`, short-link redirects at `/[code]`
- Public API: `/api/v1/*`
- Cron/webhooks: `/api/cron/*`, `/api/webhooks/twilio-inbound`

## Role Model

- `administrator`: full platform access, user/settings management, all event/planning operations.
- `office_worker` with `venue_id`: event and planning visibility/write access scoped to linked venue rows; booking/customer PII remains globally readable.
- `office_worker` without `venue_id`: global event/planning read access and can propose events for any venue, but does not gain planning write rights.
- `executive`: read-only access to events, planning, and reporting.

Roles are stored in `public.users.role`; `public.users.venue_id` is the office-worker capability switch. Enforcement is layered through UI visibility, server actions, shared helpers in `src/lib/roles.ts` and `src/lib/visibility.ts`, and Supabase RLS.

## Website Publishing API

The website API is server-to-server and bearer-token only:

```bash
curl -H "Authorization: Bearer $BARONSHUB_WEBSITE_API_KEY" \
  "http://localhost:3000/api/v1/events?limit=25"
```

Public event payloads only expose public fields. `description` is sourced from `events.public_description`; internal `events.notes` is not selected or returned.

See `docs/WebsitePublishingAPI.md` for response shapes and sync guidance.

## Scripts

- `npm run dev` - Next.js dev server
- `npm run build` - production build
- `npm run start` - serve production build
- `npm run lint` - ESLint
- `npm run test` - Vitest single pass
- `npm run typecheck` - `tsc --noEmit`
- `npm run supabase:migrate` - push pending migrations to the linked Supabase project
- `npm run supabase:reset` - destructive linked-project reset

## Verification

Use the PATH wrapper if your shell cannot spawn standard utilities:

```bash
/usr/bin/env PATH=/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH npm run typecheck
/usr/bin/env PATH=/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH npm run lint
/usr/bin/env PATH=/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH npm run test
/usr/bin/env PATH=/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH npm run build
/usr/bin/env PATH=/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH npm audit --omit=dev
```

Migration/RLS integration tests are skipped by default. Run them only against a staging-safe Supabase project:

```bash
RUN_SUPABASE_MIGRATION_TESTS=1 \
SUPABASE_OW_JWT=<office-worker-with-venue-jwt> \
SUPABASE_OTHER_OW_JWT=<different-venue-office-worker-jwt> \
SUPABASE_OW_NO_VENUE_JWT=<office-worker-without-venue-jwt> \
npm run test -- supabase/migrations/__tests__/office_worker_event_scope.test.ts
```

## Project Structure

```text
src/actions/         Server actions for mutations
src/app/             App Router pages, API routes, cron routes, webhooks
src/components/      UI primitives and feature components
src/lib/             Auth, roles, visibility, Supabase, public API, SMS/email/AI helpers
supabase/migrations/ Schema, RLS, RPC, and trigger migrations
docs/                Architecture notes, API docs, runbooks
```
