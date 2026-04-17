# Spec Trace Report v3

Spec audited: `/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md`.

## Part A — Handoff Checklist

Blocking: **7/7 YES**, with two new consistency problems called out in Part D.

- **SPEC-CRV2-1 — YES.** `venue_filter` defaults to `NULL` and the coherency CHECK requires `NULL` for `single` rows: spec lines 632-643.
- **SPEC-CRV2-2 — YES.** Trigger allows `approved_pending_details → draft` for creator or venue-scoped office worker with required fields present: lines 522-540.
- **SPEC-CRV2-3 — YES.** No `storage.objects` policy added; default-deny documented: line 1193.
- **SPEC-CRV2-4 — YES.** Session-local bypass convention and use in SOP RPC / cascade trigger / guard: lines 64, 686-688, 834-835, 892-893.
- **SPEC-CRV2-5 — YES.** Cascade trigger inserts audit rows for auto-complete and reopen: lines 851-853, 868-870.
- **SPEC-CRV2-6 — YES.** `generate_sop_checklist_v2` is specified with JSONB result and caller migration contract: lines 666-808.
- **SPEC-CRV2-7 — YES.** Attachment INSERT RLS checks each parent branch and forces `upload_status = 'pending'`: lines 1104-1156.

Non-blocking spec defects: **8 YES, 2 PARTIAL**.

- **SPEC-SDV2-1 — PARTIAL.** v3 says the migration must enumerate the full action list, but the spec itself still only lists new actions and a grep instruction: lines 83-99. This does not fulfil “enumerate every existing action value” in the spec text.
- **SPEC-SDV2-2 — YES.** Wave 0 runs before everything else: lines 68-70, 1283-1285, 1317-1323.
- **SPEC-SDV2-3 — YES.** SOP admin references use `/settings`: lines 234, 968, 1354.
- **SPEC-SDV2-4 — YES.** Wave 3 and Wave 4 depend on Wave 2: lines 462, 627, 1319-1321.
- **SPEC-SDV2-5 — YES.** Event roll-up includes direct event, planning-item, and task attachments: lines 1231-1246.
- **SPEC-SDV2-6 — YES.** Cascade audit actions use `planning_task.cascade_*`: lines 93, 781-784, 851-853, 868-870, 994.
- **SPEC-SDV2-7 — YES.** Multi-venue event RPC payload, return shape, grants, and audit ownership are specified: lines 377-436.
- **SPEC-SDV2-8 — PARTIAL.** The global hardening rule is correct at lines 56-63, and `generate_sop_checklist_v2` follows it at lines 802-805, but several function snippets omit the full revoke/grant pattern: lines 552-555, 877-880, 919-921; the multi-venue RPC only states `GRANT EXECUTE` at line 434.
- **SPEC-SDV2-9 — YES, with rollback caveat in Part D.** Rows exist for audit CHECK, `venues.category`, SOP expansion columns, and other migrations: lines 1305-1312.
- **SPEC-SDV2-10 — YES.** Flat-task-to-tree sweep includes dashboard and event detail: lines 980-981.

Workflow refinements: **11/11 YES**.

- **WFV2-1 — YES:** `idempotency_key` and `event_creation_batches`: lines 377, 408-424, 438, 451.
- **WFV2-2 — YES:** backfill queue has attempt/lock/retry/dead-letter fields and `FOR UPDATE SKIP LOCKED`: lines 930-960.
- **WFV2-3 — YES:** attachment confirm transient vs terminal states: lines 1209-1214.
- **WFV2-4 — YES:** cleanup sweeps failed uploads after 24h: lines 1264-1267.
- **WFV2-5 — YES:** 14-day stale approval reaper specified: lines 567-573.
- **WFV2-6 — YES:** `SLT_FROM_ALIAS` or one-email-per-recipient fallback: lines 319-332.
- **WFV2-7 — YES:** empty SLT recipient audit uses `slt_emailed: false`: lines 330, 351.
- **WFV2-8 — YES:** labour-rate drift banner: lines 275-278, 282, 296.
- **WFV2-9 — YES:** category change out of filter marks children `not_required`: lines 962-965, 993.
- **WFV2-10 — YES:** `file-type` null becomes failed upload: line 1212.
- **WFV2-11 — YES:** metadata-only `completed_at` update limit documented: line 885.

Security refinements: **4/4 YES**.

- **SRV2-1 — YES.** Executive attachment visibility explicitly classified: line 1102.
- **SRV2-2 — YES.** Attachment server actions use service-role client after caller validation: lines 1197-1221.
- **SRV2-3 — YES.** Future sensitive `business_settings` columns rule documented: line 270.
- **SRV2-4 — YES.** DB CHECK on `attachments.original_filename`: lines 1017-1019.

## Part B — Architectural Coherence

- **Decision 1 — VERIFIED.** SOP absorbs cascade via `sop_task_templates.expansion_strategy` / `venue_filter` and planning-task cascade columns: lines 7-10, 631-664. `rg` found no `cascade_definitions` in v3.
- **Decision 2 — VERIFIED.** Labour rate is a typed `business_settings` singleton: lines 244-251. `rg` found no `app_settings` in v3.
- **Decision 3 — VERIFIED.** Attachments use three nullable FKs plus exactly-one-parent CHECK: lines 1011-1033. `rg` found no `subject_type` in v3.

## Part C — Client Request Mapping

1. **Task notes — YES.** Lines 142-168.
2. **Mark todo not required from todos page — YES.** Lines 170-202.
3. **Audit logging — PARTIAL.** Broad audit coverage is specified at lines 48 and 68-134, but the final action list is not actually enumerated in the spec text: lines 83-99.
4. **Proof-read menus task — YES.** Lines 204-238.
5. **Pre-event entry form — PARTIAL.** The workflow is present at lines 460-621, but it reuses a Wave 2 draft RPC whose payload/status contract does not match proposal creation; see SPEC-V3-002.
6. **Multi-select venues + categories — PARTIAL.** UI/categories are covered at lines 355-456, but the multi-venue RPC calls `generate_sop_checklist_v2` before that RPC exists in the migration order; see SPEC-V3-001.
7. **Task attachments + roll-up — YES.** Lines 998-1277.
8. **Task cascade — YES, with implementation-order caveats.** Core behaviour is specified at lines 625-994; see Part D for ordering/hardening issues.
9. **SLT email — YES.** Lines 299-351.
10. **Labour hours — YES.** Lines 240-297.

Regressions introduced by v3 revisions: **yes**. The main regressions are the Wave 2 dependency on `generate_sop_checklist_v2` before Wave 4 creates it, and the pre-event proposal flow reusing a draft-only RPC contract.

## Part D — New v3 Inconsistencies

- **SPEC-V3-001 — BLOCKER: Wave 2 calls `generate_sop_checklist_v2` before it exists.** Wave 2 RPC behaviour calls `generate_sop_checklist_v2(planning_item_id)` at line 430, but the migration list does not create it until item 15, line 1299. The dependency diagram also shows Wave 4 depending on Wave 2, not Wave 2 depending on Wave 4: lines 1319-1321. Fix by moving `generate_sop_checklist_v2` before the multi-venue RPCs or keeping Wave 2 on the old RPC until Wave 4.

- **SPEC-V3-002 — BLOCKER: pre-event proposal reuses a draft RPC with incompatible payload/status.** Wave 3 says `proposeEventAction` creates `pending_approval` events by reusing the Wave 2 multi-venue RPC: line 562. But the Wave 2 RPC is named `create_multi_venue_event_drafts`, has no `status` field, and requires `event_type`, `end_at`, and `venue_space`: lines 377, 385-388. Wave 3 explicitly allows those fields to be null for proposal states: lines 486-493, 582-603.

- **SPEC-V3-003 — MAJOR: SECURITY DEFINER hardening text and SQL snippets diverge.** The convention requires owner, pinned search path, revoke from `public, authenticated`, and grant to `service_role`: lines 56-63. Several function snippets only revoke from `public` and omit the service-role grant: lines 552-555, 877-880, 919-921. Multi-venue RPC grants are also under-specified: line 434.

- **SPEC-V3-004 — MAJOR: rollback dependency order is incomplete.** Wave 0 says `cascade_internal_bypass` “can be dropped safely”: line 1305, but Wave 4 guard calls it: line 893. Wave 4 rollback also omits dropping `generate_sop_checklist_v2`, `cascade_parent_sync`, and `guard_planning_task_cascade_columns` before dropping referenced columns: line 1311.

- **SPEC-V3-005 — MAJOR: idempotency transaction wording is not implementable as written.** The spec defines an RPC function at line 377, then says it opens a transaction, commits, and writes `event_creation_batches` after commit: lines 427-431. A normal Postgres function cannot manage `COMMIT`, and writing the idempotency row after event creation weakens retry safety. The batch row should be inserted/locked/updated inside the same implicit transaction.

- **SPEC-V3-006 — MINOR: stale wave numbers remain after renumbering.** Non-goals say Wave 5 extends SOP even though SOP is Wave 4: line 41. New audit action bullets also cite stale waves: lines 93, 96-99.

- **SPEC-V3-007 — MINOR: stale-approval reaper predicate is ambiguous.** Line 570 says `start_at < ... OR updated_at < ...` while also saying “whichever is later past”. That should be expressed as `greatest(start_at, updated_at) < now() - interval '14 days'`, or the intended rule should be stated plainly.

Specific checks requested:

- **Wave 0 ordering — PASS.** Migration item 1 is Wave 0: lines 1283-1285; dependency diagram starts with Wave 0: lines 1317-1323.
- **`cascade_internal_bypass()` before Wave 4 use — PASS.** Defined at lines 101-112, migration item 1 at line 1285, used later at line 893.
- **`generate_sop_checklist_v2` caller migration contract — PRESENT BUT CONFLICTING.** Same-PR caller migration contract exists at line 808, but Wave 2 already calls it before creation at line 430.
- **`event_creation_batches` audit entity — ACCEPTABLE AS WRITTEN.** No `event_creation_batch` entity is added at lines 78-81, but the spec does not log batch-row actions; it audits events with `meta.multi_venue_batch_id`: line 436.
- **Rollback dependency drops — FAIL.** See SPEC-V3-004.

## Part E — Open Questions

- Should `generate_sop_checklist_v2` move to Wave 0/Wave 2, or should Wave 2 keep using `generate_sop_checklist` until Wave 4?
- Should proposal creation use a separate `create_multi_venue_event_proposals` RPC, or should the Wave 2 RPC gain an explicit `mode/status` contract?
- Should idempotency batch rows be first-class audit entities, or is per-event audit with `multi_venue_batch_id` sufficient?
- What exact expiry predicate should the 14-day reaper use: `start_at`, `updated_at`, or `greatest(start_at, updated_at)`?

## Recommendation

**V4 NEEDED.**

The v2 checklist is mostly applied, but v3 is not clean to implement because of two blockers: Wave 2 calls `generate_sop_checklist_v2` before it exists, and the pre-event proposal flow reuses a draft RPC with the wrong payload/status contract. Fix those, then tighten SECURITY DEFINER snippets and rollback ordering before implementation.