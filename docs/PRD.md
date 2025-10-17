# Event Planning Platform PRD

## Vision
Deliver a centralised hub for cross-venue event planning that streamlines submission, approval, promotion preparation, and post-event learning with AI-assisted metadata.

## Objectives
- Reduce average approval turnaround to ≤3 business days.
- Increase the proportion of events published with structured metadata by 30%.
- Capture post-event debriefs within 48 hours for ≥90% of events.
- Achieve venue manager CSAT ≥4/5 within two months of rollout.

## Scope
### In Scope
- Multi-role web application for venue managers, reviewers, HQ planners, and executive viewers.
- Event submission workflow, approvals, AI enrichment, dashboards, debrief collection, notifications, and data export hooks.

### Out of Scope
- Single sign-on or advanced identity providers.
- Budget threshold governance rules.
- Legacy CMS integrations (awaiting new website platform).
- Public-facing website build.

## Assumptions
- Authentication uses Supabase email/password (with optional magic links); HQ admins assign user roles.
- Multiple managers can be attached to a single venue through individual accounts.
- Reviewer routing is managed manually via venue-to-reviewer mapping maintained by HQ planners.
- AI enrichment leverages a managed LLM service with human review before external publishing.
- Takings and attendance data are entered manually during debriefs in the first release.
- Weekly executive digest emails summarise KPIs and upcoming events.

## Personas
- **Venue Manager**: Creates and edits event drafts, submits requests, responds to feedback, completes post-event debriefs.
- **Regional Reviewer**: Reviews submissions for assigned venues, approves, rejects, or requests revisions, and provides feedback.
- **HQ Planner**: Monitors pipeline, manages calendars, enriches metadata, publishes downstream exports, and maintains reviewer assignments.
- **Executive Viewer**: Receives weekly digest emails and accesses read-only dashboards for performance tracking.

## Core User Journeys
1. Venue manager drafts event → validates required fields → submits for review → receives decision or feedback → resubmits if needed → approved event locks core fields.
2. Regional reviewer triages queue (with SLA indicators) → inspects details → approves, requests changes, or rejects → feedback captured in audit log.
3. HQ planner monitors dashboard/calendar → resolves scheduling conflicts → clones or sequences events → edits metadata → triggers exports.
4. Approved event triggers automatic AI enrichment → HQ reviews and optionally edits metadata → publishes structured payload to downstream systems.
5. Day-after-event reminder prompts venue manager to complete debrief → HQ reviews insights and tracks compliance.

## Functional Requirements
### Event Creation & Management
- Structured fields: title, event type, date/time, venue space, expected headcount, talent roster, wet promotion, food promotion, goal dropdown, estimated takings band, compliance checklist, attachments.
- Draft autosave, inline form validation, and ability to duplicate past events.

### Review Workflow
- Queue segmented by reviewer’s assigned venues with SLA countdown (default three business days) and escalation indicators.
- Decisions: approve (locks core fields), needs revisions (reopens editable fields), reject (final decision with rationale).
- Feedback templates with optional rich-text notes; all actions logged.

### HQ Oversight
- Dashboard with status tiles, SLA breaches, and recent activity feed.
- Calendar and list views with conflict detection (overlapping events at the same venue) plus override capability.
- Tools to clone events, manage goal list, adjust metadata, and trigger exports.

### AI Enrichment
- Automatic trigger on approval; generates synopsis, SEO keywords, hero copy, audience tags, and talent bios.
- Server-side review interface with version history, manual edits, publish toggle, and provenance logging.

### Post-Event Debrief
- Reminder emails and in-app alerts at 09:00 local time the day after the event, plus a second reminder after 24 hours and escalation to HQ at 48 hours overdue.
- Debrief captures actual attendance, wet takings, food takings, promotional effectiveness rating, notable wins, issues, observations, and optional media uploads.
- Debrief status visible in dashboards and analytics.

### Notifications & Reporting
- Email and in-app notifications for submissions, reviewer feedback, approvals, SLA warnings, AI metadata readiness, debrief reminders, and weekly executive digest.
- Reporting dashboards for approval cycle time, approval rate, event volume by type/venue, AI metadata publish rate, debrief compliance, and estimated versus actual takings deltas.
- CSV exports and weekly executive digest email summarising metrics and upcoming events.

### Permissions & Audit
- Role-based access with row-level security enforced through Supabase policies.
- Audit logging for all edits, status changes, AI runs, and publication actions.
- Soft delete with restore functionality for events and related records.

## Data Model Highlights
- Core entities: users, venues, events, event_versions, goals, talent, attachments, approvals, ai_content, notifications, debriefs, weekly_digest_logs, audit_log.
- Event status flow: draft → submitted → needs_revisions → approved → rejected → published (metadata ready) → completed (debrief submitted).
- Structured metadata stored as JSON payload for downstream syndication.

## Non-Functional Requirements
- Responsive design optimised for desktop/tablet with mobile-friendly debrief forms.
- Accessibility compliance with WCAG 2.1 AA.
- Page loads under 2.5 seconds on standard broadband; AI responses within 30 seconds or flagged for follow-up.
- Attachments stored securely in Supabase Storage; encryption at rest and in transit.
- GDPR-aligned retention: events retained for 24 months, debrief data for 36 months.
- Target availability of 99.5% with maintenance notifications at least seven days in advance.

## Success Metrics
- ≥80% of approved events publish AI metadata without requiring full rewrites.
- 20% reduction in revision cycles during the first quarter post-launch.
- ≥90% post-event debrief compliance rate.
- Venue manager CSAT ≥4/5 after two months in production.

## Risks & Mitigations
- **AI output quality**: Maintain human review workflow, refine prompts, and provide fallback templates.
- **Multi-manager coordination**: Audit trails, per-user notifications, and clear activity feeds reduce confusion.
- **Debrief fatigue**: Keep forms concise, mobile-accessible, and highlight the impact via weekly digests.
- **Cron reliability**: Use Vercel Cron paired with job deduplication tables for visibility and manual retries.
