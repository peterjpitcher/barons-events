# AI Metadata Maintenance Cadence

This runbook keeps the seeded executive demo accounts and AI sample content aligned with the latest schema so planners always have realistic data when reviewing enrichment outputs.

## Weekly cadence
- **Monday morning** – run `npm run seed:exec` locally to reset Supabase, reseed demo data, and confirm AI timestamps stay within the 120-day freshness window.
- **Before stakeholder demos** – repeat `npm run seed:exec` so walkthroughs always include current AI payloads and queue entries.
- **After schema changes** – whenever `ai_content` columns are added or renamed, update `supabase/seed.sql`, run `npm run seed:check`, and execute the Vitest seed checks to confirm coverage.

## Verification checklist
1. Execute `npm run seed:exec` (or run `npm run seed:demo` followed by `npm run seed:check`).
2. Run `npm test -- src/lib/__tests__/seed.test.ts` to ensure the seed file still matches the AI schema and includes publish queue samples.
3. Spot-check the AI metadata workspace (`/planning`) and confirm the seeded events expose synopsis, hero copy, keyword, and audience tag data.
4. If the publish dispatcher is required for QA, trigger `/api/cron/ai-dispatch` from the Supabase SQL editor or the CLI with your `CRON_SECRET`.

> Tip: `npm run seed:demo` is still an alias for `supabase db reset --force`, so feel free to use the Supabase CLI directly when scripting CI tasks—just remember to follow up with `npm run seed:check`.
