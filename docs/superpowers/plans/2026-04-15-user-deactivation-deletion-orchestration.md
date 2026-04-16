# Orchestration Plan: User Deactivation & Deletion

## Plan Summary
Deploy 5 agents across 3 waves to implement user deactivation/deletion. Wave 1 handles the database migration (foundation). Wave 2 parallelises auth blocking and server actions. Wave 3 builds all UI components and integrates them.

## Work Streams
| # | Role | Wave | Depends On | Outputs |
|---|------|------|------------|---------|
| 1 | DB Migration Agent | 1 | None | Migration SQL, verified schema |
| 2 | Auth Blocking Agent | 2 | Agent 1 (schema must exist) | Auth checks in 6 locations + deactivated page |
| 3 | Server Actions Agent | 2 | Agent 1 (RPCs must exist) | 4 server actions + tests + active-user filtering |
| 4 | UI Components Agent | 3 | Agents 2+3 (actions + types must exist) | All dialog components + dropdown menu |
| 5 | Integration Agent | 3 | Agents 2+3+4 | Wire UI into user list, invite guard, verification |

## Wave Structure
- Wave 1: [Agent 1 — DB Migration] — foundation, no dependencies
- Wave 2: [Agent 2 — Auth Blocking, Agent 3 — Server Actions] — parallel, both depend on Wave 1
- Wave 3: [Agent 4 — UI Components, Agent 5 — Integration] — depend on Wave 2 outputs
