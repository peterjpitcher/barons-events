# Cron Monitoring Runbook

## Purpose

Monitor and manually verify BaronsHub cron routes:

- `/api/cron/cleanup-auth`
- `/api/cron/refresh-inspiration`
- `/api/cron/sms-booking-driver`
- `/api/cron/sms-reminders`
- `/api/cron/sms-post-event`
- `/api/cron/expire-stale-approvals`
- `/api/cron/attachments-cleanup`
- `/api/cron/cascade-backfill`
- `/api/cron/weekly-digest`

All cron routes require `Authorization: Bearer <CRON_SECRET>`.

`/api/cron/weekly-digest` runs the **mandatory Tuesday update**, not the configurable todo digest. It is scheduled `0 8 * * 1-5`, which is 08:00 **UTC** on weekdays (08:00 London in winter, 09:00 during British Summer Time). The function returns immediately unless the London date is a Tuesday, so the Monday and Wednesday to Friday invocations are expected no-ops. Every active user receives it and there is no opt-out.

The update carries three sections: events created since that recipient's own last accepted send (floored at 14 days), their open SOP to-dos, and debriefs from the last 7 days. The first two are venue-scoped for a user with `venue_id` set.

There is no same-week retry. A recipient whose send fails keeps their cursors and is picked up on the next Tuesday, with a window covering both weeks.

## Staging Smoke

Use staging-safe data and do not point these commands at production unless this is an approved operational run.

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  "https://<staging-domain>/api/cron/weekly-digest"
```

Expected:
- `200` or a route-specific success JSON response.
- Missing/invalid secret returns `401`.
- Vercel function logs show the run id, counts, and any integration errors.

## Monitoring Checklist

- Confirm Vercel Cron schedule matches intended cadence.
- Confirm `CRON_SECRET` exists in every deployed environment and differs from local examples.
- Confirm `RESEND_API_KEY` is configured and `BARONSHUB_OPERATIONAL_EMAILS_ENABLED=true` in environments that should send staff todo digests.
- Check Vercel logs for non-2xx responses after each deploy.
- Check Supabase tables touched by the route: SMS sends, inbound messages, `audit_log` digest rows, approval expiry audit entries, and attachment cleanup.
- For the Tuesday update, check `users.weekly_digest_last_sent_on` (drives once-per-ISO-week suppression) and `users.weekly_digest_last_sent_at` (starts the next content window). Both advance together and only after the email provider accepts. A user whose pair has not moved was a failure, not a skip.
- Confirm the run's `audit_log` row (`entity = 'digest'`, `action = 'digest.batch_sent'`, `meta.weekly_update = true`) reports `failed: 0`, and check `meta.window_start`, `meta.run_cutoff` and `meta.new_event_rows` look sane. The same information appears in the Vercel logs as a `weekly_update_batch` line.
- For email/SMS routes, verify provider dashboards show only staging-safe sends during staging tests.

## Incident Response

1. Identify the failing route, deployment SHA, and request timestamp from Vercel logs.
2. Check whether the failure is auth/config (`401`, missing env), provider (`Resend`/`Twilio`), or database/RLS.
3. Re-run the route once manually after the root cause is fixed.
4. If a route is repeatedly sending duplicate customer communications, pause the Vercel Cron schedule before retrying.
5. Record the incident, affected records, provider message ids, and rollback/retry decision.
