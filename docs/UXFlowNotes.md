# UX Flow Notes & Wireframe Guidance

## Design Principles
- Guided, low-friction workflows tailored to each role.
- Clear progress indicators and feedback on submissions and approvals.
- Mobile-friendly layouts for quick updates (especially debriefs).
- Consistent component patterns using shared design tokens (buttons, status badges, cards).

## Key Screens & Notes

### 1. Venue Dashboard
- **Goals**: Quick snapshot of upcoming events, statuses, and outstanding actions.
- **Layout**: Hero banner with next event, cards for `Drafts`, `Awaiting Review`, `Feedback Required`, `Approved`.
- **Actions**: `Create Event` CTA, link to submit debrief (if pending).
- **Notifications**: Inline banner for overdue debriefs or revision requests.

### 2. Event Creation / Edit Flow
- **Structure**: Multi-step form (`Basics`, `Promotions`, `Talent`, `Goals & Targets`, `Attachments`).
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
- **Empty State**: Encourage reviewers to check upcoming events or contact HQ for reassignments.

### 5. Reviewer Detail Page
- **Layout**: Left column with event overview (date/time, venue, promotions, goals); right column with timeline (submission, revisions, approvals).
- **Actions**: Approve, Request Changes, Reject buttons with confirmation modals.
- **Feedback**: Dropdown to select template, rich-text for custom message, attachments option.
- **AI Preview**: Read-only section showing auto-generated metadata once available (post-approval).

### 6. HQ Planner Dashboard
- **Top-Level Metrics**: Cards for events by status, breaches, upcoming week snapshot, debrief compliance.
- **Calendar**: Month/week toggle, color-coded by status, conflict warnings (toast or inline).
- **Filters**: Venue, region, event type, goal.
- **Quick Actions**: `Clone Event`, `Manage Goals`, `Export CSV`.

### 7. AI Metadata Review
- **Entry Point**: Appears once an event is approved.
- **Layout**: Left pane with AI output sections (synopsis, hero copy, tags, talent bios); right pane with editable fields and change indicators.
- **Controls**: `Regenerate` (with reason drop-down), `Save Draft`, `Publish Metadata`.
- **Audit Badge**: Show who last edited/reviewed, timestamp, and version number.

### 8. Post-Event Debrief Form
- **Access**: Deep link from email + dashboard banner.
- **Layout**: Single-page form optimised for mobile; grouped inputs (`Performance`, `Observations`, `Media`).
- **Inputs**: Numeric fields for attendance/takings, rating component for promo effectiveness, textareas for wins/issues/observations.
- **Submit Feedback**: confirmation screen summarising input, option to download PDF copy (future).

### 9. Executive Weekly Digest (Email)
- **Sections**: Summary metrics (cycle time, approval rate, debrief compliance), top upcoming events, spotlight on standout venue performance.
- **Design**: Responsive email template with clear CTA to view full dashboard.

## Interaction Patterns
- Status badges use consistent color palette (`Draft`, `Submitted`, `Needs Revisions`, `Approved`, `Published`, `Completed`).
- Toast notifications for quick feedback; inline validation for errors.
- Timeline component on event detail page to highlight state changes and audit entries.
- Tooltips for terms like “Wet promotion” to support new users.

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
