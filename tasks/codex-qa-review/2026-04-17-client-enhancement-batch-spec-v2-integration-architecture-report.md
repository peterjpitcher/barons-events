# Integration & Architecture Report v2

## Summary

v2 resolves the three big modelling objections from v1 in principle: cascades no longer fork the SOP template system, labour rate is typed, and attachments regain relational integrity. The layering is not yet coherent enough to implement safely.

The blocking issues are now in the details: the SOP migration is internally inconsistent, the cascade guard blocks the service-role SOP RPC and the cascade trigger, per-venue SOP dependencies are underspecified, and the `approved_pending_details` trigger blocks the venue-manager transition the spec says should happen.

## v1 Findings Resolution Audit

| Finding | Status | Audit |
|---|---:|---|
| IA-001 Cascades duplicate SOP | RESOLVED | v2 absorbs cascade into `sop_task_templates` instead of a second template system: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:651). New implementation debt remains below. |
| IA-002 Parent task breaks flat assumptions | PARTIAL | Wave 5.6 adds projection rules: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:847). It misses dashboard and event-detail projections that also map flat tasks: [dashboard](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/dashboard.ts:115), [event page](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:124). |
| IA-003 Trigger bypasses action/audit boundary | PARTIAL | v2 adds locking, reopen, and trigger-written audit: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:722), [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:873). The guard/trigger interaction now breaks writes. |
| IA-004 Multi-venue grouping | UNRESOLVED | Still only audit metadata for `multi_venue_batch_id`: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:476). No durable event group exists. |
| IA-005 `pending_approval` state-machine | PARTIAL | v2 adds nullable-field checks and a sweep list: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:548), [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:592). The transition trigger contradicts the intended venue-manager completion path. |
| IA-006 JSONB settings | RESOLVED | Replaced by typed singleton `business_settings`: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:205). |
| IA-007 SLT permissions | RESOLVED | v2 explicitly says SLT is not a permission role: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:289). |
| IA-008 Polymorphic attachments | RESOLVED | Three concrete nullable FKs plus exactly-one CHECK: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:901). RLS drift risk remains. |
| IA-009 Public API contract | RESOLVED | Public event statuses remain `approved | completed`: [public API lib](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/public-api/events.ts:6), [route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/v1/events/route.ts:94). |
| IA-010 Audit CHECK brittleness | PARTIAL | Consolidated migration is now specified: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:358). It still keeps the brittle CHECK-list pattern. |
| IA-011 Fire-and-forget email | RESOLVED | v2 now awaits delivery and catches/logs failure: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:286). |

## New Architectural Concerns in v2

**IA-V2-001: SOP template expansion migration fails as written**  
Type / Severity / Confidence: Schema migration / High / High.  
Evidence: v2 adds `expansion_strategy default 'single'` and `venue_filter default 'pub'`, then requires `single` rows to have `venue_filter IS NULL`: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:661). Existing seeded templates insert no expansion fields: [SOP seed](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120005_seed_sop_template.sql:42).  
Impact: existing templates become `single + pub`, so the coherence CHECK rejects the migration.  
Action: make `venue_filter` default `NULL`, add/backfill columns, then add the CHECK. Only set `venue_filter` when switching to `per_venue`.

**IA-V2-002: Per-venue SOP RPC internals are underspecified and contract-breaking**  
Type / Severity / Confidence: RPC/domain contract / High / High.  
Evidence: existing RPC maps one template id to one task id: [RPC](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120003_add_sop_rpc_functions.sql:58), [RPC](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120003_add_sop_rpc_functions.sql:192). It returns an integer: [RPC](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120003_add_sop_rpc_functions.sql:31), and TS expects `Promise<number>`: [sop.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/sop.ts:9). v2 says skipped venues are returned: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:704).  
Impact: changing the RPC return shape breaks callers such as SOP backfill count logic: [actions/sop.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/sop.ts:571). Idempotency also still keys off `sop_template_task_id`: [RPC](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120003_add_sop_rpc_functions.sql:72), while v2 puts the master link in `cascade_sop_template_id`: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:701).  
Action: keep the old RPC return stable or introduce `generate_sop_checklist_v2`. Define master/child `sop_section`, `sort_order`, `sop_template_task_id`, dependency mapping, and idempotency explicitly.

**IA-V2-003: Cascade parent completion does not unblock SOP dependencies**  
Type / Severity / Confidence: Data flow / High / High.  
Evidence: dependency unblocking is app-side and runs for the toggled task id only: [planning action](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts:581), [sop.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/sop.ts:51). The cascade trigger updates the parent internally: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:741).  
Impact: if downstream SOP tasks depend on the master, they remain blocked when the parent is auto-completed. If dependencies should apply per child, the spec does not define that mapping.  
Action: decide dependency semantics: master-only, child-per-venue, or both. Then recompute dependencies for the parent inside the same server-side flow that completes it.

**IA-V2-004: Cascade guard blocks the SOP RPC and the cascade trigger**  
Type / Severity / Confidence: DB boundary / Critical / High.  
Evidence: guard only bypasses `current_user_role() = 'administrator'`: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:781). Existing SOP RPC is service-role only: [hardening](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:80), and the wrapper uses the service-role client: [sop.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/sop.ts:14). `current_user_role()` falls back to JWT role, so service role is not `administrator`: [RBAC](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260415180000_rbac_renovation.sql:104).  
Impact: triggers still fire under SECURITY DEFINER. The SOP RPC insert is rejected. The cascade trigger’s parent update is also rejected for non-admin users because it sets `auto_completed_by_cascade_at`: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:742).  
Action: allow a narrowly scoped service-role/RPC bypass, e.g. `auth.role() = 'service_role'` plus `GRANT EXECUTE TO service_role` only. Do not rely on SECURITY DEFINER to skip triggers.

**IA-V2-005: `approved_pending_details` cannot transition as specified**  
Type / Severity / Confidence: State machine / High / High.  
Evidence: trigger says transitions out of `approved_pending_details` require administrator: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:564). The intended flow says the venue manager completes the form and moves it to `draft`: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:590).  
Impact: approved proposals get stuck unless an administrator completes the full event form.  
Action: permit `approved_pending_details -> draft` for the creator or venue-scoped manager when required fields are present. This does not need a dedicated route, but it does need a clear “Complete event details” banner/action on the event list/detail.

**IA-V2-006: Queue and indexing are under-specified**  
Type / Severity / Confidence: Operational data flow / Medium-High / Medium.  
Evidence: pending queue is admin-RLS: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:831). Existing cron/system tables use service-role-only scope: [sms campaign](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260417000000_sms_campaign.sql:29). Cron routes use `CRON_SECRET` plus service-role clients: [cron](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/sms-booking-driver/route.ts:16). v2 scans open masters by `cascade_sop_template_id`/status but only indexes parent and venue: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:687).  
Impact: direct admin writes to the queue are wider than necessary, duplicate queue rows are possible, and backfill scans will not age well.  
Action: make the queue service-role only, write it from an authorised server action using the admin client, add a partial unique index for unprocessed venue rows, and add a partial index on open cascade masters.

**IA-V2-007: Attachment RLS insert policy is weaker than the FK model**  
Type / Severity / Confidence: RLS/authorisation / Medium-High / High.  
Evidence: the CHECK correctly enforces exactly one parent FK: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:918). Read RLS has parent-specific branches: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:942). Insert RLS only checks `uploaded_by` and role: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1012).  
Impact: any office worker with direct table access can create attachment metadata against any parent id. Server action validation helps, but the spec says RLS gates direct access.  
Action: mirror parent edit permissions in insert RLS, or centralise them in DB helper functions to avoid three OR-branch drift.

**IA-V2-008: Wave dependency statement is contradictory**  
Type / Severity / Confidence: Delivery sequencing / Medium / High.  
Evidence: Wave 3 creates `venues.category`: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:427). Wave 5 uses category-backed `venue_filter` matching: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:701). But v2 says Wave 5 is independent of Wave 3: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1184).  
Impact: Wave 5 cannot be built or tested correctly before Wave 3.  
Action: mark Wave 5 as depending on Wave 3. Wave 6 can remain independent of Wave 3 unless child-task attachment UI is shipped in the same slice.

## Coupling / Boundary Issues (new)

Cascade now couples SOP templates, planning task hierarchy, venue category, venue default manager, cron, and trigger-written audit. That is acceptable only if the privileged write path is explicit; currently the guard, RPC, and trigger disagree.

Attachments have a sound relational boundary, but RLS policy logic is duplicated across three parent types. Use helper functions or tests so the CHECK invariant and policy branches do not drift.

## State Ownership (new)

Parent cascade status is owned by a DB trigger, whilst dependent-task unblocking and UI revalidation are owned by app-side actions. That split is the main state-ownership risk.

`approved_pending_details` is owned by admin approval but must then be owned by the venue manager. The trigger currently keeps ownership with admins.

## Data Flow Mismatches (new)

The public API remains safe: list, detail, and slug routes all filter to `PUBLIC_EVENT_STATUSES`: [route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/v1/events/route.ts:94), [detail](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/v1/events/[eventId]/route.ts:76), [slug](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/v1/events/by-slug/[slug]/route.ts:86).

The SOP RPC data flow is not safe yet: v2 wants richer output, but existing callers and tests expect a number: [test](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/__tests__/sop-generate.test.ts:34).

## Maintainability (new)

`supabase/seed.sql` itself should not break from nullable `planning_tasks` cascade columns because it uses an explicit column list: [seed](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/seed.sql:417). The SOP template migration will break existing template rows unless the `venue_filter` default is fixed.

The projection sweep should include `src/lib/dashboard.ts` and event-detail SOP mapping, not just Wave 5.6’s listed files.

## What Appears Newly Sound

The `business_settings` singleton is coherent. With the seed row, `select().single()` works because authenticated users can read all rows and the boolean PK/CHECK allows at most one row: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:206). The local Supabase clients are not strongly typed with the generated `Database` generic anyway: [server client](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/server.ts:6). Future settings requiring migrations is a feature here, not a bug: it keeps validation typed and visible.

The attachment FK model is much better than v1’s polymorphic reference. The exactly-one-parent CHECK is the right invariant.

The public API contract remains protected from proposal statuses.