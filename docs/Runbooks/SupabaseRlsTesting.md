# Supabase RLS Testing Runbook

## Purpose

Verify that Supabase RLS matches the application role model for events, planning, and attachments.

## Required Staging Command

Run only against a staging-safe Supabase project with seeded users:

```bash
RUN_SUPABASE_MIGRATION_TESTS=1 \
NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
SUPABASE_OW_JWT=<office-worker-with-venue-jwt> \
SUPABASE_OTHER_OW_JWT=<different-venue-office-worker-jwt> \
SUPABASE_OW_NO_VENUE_JWT=<office-worker-without-venue-jwt> \
npm run test -- supabase/migrations/__tests__/office_worker_event_scope.test.ts
```

## Expected Coverage

- Assigned office worker can read only events/planning linked to their venue.
- Unassigned office worker can read events/planning globally.
- Multi-venue join rows grant visibility even when legacy `venue_id` points elsewhere.
- Off-venue updates are blocked.
- Proposal RPC permits unassigned office workers and rejects deleted venues.

## Notes

The suite is skipped by default so normal local tests do not touch a real Supabase project.
