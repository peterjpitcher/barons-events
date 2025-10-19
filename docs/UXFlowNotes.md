# UX Flow Notes & Wireframe Guidance

## Design Principles
- Guided, low-friction workflows tailored to each role.
- Clear progress indicators and feedback on submissions and approvals.
- Mobile-friendly layouts for quick updates (especially debriefs).
- Consistent component patterns using shared design tokens (buttons, status badges, cards).
- Barons brand alignment using the primary navy `#273640` with warm/cool complementary accents and soft neutral canvas backgrounds.
- Dark-mode fallback palette mirrors the brand hues to maintain contrast in low-light contexts.
- Plain-language copy that feels human and calm—reference `docs/Runbooks/UICopy.md` before shipping new strings.

## Brand Palette & Tokens

| Role                | Colour Name          | Hex Code | Usage Notes                                                                 |
| ------------------- | -------------------- | -------- | ---------------------------------------------------------------------------- |
| **Primary**         | Deep Heritage Navy   | `#273640` | Core brand colour for navigation, headings, and key actions.                 |
| **Secondary**       | Aged Brass           | `#B49A67` | Warm metallic accent for secondary buttons, highlights, and tags.           |
| **Accent 1**        | Antique Burgundy     | `#6E3C3D` | Rich red accent for warnings, destructive states, or decorative trims.      |
| **Accent 2**        | Olive Smoke          | `#6C7156` | Earthy green for confirmations, success states, or subtle emphasis.         |
| **Neutral Light**   | Parchment            | `#E7E0D4` | Default canvas/background; evokes a heritage paper feel.                    |
| **Neutral Midtone** | Weathered Stone      | `#9CA3A6` | Supporting neutral for dividers, metadata, or secondary text.               |
| **Highlight**       | Burnished Copper     | `#A65A2E` | Optional highlight for decorative trims or promotional callouts.            |

- **Tokens**: Rounded radii (`0.5rem`, `0.75rem`, `1rem`), shadow presets (`shadow-card`, `shadow-soft`), and typography based on Geist Sans with Playfair Display for serif accents.

## Component Kit
- `Button` variants: primary, secondary, outline, ghost, subtle, destructive (rounded, pill style).
- `Badge` system for live/building/queued statuses plus info/success/warning/danger states.
- `Card` surfaces with consistent padding, header/footer helpers, and stat-pill summary variant.
- `Table` scaffolding with hover states, zebra separators, and rounded container.
- `Alert`, `PageHeader`, `ContentGrid`, `ContentSection`, `Avatar`, `Skeleton`, and input primitives (input/select/textarea) unify form layout and feedback.
- All primitives live under `src/components/ui/*` and share the `cn` helper (`src/lib/utils.ts`).

## Key Screens & Notes

### 1. Venue Dashboard
- **Goals**: Quick snapshot of upcoming events, statuses, and outstanding actions.
- **Layout**: Hero banner with next event, cards for `Drafts`, `Awaiting Review`, `Feedback Required`, `Approved`.
- **Actions**: `Create Event` CTA, link to submit debrief (if pending).
- **Notifications**: Inline banner for overdue debriefs or revision requests.

### 2. Event Creation / Edit Flow
- **Structure**: Multi-step form (`Basics`, `Promotions`, `Talent`, `Goals & Targets`, `Attachments`).
- **Current build**: Basics → Schedule → Review wizard live with progress indicator, local validation, and summary confirmation before submission.
- **Guidance**: Progress indicator; inline validation; contextual tips for goal selection and promo details.
- **Autosave**: Draft saves on step change; explicit `Submit for Review` button available on final step.
- **Goal Dropdown**: Predefined options with short descriptions; optional tooltip to explain impact.
- **Attachments**: Drag-and-drop uploader with accepted file types listed.

### 3. Submission Confirmation
- Confirmation screen summarising key event data, showing assigned reviewer and SLA deadline.
- Links to `View Submission`, `Create Another Event`, `Return to Dashboard`.
- Kick-off notification preferences (toggle email reminders on/off).

### 4. Reviewer Queue
- **List View**: Table with filters (venue, region, date range, SLA countdown).
- **Row Details**: Priority badge, submission date, venue, requested date/time.
- **Bulk Actions**: Optional (future); initial scope single review at a time.
- **Empty State**: Encourage reviewers to check upcoming events or contact central planning for reassignments.
- **Implementation snapshot**: Queue now uses the shared `Table` + `Badge` kit with persistent filters, SLA badges, and inline decision form entry points.
- **Next step**: Add a sidebar notification feed surfacing SLA breaches and escalation history.

### 5. Reviewer Detail Page
- **Layout**: Left column with event overview (date/time, venue, promotions, goals); right column with timeline (submission, revisions, approvals).
- **Actions**: Approve, Request Changes, Reject buttons with confirmation modals.
- **Feedback**: Dropdown to select template, rich-text for custom message, attachments option.
- **AI Preview**: Read-only section showing auto-generated metadata once available (post-approval).

### 5a. Event Timeline View (Implemented)
- Combined manual + AI updates in a filterable timeline using the new card + badge system.
- Conflict/AI deep links surface contextual alerts ahead of the header.
- Summary header uses status badges, schedule tiles, and immediate access back to the events list.
- AI entries expose synopsis, hero copy, SEO keywords, tags, and talent bios inline when filtering.

### 5b. Reviewer Decision Workspace (In-Progress)
- Queue summary tiles highlight SLA posture (on track, due soon, overdue, missing date).
- Persistent filters (status + reviewer) save per user, feeding the new decision workspace context card.
- Trigger button opens a modal with decision templates (approve, needs revisions, reject) and optional notes.
- Focus panel provides side-by-side event overview, recent feedback history, and decision entry using the shared component kit.
- Reviewer notifications sidebar in Planning Ops surfaces the most recent SLA reminders with mailto/timeline shortcuts; future work adds filtering and historical export.

### 6. Central Planner Dashboard
- **Top-Level Metrics**: Cards for events by status, breaches, upcoming week snapshot, debrief compliance.
- **Calendar**: Month/week toggle, color-coded by status, conflict warnings (toast or inline).
- **Filters**: Venue, region, event type, goal.
- **Quick Actions**: `Clone Event`, `Manage Goals`, `Export CSV`.
- **Planning Ops header**: PageHeader now opens with a conflict alert banner and in-line ICS subscription card linking to the executive calendar runbook so planners can remediate overlaps quickly.
- **Analytics tiles**: Pipeline metrics use the shared `StatPill` component with trend copy; loading states render skeletons so the grid doesn't jump during refreshes.
- **Cron monitoring**: Heartbeat/queue/failure summaries surface as stacked cards with alert messaging for errors and skeleton placeholders while data refreshes.

### 7. AI Metadata Review
- **Entry Point**: Appears once an event is approved.
- **Layout**: Left pane with AI output sections (synopsis, hero copy, tags, talent bios); right pane with editable fields and change indicators.
- **Controls**: `Regenerate` (with reason drop-down), `Save Draft`, `Publish Metadata`.
- **Audit Badge**: Show who last edited/reviewed, timestamp, and version number.
- **Version timeline**: Each event shows version chips (with published/draft styling) plus diff badges that flag which fields changed since the previous iteration; publish/regenerate controls sit in the card footer for consistent access.

### 8. Post-Event Debrief Form
- **Access**: Deep link from email + dashboard banner.
- **Layout**: Single-page form optimised for mobile; grouped inputs (`Performance snapshot`, `Observations & follow-ups`, `Media & receipts`) presented as stacked cards with rounded surfaces.
- **Reminder states**: Alert banner reflects reminder cadence (`Heads up`, `Reminder issued`, `Second reminder`, `Overdue`, `Completed`) with copy tied to cron escalation timings. Timeline card shows day +1, day +2, and escalation milestones with badge states.
- **Inputs**: Numeric fields for attendance/takings, select for promo effectiveness, textareas for wins/issues/observations. Skeleton placeholders communicate attachment upload work-in-progress.
- **Runbooks**: Inline links to `docs/Runbooks/DebriefQA.md` (QA checklist) and `docs/Runbooks/CronMonitoring.md` for escalation context.
- **Submit Feedback**: Confirmation alert appears on save today; PDF export remains future scope.

### 9. Executive Weekly Digest (Email)
- **Sections**: Summary metrics (cycle time, approval rate, debrief compliance), top upcoming events, spotlight on standout venue performance.
- **Design**: Responsive email template with clear CTA to view full dashboard.
- **Preview panel**: In-app digest preview mirrors the email tiles via `StatPill`s, highlights reviewer queue status, and pairs the ICS CTA with a direct runbook link for calendar rollouts.

### 10. Settings Workspace
- **Structure**: PageHeader with quick facts (signed-in identity, role, support contact) plus cards for `Profile`, `Notifications`, and `Team roles`.
- **Profile Card**: Read-only fields sourced from Supabase Auth metadata with CTA to request updates from Ops until self-service editor lands.
- **Notification preferences**: Rows use select inputs for channel selection (`Email + in-app`, `In-app only`, `Disabled`) and `Send test alert` actions. Critical reviewer SLA toggle surfaced with badge. References `docs/Runbooks/AiMetadataMaintenance.md` + cron runbook for context.
- **Team roles overview**: Badges summarise Venue Manager, Reviewer, Central Planner responsibilities with onboarding-ready copy and links to relevant runbooks.
- **Documentation quick links**: Dedicated card surfaces runbook URLs (Cron monitoring, AI maintenance, Executive calendar) for rapid access during ops handoffs.

## Interaction Patterns
- Status badges use consistent color palette (`Draft`, `Submitted`, `Needs Revisions`, `Approved`, `Published`, `Completed`).
- Toast notifications for quick feedback; inline validation for errors.
- Timeline component on event detail page to highlight state changes and audit entries.
- Tooltips for terms like “Wet promotion” to support new users.

## Current Implementation Highlights
- Global shell now uses the Barons gradient header with avatar summary and pill navigation badges.
- Home dashboard ships with stat tiles, focus cards, and role-based checklist module following the new component kit.
- Venue management hub includes PageHeader stats, responsive table, audit feed cards, and updated create/edit forms leveraging the shared inputs.
- Event draft form uses the new form primitives and warning alert for missing venues; multi-step flow still outstanding.

## Accessibility Considerations
- Minimum contrast ratio 4.5:1.
- Keyboard navigable forms and buttons.
- Descriptive labels and aria attributes for status badges and progress steps.
- Error messages positioned near inputs with clear instructions.

## Wireframe Deliverables (to-be-created)
- Low-fi wireframes covering screens listed above.
- Interactive prototype linking key journeys (create event, review, AI metadata, debrief).
- Pattern library documenting buttons, form controls, cards, badges, tables, calendar interactions.

## Content Strategy Notes
- Friendly, action-oriented microcopy (“Submit for review”, “Great! Your event is with the reviewer”).
- Provide rationale in notifications (“We need more detail on talent requirements”).
- Weekly digest highlights impact (“80% of events met SLA last week”).
- Debrief form emphasises value (“These insights help shape next month’s calendar”).
