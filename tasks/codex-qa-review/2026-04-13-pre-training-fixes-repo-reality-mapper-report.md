Saved the report at [2026-04-13-uncommitted-diff-repo-reality-mapper-report.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/tasks/codex-qa-review/2026-04-13-uncommitted-diff-repo-reality-mapper-report.md).

It includes the inspection inventory, direct dependency/test map for each changed file, the shared `roles`/`auth` model, and the main review context: layered permission enforcement, event status-flow alignment, audit/revalidation patterns, the booking `event_id` integrity fix, the remaining revert-to-draft ownership/RLS mismatch, and opening-hours invalidation/optimistic-state gaps.

Verification noted in the report: targeted Vitest runs passed for auth RBAC, revert-to-draft, bookings, and inspiration-action coverage.