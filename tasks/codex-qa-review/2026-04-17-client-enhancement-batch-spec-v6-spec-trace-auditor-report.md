**Verdict: MINOR FIXES**

v6 fixes the v5 blockers in the operative prose, but I would not call it fully ready until one trace gap is patched: `pre_approve_event_proposal` is described, but it is not present in the consolidated migration list and has no SQL/function snippet. That is small, but implementation-critical.

**Part A — v6 Claim Verification**

| Claim | Status | Evidence |
|---|---:|---|
| AB-V5-001: `preApproveEventAction` planning item columns enumerated | YES | The approval RPC now lists `event_id`, `venue_id`, `target_date`, `title`, `type_label = 'Event'`, `status = 'planned'`, and `created_by = p_admin_id` at spec:954. Changelog claim is at spec:1905. |
| AB-V5-002: approval is dedicated RPC + post-commit email | PARTIAL | The server action now calls `pre_approve_event_proposal(...)` at spec:948; DB work is described as a single implicit transaction at spec:950-958; email is explicitly post-commit and non-rollbackable at spec:960. But the RPC is not in the migration list at spec:1853-1855 and no `create function public.pre_approve_event_proposal` SQL exists. |
| AB-V5-003: draft RPC prose aligned with SQL | YES | Behaviour step 4 now rejects no-venue office workers and requires every target venue to match the office worker’s `user.venue_id` at spec:552. The SQL matches: role rejection at spec:616-621 and venue mismatch rejection at spec:627-630. |
| Part D: migration 011 ships in Wave 3 PR | YES | Migration `011_add_multi_venue_event_proposal_rpc.sql` is still labelled Wave 2.3b, but explicitly runs after migration 009 and ships in the Wave 3 PR at spec:1855. Changelog repeats this at spec:1908. |
| AB-V5-004: stale changelog line corrected | YES | The convention says direct-call RPCs grant `service_role`, trigger functions do not at spec:58-66. The old SD-V2-8 changelog now matches that split at spec:1964. |

**Part B — Architectural Coherence**

1. SOP absorbs cascade: YES. Revision notes preserve the decision at spec:8. Wave 4 extends `sop_task_templates` with `expansion_strategy` / `venue_filter` and `planning_tasks` with cascade columns at spec:1040-1058. No `cascade_definitions` reference remains.
2. `business_settings` typed singleton: YES. Boolean singleton PK and labour rate are specified at spec:364-371, with the sensitive-column rule at spec:390.
3. Three FKs on attachments: YES. `attachments` has `event_id`, `planning_item_id`, and `planning_task_id` at spec:1565-1569, plus the exactly-one-parent CHECK at spec:1583-1588.

**Part C — Client Request Mapping**

Mapping is unchanged and no request has dropped out:

| # | Request | Evidence |
|---:|---|---|
| 1 | Task notes | spec:262-288 |
| 2 | “Not required” on todos | spec:290-323 |
| 3 | Audit logging | spec:71-254 |
| 4 | “Proof-read menus” | spec:324-359 |
| 5 | Pre-event entry form | spec:839-1029 |
| 6 | Venue categories + multi-venue creation | spec:475-835 |
| 7 | File attachments | spec:1552-1832 |
| 8 | SOP per-venue expansion / cascade | spec:1033-1548 |
| 9 | SLT debrief email | spec:419-471 |
| 10 | Labour hours + rate | spec:360-417 |

**Part D — New v6 Inconsistencies**

- `pre_approve_event_proposal` does not directly contradict the approval flow, but it has a trace gap. The RPC is declared at spec:948 and described at spec:950-958, yet the consolidated migration list jumps from status relaxation/trigger/proposal RPC at spec:1853-1855 straight to Wave 4 at spec:1856. Add a Wave 3 migration entry, or state it is included in `011_add_multi_venue_event_proposal_rpc.sql`.

- There is one stale mechanism reference: proposal RPC prose says SOP generation happens on approval “via an after-update hook, or by the admin approve action calling `generate_sop_checklist` explicitly” at spec:719. v6’s chosen mechanism is the dedicated approval RPC at spec:948-958. Rewrite spec:719 to point to `pre_approve_event_proposal`.

- The “Wave 3 PR carries migration 011” note is consistent with the dependency diagram. The diagram says Wave 3 depends on Wave 2 at spec:1879, while the migration list says `011` runs after `009` and ships with Wave 3 at spec:1855. That is coherent.

- Old server-action-only approval pattern: mostly gone. The bad “email rolls back with DB” pattern is explicitly removed by spec:960. The only pre-RPC-ish wording left is spec:719, noted above.

- Duplicated bullet points: none found. Exact duplicate markdown bullet/numbered bullet scan returned no duplicates; changelog bullets span spec:1905-1981 without exact repeats.

**Part E — Open Questions**

1. Should `pre_approve_event_proposal` be added as its own Wave 3 migration, or folded into `011_add_multi_venue_event_proposal_rpc.sql`?
2. Should the spec include concrete SQL for `pre_approve_event_proposal`, matching the direct-call RPC hardening convention at spec:58-66?
3. Should spec:719 be rewritten to remove the after-update-hook/admin-direct-call alternative and name the approval RPC as the single mechanism?

**Part F — Recommendation**

MINOR FIXES.

The architecture is stable and the v5 blockers are conceptually fixed. Before implementation, patch the approval RPC trace: add its migration/SQL or explicit migration ownership, and clean the stale SOP-generation mechanism at spec:719.