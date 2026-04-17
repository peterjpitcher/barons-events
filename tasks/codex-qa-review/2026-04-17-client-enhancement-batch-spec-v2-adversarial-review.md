# Adversarial Review v2: Client Enhancement Batch Spec

**Date:** 2026-04-17
**Mode:** A — Adversarial Re-Review (spec v2, pre-implementation)
**Engines:** Codex CLI (5 specialist passes — Assumption Breaker, Integration & Architecture, Workflow & Failure-Path, Security & Data Risk, Spec Trace Auditor)
**Scope:** [docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md) v2
**Compared against:** v1 review artefacts at [adversarial-review.md](./2026-04-17-client-enhancement-batch-spec-adversarial-review.md) and [claude-handoff.md](./2026-04-17-client-enhancement-batch-spec-claude-handoff.md)

## Executive summary

v2 resolves almost every v1 consistency defect (all 10 SDs), most architectural concerns (IA-006 JSONB, IA-007 SLT, IA-008 polymorphic, IA-009 public API, IA-011 fire-and-forget), and three of the seven critical blockers (CR-1 audit helper, CR-3 attachment lifecycle, CR-4 cascade reopen).

Four v1 blockers are only partially resolved or newly regressed, and seven new blockers have been introduced by the revisions themselves. All remaining issues are editable at the spec level; no architectural choice needs to be re-opened.

**v1 findings resolution headline:**

| Cohort | Resolved | Partial | Unresolved | New regression |
|---|---:|---:|---:|---:|
| v1 CR (7 blockers) | 3 | 3 | 0 | 1 (CR-6) |
| v1 SD (10 consistency) | 10 | 0 | 0 | 0 |
| v1 IA (11 architecture) | 6 | 4 | 1 | 0 |
| v1 SEC (11 security) | 3 | 7 | 0 | 1 (SEC-008) |
| v1 WF (17 workflow) | 4 | 11 | 2 | 0 |
| v1 SPEC (14 trace) | 13 | 1 | 0 | 0 |

## What Appears Newly Sound (v2 improvements)

Preserve these — they are unambiguously better than v1 and should not change in v3:

- Attachment lifecycle: `upload_status` + `uploaded_at` + terminal `failed` state is coherent end-to-end.
- Heather Farm Cafe exact name fix (migration will match).
- Proof-read menus migration: deterministic UUID + `ON CONFLICT (id)` + correct section `label`.
- `business_settings` singleton pattern: `id boolean PK DEFAULT true CHECK (id = true)` prevents duplicates, seed INSERT explicitly (true) works, future `ALTER TABLE ADD COLUMN` is not blocked.
- Cascade parent-row lock (`SELECT ... FOR UPDATE`) serialises concurrent child completions.
- Cascade reopen branch handles the `done|not_required → open` transition.
- Labour validation aligned (Zod max 2000, DB `numeric(6,2)` precision matched).
- Public API filter to `approved | completed` still correctly protects proposal states.
- SLT BCC improvement (partial — see WF-V2-011 below).
- Multi-venue creation moved to a transactional RPC with all-or-nothing semantics (partial — see WF-V2-001).
- Typed `business_settings` replaces the JSONB key-value trap from v1.
- FK-based attachments replace polymorphic `subject_type` / `subject_id`.
- SOP template expansion absorbs cascade — no second template system to maintain.

## Critical Risks (v2 blockers)

These must be fixed in v3 before implementation starts. Multiple reviewers agreed on each.

### CR-V2-1: SOP template migration fails as written
- **Engines:** Assumption Breaker, Integration & Architecture, Spec Trace
- **Evidence:** v2 sets `expansion_strategy DEFAULT 'single'` ([spec:662](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) and `venue_filter DEFAULT 'pub'` ([spec:664](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) on `sop_task_templates`. Then the coherency CHECK ([spec:669](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) requires `single` rows to have `venue_filter IS NULL`. Existing seeded templates ([supabase/migrations/20260408120005_seed_sop_template.sql:42](../../supabase/migrations/20260408120005_seed_sop_template.sql)) become `(single, pub)` and fail the CHECK.
- **Fix:** default `venue_filter` to `NULL`. Only set it when `expansion_strategy = 'per_venue'`.

### CR-V2-2: Event status trigger blocks the venue manager's approval → draft transition
- **Engines:** Assumption Breaker, Integration & Architecture, Security, Spec Trace, Workflow
- **Evidence:** v2 trigger ([spec:564](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) rejects every transition out of `pending_approval` or `approved_pending_details` unless `current_user_role() = 'administrator'`. The spec's own workflow ([spec:523](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md), [spec:590](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md), [spec:641](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) says the venue manager completes the full form and moves the event to `draft` — that transition is now blocked.
- **Fix:** permit `approved_pending_details → draft` for the creator or a venue-scoped office worker when the required fields are all non-null. Keep the admin-only rule for the other transitions.

### CR-V2-3: Cascade guard trigger blocks the SOP RPC and the cascade parent-sync trigger
- **Engines:** Assumption Breaker, Integration & Architecture, Security, Spec Trace
- **Evidence:** Guard ([spec:779-805](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) rejects any non-admin write to `parent_task_id`, `cascade_venue_id`, `cascade_sop_template_id`, `auto_completed_by_cascade_at`. The existing SOP RPC runs as `service_role` ([supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:80](../../supabase/migrations/20260410120000_harden_security_definer_rpcs.sql)); `service_role` is not `administrator` — `current_user_role()` returns JWT role / `authenticated` for it ([supabase/migrations/20260415180000_rbac_renovation.sql:104](../../supabase/migrations/20260415180000_rbac_renovation.sql)). The parent-sync trigger ([spec:742](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) also writes `auto_completed_by_cascade_at`; it would fire for a child update by an office worker, then be rejected by the guard.
- **Fix:** add a narrowly-scoped bypass in the guard:
  ```sql
  if public.current_user_role() = 'administrator' or auth.role() = 'service_role' then
    return new;
  end if;
  ```
  And inside the parent-sync trigger, set a session-local flag before the UPDATE and have the guard check that flag too. Or: mark cascade columns as owned by DB triggers + the SOP RPC only, and simplify the guard to "deny unless current_setting('app.cascade_internal', true) = 'on'", with the triggers and RPC setting that flag.

### CR-V2-4: Cascade trigger does not actually insert audit rows
- **Engines:** Assumption Breaker, Spec Trace
- **Evidence:** Wave 5 acceptance criteria require audit rows for auto-complete and reopen ([spec:873](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) and a note claims the trigger inserts its own audit ([spec:875](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). The trigger SQL body ([spec:710-770](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) contains only `UPDATE planning_tasks` — no `INSERT INTO audit_log`.
- **Fix:** add the audit insert inside the trigger body. Example:
  ```sql
  insert into audit_log (entity, entity_id, action, meta, actor_id)
  values ('planning_task', v_parent_id, 'planning_task.cascade_autocompleted',
    jsonb_build_object('via', 'cascade_trigger', 'triggered_by_child', new.id), null);
  ```
  (And a matching insert inside the reopen branch.) Reconcile the action-name drift: Wave 2.1 uses `planning_task.cascade_*` prefix ([spec:383](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) but Wave 5 acceptance uses unprefixed `cascade_*` ([spec:873](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) — keep one.

### CR-V2-5: SOP generation RPC is a hidden contract rewrite
- **Engines:** Assumption Breaker, Integration & Architecture
- **Evidence:** v2 says "The existing SOP generation RPC is extended" ([spec:697](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). The current RPC returns an integer task count ([supabase/migrations/20260408120003_add_sop_rpc_functions.sql:31](../../supabase/migrations/20260408120003_add_sop_rpc_functions.sql)) and is idempotent keyed by `sop_template_task_id` ([add_sop_rpc_functions.sql:72](../../supabase/migrations/20260408120003_add_sop_rpc_functions.sql)). v2 also expects the RPC to return "skipped venues" metadata ([spec:704](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) and to write into new cascade columns, which breaks callers/tests ([src/actions/sop.ts:571](../../src/actions/sop.ts), [src/lib/__tests__/sop-generate.test.ts:34](../../src/lib/__tests__/sop-generate.test.ts)).
- **Fix:** either keep `generate_sop_checklist` stable and add a new `generate_sop_checklist_v2` with the richer return type, or fully specify the new return shape in the spec plus every caller/test that needs updating. Also spell out idempotency for master+children: a unique index on `(planning_item_id, sop_template_task_id)` for masters plus the existing `(parent_task_id, cascade_venue_id)` partial unique for children.

### CR-V2-6: Attachment INSERT RLS permits arbitrary parent attachment rows
- **Engines:** Assumption Breaker, Integration & Architecture, Security, Spec Trace
- **Evidence:** The insert policy ([spec:1012](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) only checks `uploaded_by = auth.uid()` and role `IN (administrator, office_worker)`. It does not verify that the user can edit the parent event / planning item / planning task. The v2 comment ([spec:1010](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) claims write policy gates direct table access, but the SQL does not back that up.
- **Fix:** rewrite the INSERT policy to check parent edit permission per FK branch. Example for the `planning_task_id` branch:
  ```sql
  with check (
    uploaded_by = auth.uid()
    and upload_status = 'pending'
    and (
      -- For planning_task attachments, user must be assignee/creator or at the venue.
      (planning_task_id is not null and exists (
        select 1 from planning_tasks pt
        join planning_items pi on pi.id = pt.planning_item_id
        join users u on u.id = auth.uid()
        where pt.id = planning_task_id
          and u.deactivated_at is null
          and (
            u.role = 'administrator'
            or (u.role = 'office_worker' and (u.venue_id is null or pi.venue_id is null or pi.venue_id = u.venue_id
                                              or pt.assignee_id = auth.uid() or pt.created_by = auth.uid()))
          )
      ))
      or (planning_item_id is not null and exists (
        -- similar check via planning_items -> venues -> users
      ))
      or (event_id is not null and exists (
        -- similar check via events -> venues -> users
      ))
    )
  );
  ```

### CR-V2-7: `storage.objects` policy is an over-grant, not a deny
- **Engines:** Security, Spec Trace
- **Evidence:** v2 writes `using (bucket_id != 'task-attachments')` ([spec:1047](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). That is a positive SELECT grant for every non-task-attachments bucket to every authenticated user. Existing storage policies are bucket-scoped and narrow ([supabase/migrations/20260210122000_retire_venue_areas_and_event_image_storage.sql:29](../../supabase/migrations/20260210122000_retire_venue_areas_and_event_image_storage.sql)).
- **Fix:** drop this policy entirely. Do NOT add any `task-attachments` SELECT policy — the absence of a permissive policy means authenticated users cannot SELECT. Server-action signed URLs remain the only access path.

## Spec Defects (v2, non-blocking)

### SD-V2-1: Audit Wave 2.1 does not enumerate existing action values
The spec says Wave 2.1 covers "every value written today" ([spec:360](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) but only lists additions ([spec:381](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) and punts the existing set to implementation ([spec:390](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). This is still a hand-off, not a contract.
**Fix:** list every `action` value currently in the repo — grep `recordAuditLogEntry` and `logAuthEvent` call sites — and fold them into the migration block explicitly.

### SD-V2-2: Wave ordering vs Wave 1 audit dependency
Goals / dependency diagram say Wave 1 ships first ([spec:20](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md), [spec:1168](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) but Wave 1 emits new audit actions that don't exist until Wave 2.1 ([spec:77](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md), [spec:266](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md), [spec:341](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). The migration list quietly makes Wave 2.1 first ([spec:1132](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)), but the prose contradicts it.
**Fix:** rename Wave 2.1 to "Wave 0" or state explicitly: the audit migration runs first; Wave 1 features then reference values that already exist.

### SD-V2-3: `/admin/sop` route does not exist
v2 Wave 5.5 ([spec:840](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) references `/admin/sop`. No `src/app/admin/` exists in this repo; SOP editor lives under `/settings` ([src/app/settings/page.tsx:48](../../src/app/settings/page.tsx)).
**Fix:** change the path to the existing `/settings` SOP surface, or explicitly add a new route to Wave 5 scope.

### SD-V2-4: Wave 5 depends on Wave 3 but diagram says it doesn't
Wave 5 `venue_filter` matching needs `venues.category` from Wave 3 ([spec:701](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). The dependency diagram shows Wave 5 independent of Wave 3 ([spec:1184](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)).
**Fix:** add the dependency edge.

### SD-V2-5: Event attachment roll-up omits planning-item attachments
Wave 6.6 ([spec:1088](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) unions event direct attachments and task attachments. It misses attachments on the event's linked planning items.
**Fix:** add the planning_item join.

### SD-V2-6: Cascade audit action names inconsistent
Wave 2.1 uses `planning_task.cascade_*` prefix ([spec:383](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)); Wave 5 acceptance uses unprefixed `cascade_*` ([spec:873](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)).
**Fix:** pick one prefix and apply it everywhere.

### SD-V2-7: Multi-venue RPC underspecified
`create_multi_venue_event_drafts(payload jsonb)` is named ([spec:464](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) but payload schema, return shape, security grants, audit ownership, and failure contract are not.
**Fix:** specify or delegate explicitly to the implementation phase with an acceptance test contract.

### SD-V2-8: SECURITY DEFINER functions lack hardening metadata
Event/cascade/guard triggers are `SECURITY DEFINER` ([spec:577](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md), [spec:770](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md), [spec:805](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) without owner, pinned `search_path`, or revoke/grant policy. The repo's existing hardening pattern ([supabase/migrations/20260410120000_harden_security_definer_rpcs.sql](../../supabase/migrations/20260410120000_harden_security_definer_rpcs.sql)) is the precedent to follow.
**Fix:** state `ALTER FUNCTION ... SET search_path = pg_catalog, public; REVOKE EXECUTE FROM public; GRANT EXECUTE TO service_role;` for each function — or the analogous pattern.

### SD-V2-9: Rollback plan incomplete for new migrations
Rollback ([spec:1150-1154](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) omits `venues.category`, `sop_task_templates.expansion_strategy`/`venue_filter`, audit CHECK expansion.
**Fix:** add explicit rollback rows for each.

### SD-V2-10: Cascade projection sweep misses dashboard + event-detail
Wave 5.6 ([spec:847-863](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) lists files to update for the flat-task-to-tree projection. It misses [src/lib/dashboard.ts:115](../../src/lib/dashboard.ts) and the event-detail SOP mapping at [src/app/events/[eventId]/page.tsx:124](../../src/app/events/[eventId]/page.tsx).
**Fix:** add both to the sweep list.

## Workflow & Failure-Path Defects (v2, new)

### WF-V2-1: Multi-venue RPC timeout ambiguity
HTTP timeout could leave events committed but client unaware. No `client_request_id` / idempotency key to recover.
**Fix:** the RPC takes an `idempotency_key uuid` argument and stores it on a batch row; retries with the same key return the original result.

### WF-V2-2: Backfill queue has no retry / dead-letter model
`pending_cascade_backfill` only tracks `processed_at` and `error` ([spec:823-828](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)).
**Fix:** add `attempt_count`, `last_attempt_at`, `locked_at`, `locked_by`, `next_attempt_at`. Use `FOR UPDATE SKIP LOCKED` for concurrent cron safety. Move rows with `attempt_count > 5` to a dead-letter log.

### WF-V2-3: Attachment confirm doesn't distinguish transient vs terminal failures
Storage download failure → keep pending; MIME mismatch → terminal `failed`. Spec conflates them.
**Fix:** document the state transitions explicitly in Wave 6.4.

### WF-V2-4: Failed attachments linger indefinitely
Cleanup cron ([spec:1093-1097](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) only sweeps pending and deleted rows, not failed.
**Fix:** add `upload_status = 'failed'` + 24-hour age to the sweep.

### WF-V2-5: `approved_pending_details` has no terminal path
Venue manager can abandon the form; row stays in `approved_pending_details` indefinitely.
**Fix:** either auto-revert to `rejected` after N days, or add an admin-visible "stale approvals" filter.

### WF-V2-6: SLT BCC privacy is conditional on admin alias
"Use a shared admin alias if configured, else first recipient" ([spec:319](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). With 10 SLT members and no alias, the first recipient is visible.
**Fix:** make the admin alias required; document the env var (`SLT_FROM_ALIAS` or similar). If no alias is set, send one email per recipient.

### WF-V2-7: Empty SLT audit meta is contradictory
No email sent but `meta.slt_emailed: true` ([spec:338](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) regardless.
**Fix:** audit `slt_emailed: boolean` accurately (false if no recipients).

### WF-V2-8: Labour cost preview can silently change between form load and submit
Acknowledged in v2 ([spec:275](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) but no visible warning to the user if the rate changed.
**Fix:** if `labour_rate_gbp_at_submit` differs from the rate loaded on form open (client sends both), surface a banner: "Labour rate has been updated. New cost: £X.XX".

### WF-V2-9: Venue category change out of matching filter leaves stale children
Spec only handles category change *into* a filter ([spec:815](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). A pub→cafe change leaves pub-only children blocking the master.
**Fix:** when category changes out of a filter, either mark the matching cascade children as `not_required` (so the master can still complete) or document that this requires manual cleanup.

### WF-V2-10: `file-type` null result not defined
If the library can't identify the uploaded bytes, what happens? Spec doesn't say.
**Fix:** null from `file-type` → mark as `failed`. Log the reason.

### WF-V2-11: Direct task metadata updates bypass cascade reopen
The trigger fires `AFTER UPDATE OF status` ([spec:772](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). A metadata update that rewrites `completed_at` without changing status is not caught.
**Fix:** document this as an intentional limit; or broaden the trigger to also fire on `completed_at` changes with an internal reconciliation.

## Security Risks (v2, new)

### SR-V2-1: Executive role sees all attachments
RLS short-circuits on `role in ('administrator', 'executive')`. Attachments may contain sensitive operational or personal data not comparable to event metadata.
**Fix:** explicitly classify what can/cannot be attached. Either remove `executive` from the short-circuit (force same venue-scoped logic as office workers) or document the policy.

### SR-V2-2: Confirm/URL-signing actions need explicit service-role client
v2 describes the actions but doesn't say they use the admin/service-role Supabase client ([spec:1061-1080](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). The bucket SELECT is blocked for authenticated users, so the cookie client would fail.
**Fix:** state explicitly: `getSupabaseAdmin()` is used inside these actions after user authorisation. Match the event-image upload pattern at [src/actions/events.ts:453](../../src/actions/events.ts).

### SR-V2-3: Future `business_settings` columns could leak
Read policy is `select to authenticated using (true)`. If a future setting is sensitive, it becomes visible to all authenticated users.
**Fix:** add a `column visibility gate` — specifically, future sensitive columns must add a `sensitive_<name> text` accessor pattern or be split into a separate `private_business_settings` table. Document the rule.

### SR-V2-4: Attachment original_filename unvalidated in DB
Column is `text` with no length/content constraint ([spec:907](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). Validation is application-only.
**Fix:** `CHECK (char_length(original_filename) BETWEEN 1 AND 180 AND original_filename !~ '[/\\x00\\n\\r]')`.

## Recommended fix order (to reach v3)

1. **CR-V2-1** (SOP migration default fix) — one-line change.
2. **CR-V2-2** (transition trigger allows creator → draft).
3. **CR-V2-7** (drop the `storage.objects` policy).
4. **CR-V2-3 + CR-V2-4** (cascade guard + trigger + audit in a single pass). This is the trickiest — pick the session-local flag pattern or the `auth.role()` bypass, apply consistently.
5. **CR-V2-5** (SOP RPC contract: v2 function, return shape, idempotency).
6. **CR-V2-6** (attachment INSERT RLS per-parent policy).
7. **SD-V2-1 through SD-V2-10** (consistency defects — 10 minor edits).
8. **WF-V2-1 through WF-V2-11** (workflow refinements; most are 1-2 line spec additions).
9. **SR-V2-1 through SR-V2-4** (security refinements).

## Follow-up review required

After v3 is written, re-run a targeted adversarial pass — Assumption Breaker + Spec Trace Auditor only. Both run quickly and cover the remaining surface.

Once implementation starts, Mode-B reviews run per wave against actual code.
