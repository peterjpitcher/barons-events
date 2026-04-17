# Assumption Breaker Report v3: Client Enhancement Batch Spec

## Summary
v3 is **not ready to implement**. It fixes several v2 blockers cleanly, but introduces new blocking defects in the status flow, SOP generation SQL, audit prerequisite, attachment INSERT RLS, and multi-venue idempotency model.

Resolution count:
- Blocking v2 issues: **5 resolved, 2 partially resolved**, with new regressions around the partially resolved areas.
- Non-blocking v2 issues: **18 resolved, 7 partially resolved**.
- New v3 issues: **12 total**, **9 blocking**, **3 advisory / implementation-hardening**.

## PART A — v2 Findings Resolution

### Blocking (CR-V2-1 through CR-V2-7)

| Finding | v3 status | Evidence | Notes |
|---|---|---|---|
| SPEC-CRV2-1 SOP `venue_filter` default | **RESOLVED** | `venue_filter text default null`; coherent CHECK at [spec:632](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:632) | Existing single templates now pass. |
| SPEC-CRV2-2 venue-manager `approved_pending_details → draft` | **RESOLVED + NEW ISSUE INTRODUCED** | Trigger permits creator / venue office worker with required fields at [spec:522](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:522) | Trigger branch exists, but v3 misses action-level status update and rejected rows fail the new CHECK. See AB-V3-001, AB-V3-003. |
| SPEC-CRV2-3 drop `storage.objects` over-grant | **RESOLVED** | Explicit default-deny at [spec:1193](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1193) | No broad `bucket_id != 'task-attachments'` grant remains. |
| SPEC-CRV2-4 cascade guard / trigger / SOP bypass | **RESOLVED** | Helper at [spec:104](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:104), SOP flag at [spec:687](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:687), parent-sync flag at [spec:835](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:835), guard check at [spec:893](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:893) | `current_setting(..., true)` correctly handles missing setting. Normal app users cannot set this via standard Supabase REST unless an exposed RPC lets them execute `set_config`; arbitrary SQL users could. |
| SPEC-CRV2-5 cascade trigger audit inserts | **RESOLVED** | Auto-complete audit at [spec:851](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:851), reopen audit at [spec:868](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:868) | Inserts are after `set_config`, inside the trigger body. |
| SPEC-CRV2-6 `generate_sop_checklist_v2` contract | **PARTIALLY RESOLVED + NEW BLOCKERS** | New RPC and JSONB shape at [spec:671](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:671) | The contract exists, but the SQL will fail or silently skip children, and drops v1 behaviour. See AB-V3-004 to AB-V3-006. |
| SPEC-CRV2-7 attachment INSERT RLS per-parent | **PARTIALLY RESOLVED + NEW SECURITY ISSUE** | Per-FK branches and `uploaded_by = auth.uid()` at [spec:1107](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1107) | Branches exist, but `u.venue_id is null` grants write to read-only office workers. See AB-V3-008. |

### Non-blocking (SD/WF/SR)

| Finding | v3 status | Evidence / gap |
|---|---|---|
| SPEC-SDV2-1 audit values enumerated | **PARTIALLY RESOLVED** | v3 adds a grep gate at [spec:83](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:83), but does **not** enumerate the current action list and lists wrong entities. See AB-V3-007. |
| SPEC-SDV2-2 Wave ordering | **RESOLVED** | Wave 0 runs first at [spec:68](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:68), migration `000` first at [spec:1285](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1285). |
| SPEC-SDV2-3 `/admin/sop` route | **RESOLVED** | `/settings` used at [spec:968](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:968). |
| SPEC-SDV2-4 dependency edge | **RESOLVED** | Wave 4 depends on Wave 2 at [spec:1319](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1319). |
| SPEC-SDV2-5 event roll-up planning-item attachments | **RESOLVED** | Included at [spec:1231](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1231). |
| SPEC-SDV2-6 cascade audit names | **RESOLVED** | `planning_task.cascade_*` used at [spec:93](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:93), [spec:783](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:783), [spec:852](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:852). |
| SPEC-SDV2-7 multi-venue RPC | **PARTIALLY RESOLVED** | Payload/return/grants exist at [spec:399](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:399), but transaction/idempotency order is not implementable as written. See AB-V3-009. |
| SPEC-SDV2-8 SECURITY DEFINER hardening | **PARTIALLY RESOLVED** | Convention added at [spec:56](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:56), but snippets apply it inconsistently. See AB-V3-012. |
| SPEC-SDV2-9 rollback plan | **PARTIALLY RESOLVED** | Added at [spec:1303](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1303), but full reverse-wave ordering is still not explicit. |
| SPEC-SDV2-10 projection sweep | **RESOLVED** | Dashboard and event detail included at [spec:980](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:980). |
| SPEC-WFV2-1 idempotency key | **PARTIALLY RESOLVED** | Key/table added at [spec:408](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:408), but RPC order is flawed. |
| SPEC-WFV2-2 backfill retry/dead-letter | **PARTIALLY RESOLVED** | Columns and retry specified at [spec:930](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:930), but locking contract is incomplete. |
| SPEC-WFV2-3 transient vs terminal attachment failures | **RESOLVED** | [spec:1209](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1209). |
| SPEC-WFV2-4 failed attachment cleanup | **RESOLVED** | [spec:1265](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1265). |
| SPEC-WFV2-5 terminal path for stale approvals | **PARTIALLY RESOLVED** | Reaper added at [spec:567](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:567), but predicate and rejected CHECK are broken. |
| SPEC-WFV2-6 SLT BCC privacy | **RESOLVED** | [spec:319](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:319). |
| SPEC-WFV2-7 empty SLT audit | **RESOLVED** | [spec:330](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:330). |
| SPEC-WFV2-8 labour rate drift banner | **RESOLVED** | [spec:275](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:275). |
| SPEC-WFV2-9 category change out of filter | **RESOLVED** | [spec:962](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:962). |
| SPEC-WFV2-10 `file-type` null | **RESOLVED** | [spec:1212](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1212). |
| SPEC-WFV2-11 metadata-only cascade reopen | **RESOLVED** | Known limit documented at [spec:885](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:885). |
| SPEC-SRV2-1 executive attachment visibility | **RESOLVED BY DOCUMENTING LIMIT** | [spec:1102](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1102). |
| SPEC-SRV2-2 service-role attachment actions | **RESOLVED** | [spec:1197](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1197). |
| SPEC-SRV2-3 future sensitive settings | **RESOLVED** | [spec:270](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:270). |
| SPEC-SRV2-4 filename DB CHECK | **RESOLVED** | [spec:1017](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1017). |

## PART B — New Issues in v3 (AB-V3-NNN)

**AB-V3-001 — Rejected proposal rows violate required-fields CHECK**  
Type: SQL logic. Severity: Blocking. Confidence: High. Evidence: CHECK exempts only `pending_approval` and `approved_pending_details` at [spec:491](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:491), but flow rejects incomplete proposals at [spec:472](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:472) and reaper writes `rejected` at [spec:570](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:570). What would confirm: dry-run `pending_approval` with null `event_type/end_at/venue_space` to `rejected`. Owner: DB/status flow. Blocking-advisory: Blocking.

**AB-V3-002 — Status trigger still allows non-admin direct approval outside proposal states**  
Type: Authorisation / workflow. Severity: Blocking. Confidence: High. Evidence: trigger returns for all non-proposal transitions at [spec:543](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:543); venue-scoped office workers can update venue events under current RLS at [rbac:180](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260415180000_rbac_renovation.sql:180). What would confirm: office worker direct `draft → approved` update. Owner: DB/status trigger. Blocking-advisory: Blocking.

**AB-V3-003 — `approved_pending_details → draft` is permitted by trigger but not attempted by the existing action**  
Type: Spec-vs-reality drift. Severity: Blocking. Confidence: High. Evidence: v3 says existing `saveEventDraftAction` handles the transition at [spec:565](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:565), but current save payload does not set `status = 'draft'` at [events action:705](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:705) and `updateEventDraft` sends that payload at [events lib:627](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/events.ts:627). What would confirm: full-form save leaves status unchanged. Owner: events action. Blocking-advisory: Blocking.

**AB-V3-004 — `generate_sop_checklist_v2` per-venue master INSERT fails due missing `due_date`**  
Type: Migration-time/runtime SQL failure. Severity: Blocking. Confidence: High. Evidence: per-venue master insert omits `due_date` at [spec:720](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:720), while `planning_tasks.due_date` is NOT NULL at [planning migration:80](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260223120000_add_planning_workspace.sql:80). What would confirm: run RPC with one `per_venue` template. Owner: SOP RPC. Blocking-advisory: Blocking.

**AB-V3-005 — Existing SOP idempotency index blocks every per-venue child**  
Type: SQL/data-model contradiction. Severity: Blocking. Confidence: High. Evidence: master and children share `(planning_item_id, sop_template_task_id)` at [spec:720](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:720) and [spec:757](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:757); existing unique index applies to all SOP-derived tasks at [planning task columns:94](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120001_add_planning_task_columns.sql:94). What would confirm: child insert returns no row under `ON CONFLICT DO NOTHING`. Owner: SOP migration. Blocking-advisory: Blocking.

**AB-V3-006 — `generate_sop_checklist_v2` drops v1 SOP behaviour and idempotency does not heal partial children**  
Type: Contract regression. Severity: Blocking. Confidence: High. Evidence: v3 inserts omit `sop_section`, `sop_t_minus_days`, dependency wiring, and assignee junctions at [spec:697](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:697); v1 populates those at [old RPC:120](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120003_add_sop_rpc_functions.sql:120), [old RPC:169](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120003_add_sop_rpc_functions.sql:169), [old RPC:200](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120003_add_sop_rpc_functions.sql:200). Existing assignee update RLS uses the junction table at [planning task columns:208](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120001_add_planning_task_columns.sql:208). What would confirm: generated tasks lack dependencies/assignees; rerun skips existing master at [spec:732](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:732). Owner: SOP RPC. Blocking-advisory: Blocking.

**AB-V3-007 — Wave 0 audit contract is still wrong for current repo entities/actions**  
Type: Spec-vs-reality drift. Severity: Blocking. Confidence: High. Evidence: v3 final entity set includes `planning_item`, `planning_series`, `short_link` at [spec:80](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:80), but current code writes entity `"planning"` at [planning action:101](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts:101) and `"link"` at [links action:99](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/links.ts:99); audit type also lists `"planning"` and `"link"` at [audit-log:8](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/audit-log.ts:8). What would confirm: generated CHECK excludes current action call sites. Owner: audit migration. Blocking-advisory: Blocking.

**AB-V3-008 — Attachment INSERT RLS grants write access to no-venue office workers**  
Type: Security. Severity: Blocking. Confidence: High. Evidence: each branch permits `u.venue_id is null` at [spec:1125](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1125), [spec:1142](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1142), [spec:1152](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1152), but role model says office worker with no venue is read-only at [roles:7](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:7). What would confirm: no-venue office worker inserts attachment to arbitrary parent. Owner: attachments RLS. Blocking-advisory: Blocking.

**AB-V3-009 — Multi-venue RPC idempotency/transaction model is not implementable as written**  
Type: RPC contract / transaction design. Severity: Blocking. Confidence: Medium-high. Evidence: spec says check batch, open transaction, insert events, commit, then write batch row at [spec:427](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:427). A Postgres RPC cannot `COMMIT` internally, and writing the idempotency row after the event inserts is not atomic. What would confirm: implementation attempt in PL/pgSQL. Owner: multi-venue RPC. Blocking-advisory: Blocking.

**AB-V3-010 — Backfill locking is not fully specified**  
Type: Cron concurrency. Severity: Medium. Confidence: High. Evidence: queue has `locked_at/locked_by` at [spec:934](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:934), but selector ignores them at [spec:956](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:956). `FOR UPDATE SKIP LOCKED` only helps inside the same open transaction. What would confirm: two cron invocations around a committed claim step. Owner: backfill cron. Blocking-advisory: Advisory, but fix before implementation.

**AB-V3-011 — Stale-approval reaper predicate is ambiguous and underspecified**  
Type: Cron logic. Severity: Medium. Confidence: High. Evidence: [spec:570](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:570) mixes `AND`/`OR` and says “whichever is later past”. Literal SQL would select `(proposal AND old start_at) OR old updated_at`. No concrete schedule/failure/locking behaviour is given. What would confirm: route implementation or cron config. Owner: stale approval cron. Blocking-advisory: Advisory, but related CHECK issue is blocking.

**AB-V3-012 — SECURITY DEFINER hardening pattern is inconsistent**  
Type: Security hardening. Severity: Medium. Confidence: Medium. Evidence: convention says revoke from `public, authenticated` and grant `service_role` at [spec:56](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:56), but trigger snippets only revoke public and do not show grants at [spec:552](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:552), [spec:877](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:877), [spec:919](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:919). What would confirm: final migration snippets. Owner: DB migrations. Blocking-advisory: Advisory.

## What Appears Newly Sound

- `cascade_internal_bypass()` correctly uses `current_setting('app.cascade_internal', true)`; the `true` argument handles the missing-setting case without throwing, and `coalesce(..., '') = 'on'` returns false by default.
- `pending_approval → approved_pending_details` works for admins because the trigger returns early for `v_is_admin`.
- `pending_approval → rejected` also reaches the admin branch, but is currently blocked by the required-fields CHECK for incomplete proposals.
- `approved_pending_details → draft` trigger logic is sound in isolation: creator or venue-scoped office worker, non-deactivated, and required fields present.
- `draft → submitted`, `submitted → approved / needs_revisions / rejected`, and `approved → completed` are not blocked by this trigger. The debrief action uses service role first at [debriefs:131](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/debriefs.ts:131), so `auth.role() = 'service_role'` should pass; the cookie-client fallback also falls through because it is not a proposal-state transition.
- `cascade_parent_sync` sets the bypass before parent updates, only reopens auto-completed parents, and places audit inserts inside the trigger body.
- Attachment admin insert still retains `uploaded_by = auth.uid()` and `upload_status = 'pending'` before the admin short-circuit.
- The `pending_cascade_backfill` partial unique index is logically correct for re-queue after a processed row: old processed rows are outside the partial predicate.

## Recommendation

**NEEDS V4.**

Do not start implementation from v3. The required v4 fixes are narrow but material: repair the event CHECK/status action path, rewrite `generate_sop_checklist_v2` around the existing SOP contract and indexes, correct the audit entity/action contract, tighten attachment INSERT RLS for no-venue office workers, and make multi-venue/backfill cron idempotency transactionally precise.