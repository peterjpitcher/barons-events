Spec reviewed: [2026-04-17-client-enhancement-batch-design.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1). Planning schema checked: [20260223120000_add_planning_workspace.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260223120000_add_planning_workspace.sql:31).

**Part A**
| Claim | Status | Evidence |
|---|---:|---|
| AB-V4-001 / SPEC-V4-003: multi-venue RPC authorisation tightened | YES | Draft RPC rejects non-admin/non-office roles, no-venue office workers, and wrong-venue office workers at spec:602-631. Proposal RPC mirrors this at spec:759-780. |
| AB-V4-002: `planning_items.status = 'planned'` | YES | Draft RPC inserts `status = 'planned'` at spec:659-665. |
| AB-V4-003 / SPEC-V4-007: `user.sensitive_column_changed` in audit CHECK | YES | Listed at spec:109 and included in SQL CHECK at spec:190-192. |
| AB-V4-004 / SPEC-V4-005: draft RPC return shape simplified | YES | Return shape is only `{batch_id, events}` at spec:519-525 and SQL builds only those fields at spec:682-686. |
| AB-V4-005 / SPEC-V4-002: approval creates planning item + SOP | YES, with implementation caveat | `preApproveEventAction` now says it creates the planning item and calls SOP generation in one transaction at spec:948. Column/transaction concerns remain in Part D. |
| AB-V4-006: Wave 4 caller migration explicit | YES | Caller migration is stated at spec:559, SQL comment at spec:667, full caller list at spec:1309, migration note at spec:1845. |
| AB-V4-008: duplicate `cascade_internal_bypass` removed | YES | Only one `create or replace function public.cascade_internal_bypass()` remains at spec:220-223; later references are usage/docs only at spec:233, spec:1395, spec:1852. |
| MIG-V4-001 / SPEC-V4-001: migration list reorder | YES | `009_relax...` precedes `011_add_multi_venue_event_proposal_rpc.sql` at spec:1840-1842. |
| SPEC-V4-004: status trigger requires `v_user_venue IS NOT NULL` | YES | Trigger requires `v_user_venue is not null` before allowing office-worker completion at spec:919-920. |
| SPEC-V4-006: SECURITY DEFINER convention split | YES | Direct-call RPC vs trigger-function variants are split at spec:58-66; snippets follow it at spec:696-699, spec:815-818, spec:936-940, spec:1378-1381, spec:1421-1424. |
| SPEC-V4-009: backfill cron SQL concrete | YES | Concrete transaction and claim SQL at spec:1458-1499; `locked_at is null` rationale at spec:1501. |
| SPEC-V4-010: Wave 4 migration list ordering | YES | Wave 4 order is 4.1a, 4.1b, 4.2, 4.3/4.4, 4.5 at spec:1843-1847. |
| SPEC-V4-011: rollback drop order | YES | Wave 0 helper is explicitly dropped last after Waves 5 to 1 are reverted at spec:1852; Wave 4 rollback starts with triggers at spec:1858. |

**Part B**
1. SOP absorbs cascade: YES. The architecture is unchanged: revision notes say SOP templates absorb cascade at spec:8, and the implementation extends `sop_task_templates` plus `planning_tasks` at spec:1027-1058. No `cascade_definitions` reference remains.
2. `business_settings` typed singleton: YES. Boolean singleton PK and labour rate are specified at spec:364-371, with sensitive-column guidance at spec:390.
3. Three FKs on attachments: YES. `attachments` has `event_id`, `planning_item_id`, `planning_task_id`, plus exactly-one-parent CHECK at spec:1552-1575.

**Part C**
| # | Request | Still fully addressed? |
|---:|---|---:|
| 1 | Task notes | YES, spec:262-288. |
| 2 | “Not required” on todos | YES, spec:290-323. |
| 3 | Audit logging | YES, spec:77-130 and spec:143-218, with gap map/CI guard at spec:235-253. |
| 4 | “Proof-read menus” task | YES, spec:324-359. |
| 5 | Pre-event entry form | PARTIAL. Flow exists at spec:839-1017, but Wave 3 depends on the proposal RPC while that RPC is migration item 12 after Wave 3 migrations; see Part D. |
| 6 | Multi-select venues + categories | YES, spec:475-835; authorisation blockers from v4 are corrected at spec:602-631 and spec:759-780. |
| 7 | Task attachments + roll-up | YES, spec:1539-1823. |
| 8 | Task cascade | PARTIAL. Core cascade is covered at spec:1024-1535, but per-venue children still have no own dependencies and blocked-state recompute is master-only at spec:1265-1290. |
| 9 | SLT email | YES, spec:419-471. |
| 10 | Labour hours + rate | YES, spec:360-417. |

**Part D**
- Migration file numbers now wrong? NO. The explicit numbered list is internally updated at spec:1831-1848, and the change-log reference matches it at spec:1899.
- Wave 3 prose still references Wave 2.3b despite 2.3b being after Wave 3 in the migration list? YES. Section 2.3b says “Wave 3 uses this” at spec:712, Wave 3 action calls it at spec:947, but the migration list puts Wave 3 items at spec:1840-1841 and the proposal RPC after them at spec:1842.
- Does the spec require Wave 2.3b to ship as part of the Wave 3 PR? NO. It says `proposeEventAction` calls the RPC at spec:947, but the “same PR” language at spec:972 only covers status-consumer files, not migration `011`. Add an explicit Wave 3 PR requirement or relabel 2.3b as a Wave 3 migration.
- Does `preApproveEventAction` use valid `planning_items` columns for the named pre-migration schema? PARTIAL / ambiguous. The prose names valid base columns: `venue_id`, `target_date`, `title`, `type_label` at spec:948, and those exist in 202602:36-43. But the base schema also requires `status` and `created_by` at 202602:42-43, which spec:948 does not mention. Also, “linked” cannot mean `event_id` against 202602:31-47 because `event_id` is absent there; it only exists after `20260408120002` lines 4-10.
- Does the v5 draft RPC `status = 'planned'` survive the existing CHECK? YES. Spec inserts `planned` at spec:664, and 202602 allows `planned` at line 42.
- Remaining stale “Wave 5” / “Wave 6” references? NO stale ones found. Wave 5 is still attachments at spec:1539, spec:1848, spec:1859, spec:1870. No Wave 6 reference remains.
- SECURITY DEFINER convention internally consistent? YES. The convention split at spec:58-66 matches direct-call RPC snippets and trigger-function snippets. One minor note: `cascade_internal_bypass()` is not itself `SECURITY DEFINER`, so its different grant at spec:227-228 is outside that convention.
- Additional v5 inconsistency: spec:948 says a server action performs status transition, planning insert, SOP generation, audit, and email “in a single transaction”. That needs a DB RPC for the database work, and email should be after commit or via an outbox. Email cannot be rolled back as part of a Postgres transaction.

**Part E**
Open questions:
- Should `011_add_multi_venue_event_proposal_rpc.sql` be renamed/relabelled as Wave 3 and explicitly shipped in the Wave 3 PR?
- Should `preApproveEventAction` be specified as a dedicated approval RPC so the DB transition, planning item insert, SOP generation, and audit are genuinely atomic?
- Which planning schema should the spec cite as authoritative for `event_id`: the base 202602 table or the full current chain including `20260408120002`?
- Are per-venue cascade children intentionally dependency-free, or should they inherit/reflect master dependencies?

**Part F**
V6 NEEDED.

The v5 change-log claims are mostly backed by spec content, but implementation should not start until the Wave 2.3b/Wave 3 PR dependency and the approval transaction/planning-item details are tightened. These are narrow fixes, not a wholesale redesign.