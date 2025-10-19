# Development Summary

_Last updated: 2025-03-05_

## Delivered Enhancements
- **Database & Auth**
  - Renamed the `hq_planner` Supabase role to `central_planner` and updated dependent Row Level Security (RLS) policies (`supabase/migrations/20250305120000_rename_hq_role.sql`).
  - Added venue area support (`venue_areas`, `event_areas`) with RLS and indexes to unlock area-level planning plus enforced seeds (`supabase/migrations/20250305130000_venue_areas.sql`, `supabase/seed.sql`).
  - Hardened cookie handling so Supabase cookies are only set inside server actions/route handlers (`src/lib/supabase/server.ts`), eliminating the Next.js 15 warning spam.

- **User Management**
  - Introduced a service-role backed user creation action with validation, role enforcement, optional invites, and Vitest coverage (`src/actions/users.ts`, `src/actions/users.test.ts`).
  - Replaced “HQ Planner” language with “Central Planner” across UI, navigation, docs, and notifications (`src/components/navigation/main-nav.tsx`, `src/lib/navigation.ts`, `docs/*`).
  - Added a settings dashboard that lets Central Planners create users, assign venues to venue managers, preview existing accounts, and adjust notifications (`src/app/settings/page.tsx`, `src/components/settings/user-management-card.tsx`, `src/components/settings/notification-preferences.tsx`).

- **Venues & Areas**
  - Added CRUD server actions for venue areas with audit logging hooks (`src/actions/venues.ts`).
  - Embedded the new `VenueAreasManager` on the venue edit screen and stripped the legacy “Region” field from the create form to meet the latest spec (`src/app/venues/[id]/edit/page.tsx`, `src/app/venues/new/page.tsx`, `src/components/venues/venue-areas-manager.tsx`, `src/components/venues/venue-form.tsx`).
- Venue management now includes per-space capacity handling, and planners invite new users directly from the workspace.
  - Let planners define areas and capacities during venue creation so they land ready for event drafting (`src/components/venues/venue-form.tsx`, `src/actions/venues.ts`).

- **Events Workflow**
  - Rebuilt the event draft form into a multi-step wizard with venue area selection, better validation routing, and review summary (`src/components/events/event-form.tsx`).
  - Shipped a dedicated “Create event draft” route with role gating and venue filtering plus an enriched `/events` index featuring calendar/list toggles (`src/app/events/new/page.tsx`, `src/app/events/page.tsx`, `src/components/events/events-calendar-viewer.tsx`, `src/components/events/week-calendar.tsx`).
  - Added a nested `/events/[eventId]/debrief` workflow with reminder timelines, post-event KPIs, and reference runbooks (`src/app/events/[eventId]/debrief/page.tsx`, `src/components/events/debrief-form.tsx`, `src/lib/events/upcoming.ts`, `src/lib/time.ts`).
  - Updated planning analytics, reviewer flows, and cron routes to understand venue areas and new role naming (`src/lib/events/planning-analytics.ts`, `src/actions/reviewers.ts`, `src/app/api/cron/*`, related tests).
  - Enforced area selection whenever a venue defines spaces and now snapshot the full venue/area state during submission so versions and audit logs stay descriptive (`src/actions/events.ts`, `src/components/events/event-form.tsx`, tests in `src/actions/events.test.ts`).

- **Notifications & Email**
  - Re-skinned existing Resend templates to match the app typography/brand palette and added reviewer notification improvements (`src/emails/*.tsx`, `src/lib/notifications/*.tsx`).
  - Designed Supabase system email templates (invite, password reset, OTP, etc.) that mirror the EventHub styling and stored them as pure HTML in `docs/emails/`.

- **Design System & Documentation**
  - Laid down shared UI primitives (cards, buttons, alerts, headers, badges, etc.) for consistent styling across pages (`src/components/ui/*`, `src/app/globals.css`).
  - Captured supporting collateral: brand palette, UI implementation playbook, copy runbooks, and QA guides (`docs/BrandPalette.md`, `docs/UIImplementationPlan.md`, `docs/Runbooks/UICopy.md`, `docs/Runbooks/DebriefQA.md`, updates throughout `docs/*.md`).

## Operational Notes
- Run `npm run supabase:migrate` (or `npm run supabase:reset`) so the `central_planner` rename and `venue_areas` tables exist locally.
- Seeds now include sample venue areas and area assignments. Re-run the seed script after migrations to keep demo data in sync.
- Lint, unit tests, and the production build were verified locally:
  - `npm run lint`
  - `npm test`
  - `npm run build`

## Outstanding Follow-ups
- Decide whether the new event cards/layout on `/events` aligns with product expectations; restore `PageHeader`/`StatPill` variants if required (`src/app/events/page.tsx`).
- Consider a lightweight component test for the venue area manager UI once we expand interactive coverage (`src/components/venues/venue-areas-manager.tsx`).
- Review newly created docs/runbooks for completeness once planning leadership validates the workflows (`docs/Runbooks/*.md`, `docs/UIImplementationPlan.md`).

## Quick Reference
- Need access help? Central planner support contact stays at `peter@orangejelly.co.uk` (see `src/app/settings/page.tsx`).
- Runbooks linked from UI:
  - Cron monitoring: `docs/Runbooks/CronMonitoring.md`
  - AI metadata maintenance: `docs/Runbooks/AiMetadataMaintenance.md`
  - Debrief QA: `docs/Runbooks/DebriefQA.md`
- Email templates preview: open the HTML files in `docs/emails/` directly in a browser to review rendering.
