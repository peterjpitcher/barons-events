
## 2026-06-11 — "Fixed" means deployed and verified, not merged locally
Client retested the QR bug on production while the fix sat in an unmerged PR; the user had to come back with "it's not fixed yet".
**Rule:** when the user reports a production bug, the job is done only when the fix is verified live: merge → watch the production deployment succeed → smoke-test the affected path. State explicitly in the summary which environment the fix has reached. BaronsHub deploys to production from `main` via Vercel; a pushed branch deploys previews only.

## 2026-07-20 — Specs must be verified against the latest migrations and real project helpers
The venue calendar notes spec claimed the project's RLS pattern was a broad authenticated policy (true in the 2026-02 planning migration, replaced by scoped current_user_role()/current_user_venue_id() policies in 20260605143000) and named an audit helper (logAuditEvent) that exists in workspace docs but not in this project (the real helper is recordAuditLogEntry with an entity allow-list enforced in both TypeScript and a DB check constraint). It also missed multi-venue events via event_venues.
**Rule:** before writing a spec, verify every named function, table, policy and pattern against the newest migration touching that table and the actual source file, not older migrations or workspace-level conventions. Grep for join tables (event_venues, planning_item_venues) before assuming a single FK models a relationship.
