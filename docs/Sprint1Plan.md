# Sprint 1 Plan – Foundation Build

## Sprint Goal
Establish authenticated access, venue/user management, core event data structures, and a skeleton UI to support draft creation within the centralised event planning platform.

## Working Cadence
- Treat Sprint 1 as the first focused build iteration; move to the next iteration once the Definition of Done is satisfied.
- Regular check-ins between Developer (me) and Product Owner (you) to confirm priorities or adjust scope.

## Current Progress (Week 1)
- ✅ README and workspace docs aligned; dev env configured with Supabase credentials.
- ✅ Next.js navigation shell live with workstream placeholders and status labels.
- ✅ Supabase Auth wired into middleware, login form, and session-aware layout.
- ✅ HQ planner venue listing connected to Supabase with create/edit flows for venues.
- ✅ Initial Supabase migrations + seed scripts (venues, users, goals, events) checked in.
- ✅ Venue audit logging landed with activity feed surfaced for HQ planners.
- ✅ Event draft server action and draft creation form connected to Supabase.
- ✅ Event timeline shows draft/submission history with diff summaries and an audit feed sourced from `event_versions` and `audit_log`.
- ✅ Reviewer assignment RPC + server action wired into the reviews queue with audit logging.
- ✅ Reviewer decision workflow updates event status, approvals, and audit trail under the new RLS policies.
- ✅ Reviewer queue UI now exposes per-reviewer filtering plus SLA escalation cues and queue summary analytics for HQ planners.
- ✅ Event pipeline now includes status analytics, venue-space aware conflict detection, and a planning feed snapshot to spotlight scheduling risks.
- ✅ Planning feed API (`/api/planning-feed`) delivers HQ analytics payloads for dashboards and calendar hooks.
- ✅ Planning dashboard surfaces reviewer SLA trend tiles and ships an ICS calendar feed with conflict flags for HQ planners.
- ✅ HQ goal catalogue management live with create/archive controls for planners.
- ✅ AI metadata workspace now supports inline edits plus publish/retract flows for enrichment outputs.
- ✅ Cron scaffolding landed for reviewer SLA reminders and weekly digest snapshots (secured via `CRON_SECRET`).
- ⏳ Automated tests for event/reviewer actions and migration regression checks still outstanding.

## Key Deliverables
1. Supabase project configured with core tables, row-level security policies, and role mappings.
2. Next.js app deployed to Vercel with baseline layout, navigation, and protected routes.
3. Auth flows using Supabase (sign up/in, password reset, role-based redirects).
4. Venue and user management screens (list, detail, basic CRUD restricted to HQ planners).
5. Event draft schema and API abstractions (server actions) for create/read/update drafts.
6. Audit logging scaffold capturing user actions on venues and drafts.
7. CI/CD pipeline using Vercel previews and lint/test checks.

## Backlog Items
### EP-101 Supabase Project Setup
- Configure environments (dev, staging) and initialise schema.
- Define roles/groups for venue managers, reviewers, HQ planners, executives.
- Establish seed data script for venues and roles.

### EP-102 RLS Policies & Row-Level Functions
- Implement policies restricting access to venue/event data based on user role.
- Write helper RPC for HQ planners to manage assignments.

### EP-103 Next.js Project Bootstrap
- Scaffold Next.js App Router project with TypeScript, Tailwind, ESLint, Prettier.
- Configure environment variables and Supabase client with server-only access.

### EP-104 Auth Flow Implementation
- Build sign-in, sign-up (HQ invites), password reset pages.
- Server actions for role-based routing; protect routes via middleware.

### EP-105 Layout & Navigation Shell
- Create responsive navigation with role-aware menu items.
- Implement placeholder pages for dashboard, venues, events, reviews.

### EP-106 Venue Management CRUD
- HQ-only list/detail screens, create/edit venue forms.
- Server actions for Supabase writes, with validation via Zod.

### EP-107 Event Draft Schema & API
- Define server action to create/update event drafts (title, type, schedule basics).
- Store draft snapshots in `event_versions`.
- Return hydrated drafts to client for rendering in upcoming sprints.

### EP-110 Conflict Management & Analytics
- Extend venue conflict detection to account for venue spaces and calendar feeds.
- Publish conflict summary tiles to planning dashboards.
- Add automated regression tests for event timeline/version analytics.

### EP-108 Audit Logging Framework
- Create `audit_log` table and server utility to record mutations (user, action, payload).
- Integrate logging into venue and draft actions.

### EP-109 CI/CD & Quality Gates
- Configure Vercel project and preview deployments.
- Add GitHub workflow for lint (ESLint) and unit tests (Jest placeholder).
- Document developer setup in README.

## Outstanding TODOs (Sprint 1 Wrap-Up)
- ✅ **Cron monitoring uplift**: Runbook now includes staging verification logs, helper script for triggering crons, and the Planning Ops monitoring panel surfaces queued retries plus webhook heartbeats.
- ✅ **Executive integrations**: Executive digest exposes an ICS subscribe CTA, conflict drill-down links, parity verified via `scripts/check-planning-parity.mjs`, and runbooks now document Google/Outlook pilot quirks.
- ✅ **AI metadata controls**: Regeneration pipeline now consumes OpenAI output, normalises list fields, and queues publish payloads with webhook/error handling tests.
- ✅ **Timeline polish**: Event detail timelines badge AI vs. manual diffs, and the planning AI panel filters Draft/Published entries.
- ✅ **Test coverage**: Vitest exercises regenerate → publish flows plus AI dispatch webhook success/failure paths; existing reviewer coverage remains the next expansion target.

## Testing & Validation
- Draft smoke test checklist covering auth, navigation, venue CRUD, and event submission + reviewer decision paths.
- Unit coverage in `src/actions/events.test.ts` now validates draft creation/submission server actions (auth, validation, Supabase error handling); extend to reviewer flows next.
- Reviewer decision/assignment flows are covered in `src/actions/reviewers.test.ts`, including Supabase rollback scenarios.
- Notification utilities now wrap Resend (`src/lib/notifications/*`), with reviewer assignment emails covered by unit tests.
- GitHub Actions workflow (`.github/workflows/ci.yml`) runs lint + Vitest on each push/PR to `main`.
- Regression tests for event timeline analytics and venue conflict detection (including space-aware overlaps) live in `src/lib/events/analytics.test.ts`.
- Run migration + seed cycle via `npm run supabase:reset` before QA sessions to load overlapping event seeds (venue-space variations), timeline data, and role-based RLS coverage.

## Definition of Done
- Backlog items completed with code merged to `main` and deployed to staging.
- Documentation (README or `/docs`) updated with setup instructions and feature notes.
- Smoke tests pass without critical defects; unit test suite green.
- Demo walkthrough recorded or presented covering auth flow, venue management, and draft creation API.

## Risks & Mitigations
- **RLS Misconfiguration**: Write Supabase tests and run manual SQL checks before deploying.
- **Auth UX gaps**: Prototype flows early and review together mid-iteration.
- **Schema churn**: Reconfirm required fields with Product Owner before coding; document any changes immediately.

## Dependencies
- Supabase project and Vercel environment credentials.
- Base brand assets (logo, typography) for layout scaffolding (optional for MVP but helpful).
- Initial venue data agreed with Product Owner for seeding.
