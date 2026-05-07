# Wave 3 — Cron Engineer Handoff

**Task:** B4 cron portion — daily reconcile of `events.pending_image_attach`.

## Delivered
- `src/app/api/cron/reconcile-event-images/route.ts` — GET (and POST alias) authed via `verifyCronSecret`. Selects up to 50 events with non-null `pending_image_attach`, retries the attach (`event_image_path = pending_image_attach`, clear pending), purges storage object + clears pointer for orphans older than 7 days. Emits structured `cron.invoked` / `cron.completed` log lines. Returns `{ reconciled, purged, pending }`.
- `vercel.json` — appended `{ "path": "/api/cron/reconcile-event-images", "schedule": "15 3 * * *" }`. Used `15 3` rather than `0 3` to stagger off the existing `cleanup-auth` cron at the same hour.

## Out of scope (owned elsewhere)
- The producer side (writing `pending_image_attach` when the storage upload succeeds but the DB attach fails) is owned by the Action Rewirer in `src/actions/events.ts`. Not touched here.
- `image-state-machine.test.ts` (plan step 5) skipped — Action Rewirer is the natural owner since they own the producer logic the test would exercise.

## Verification
- `npm run lint` — clean for the new file (only 2 unrelated pre-existing warnings in `session-monitor.tsx`).
- `npm run typecheck` — clean.

## Commit
`feat(events): reconcile-event-images cron for pending image attachments`
