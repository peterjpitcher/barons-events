# Barons Events MVP

This build is a slimmed-down reboot focused on the core flows for Sprint 1: event drafting, reviewer decisions, planner oversight, and post-event debriefs.

## Stack
- Next.js 15 (App Router, TypeScript, Tailwind v4)
- Supabase (Postgres + Auth)
- Resend (optional email notifications)
- Vitest (placeholder for future unit coverage)

## Getting Started
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Environment variables**  
   Copy `.env.example` to `.env.local` and fill in real keys. Minimum required:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (only for migrations/seeds)
   - `RESEND_API_KEY` (optional; emails skipped when unset)
3. **Reset and seed the database**  
   Make sure the Supabase CLI is linked to the `shofawaztmdxytukhozo` project, then run:
   ```bash
   npm run supabase:reset
   ```
   This applies the MVP migrations and seeds demo users/venues/events:
   - `central.planner@barons.example` / `password`
   - `reviewer@barons.example` / `password`
   - `venue.manager@barons.example` / `password`
   - `executive@barons.example` / `password`
4. **Start the app**
   ```bash
   npm run dev
   ```
   Visit http://localhost:3000 and sign in with one of the accounts above.

## Core Flows
- **Venue manager**: `/events/new` → save draft → submit for review → track status on `/events` → add debrief once approved.
- **Reviewer**: `/reviews` surfaces assigned submissions with an inline decision form or link through to `/events/[eventId]`.
- **Planner**: `/` dashboard shows status counts, review queue summary, upcoming events, and lightweight conflict detection.
- **Debrief**: `/debriefs/[eventId]` captures attendance, takings, and notes, bumping the event to `completed`.

## Scripts
- `npm run dev` – Next.js dev server
- `npm run build` – Production build
- `npm run start` – Serve the production build
- `npm run lint` – ESLint (may require patch fix if `@rushstack/eslint-patch` misbehaves)
- `npm run test` – Reserved for future Vitest suites
- `npm run supabase:reset` – Resets and seeds the linked Supabase project
- `npm run supabase:migrate` – Pushes migrations to the linked Supabase project

## Project Structure
```
src/
  actions/         // Server actions for auth/events/reviews/debriefs
  app/             // App Router pages
  components/      // UI primitives + feature components
  lib/             // Supabase helpers, validation, notifications
supabase/
  migrations/      // MVP schema
  seed.sql         // Demo data
docs/              // Original product, UX, and schema documentation (untouched)
```

## Outstanding Follow-ups
- Restore ESLint once the `@rushstack/eslint-patch` issue is resolved (tracked separately).
- Flesh out Vitest coverage for server actions and date helpers.
- Hook Resend templates and cron jobs when we expand beyond MVP.
