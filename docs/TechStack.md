# Event Planning Platform – Lean Tech Stack

## Core Principles
- All business logic runs server-side to maintain security and simplify compliance.
- Minimal infrastructure footprint leveraging managed services (Vercel + Supabase + Resend).
- Environment configuration handled via `.env.local` for development and Vercel environment variables in production.

## Application Layer
- **Framework**: Next.js (App Router) with TypeScript.
- **Rendering Strategy**: Server Components and Server Actions; client components limited to UI interactivity.
- **Styling & UI**: Tailwind CSS (or Chakra UI alternative), Radix primitives as needed.
- **Forms & Validation**: Next.js Server Actions with `useFormState` and Zod schemas for validation on the server boundary.
- **Charts & Dashboards**: Recharts (or Victory) for KPI visualisations.

## Data & Auth
- **Database**: Supabase Postgres with row-level security policies enforcing per-role access.
- **Auth**: Supabase Auth (email/password, optional magic links) with role mapping (`venue_manager`, `reviewer`, `hq_planner`, `executive`).
- **Storage**: Supabase Storage buckets for attachments and AI-generated assets.
- **Client Access**: Public anon key restricted to read flows; mutations executed through server-side Supabase client.

## Business Logic & Jobs
- **Server Actions/API Routes**: Handle event submissions, approvals, AI enrichment, notifications, debrief recording, reporting exports.
- **Planning Analytics**: Event pipeline surfaces status metrics plus venue-space conflict detection feeding the planning dashboard snapshot feed.
- **APIs**: `/api/planning-feed` serves HQ-only analytics (status counts, conflicts, upcoming submissions) for dashboards and calendar integrations; `/api/planning-feed/calendar` exports an ICS feed with conflict flags for external calendars.
- **Scheduling**: Vercel Cron hits `/api/cron/sla-reminders` (reviewer SLA queue) and `/api/cron/weekly-digest` (executive snapshot); both require a `CRON_SECRET` bearer token.
- **Job Coordination**: Supabase tables track job state and deduplication; retries handled in server logic.

## AI Enrichment
- **Service**: OpenAI or Azure OpenAI accessed via server calls using environment-stored API keys.
- **Pipeline**: Prompt orchestration, response parsing, moderation checks, and version tracking executed server-side.

## Notifications
- **Provider**: Resend for transactional emails (assignment, approvals, reminders, weekly digest).
- **Template Management**: React email components in `src/emails`, rendered through the Resend SDK (`sendTransactionalEmail`).

## Observability & Logging
- Supabase logs and Vercel analytics for request tracing.
- Application-level audit logging stored in Postgres tables (`audit_log`, `notifications`, etc.).

## Development Workflow
- `.env.local` for local secrets; Vercel environment variables for staging/production.
- Tooling: ESLint and TypeScript. Server action/unit test harness queued next (Vitest or Jest to be introduced).
- Tailwind CSS compiled via the new v4 PostCSS plugin with Lightning CSS disabled locally/CI using `TAILWIND_DISABLE_LIGHTNINGCSS=1`.
- GitHub (or preferred Git host) with Vercel Preview Deployments for feature validation.

## Future Considerations
- Evaluate Supabase Functions for push notification support if in-app alerts expand.
- Introduce dedicated analytics warehouse or BI tooling once data volume grows.
- Assess incremental static regeneration for public endpoints once website integration requirements solidify.
