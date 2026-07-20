# Integration tests (real Supabase)

The integration suite (`src/**/*.integration.test.ts`) exercises the
`save_event_draft`, `submit_event_for_review`, and `propose_event_draft`
SECURITY DEFINER RPCs against a real Postgres + RLS + auth stack. Default
`npm test` skips the suite cleanly; you only need this setup when you want
to run integration tests locally or in CI.

## Prerequisites

- Docker Desktop (or compatible engine) running
- Supabase CLI (`brew install supabase/tap/supabase`)
- `npm install` already run in the project

## First-time local setup

The repo currently pushes migrations against the linked remote project
(`npm run supabase:migrate`). Local stacks are an additive setup — you do
not have to choose one or the other.

```bash
# One-time: scaffold a supabase/config.toml if it does not already exist
# (skip if supabase init was run previously on this branch).
supabase init

# Boot the local stack (Postgres + auth + storage on docker).
supabase start

# Apply the migrations from supabase/migrations/ to the LOCAL stack.
supabase db reset --local

# Seed test fixtures (a venue, an artist, an office_worker, a foreign
# venue the office_worker cannot access). The exact SQL lives in
# supabase/seed.sql; extend it with the fixtures below if missing.
supabase db reset --local --no-seed=false
```

`supabase start` prints the URL, anon key, and service-role key for the
local stack. Export them so the integration tests can pick them up:

```bash
export SUPABASE_INTEGRATION_URL="http://127.0.0.1:54321"
export SUPABASE_INTEGRATION_ANON_KEY="<from supabase start output>"
export SUPABASE_INTEGRATION_SERVICE_ROLE_KEY="<from supabase start output>"
```

## Test fixtures

Each test in the suite expects a small, stable set of seeded rows. Set the
following env vars to the IDs of the seeded fixtures (or wire a setup hook
in the suite once a deterministic seed exists):

| Variable | Purpose |
|---|---|
| `INTEGRATION_TEST_USER_ID` | UUID of an `office_worker` user with access to one venue |
| `INTEGRATION_TEST_USER_JWT` | A signed JWT for that user (mint with `supabase auth users invite` + sign-in or use `auth.admin.createUser` + sign-in-with-password) |
| `INTEGRATION_TEST_VENUE_ID` | Venue the user CAN access |
| `INTEGRATION_TEST_FOREIGN_VENUE_ID` | Venue the user CANNOT access (used for the RLS-denial test) |
| `INTEGRATION_TEST_SECOND_VENUE_ID` | A second accessible venue (used by the multi-venue propose test) |
| `INTEGRATION_TEST_ARTIST_ID` | An artist row for happy-path artist linking (optional) |

A future improvement is to replace these env vars with a `beforeAll` hook
that seeds the fixtures inside the suite — see the TODO at the top of
`save-event-draft.integration.test.ts`.

## Running the suite

```bash
RUN_INTEGRATION_TESTS=1 \
  npm run test:integration
```

Without `RUN_INTEGRATION_TESTS=1`, every test in the suite is marked
`skipped` by `describe.skipIf` — no connections are attempted and the
command exits cleanly even if the local stack is down.

## Troubleshooting

- **"connect ECONNREFUSED 127.0.0.1:54321"** — run `supabase start` first.
- **"JWT expired"** — JWTs minted with the local secret are short-lived; mint a fresh one before each run, or generate one inside the suite using the admin client.
- **"venue access denied" on a venue that should work** — check `public.users.venue_id` matches the seeded venue and that RLS policies are loaded (`supabase db reset --local`).
- **Tests mutate state across runs** — the suite cleans up rows it creates, but a hard kill mid-run can leak rows. Re-run `supabase db reset --local` to start fresh.

## CI considerations

For CI, mint short-lived test fixtures with the service-role client at the
start of each job, export their IDs as env vars, and tear them down after.
Avoid running the integration suite against a shared stack (use a fresh
ephemeral Postgres per run).

## Migration RLS suite (`supabase/migrations/__tests__/*.test.ts`)

Gated on `RUN_SUPABASE_MIGRATION_TESTS=1`; the `venue_calendar_notes_rls` suite also needs `SUPABASE_ADMIN_JWT` (an administrator JWT) alongside the existing manager JWTs `SUPABASE_OW_JWT`, `SUPABASE_OTHER_OW_JWT`, and `SUPABASE_OW_NO_VENUE_JWT`.
