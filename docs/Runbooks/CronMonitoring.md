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
The todo digest route is scheduled every weekday; individual users can choose every weekday, twice weekly, weekly, every two weeks, or no digest from `/account`.

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
- Check Supabase tables touched by the route: SMS sends, inbound messages, `audit_log` digest rows, user `todo_digest_last_sent_on`, approval expiry audit entries, and attachment cleanup.
- For email/SMS routes, verify provider dashboards show only staging-safe sends during staging tests.

## Incident Response

1. Identify the failing route, deployment SHA, and request timestamp from Vercel logs.
2. Check whether the failure is auth/config (`401`, missing env), provider (`Resend`/`Twilio`), or database/RLS.
3. Re-run the route once manually after the root cause is fixed.
4. If a route is repeatedly sending duplicate customer communications, pause the Vercel Cron schedule before retrying.
5. Record the incident, affected records, provider message ids, and rollback/retry decision.
