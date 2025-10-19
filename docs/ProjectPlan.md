# Event Planning Platform – Project Plan

## Phase Overview
Each phase is sequential and handled directly by us (Developer + Product Owner). Timelines are flexible; move forward when the phase objectives are satisfied.

1. **Discovery & Alignment**  
   - Activities: Confirm personas, refine requirements, prioritise MVP scope, agree success metrics.  
   - Lead: Product Owner for business context, Developer for feasibility notes.  
   - Exit Criteria: Shared understanding captured in PRD with assumptions validated.

2. **UX & Service Sketching**  
  - Activities: Produce low-fi wireframes for key flows (submission, review, central planning dashboard, debrief), define navigation structure, capture UX notes.  
   - Lead: Developer (with feedback from Product Owner).  
   - Exit Criteria: Wireframes approved, design decisions documented in `docs/UXFlowNotes.md`.

3. **Technical Architecture & Backlog**  
   - Activities: Finalise Supabase schema/RLS, map server actions, confirm AI/service integrations, break MVP into build iterations.  
   - Lead: Developer.  
   - Exit Criteria: Architecture captured in `docs/SupabaseSchema.md` and build backlog ready (starting with Sprint 1 plan).

4. **Build Iteration 1 – Foundations**  
   - Activities: Implement auth, user/venue setup, core event schema, draft creation API, baseline UI shell.  
   - Lead: Developer.  
   - Exit Criteria: Sprint 1 deliverables met (`docs/Sprint1Plan.md`), deployed to staging for smoke tests.

5. **Build Iteration 2 – Submission & Review**  
   - Activities: Submission workflow, reviewer queue with SLA indicators, notifications, conflict calendar.  
   - Lead: Developer.  
   - Exit Criteria: End-to-end submission-to-decision flow demonstrable.

6. **Build Iteration 3 – AI & Publishing**  
   - Activities: Integrate AI enrichment, metadata review UI, structured export/publish pipeline.  
   - Lead: Developer.  
   - Exit Criteria: Approved events automatically generate metadata, editable and publishable downstream.

7. **Build Iteration 4 – Debriefs & Analytics**  
   - Activities: Post-event debrief forms, reminder automation, KPI dashboards, weekly digest email.  
   - Lead: Developer.  
   - Exit Criteria: Debrief compliance tracked; reporting surfaces core metrics.

8. **Testing & Polish**  
   - Activities: Comprehensive QA pass, accessibility/performance checks, documentation updates, bug fixing.  
   - Lead: Developer (Product Owner assists UAT).  
   - Exit Criteria: Acceptance criteria met, critical bugs resolved, release checklist complete.

9. **Pilot & Feedback Loop**  
   - Activities: Release to initial venue set, monitor analytics, tune AI prompts, adjust notifications.  
   - Lead: Developer + Product Owner.  
   - Exit Criteria: Pilot goals met, backlog updated with improvements.

10. **Full Release & Support**  
    - Activities: Roll out to remaining venues, create onboarding materials, define support cadence, monitor KPIs.  
    - Lead: Developer + Product Owner.  
    - Exit Criteria: Platform stable in production with agreed operational rhythms.

## Cross-Phase Notes
- **Documentation**: Keep `/docs` updated at each phase to reflect decisions and learnings.
- **Feedback Loop**: Schedule quick check-ins after each iteration to adjust priorities.
- **Quality**: Automated tests and manual smoke checks added incrementally; no separate QA role.

## Team Brief & Ways of Working
- **Decision-first**: Surface the intent of a change in the pull request description and link to the task below; small, focused PRs keep Supabase migrations, server actions, and UI tweaks easy to review.
- **Tests over trust**: Any change touching server actions, cron routes, or Supabase migrations must ship with Vitest coverage (unit or integration) that fails before the fix and passes after. Run `npm test` locally before opening a PR.
- **Env discipline**: Use `.env.example` as the source of truth; if a variable is required for your feature, add it there and document usage in `README.md` when relevant. Run `npm run supabase:reset` prior to QA to keep seed data aligned.
- **Type-safe Supabase**: Prefer the typed client (`createServerClient`) and Zod validation for inputs. Do not bypass RLS—use service role access only inside server actions or cron routes where documented.
- **UI polish**: New UI should follow the existing Tailwind utility pattern, respect dark text on light background, and provide loading/skeleton states when async calls exceed ~200 ms.
- **Communication cadence**: End each PR with a short “Verification” note describing manual checks or screenshots, and flag any follow-on TODOs directly in the relevant backlog section below.

## Milestones
1. PRD & UX approval.
2. Foundations deployed (Iteration 1 complete).
3. Submission-to-approval workflow live.
4. AI enrichment live.
5. Debrief & analytics operational.
6. Pilot release.
7. Full release.

## Risks & Mitigations
- **Scope overload**: Reassess priorities with Product Owner before starting each iteration; adapt backlog.
- **AI integration hurdles**: Maintain fallback manual metadata workflow; iterate prompts with small batch testing.
- **Notification fatigue**: Test cadence during pilot; adjust messaging quickly based on feedback.
- **Single-developer bandwidth**: Timebox iterations, ensure documentation stays current to avoid rework.

## Active Workstreams

### Workstream A – Reliability, Monitoring & Quality Gates
**Assignments**  
- Me (Dev Lead): owns this stream end-to-end.

**Completed**  
- Cron observability runbook, helper scripts, and SLA monitoring panel shipped (queued retries, webhook heartbeats).
- Monitoring panel now consumes `cron_notification_failures`, exports `/api/monitoring/cron/failures`, and surfaces recent alert log entries.
- Vitest coverage added for cron routes + monitoring APIs; CI enforces `TAILWIND_DISABLE_LIGHTNINGCSS=1`.
- Reviewer notifications sidebar embedded in Planning Ops highlights recent SLA alerts with quick mailto/timeline links. Decision modal templates and reviewer queue UI now share the new component kit with unit coverage.

**Outstanding backlog**  
- Automate cron webhook 200 checks (scheduled heartbeat + alert) and surface status in the panel header.  
- Build reviewer notifications history endpoint + planning sidebar filters (depends on data model decisions).  
- Extend reviewer server-action tests with Supabase/RLS integration scenarios (assign/decision error branches).  
- Seed QA loop: add scripted smoke checklist + ensure reseed flows exercise monitoring dashboards.

### Workstream B – Planning & Executive Experience
**Assigned to Dev A (Full-stack/UI).**

**Status**  
- ICS subscribe CTA, calendar runbook updates, conflict deep links, and navigation polish are live.
- Weekly digest vs. planning feed parity validated via `scripts/check-planning-parity.mjs` (current staging snapshot empty → reseed before next send).
- Reviewer queue filters persist via query params/local storage, Planning/Reviews skeletons cover load states, and conflict panels link directly into event timelines.
- Supabase seed UUID corrected so `supabase db reset --local` succeeds; local reset + parity check confirmed after bringing the CLI stack up with `supabase start`.

**Remaining scope**  
- Monitor executive calendar adoption and capture additional pilot feedback after the next staged reseed + digest run.  
- Schedule parity script checks as part of release smoke tests once staging data is refreshed.  

### Workstream C – Debriefs, Settings & Documentation Polish
**Assigned to Dev B (Venue Manager/Ops focus).**

**Status**  
- Post-event debrief page delivers grouped panels (performance, observations, media), reminder timeline, and runbook links for QA and cron escalation.  
- Settings workspace refreshed with profile summary card, notification toggles (including reviewer SLA alerts), team role overview, and documentation quick links.  
- Planning Ops surfaces reference the latest runbooks (Cron monitoring, Executive calendar) and expose the reviewer notifications sidebar.  
- Documentation updated: UI implementation plan, UX flow notes for debrief/settings, and new `docs/Runbooks/DebriefQA.md` checklist.

**Next steps**  
- Wire debrief submission to the forthcoming Supabase `record_debrief` action and persist reminder state from real data.  
- Capture and store mobile + desktop screenshots for the debrief and settings pages once wiring lands.  
- Add integration coverage for the notification preferences module once the `user_preferences` table/RPC is finalised.

## Appendix – Executive Calendar Subscription Playbook
### Google Calendar (Web)
1. From the Planning Ops dashboard, copy the `https://<app-domain>/api/planning-feed/calendar` link via the “Subscribe via ICS” button.  
2. In Google Calendar, open the left sidebar → “Other calendars” → “+ Add other calendars” → “From URL”.  
3. Paste the ICS link, keep “Make the calendar publicly accessible?” unchecked, and click “Add calendar”.  
4. Rename the calendar to “Barons Planning Feed” and colour it amber so conflict entries (prefixed with “Conflict · …”) stand out.

### Outlook (Web)
1. Copy the ICS link from the “Subscribe via ICS” button.  
2. Navigate to Outlook Calendar → “Add calendar” → “Subscribe from web”.  
3. Paste the ICS URL, set an intuitive name/colour, and save. Outlook will refresh the feed roughly every hour; force a manual refresh after initial setup to verify events appear.  
4. Toggle event alerts to “None” if execs prefer email-only digests; conflict markers stay visible in the calendar view.

> **Rollout tip**: After each subscription, verify that at least one conflict event and a standard approved event render. If nothing appears, ensure the exec account has access to the planning workspace (Supabase RLS still applies).
