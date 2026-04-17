# Spec Trace Report v2

## Part A — v1 Findings Resolution

| Finding | v2 status | Evidence / remaining issue |
|---|---:|---|
| SPEC-001 | RESOLVED | `operation_status` is explicitly removed from the audit contract: Wave cross-cutting, lines 35 and changelog line 1207. |
| SPEC-002 | PARTIALLY RESOLVED | Timing/entity coverage is much better: Wave 2.1 lines 358-392 and migration list line 1132. Still incomplete because the action CHECK is not a full list: line 381 says “additions on top of existing list” and line 390 says existing values “need enumerating”. That leaves the same class of audit-constraint miss possible. |
| SPEC-003 | RESOLVED | The non-existent `canEditPlanningTask` reference is gone. Task notes reuse the existing task edit permission, line 73; todos use existing planning permission language, lines 118-120. |
| SPEC-004 | RESOLVED | The spec now states the canonical FormData action shape, line 42, and uses `togglePlanningTaskStatusAction`, line 118. No stale `saveEventDraftAction(input, eventId?)` signature remains. |
| SPEC-005 | RESOLVED | Labour data model is collapsed into one authoritative migration block, lines 203-235, and the migration list names one consolidated migration, line 1134. |
| SPEC-006 | RESOLVED | Proof-read menus now uses a deterministic UUID and `ON CONFLICT (id) DO NOTHING`, lines 147-163. |
| SPEC-007 | RESOLVED | The migration now directly inserts an audit row instead of claiming server-action audit, lines 165-174. |
| SPEC-008 | RESOLVED | Wave 4 no longer says “status CHECK only”; it explicitly includes status CHECK replacement, NOT NULL relaxation, and the follow-up required-fields CHECK, lines 529-552. |
| SPEC-009 | RESOLVED | `attachments` now has `upload_status` and `uploaded_at`, lines 911-915; confirm and cleanup use that model, lines 1065 and 1094. |
| SPEC-010 | RESOLVED | Cascade reopen is now specified: marker column lines 674-679, parent lock lines 722-726, reopen branch lines 750-765. |
| SPEC-011 | PARTIALLY RESOLVED | v2 says audit rows must exist and claims trigger insertion, lines 873-875. But the concrete trigger SQL shown at lines 710-770 contains no audit insert, and audit action names drift between `planning_task.cascade_*` at line 383 and unprefixed `cascade_*` at line 873. |
| SPEC-012 | RESOLVED | The old `cascade_definition_id` / `default_due_offset_days` model is removed by the SOP-template architecture. The replacement is `cascade_sop_template_id`, lines 674-679, with generation driven from `sop_task_template`, lines 697-704. |
| SPEC-013 | RESOLVED | Wave dependencies are explicit: Wave 4 depends on Wave 3 at lines 511-513 and in the dependency diagram, lines 1165-1184. |
| SPEC-014 | RESOLVED | The migration list now marks Wave 4 as not additive, lines 1138 and 1146. |

## Part B — Architectural Decision Coherence

**Decision 1 — Cascade absorbed into SOP: PARTIALLY COHERENT**

The old separate table is not used operationally. The only `cascade_definitions` mentions are negative/historical statements, lines 653 and 1204. Wave 5.1-5.5 generally uses the unified model: `sop_task_templates.expansion_strategy`, `venue_filter`, and `cascade_sop_template_id`, lines 657-845. The migration list has no `add_cascade_definitions.sql`, lines 1128-1144. Wave 2 uses `sop_task_template.expansion_changed`, line 389, not `cascade_definition.*`.

Drift points:
- The SOP migration as written cannot apply: `expansion_strategy` defaults to `single`, `venue_filter` defaults to `pub`, then the CHECK requires `single` rows to have `venue_filter is null`, lines 661-672.
- Cascade audit names are inconsistent: `planning_task.cascade_*` at line 383 versus unprefixed `cascade_*` at line 873.
- The changelog claims invariant checks are inside the cascade trigger, line 1210, but the trigger SQL at lines 710-770 does not check same planning item, parent master status, or child venue presence.
- Settings UI points to `/admin/sop`, line 840, but the repo’s SOP editor is under `/settings` in [src/app/settings/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/settings/page.tsx:48).

**Decision 2 — `business_settings` typed singleton: COHERENT**

Operational references use `business_settings`: data model lines 203-235, server actions lines 250-252, audit lines 264-266, Wave 2 entity/action lines 378 and 385, migration list line 1134. There is no `add_app_settings.sql`. The only `app_settings` mention is the changelog’s historical note, line 1205. That is not implementation drift.

**Decision 3 — Attachments three nullable FKs: MOSTLY COHERENT**

The data model uses only `event_id`, `planning_item_id`, and `planning_task_id` with an exactly-one CHECK, lines 902-923. RLS read policy uses the new FK shape and has administrator/executive short-circuit, lines 942-1008. Roll-up query uses the FK shape, lines 1088-1089. Cleanup uses `upload_status`/`deleted_at`, not polymorphic columns, lines 1091-1097. The only `subject_type` / `subject_id` mentions are negative/historical, lines 10, 885, and 1206.

Drift points:
- Attachment insert/update RLS does not actually enforce edit permission on the parent, despite the comment at lines 1010-1011. Insert only checks role and `uploaded_by`, lines 1012-1016; update is administrator-only, lines 1018-1020, which also conflicts with non-admin upload confirmation/delete flows.
- Event roll-up omits direct planning-item attachments for planning items linked to the event, line 1088.
- The storage SELECT policy grants authenticated SELECT on every non-`task-attachments` bucket, lines 1045-1049.

## Part C — Client Request Mapping Refresh

1. **Task notes — FULLY ADDRESSED.** Data, UI, action, permissions, audit, and all-view rendering are covered, lines 50-83.

2. **Mark todo as not required from todos page — FULLY ADDRESSED.** UI, resolved toggle, metadata fix, status sweeps, and acceptance criteria are covered, lines 89-129.

3. **Audit logging for all changes — PARTIALLY ADDRESSED.** The intent is strong, lines 35 and 354-415, but the action CHECK is still not fully enumerated, line 390; trigger audit is asserted but not specified in SQL, lines 710-770 and 873-875; scope remains mostly server-action-centric.

4. **Proof-read menus task in food category — FULLY ADDRESSED.** Food Development is confirmed and the idempotent migration is valid, lines 135-184.

5. **Pre-event entry form, simpler/admin-approved — PARTIALLY ADDRESSED WITH REGRESSION.** The workflow is specified, lines 511-645, but the trigger blocks non-admin transitions out of `approved_pending_details`, lines 564-567, while the venue manager is supposed to complete that state into `draft`, lines 590 and 641.

6. **Multi-select venues + all pubs excluding Heather Farm + venue category — FULLY ADDRESSED.** Category, Heather Farm Cafe fix, multi-select, all-pubs quick action, N-row event creation, and planning-item creation are covered, lines 423-503.

7. **Task attachments + event/planning item roll-up — PARTIALLY ADDRESSED.** The FK model, upload flow, UI, roll-ups, cleanup, and acceptance criteria exist, lines 883-1124. Regressions remain in RLS write policy and event roll-up completeness, lines 1010-1020 and 1088-1089.

8. **Task cascade across venues + settings-managed + default manager assignment — PARTIALLY ADDRESSED.** The unified SOP model covers the core request, lines 651-875. Blocking issues remain: impossible default/CHECK combination, lines 661-672; missing trigger invariants, lines 710-770; route drift at line 840.

9. **Debrief emails SLT + people picker in settings — FULLY ADDRESSED.** `slt_members`, picker, email helper, empty-list behaviour, BCC, audit, and acceptance criteria are covered, lines 279-349.

10. **Labour hours in debrief at £12.71/hr + editable in settings — FULLY ADDRESSED.** Typed singleton, default £12.71, debrief snapshot, live calculation, settings update, audit, and acceptance criteria are covered, lines 190-274.

## Part D — New v2 Inconsistencies

**SPEC-V2-001 — Critical — SOP expansion migration contradicts itself.**  
`expansion_strategy` defaults to `single`, `venue_filter` defaults to `pub`, then the CHECK requires `single` rows to have `venue_filter is null`, lines 661-672. Existing rows and future single-template inserts fail.

**SPEC-V2-002 — Critical — Pre-event trigger blocks the intended approval path.**  
The trigger requires administrator for transitions out of `approved_pending_details`, lines 564-567, but the venue manager’s full form submit must transition `approved_pending_details → draft`, lines 590 and 641.

**SPEC-V2-003 — High — Cascade guard likely blocks the elevated RPC path.**  
The guard allows only `current_user_role() = 'administrator'`, lines 779-805, while line 811 says the elevated SOP RPC can still set cascade columns. Existing `current_user_role()` derives from `auth.uid()`/JWT role, [migration](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260415180000_rbac_renovation.sql:104); hardened SOP RPCs are granted to `service_role`, [migration](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:80). `service_role` is not `administrator`.

**SPEC-V2-004 — High — Cascade invariant checks requested in the handoff are not in the trigger.**  
The trigger SQL, lines 710-770, never checks child/parent `planning_item_id`, parent master identity, or child `cascade_venue_id`. The changelog says invariant checks were added, line 1210, but they were not.

**SPEC-V2-005 — High — Cascade audit is internally inconsistent.**  
Wave 2 allows `planning_task.cascade_spawn`, `planning_task.cascade_autocompleted`, `planning_task.cascade_reopened`, line 383. Wave 5 acceptance uses `cascade_spawn`, `cascade_autocompleted`, `cascade_reopened`, line 873. The trigger SQL has no audit insert, lines 710-770, despite the note at line 875.

**SPEC-V2-006 — High — Wave ordering still conflicts with audit constraints.**  
Goals say Wave 1 ships first, lines 20-21, and dependency diagram puts Wave 1 before Wave 2, lines 1168-1172. But Wave 1 features emit new audit actions that are only added by Wave 2.1, lines 77, 266, and 341. The migration list quietly makes audit migration first overall, lines 1132-1135. Make Wave 2.1 a Wave 0 prerequisite or reorder the waves.

**SPEC-V2-007 — Medium — Wave 2.1 claims complete action coverage but does not enumerate it.**  
Line 360 says every value written today is included. Line 381 says the list is only “additions”, and line 390 delegates existing action enumeration to implementation. That is not a spec-level contract.

**SPEC-V2-008 — High — Attachment RLS write policy contradicts the server-action flow.**  
The spec says write policy gates direct table access and parent edit permission, lines 1010-1011. SQL only checks `uploaded_by` and broad role on insert, lines 1012-1016, and makes updates administrator-only, lines 1018-1020. That conflicts with non-admin upload confirmation and soft-delete flows, lines 1061-1067 and 1078-1080.

**SPEC-V2-009 — High — Storage policy over-grants non-attachment buckets.**  
The policy intended to block task-attachment SELECT instead allows authenticated SELECT where `bucket_id != 'task-attachments'`, lines 1045-1049. That can widen access to every other bucket.

**SPEC-V2-010 — Medium — Event attachment roll-up omits planning-item attachments.**  
The UI supports event and planning-item direct attachments, lines 1082-1083. Event roll-up includes event direct attachments and task attachments only, line 1088; it misses `attachments.planning_item_id IN (...)`.

**SPEC-V2-011 — Medium — SOP settings route is wrong.**  
Spec says existing `/admin/sop`, line 840. Repo has no `src/app/admin`; SOP editor is in `/settings`, [src/app/settings/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/settings/page.tsx:48).

**SPEC-V2-012 — Medium — Transactional multi-venue RPCs are under-specified.**  
`create_multi_venue_event_drafts(payload jsonb)` is named, lines 464-476, and planning-item fan-out says “transactional RPC”, lines 480-492, but v2 does not define payload, return shape, SQL body, security grants, audit responsibility, or failure contract.

**SPEC-V2-013 — Medium — SECURITY DEFINER functions lack hardening details.**  
Event/cascade/guard functions are `SECURITY DEFINER`, lines 577, 770, and 805, but v2 does not specify owner, pinned `search_path`, revoke/grant policy, or service-role-only execution pattern. The repo has an existing hardened pattern for this.

**SPEC-V2-014 — Low — Rollback plan is incomplete for the new migration set.**  
Rollback covers broad buckets, lines 1150-1154, but omits explicit rollback for audit CHECK expansion, `venues.category`, `sop_task_templates.expansion_strategy`/`venue_filter`, and exact data preconditions before dropping typed settings/labour columns.

## Open Questions Still Open

- Should `approved_pending_details → draft` be allowed for the original creator, any office worker at the venue, or only administrators?
- Should Wave 2.1 be renamed/repositioned as a prerequisite audit migration before Wave 1?
- What are the final cascade audit action names: `planning_task.cascade_*` or unprefixed `cascade_*`?
- How should the cascade guard safely permit service-role RPC writes without allowing client-side tampering?
- Should event attachment roll-up include direct planning-item attachments? The current UI implies yes.
- Is the SOP settings surface `/settings` only, or is a new `/admin/sop` route intended?

## Priority Recommendations for v3

1. Fix the two blockers first: SOP `venue_filter` default/CHECK and the `approved_pending_details → draft` trigger contradiction.
2. Make the audit migration fully concrete: complete action list, final action names, and correct wave ordering before any feature logs new values.
3. Rewrite Wave 5 trigger/guard SQL with invariants, service-role-safe execution, search-path/grant hardening, and real audit inserts.
4. Tighten attachment RLS/storage policies and update roll-up queries to cover all three FK shapes consistently.
5. Correct `/admin/sop` to the actual `/settings` SOP tab, or explicitly add the new route to scope.