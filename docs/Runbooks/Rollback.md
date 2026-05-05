# Rollback Runbook

## Application Rollback

1. Identify the last known good deployment SHA.
2. Use Vercel rollback or redeploy the known good commit.
3. Confirm `/login`, `/events`, `/planning`, `/api/v1/health`, and critical cron routes respond.
4. Keep cron routes paused if the rollback is related to outbound email/SMS duplication.

## Database Rollback

Supabase migrations are forward-only by default. Prefer a corrective migration unless data loss is understood and approved.

Before database rollback work:
- Export affected table rows.
- Capture migration versions applied in staging/production.
- Confirm whether RLS changes, triggers, or RPCs are involved.
- Test the corrective migration on staging with `RUN_SUPABASE_MIGRATION_TESTS=1`.

## Communications

Record the incident timeline, affected routes, provider message ids, database records changed, and the deployment SHA restored or corrected.
