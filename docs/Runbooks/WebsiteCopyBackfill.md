# Website Copy Backfill

Use this runbook to ensure all already-approved events have AI-generated website copy.

## Prerequisites

- `.env.local` contains:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY` (only required for apply mode)

## 1) Scan only (no writes)

```bash
npm run backfill:website-copy
```

This reports:

- total approved/completed events
- how many already have `event.website_copy_generated` audit rows
- how many already have all required website-copy fields
- how many candidates need processing

## 2) Apply backfill

```bash
npm run backfill:website-copy -- --apply
```

Optional flags:

- `--limit=25` process a small batch
- `--event-id=<uuid>` target a specific event (repeatable)
- `--force` regenerate even when audit + required fields already exist
- `--actor-id=<uuid>` set `audit_log.actor_id` for inserted audit rows
- `--model=<name>` override OpenAI model
- `--verbose` print per-event progress

## 3) Verify zero remaining candidates

```bash
npm run backfill:website-copy
```

Expected: `"candidates": 0`.
