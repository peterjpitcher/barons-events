# Cron Monitoring Runbook

## Purpose
Ensure automated jobs (`/api/cron/sla-reminders`, `/api/cron/weekly-digest`) run reliably and notify the team when delivery fails.

## Prerequisites
- `CRON_SECRET` set in environment (already required).
- `CRON_ALERT_WEBHOOK_URL` configured with a Slack/Teams incoming webhook URL for staging/production.
- Access to Supabase project with service-role credentials.

## Verification Steps (Staging)
1. Deploy latest build with cron changes.
2. Populate staging data via `npm run supabase:reset` to seed events and notifications.
3. Trigger the SLA reminders endpoint manually:
   ```bash
   CRON_BASE_URL=https://<staging-domain> \
   CRON_SECRET=$CRON_SECRET \
   node scripts/trigger-cron.js api/cron/sla-reminders
   ```
4. Confirm the response logs `queued > 0`. In Supabase, query:
   ```sql
   select status, payload->'send_meta'
   from notifications
   where type = 'sla_warning'
   order by created_at desc
   limit 5;
   ```
   Ensure `status` transitions from `queued` to `sent` after Resend succeeds.
5. Force a failure (e.g., temporarily revoke `RESEND_API_KEY`) and rerun the cron. Verify the webhook channel receives an alert with job metadata.
6. Restore credentials and re-run cron to confirm `failed` notifications fall back to `queued` and resend successfully.

### Verification Log (fill per run)
| Date | Environment | Trigger Command | Alert Received? | Notes / Follow-up |
| --- | --- | --- | --- | --- |
| yyyy-mm-dd | staging | `node scripts/trigger-cron.js api/cron/sla-reminders` | ✅ / ⚠️ | e.g. “Alert posted in #ops-cron with send failure: 403” |
| yyyy-mm-dd | staging | `node scripts/trigger-cron.js api/cron/weekly-digest` | ✅ / ⚠️ | |

> Record each manual verification here (or copy to an issue) so we can confirm webhook parity across releases. If an alert is missing, capture the Vercel log URL and Resend response for debugging.

## Planner Dashboard Reminder Tile
- The Planning Ops dashboard shows the count of queued SLA reminders. If the tile grows, planners should:
  1. Check the cron alert channel for recent failures.
  2. Review `notifications` table entries with `status = 'queued'` and inspect `payload->'send_meta'->>'error'`.
  3. Once the issue is resolved, rerun the cron endpoint or wait for the next scheduled run.

### Tile behaviour contract
- Component: `src/components/planning/planning-analytics-client.tsx` (“SLA reminders queued” card).
- Data source: `fetchPlanningAnalytics` uses `notifications` table (`type = 'sla_warning'`, `status = 'queued'`).
- Visibility:
  - `slaWarningQueued === 0` → tile hidden (no queued reminders).
  - `slaWarningQueued > 0` → tile shows amber banner, copy instructs planners to check Supabase + alert channel.
- TODO when cron monitoring view lands:
  - Link the tile CTA to the monitoring view once built.
  - Surface last alert timestamp (store in Supabase materialised view or cache once Workstream A task completes).
- Monitoring panel (`CronMonitoringPanel`) now includes:
  - `Export JSON` button to download the latest snapshot via `/api/monitoring/cron/snapshot`.
  - `Failure log` button opening `/api/monitoring/cron/failures` (JSON view backed by `cron_notification_failures`) for long-tail retries.
  - Header note showing the timestamp of the most recent alert and the current webhook heartbeat status.
  - Summary tiles for queued reminders, failed reminders, and webhook configuration presented as cards with skeleton placeholders while data refreshes.
  - Event drill-down links for queued reminders (navigates to `/events/<eventId>` when available).
  - Reviewer contact shortcut (mailto) and next retry timestamp pulled from `payload.send_meta.retry_after`.
  - Recent alert list sourced from `cron_alert_logs` (heartbeat successes/failures and webhook errors).
  - Ping results surface via inline alert messaging so operators get immediate feedback when running the webhook heartbeat check.

### Webhook heartbeat automation
- Endpoint: `GET /api/cron/alert-heartbeat` (Vercel Cron, same `CRON_SECRET`).
- Schedule this to run every 5–10 minutes; it calls `pingCronAlertWebhook("webhook-heartbeat")` and records success/failure in `cron_alert_logs`.
- The monitoring panel uses the latest heartbeat log to display webhook health. Investigate immediately if the status shows “Webhook issue”.

### Remediation playbook
1. **Review heartbeat + alert log**
   - If the monitoring panel shows “Webhook issue”, open `/api/monitoring/cron/failures` and `/api/monitoring/cron/snapshot` to inspect queued reminders and recent alert payloads.
   - Check `cron_alert_logs` for the last `webhook-heartbeat` entry; non-2xx responses mean the alert webhook is failing.
2. **Re-run cron endpoints manually**
   - Use `node scripts/trigger-cron.js api/cron/sla-reminders` and `... api/cron/weekly-digest` to replay the job after resolving the incident.
   - Confirm new alert logs appear (severity `success`) and the monitoring panel heartbeat switches back to “Webhook healthy”.
3. **Escalate when retries fail**
   - Capture webhook response body and Supabase notification rows (`status = 'failed'`) and post in `#ops-cron`.
   - Pause the affected cron in Vercel if failures persist longer than one hour to avoid alert fatigue.

### Seed smoke checklist
- Run `npm run supabase:reset` to ensure notifications and AI content demo data are seeded.
- Start the app (`npm run dev`) and log in as `central.planner@barons.example`; open Planning Ops to confirm:
  1. SLA tile shows “No queued reminders” (or the expected seeded count).
  2. Heartbeat badge reports “Webhook healthy”.
  3. Failure log export returns seeded rows (if any) from `/api/monitoring/cron/failures`.
- Trigger `node scripts/trigger-cron.js api/cron/sla-reminders` to populate the queue for local demos; verify the monitoring panel updates after a refresh (`Refresh` button).

## Weekly Digest Checklist
1. Trigger `/api/cron/weekly-digest` with the helper script:
   ```bash
   CRON_BASE_URL=https://<staging-domain> \
   CRON_SECRET=$CRON_SECRET \
   node scripts/trigger-cron.js api/cron/weekly-digest
   ```
2. Verify `weekly_digest_logs` records the run with `payload.send_id` populated.
3. Confirm recipients in Supabase (`role = 'executive'`) are accurate. Add/remove exec users as needed.
4. Run the parity checker to compare the digest payload with the latest planning analytics:
   ```bash
   node --env-file=.env.local scripts/check-planning-parity.mjs
   ```
   - Exit code `0` (and `diff.isAligned: true`) confirms parity.
   - Exit code `1` usually means the dataset is empty or stale—rerun `npm run supabase:reset` in staging and trigger the cron again.
5. If `error` is non-null, inspect the webhook alert and retry once the issue is fixed.

### Digest vs. Planning Feed Parity Log
| Date | Environment | Script Output | Actioned? | Notes |
| --- | --- | --- | --- | --- |
| yyyy-mm-dd | staging | `diff.isAligned: true` | ✅ / ⚠️ | e.g. “Counts matched after reseed” |
| yyyy-mm-dd | staging | `diff.isAligned: false` | ✅ / ⚠️ | Capture reseed run or cron rerun reference |
| 2025-10-17 | staging | `diff.isAligned: true` | ✅ | Seeded digest log via service-role script (staging still empty); local `supabase db reset --local` also revalidated after UUID fix |

## Escalation
- If webhook delivery fails, the log prints an error but does not block the cron. Investigate network or webhook endpoint availability.
- If Resend issues persist (multiple failures within an hour), escalate to the platform owner and consider pausing automated sends until resolved.

## Alert Payload Reference
- Slack payload sample:
  ```json
  {
    "job": "sla-reminders",
    "environment": "staging",
    "queued": 4,
    "sent": 3,
    "failed": 1,
    "error": "Resend HTTP 401",
    "timestamp": "2025-02-17T12:04:31Z"
  }
  ```
- Expected fields:
  - `job`: matches cron endpoint identifier.
  - `environment`: `staging`/`production`.
  - `queued`: currently queued notifications prior to run.
  - `sent`: incremented notifications after retries.
  - `failed`: residual failures (non-zero should trigger follow-up).
  - `error`: populated only when Resend/Webhook call fails.
  - `timestamp`: ISO string used for dashboard log ordering.

Store screenshots (Slack thread or Teams card) in the release folder under `docs/Runbooks/cron-alerts/<yyyy-mm-dd>.png` for rapid audits.
