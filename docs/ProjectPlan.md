# Event Planning Platform – Project Plan

## Phase Overview
Each phase is sequential and handled directly by us (Developer + Product Owner). Timelines are flexible; move forward when the phase objectives are satisfied.

1. **Discovery & Alignment**  
   - Activities: Confirm personas, refine requirements, prioritise MVP scope, agree success metrics.  
   - Lead: Product Owner for business context, Developer for feasibility notes.  
   - Exit Criteria: Shared understanding captured in PRD with assumptions validated.

2. **UX & Service Sketching**  
   - Activities: Produce low-fi wireframes for key flows (submission, review, HQ dashboard, debrief), define navigation structure, capture UX notes.  
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

## Immediate Next Actions
- Wire cron endpoints to notification templates and monitoring so automated reminders reach live reviewers.
- Promote the new planning feed snapshot into the planning workstream and expose an API surface for calendar integrations.
- Add automated coverage for event/reviewer server actions plus migration regression checks so Supabase changes stay safe.
- Exercise the refreshed seeds (`npm run supabase:reset`) during QA to validate overlapping event conflicts, SLA analytics, timelines, and RLS paths end-to-end.
- Pilot the ICS planning calendar feed with executive dashboards and external calendars; monitor payload shape as analytics expand.
