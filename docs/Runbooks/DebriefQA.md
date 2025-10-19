# Debrief Form QA Checklist

## Purpose
Validate the post-event debrief workflow after releases touching reminders, settings, or Supabase policies. Ensures venue managers can submit grouped performance data, reminder banners show the correct state, and planning runbooks stay in sync.

## Pre-flight
- Confirm the target environment has recent events with `status = 'approved'` and no existing `debriefs` row.
- Note the event `end_at` timestamp so you can simulate reminder states (adjust via Supabase if needed).
- Verify the Cron monitoring panel is accessible at `/planning` for the same environment.
- Optional: capture the event ID for direct navigation (`/events/<eventId>/debrief`).

## Test Cases
1. **Page header & context**
   - Navigate to `/events/<eventId>/debrief`.
   - Check the header shows breadcrumbs, event window, venue, and reviewer contact.
   - Follow the "Debrief QA runbook" and "Cron monitoring checklist" links to confirm they open in a new tab.
2. **Reminder banner states**
   - For an event ending within the last 24 hours, banner should read “Debrief opens soon”.
   - Update `end_at` to >24h old; reload and confirm “Reminder issued” or “Second reminder sent” copy matches expectation.
   - Set `debriefs.submitted_at = now()` and refresh to see “Debrief submitted” success state.
3. **Form inputs & validation**
   - Leave `Actual attendance` blank and submit; validation alert should display.
   - Populate all fields with realistic data and submit; success alert should confirm the save (UI-only today).
   - Adjust numeric fields to ensure formatting accepts decimals and prevents negatives.
4. **Observations & media panels**
   - Confirm textareas accept multiline input and retain values on validation errors.
   - Skeleton placeholders should display under “Media & receipts”; CTA reads “Upload files (coming soon)”.
5. **Reminder timeline card**
   - All steps (“Day +1 reminder”, “Day +2 follow-up”, “Central escalation”) should show correct badge state based on the simulated timeline.
   - Runbook link in the card footer must open `docs/Runbooks/CronMonitoring.md`.
6. **Settings notification linkage**
   - Visit `/settings` and ensure `Reviewer SLA alerts` and `AI metadata update` rows display with runbook links.
   - Use “Send test alert” to confirm info banner appears.

## Regression Checks
- `/planning` should surface the same Cron monitoring snapshot; heartbeat badge remains accurate.
- Event timeline (`/events/<eventId>`) still links back to the debrief page via breadcrumb.
- No console errors in browser dev tools throughout the flow.

## Post-run Notes
Capture screenshots (desktop + mobile) for the QA log and attach to the release PR. Record any Supabase data tweaks so they can be reverted after testing.
