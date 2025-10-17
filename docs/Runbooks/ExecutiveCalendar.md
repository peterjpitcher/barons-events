# Executive Calendar & Digest Checklist

## Goal
Keep executive stakeholders aligned by ensuring the weekly digest email metrics match the Planning Ops dashboard and the ICS calendar subscription remains healthy.

## Pilot Notes (April 2025)
- The Planning Ops “Subscribe via ICS” CTA now consumes the live `/api/planning-feed` snapshot, so the executive digest card, calendar feed, and weekly digest emails all share the same metrics.
- Google Calendar applies the feed immediately; Outlook still needs a manual refresh after the first sync and may take up to an hour to poll thereafter.
- Calendar subscribers must already have an authenticated HQ planner session in the browser where they grab the ICS link. Otherwise the feed returns a 403 due to Supabase RLS.
- Conflict drill-down links open the event timeline (`#timeline`) directly so planners can review overlapping submissions without extra navigation.
- Google accounts using SSO occasionally prompt to re-select the Barons workspace—if the feed is added under a personal profile, Google renders the calendar but leaves events blank until the user re-authenticates.
- Outlook Web caches the ICS response aggressively; enable “Sync every 15 minutes”, hit **Refresh**, and wait ~5 minutes for conflict-prefixed events (“Conflict · …”) to appear during pilots.

## Executive Assistant Checklist
1. Confirm the exec assistant has an active HQ planner session in the planning workspace.
2. From the Planning Ops executive digest card, copy the “Subscribe via ICS” link (or download the `.ics` file if needed for Outlook desktop).
3. Follow the Google or Outlook instructions below to add the feed. Set the calendar colour to amber so conflict entries stay visible.
4. After subscribing, refresh the feed and verify one conflict-labelled entry (“Conflict · …”) plus one standard approved event appear.
5. Cross-check the Planning Ops status tiles against the latest weekly digest email—numbers now originate from the same `/api/planning-feed` payload.
6. Log the subscribed exec accounts and add a weekly reminder to spot-check feed freshness (look for events shifting status or new conflicts).

## Weekly Digest Parity (Staging)
1. Deploy latest build to staging and seed data (`npm run supabase:reset`).
2. Trigger the cron endpoint:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<staging-domain>/api/cron/weekly-digest
   ```
3. Confirm the JSON response includes:
   - `emailsSent > 0`
   - `metrics.statusCounts`, `metrics.conflicts`, `metrics.awaitingReviewer` values.
4. Run the parity checker to compare the latest digest payload with `/api/planning-feed`:
   ```bash
   node --env-file=.env.local scripts/check-planning-parity.mjs
   ```
   - `diff.isAligned: true` → metrics match. If the script exits with code `1`, reseed staging and trigger the cron again.
5. Fetch the Planning Ops dashboard (`/planning`) while authenticated as an HQ planner and visually confirm the status tiles/conflict counts match the cron response.
6. Review the email delivered by Resend (use the staging mailbox) to ensure the digest tiles mirror the same numbers (conflict tiles and awaiting reviewer counts should match the dashboard).

## ICS Subscription Pilot
1. Copy the `Subscribe via ICS` link from the Planning Ops executive digest card.
2. Follow the relevant section in `docs/ProjectPlan.md` (Appendix) or the quick steps below:
   - **Google Calendar**: Other calendars → Add → From URL → paste link → set color/rename.
   - **Outlook Web**: Add calendar → Subscribe from web → paste link → set name/color.
3. Verify events (including conflicts) appear after a manual refresh.
   - **Google**: Stay signed in with the Barons workspace; if events do not appear, open the ICS URL in a new tab to accept the SSO prompt and confirm cookies are set.
   - **Outlook**: Toggle “Sync every 15 minutes” and press **Refresh**—conflict-prefixed events usually land within 5 minutes but may take up to an hour.
4. Document the exec accounts subscribed and set a reminder to confirm feed freshness weekly.

## Seed Prep (Reviewer Coverage)
1. Open `supabase/seed.sql` and update the `region` fields for seeded users (`hq_planner`, `reviewer`, `venue_manager`) so they mirror the territories covered in the upcoming demo.
2. Adjust the seeded reviewer assignment (`assigned_reviewer_id`) on submitted events to reflect the planners and reviewers who will be showcased.
3. Run `npm run supabase:reset` to apply the updates locally, then confirm the Planning Ops dashboard and reviewer queue reflect the new regional mix.
4. Record any region overrides and venue mappings in your demo notes so they can be reverted after the session.

## Troubleshooting
- **Metrics mismatch**: Re-run the cron endpoint, refresh the Planning Ops page, and execute `node --env-file=.env.local scripts/check-planning-parity.mjs`; if the script still reports a diff, reseed staging (`npm run supabase:reset`) and trigger the cron again.
- **ICS feed empty**: Ensure the subscriber is authenticated and that the planning feed returns events (`/api/planning-feed`); confirm Supabase RLS policies allow the HQ planner role to view events.
- **Digest email missing**: Check the cron webhook alert channel, Resend dashboard, and `weekly_digest_logs` in Supabase for delivery errors.
