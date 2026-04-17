# Assumption Breaker Report v2: Client Enhancement Batch Spec

## Summary

v2 fixes many of the v1 consistency defects, but it does **not** fully clear the v1 blockers. My audit count: **13 resolved**, **3 partially resolved**, **1 new issue introduced** across SPEC-CR-1 through SPEC-CR-7 and SPEC-SD-1 through SPEC-SD-10.

The largest new blockers are: SOP expansion is hiding a material RPC rewrite; the cascade guard trigger is likely incompatible with the hardened `service_role` RPC path; the event status trigger blocks the intended `approved_pending_details → draft` venue-manager flow; and the `sop_task_templates.venue_filter` default likely makes the Wave 5 migration fail on existing rows.

## v1 Findings Resolution Audit

| Finding | Status | Evidence | Still Missing / Problem |
|---|---:|---|---|
| SPEC-CR-1 | RESOLVED | v2 uses `recordAuditLogEntry` and explicitly says no `operation_status`: `docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:35`; grep only finds `operation_status` in the change log: `:1207`. | None. |
| SPEC-CR-2 | PARTIALLY RESOLVED | v2 adds one Wave 2.1 audit migration and lists entities/actions: `:354`, `:360`, `:362`, `:381`. | The action CHECK is still not actually enumerated. It says “Plus all existing ... action values ... need enumerating”: `:390`. Given the current migrations have already drifted audit constraints, this is still a spec hand-off, not a complete migration contract; see current dropped action risk at `supabase/migrations/20260416000000_user_deactivation.sql:85`. |
| SPEC-CR-3 | RESOLVED | Attachments now include `upload_status` and `uploaded_at`: `docs/...design.md:911`, `:915`; confirm and cleanup flows reference those columns consistently: `:1061`, `:1093`. | None on lifecycle shape. |
| SPEC-CR-4 | RESOLVED | `auto_completed_by_cascade_at` is added: `:679`; parent lock is specified: `:722`; reopen branch exists: `:750`. | None for the v1 ask. |
| SPEC-CR-5 | PARTIALLY RESOLVED | A guard trigger exists: `:779`, `:807`. | The actual `cascade_parent_sync` trigger still does not verify child/parent `planning_item_id`, parent master marker, or child `cascade_venue_id` before updating the parent: `:716`, `:741`. The v1 hardening requirement was inside the cascade trigger, not only a separate non-admin guard. |
| SPEC-CR-6 | NEW ISSUE INTRODUCED | v2 adds a status-transition trigger: `:554`, `:559`; it requires administrator for transitions out of both `pending_approval` and `approved_pending_details`: `:564`. | This contradicts the intended venue-manager completion path: `approved_pending_details → draft` via existing full-form save: `:590`, `:641`. |
| SPEC-CR-7 | PARTIALLY RESOLVED | v2 chooses `approved_pending_details`: `:519`, `:525`; the required-fields CHECK allows both proposal statuses: `:548`. | The state solves the NOT NULL/CHECK violation, but the trigger blocks the venue manager’s final transition unless rewritten. |
| SPEC-SD-1 | RESOLVED | Heather Farm Cafe exact name is used: `:431`, `:432`. | None. |
| SPEC-SD-2 | RESOLVED | No `canEditPlanningTask`; v2 points to `togglePlanningTaskStatusAction` permission behaviour: `:73`, `:118`. | None. |
| SPEC-SD-3 | RESOLVED | Canonical FormData shape is stated: `:42`; `togglePlanningTaskStatusAction` is named: `:112`, `:118`; `saveEventDraftAction` consumes FormData venue IDs: `:463`. | None. |
| SPEC-SD-4 | RESOLVED | Wave 1.4 has one consolidated data-model block: `:203`; migration list confirms one migration: `:1134`. | None. |
| SPEC-SD-5 | RESOLVED | Deterministic UUID and `ON CONFLICT (id) DO NOTHING`: `:142`, `:149`, `:162`; correct section label: `:161`. | None. |
| SPEC-SD-6 | RESOLVED | Wave 4 migration labelled **Not additive**: `:1138`, `:1146`. | None. |
| SPEC-SD-7 | RESOLVED | Wave 4 dependency on Wave 3 is explicit: `:513`, `:1177`. | None. |
| SPEC-SD-8 | RESOLVED | v2 states CHECK replacement and NOT NULL drops: `:531`, `:541`; migration summary repeats it: `:1146`. | None. |
| SPEC-SD-9 | RESOLVED | `cascade_definitions` removed by architecture decision; replacement is `cascade_sop_template_id`: `:653`, `:678`. | Resolved by deleting the old model rather than moving `cascade_definition_id`. |
| SPEC-SD-10 | RESOLVED | Unique partial index exists: `:686`, `:687`. | None. |

## New Assumptions Introduced in v2

**AB-V2-001 — SOP expansion is a hidden RPC rewrite**  
Type: Scope gap / Severity: High / Confidence: High / Evidence: v2 says the existing RPC is “extended”: `docs/...design.md:697`; current RPC is `generate_sop_checklist`, not `generate_sop_tasks_for_event`: `supabase/migrations/20260408120003_add_sop_rpc_functions.sql:26`; it returns early if any SOP task already exists: `:72`; current insert column list has no parent/child cascade columns: `:120`; dependency mapping is template-task based: `:192`, `:204`, `:222`. Counterargument: “extended” may imply a full rewrite. What would confirm: replacement SQL showing parent + children, idempotency, dependency behaviour, return contract, and tests. Action owner: implementer/spec owner. Blocking-or-advisory: Blocking.

**AB-V2-002 — Cascade guard likely blocks the hardened service-role RPC path**  
Type: Security/authorisation contradiction / Severity: High / Confidence: High / Evidence: guard only allows `public.current_user_role() = 'administrator'`: `docs/...design.md:781`; v2 assumes elevated RPC can still set cascade columns: `:811`; hardened SOP RPC execution is granted only to `service_role`: `supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:80`, `:92`; table triggers fire for RPC writes because the RPC performs real `planning_tasks` inserts/updates: `supabase/migrations/20260408120003_add_sop_rpc_functions.sql:120`, `:222`. Counterargument: the future RPC could pass an admin JWT or set an explicit bypass. What would confirm: integration test where `service_role` calls the SOP RPC and writes cascade columns through the guard. Action owner: implementer. Blocking-or-advisory: Blocking.

**AB-V2-003 — `pending_cascade_backfill` has no retention path**  
Type: Operational completeness / Severity: Medium / Confidence: High / Evidence: queue table has `processed_at` and `error`: `docs/...design.md:823`, `:827`; cron runs every minute: `:820`; no DELETE/retention job is specified. Counterargument: volume may be small. What would confirm: retention rule, e.g. delete processed rows after 30 days or archive failures. Action owner: spec owner. Blocking-or-advisory: Advisory.

**AB-V2-004 — `approved_pending_details → draft` is blocked by the trigger**  
Type: Executable contradiction / Severity: High / Confidence: High / Evidence: trigger blocks transitions out of `approved_pending_details` unless administrator: `docs/...design.md:564`; spec says venue manager completes full form via `saveEventDraftAction`: `:590`; acceptance criteria requires creator lands in `draft`: `:641`. Counterargument: the full-save action could use an admin/service client, but that would weaken actor semantics and is not specified. What would confirm: trigger rule allowing creator/venue manager to transition `approved_pending_details → draft` when required fields are present. Action owner: spec owner/implementer. Blocking-or-advisory: Blocking.

**AB-V2-005 — No discoverability path for users with approved pending details**  
Type: UX/workflow gap / Severity: High / Confidence: Medium / Evidence: v2 dashboard section only adds admin “Pending approval” controls: `docs/...design.md:613`; status-consumer sweep does not include “My tasks” or a creator dashboard CTA: `:592`; current planning board merely excludes completed/rejected and would pass unknown statuses through raw: `src/lib/planning/index.ts:550`, `:555`; no inspected code has `approved_pending_details` behaviour. Counterargument: event detail page may be enough if linked from email. What would confirm: explicit inbox/dashboard task, route, or banner that sends the creator to the full form. Action owner: product/spec owner. Blocking-or-advisory: Blocking.

**AB-V2-006 — Event transition trigger depends on unspecified service-role/auth context**  
Type: Auth-context ambiguity / Severity: High / Confidence: Medium / Evidence: trigger uses `current_user_role()` inside `SECURITY DEFINER`: `docs/...design.md:566`, `:577`; `current_user_role()` is auth/deactivation-aware: `supabase/migrations/20260416000000_user_deactivation.sql:117`; service-role calls without a user JWT can have null/system actor semantics. Counterargument: `preApproveEventAction` may use the authenticated admin client, not service-role. What would confirm: implementation states which Supabase client is used and tests admin-session and service-role paths. Action owner: implementer. Blocking-or-advisory: Blocking.

**AB-V2-007 — Attachment SELECT RLS is potentially expensive at 10k rows**  
Type: Performance risk / Severity: Medium / Confidence: Medium / Evidence: policy evaluates multiple correlated `EXISTS` joins per attachment row: `docs/...design.md:942`, `:950`, `:975`, `:994`; indexes are only simple parent-FK partial indexes: `:926`, `:927`, `:928`. Counterargument: indexed parent lookups may be acceptable at 10k. What would confirm: `EXPLAIN (ANALYSE, BUFFERS)` on 10k attachments for list and roll-up queries. Action owner: implementer/DB owner. Blocking-or-advisory: Advisory until measured.

**AB-V2-008 — MIME sniff requires an explicit service-role Storage read path**  
Type: Storage/security implementation gap / Severity: High / Confidence: Medium / Evidence: user SELECT on the bucket is blocked: `docs/...design.md:1045`, `:1047`; confirm action must download the first KB for `file-type`: `:1063`, `:1064`; v2 does not say the confirm action uses a service-role Storage client. Counterargument: Supabase service role should bypass Storage RLS if used correctly. What would confirm: server action explicitly uses the admin/service client for confirm/delete/sniff, with no client-side object read. Action owner: implementer. Blocking-or-advisory: Blocking.

**AB-V2-009 — `venue_filter default 'pub'` likely makes the migration fail**  
Type: Migration defect / Severity: High / Confidence: High / Evidence: existing rows get `expansion_strategy default 'single'`: `docs/...design.md:662`; same ALTER gives `venue_filter default 'pub'`: `:664`; coherency CHECK then requires `single` rows to have `venue_filter is null`: `:669`. Counterargument: implementer may split the migration and backfill nulls. What would confirm: dry-run migration against current DB. Action owner: spec owner/implementer. Blocking-or-advisory: Blocking.

**AB-V2-010 — Labour cost preview can lie at submit time**  
Type: Product/UX risk / Severity: Medium / Confidence: High / Evidence: form preview reads rate at load: `docs/...design.md:243`; server re-reads at submit and may store a different cost: `:244`; v2 acknowledges the mismatch and accepts it: `:275`; current debrief submit has no labour-rate mechanism yet: `src/actions/debriefs.ts:55`, `:111`. Counterargument: product may prefer submit-time truth. What would confirm: visible “rate changed” warning, or product sign-off that silent change is acceptable. Action owner: product owner. Blocking-or-advisory: Advisory.

**AB-V2-011 — Attachment INSERT RLS does not enforce parent edit permission**  
Type: Security/RLS gap / Severity: High / Confidence: High / Evidence: spec comment says write policy gates direct table access: `docs/...design.md:1010`; actual INSERT policy only checks `uploaded_by = auth.uid()` and role admin/office-worker: `:1012`, `:1015`; it does not verify event/planning item/task edit rights. Counterargument: server actions validate parent edit rights before issuing upload URLs. What would confirm: RLS `WITH CHECK` mirrors parent edit checks or table INSERT is service-action-only. Action owner: implementer. Blocking-or-advisory: Blocking.

**AB-V2-012 — Cascade trigger audit is claimed but absent from the SQL shown**  
Type: Audit completeness / Severity: Medium / Confidence: High / Evidence: acceptance criteria says auto-complete/reopen audit rows exist: `docs/...design.md:873`; note says trigger inserts its own audit row: `:875`; the trigger body shown only updates `planning_tasks` and returns: `:710`, `:742`, `:759`, `:768`. Counterargument: omitted for brevity. What would confirm: concrete SQL `insert into audit_log (...)` inside the trigger or a called SQL helper. Action owner: spec owner/implementer. Blocking-or-advisory: Blocking for Wave 5 audit acceptance.

## What Appears Newly Sound

- Attachment lifecycle is now coherent: `upload_status` + `uploaded_at` exist and cleanup references them: `docs/...design.md:911`, `:915`, `:1093`.
- The Heather Farm Cafe seed correction is precise: `:431`, `:432`.
- The Proof-read menus migration now uses section `label`, deterministic UUID, and `ON CONFLICT (id)`: `:149`, `:161`, `:162`.
- The `business_settings` seed is not blocked by the singleton design: `id = true` is inserted explicitly: `:206`, `:213`. Future `ALTER TABLE ADD COLUMN` is not inherently blocked by a boolean primary key, though the rationale at `:237` is imprecise: the primary key blocks a second `true`; the CHECK blocks `false`.
- Cascade duplicate prevention is correctly specified with a partial unique index: `:686`.
- Upload/download TTLs are now separated: `:891`, `:892`.
- SLT email privacy is materially improved by using `bcc`: `:286`, `:319`.