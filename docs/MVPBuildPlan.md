# Barons Events – MVP Build Plan

This plan captures the minimal feature slice requested for the rebooted MVP. It keeps the tonal and visual language from the previous build while stripping to the essential workflows for venue managers, reviewers, and central planners.

---

## 1. Product Slice
- Authentication gate with role-based navigation shell.
- Venue manager event draft + submission form (single version, structured fields, autosave).
- Reviewer queue with per-event decision drawer (approve / request changes).
- Planner dashboard showing status tiles, outstanding submissions, and simple conflict detector.
- Post-event debrief capture form (manual entry, no reminder jobs yet).
- Notification stubs for submission + decision emails (Resend integration preserved).

Out-of-scope for MVP: AI enrichment UI, cron jobs, weekly digest, attachment uploads, cloning tools, executive dashboards, ICS feeds.

---

## 2. Data Model (Supabase)
- `users`: auth-linked profiles (id, email, full_name, role, venue_id).
- `venues`: id, name, address, capacity (optional).
- `venue_areas`: id, venue_id, name, capacity.
- `events`: core fields + status, submitted_at, reviewer assignment.
- `event_versions`: version snapshots (v1 on create, increment on submit).
- `approvals`: reviewer decisions history.
- `debriefs`: post-event metrics & notes.
- `audit_log`: generic change log (light version).

RLS: venue managers read/write own drafts, reviewers read assigned, planners full access.

Seed data: three venues, four demo users (planner, reviewer, manager, executive).

---

## 3. Application Structure
```
src/
  app/
    layout.tsx              // Shell with navigation, theming
    page.tsx                // Planner dashboard (role-gated render)
    login/page.tsx          // Auth form
    events/
      new/page.tsx          // Draft creation flow
      [eventId]/page.tsx    // Draft detail + activity
    reviews/page.tsx        // Reviewer queue
    debriefs/[eventId]/page.tsx // Debrief entry screen
  components/
    Shell/
    EventForm/
    ReviewQueue/
    ConflictList/
    StatusTiles/
    DebriefForm/
    AuthForm/
    Button, Card, Badge primitives
  lib/
    supabase/server.ts
    auth.ts
    events.ts
    reviewers.ts
    planners.ts
    validation.ts
  actions/
    auth.ts
    events.ts
    approvals.ts
    debriefs.ts
    notifications.ts
```

Styling: reuse Tailwind v4 theme tokens from the archived build (`globals.css`, button/card variants) for visual continuity.

---

## 4. Build Tasks
1. **Bootstrap**
   - Initialise Next.js 15 App Router project with TypeScript, Tailwind v4, ESLint.
   - Restore shared fonts/theme tokens (`globals.css`) and base UI primitives.
   - Wire Supabase SSR client + middleware for protected routes.

2. **Auth & Shell**
   - Implement email/password login with Supabase.
   - Build layout shell (sidebar/nav tabs conditioned on role).
   - Add session loader, sign-out, role guards per route.

3. **Events Workflow**
   - Event form with autosave (draft state) and submit action.
   - Event detail view: summary, status timeline, decision history.
   - Server actions for create/update/submit + validation (Zod).

4. **Reviewer Queue**
   - Queue list filtered by assigned venues.
   - Decision drawer with approve / request revisions, feedback note.
   - Record approvals and update event status.

5. **Planner Dashboard**
   - Status tiles (counts by `draft/submitted/needs_revisions/approved`).
   - Recent submissions list with quick links.
   - Conflict detector (same venue overlapping time slots) with simple list.

6. **Debrief**
   - Debrief form capturing attendance, takings, key learnings.
   - Completion toggles event status to `completed`.

7. **Notifications**
   - Email triggers for submission + reviewer decision (Resend template placeholders).
   - In-app toasts for success/error states.

8. **Testing & Review**
   - Vitest coverage for server actions (validation, status transitions).
   - Manual sanity pass across roles.
   - Update README with MVP instructions.

---

## 5. Deliverables
- Running Next.js app with Supabase integration meeting the above scope.
- Updated Supabase migrations + seed script aligned to MVP slice.
- Documentation updates: README (setup, workflows), possibly runbook updates.
- Basic test suite for critical server actions.
