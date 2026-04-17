# Assumption Breaker Report v6

## Summary

v6 is **ready to implement**. The v5 blockers are resolved in the operative spec text: approval DB work is now transactional inside a dedicated RPC, email is post-commit, planning item columns are explicit, draft RPC prose matches SQL, and migration `011` is clearly owned by the Wave 3 PR.

One minor stale shorthand remains in the Wave 3 permissions prose, but the concrete RPC contract is correct and protects the database path.

## PART A — v5 Findings Resolution

| v5 finding | Verdict | Evidence |
|---|---:|---|
| **AB-V5-001: approval planning item insert under-specified** | **Resolved** | `pre_approve_event_proposal` now specifies `event_id`, `venue_id`, `target_date`, `title`, `type_label = 'Event'`, `status = 'planned'`, and `created_by = p_admin_id`: [spec:954](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:954). |
| **AB-V5-002: “single transaction” server action/email was not implementable** | **Resolved** | `preApproveEventAction` now calls `pre_approve_event_proposal(...)` for rollbackable DB work, then sends email only after the RPC commits: [spec:948](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:948). The RPC transaction and rollback boundary are stated separately: [spec:952](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:952), [spec:958](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:958). Email is explicitly post-commit and non-transactional: [spec:960](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:960). |
| **AB-V5-003: stale draft RPC authorisation prose** | **Resolved for the draft RPC** | Behaviour step 4 now says administrator OR office worker with non-null `user.venue_id`, and every payload venue must equal that venue: [spec:552](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:552). The SQL matches: role check [spec:616](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:616), no-venue office-worker rejection [spec:620](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:620), per-target venue equality [spec:627](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:627). |
| **AB-V5-004: stale SECURITY DEFINER changelog** | **Resolved** | Cross-cutting convention now distinguishes direct-call RPC grants from trigger functions: [spec:58](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:58), [spec:66](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:66). The stale changelog line now says direct-call RPCs grant `service_role`; trigger functions do not: [spec:1964](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1964). |
| **Spec-trace Part D: migration 011 / Wave 3 PR ownership** | **Resolved** | The migration list says `011_add_multi_venue_event_proposal_rpc.sql` runs after migration `009` and **ships in the Wave 3 PR**, because `proposeEventAction` depends on it: [spec:1853](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1853), [spec:1855](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1855). |

## PART B — New v6 Issues (if any)

No new blockers.

Minor non-blocking stale shorthand: Wave 3 permissions still says `Propose: canManageEvents(role, venueId) for every venue`: [spec:1015](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1015). Read literally, that helper only proves an office worker has *some* venue, not that it matches the target venue. The concrete proposal RPC SQL is correct and rejects mismatches at [spec:776](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:776), so this is not a V7-level issue. Implementation should follow the RPC contract.

## What Appears Newly Sound in v6

The `pre_approve_event_proposal` RPC spec now covers the required validation: status and `start_at` check at [spec:951](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:951), all required planning item columns at [spec:954](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:954), SOP generation at [spec:955](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:955), audit insert at [spec:956](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:956), and return shape at [spec:957](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:957).

The email/RPC split is now clear: DB commit first, email second. There is no specified path where email can succeed after a failed RPC, because email is sent only after the RPC commits: [spec:948](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:948), [spec:960](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:960).

The draft RPC behaviour prose now describes the SQL correctly: [spec:548](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:548), [spec:552](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:552).

## Recommendation

**READY TO IMPLEMENT.**