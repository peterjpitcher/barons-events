# Barons Events Platform

## Overview
Barons Events Platform is the internal workspace for planning, approving, and analysing pub events. The first build targets Sprint 1 foundations: authentication, venue management, and draft event creation scaffolding.

## Documentation
- `docs/PRD.md` – Product requirements and success metrics.
- `docs/ProjectPlan.md` – Solo delivery roadmap and iteration flow.
- `docs/Sprint1Plan.md` – Current backlog and Definition of Done.
- `docs/SupabaseSchema.md` – Database schema and RLS plan.
- `docs/TechStack.md` – Lean Next.js + Supabase + Resend stack decisions.
- `docs/UXFlowNotes.md` – UX flows and wireframe guidance.

## Getting Started
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and populate Supabase, Resend, and OpenAI credentials (Supabase keys for development are already provided in the shared `.env.local`).
3. Apply Supabase migrations and seed data (requires the Supabase CLI to be installed and linked to your project):
   ```bash
   npm run supabase:reset
   ```
   This command resets the local database, runs all migrations, and seeds reviewer/venue demo data used by the event timelines.
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open http://localhost:3000 to view the authenticated workspace shell.
   - Anonymous visitors are redirected to `/login`. Use your Supabase email/password to sign in.
   - Once signed in, the navigation shell and workstream pages become available.

## Scripts
- `npm run dev` – Start the development server.
- `npm run build` – Create a production build (runs with `TAILWIND_DISABLE_LIGHTNINGCSS=1` to avoid native Lightning CSS requirements in local builds/CI).
- `npm run start` – Run the production build locally.
- `npm run lint` – Execute ESLint.
- `npm test` – Run Vitest unit tests (analytics helpers, event & reviewer server actions).

## Continuous Integration
- GitHub Actions workflow (`.github/workflows/ci.yml`) installs dependencies, runs ESLint, and executes Vitest on every push/PR to `main`.

## Internal APIs
- `GET /api/planning-feed` – HQ-only analytics feed returning status counts, venue-space conflicts, upcoming events, and submissions awaiting reviewer assignment.
- `GET /api/planning-feed/calendar` – ICS calendar export including conflict flags and reviewer assignments for planning subscriptions.
- `GET /api/cron/sla-reminders` – Vercel Cron endpoint (requires `CRON_SECRET`) that queues reviewer SLA notifications for overdue and imminent submissions.
- `GET /api/cron/weekly-digest` – Vercel Cron endpoint that snapshots weekly planning metrics into `weekly_digest_logs` for executive digests.

## Authentication & Sessions
- Supabase Auth powers sign-in at `/login`, using the same credentials configured in `.env.local`.
- Middleware enforces authenticated access across the workspace and redirects back to `/` after a successful sign-in.
- The top-right header surfaces the signed-in user name (from Supabase metadata) and a `Sign out` action that clears the session.

## Project Structure Highlights
- `src/actions` – Server actions (e.g., Supabase sign-in/sign-out).
- `src/lib` – Shared utilities for environment parsing, Supabase clients, and session helpers.
- `src/components` – Reusable UI components, including the navigation shell and auth form.
- `src/app/*` – App Router pages for the dashboard, workstreams (`venues`, `events`, `reviews`, `planning`, `settings`), and auth.
- `supabase/migrations` – SQL migrations for schema (users, venues, goals, events).
- `supabase/seed.sql` – Base seed data for venues and goals.

## Database (Supabase)
- Make sure the Supabase CLI is installed and linked to the project (`supabase link` + `supabase login`).
- Apply migrations without dropping data: `npm run supabase:migrate`
- Reset and reseed local database: `npm run supabase:reset`
- Seeds currently create three sample venues, overlapping event timelines (across venue spaces), and default goals. Update `supabase/seed.sql` with project-specific data as needed.
- Event and review timelines expect seeded versions/audit entries; run `npm run supabase:reset` before your first build to ensure the tables are populated.

## Tech Highlights
- Next.js App Router with server-side Supabase interactions.
- Supabase Postgres + Auth for storage and identity (see `/docs/SupabaseSchema.md`).
- Tailwind CSS v4 utilities via the new `@import "tailwindcss"` directive.
- Environment variables managed locally through `.env.local` and in production via Vercel environment settings.

## Feature Snapshot
- Venue CRUD (HQ only) feeds Supabase and writes audit-log entries.
- Event draft creation form (venue managers/HQ) stores a version `1` snapshot for future timeline views.
- Reviewer queue supports HQ filters (per reviewer / unassigned), SLA escalation cues, and queue analytics for active submissions with audit-backed decision flows.
- Event pipeline surfaces status analytics plus schedule conflict warnings and a planning feed snapshot to keep venues coordinated.
- Planning Ops dashboard consumes `/api/planning-feed` for live analytics (status tiles, conflicts, reviewer SLA gaps).
- HQ planners manage strategic goals via an active/inactive catalogue to guide venue submissions.
- AI metadata oversight workspace lists generated content, allowing planners to publish or retract metadata once reviewed.
- Event list shows per-draft version timelines with submission snapshots, diff summaries, and audit entries.
- Reviews queue surfaces assignment + decision workflows with Supabase-backed history feed.

## Next Steps & Known Gaps
- Add automated tests covering event/reviewer server actions, version history inserts, and conflict detection logic.
- Seed overlapping events (including venue space variations) and reviewer workloads in Supabase to validate SLA + conflict analytics end-to-end.
 - Wire the cron endpoints to Resend email templates and verify notifications flow end-to-end.
 - Hook the planning calendar feed into exec dashboards and external calendars to validate consumption at scale.
 - Extend AI metadata workspace with inline editing and regeneration controls ahead of website publishing integrations.
