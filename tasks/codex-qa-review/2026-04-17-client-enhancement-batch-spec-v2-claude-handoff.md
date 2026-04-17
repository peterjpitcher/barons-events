# Claude Hand-Off Brief v2: Client Enhancement Batch Spec

**Generated:** 2026-04-17
**Review mode:** A — adversarial re-review (spec v2, pre-implementation)
**Overall risk assessment:** **Medium** — down from High in v1. All architectural choices settled. Seven new blockers from v2's revisions + four non-blocking security refinements remain, all editable at the spec level.

## DO NOT REWRITE

v2 got these right. Do not touch them in v3:

- `upload_status` + `uploaded_at` + `failed` lifecycle for attachments.
- Heather Farm Cafe exact-name update.
- Proof-read menus deterministic UUID + `ON CONFLICT (id)` + Food Development label.
- `business_settings` singleton (`id boolean PK DEFAULT true CHECK (id = true)`).
- Cascade parent-row lock (`SELECT ... FOR UPDATE`).
- Cascade reopen branch for `done|not_required → open`.
- Labour validation range (Zod max 2000, `numeric(6,2)`).
- FK-based attachments with exactly-one CHECK.
- SOP template absorption of cascade (expansion_strategy + venue_filter columns).
- Public API filter to `approved | completed`.
- Three architectural decisions as applied.

## SPEC REVISION REQUIRED (v3)

Seven blocking revisions. Do them in this order.

- [ ] **SPEC-CRV2-1 — SOP migration default fix.** Change `venue_filter` default from `'pub'` to `NULL`. The coherency CHECK already requires `venue_filter IS NULL` for `single` rows — the default contradicts it. One-line fix in Wave 5.1.

- [ ] **SPEC-CRV2-2 — Event status trigger allows venue-manager completion path.** Rewrite the trigger body in Wave 4.2 to permit `approved_pending_details → draft` for the creator or a venue-scoped office worker when `event_type`, `venue_space`, `end_at` are all non-null. Keep admin-only for the other transitions. Rough shape:
  ```sql
  if old.status = 'approved_pending_details' and new.status = 'draft' then
    if public.current_user_role() = 'administrator' then return new; end if;
    -- Allow creator or venue office worker to complete the form.
    if (new.event_type is not null and new.venue_space is not null and new.end_at is not null) then
      if new.created_by = auth.uid() then return new; end if;
      if public.current_user_role() = 'office_worker' and exists (
        select 1 from users u where u.id = auth.uid() and u.deactivated_at is null
          and (u.venue_id is null or u.venue_id = new.venue_id)
      ) then return new; end if;
    end if;
    raise exception 'Cannot complete pre-approved event without full details or without permission';
  end if;
  ```

- [ ] **SPEC-CRV2-3 — Drop the `storage.objects` over-grant.** Remove the `task_attachments_storage_no_user_select` policy from Wave 6.3 entirely. Rationale: the absence of a permissive SELECT policy on `storage.objects` for authenticated users means SELECT is denied by default. Adding `using (bucket_id != 'task-attachments')` instead creates a permissive grant for every other bucket, which is not what we want. The existing bucket-scoped policies for `event-images` already handle that bucket.

- [ ] **SPEC-CRV2-4 — Cascade guard + trigger interaction fix.** Pick the session-local flag pattern and apply it:
  1. Add a helper function `public.cascade_internal_bypass()` that returns true when `current_setting('app.cascade_internal', true) = 'on'`.
  2. The guard trigger becomes:
     ```sql
     if public.cascade_internal_bypass() or public.current_user_role() = 'administrator' then
       return new;
     end if;
     -- then the existing checks
     ```
  3. Inside the `cascade_parent_sync` trigger body, set the flag before the UPDATE:
     ```sql
     perform set_config('app.cascade_internal', 'on', true);  -- local to transaction
     update planning_tasks set ... where id = v_parent_id;
     -- flag auto-clears at end of transaction
     ```
  4. Inside the SOP RPC (which will be `v2`), set the same flag before inserting cascade children.

  This avoids the `auth.role() = 'service_role'` check, which some triggers cannot see reliably. Document the pattern as a workspace convention.

- [ ] **SPEC-CRV2-5 — Cascade trigger inserts audit rows.** Add to the trigger body:
  ```sql
  -- after the auto-complete UPDATE
  insert into audit_log (entity, entity_id, action, meta, actor_id)
  values ('planning_task', v_parent_id, 'planning_task.cascade_autocompleted',
          jsonb_build_object('via', 'cascade_trigger', 'triggered_by_child', new.id), null);

  -- after the reopen UPDATE
  insert into audit_log (entity, entity_id, action, meta, actor_id)
  values ('planning_task', v_parent_id, 'planning_task.cascade_reopened',
          jsonb_build_object('via', 'cascade_trigger', 'triggered_by_child', new.id), null);
  ```
  And pick one prefix convention: use `planning_task.cascade_*` everywhere (drop the unprefixed form in Wave 5 acceptance criteria).

- [ ] **SPEC-CRV2-6 — SOP generation RPC contract rewrite.** Two options:
  - **Preferred:** introduce `public.generate_sop_checklist_v2(planning_item_id uuid) returns jsonb` returning `{created: int, skipped_venues: [...], masters_created: [...], children_created: [...]}`. Keep `generate_sop_checklist` stable; all new callers use v2. Document in Wave 5.2.
  - **Alternative:** change the existing return to `jsonb` and update every caller in the same PR. The existing callers and tests are listed in the handoff brief reference. More disruptive but fewer moving parts.
  Either way, spell out the idempotency contract: unique index on `(planning_item_id, sop_template_task_id)` for single + master tasks, plus the existing `(parent_task_id, cascade_venue_id)` partial unique for children.

- [ ] **SPEC-CRV2-7 — Attachment INSERT RLS per-parent check.** Rewrite the `attachments_insert` policy to validate parent edit permission per FK branch. Force `upload_status = 'pending'` on insert. See the example shape in the full adversarial review. Attachment UPDATE also needs per-FK logic (currently admin-only, but the server action flips `upload_status` and sets `uploaded_at` on confirm — needs a separate policy for that narrow transition, owned by service-role or guarded by a CHECK).

Non-blocking spec defects to fix in the same revision:

- [ ] **SPEC-SDV2-1** — Wave 2.1 audit migration: enumerate every existing `action` value from the repo (grep `recordAuditLogEntry` + `logAuthEvent`), not just additions.
- [ ] **SPEC-SDV2-2** — Wave ordering: rename Wave 2.1 to "Wave 0: Audit prerequisite" OR state explicitly at the top of Wave 1 that the audit migration ships first. Update the dependency diagram.
- [ ] **SPEC-SDV2-3** — `/admin/sop` → `/settings` (the actual route; or add a new route explicitly to Wave 5 scope).
- [ ] **SPEC-SDV2-4** — Add the Wave 3 → Wave 5 dependency edge (venue category).
- [ ] **SPEC-SDV2-5** — Event attachment roll-up: include direct planning-item attachments in the union.
- [ ] **SPEC-SDV2-6** — Cascade audit action names: pick `planning_task.cascade_*` and apply everywhere.
- [ ] **SPEC-SDV2-7** — Specify `create_multi_venue_event_drafts` RPC: payload shape, return shape, security grants, audit ownership.
- [ ] **SPEC-SDV2-8** — SECURITY DEFINER hardening: for every new function, add `ALTER FUNCTION ... SET search_path = pg_catalog, public; REVOKE EXECUTE FROM public; GRANT EXECUTE TO service_role;` (match the existing pattern in `20260410120000_harden_security_definer_rpcs.sql`).
- [ ] **SPEC-SDV2-9** — Rollback plan: add rows for `venues.category`, `sop_task_templates.expansion_strategy`/`venue_filter`, audit CHECK expansion.
- [ ] **SPEC-SDV2-10** — Flat-task-to-tree sweep: add `src/lib/dashboard.ts:115` and `src/app/events/[eventId]/page.tsx:124`.

Workflow refinements (each 1-2 spec lines):

- [ ] **SPEC-WFV2-1** — Multi-venue RPC: add `idempotency_key uuid` argument + batch row for retry safety.
- [ ] **SPEC-WFV2-2** — `pending_cascade_backfill`: add `attempt_count`, `last_attempt_at`, `locked_at`, `locked_by`, `next_attempt_at`. Use `FOR UPDATE SKIP LOCKED` in the cron. Dead-letter after 5 failed attempts.
- [ ] **SPEC-WFV2-3** — Attachment confirm: document transient (keep `pending`, retry) vs terminal (`failed`) failure states.
- [ ] **SPEC-WFV2-4** — Attachment cleanup cron: also sweep `upload_status = 'failed' AND created_at < now() - interval '24 hours'`.
- [ ] **SPEC-WFV2-5** — `approved_pending_details` reaper: auto-revert to `rejected` with reason "proposal not completed within N days" after N days, OR an admin-visible stale-approval filter. Pick N (recommend 14 days).
- [ ] **SPEC-WFV2-6** — SLT BCC: require `SLT_FROM_ALIAS` env var OR send one email per recipient when absent. Document in Wave 1.5.
- [ ] **SPEC-WFV2-7** — Empty SLT audit: `slt_emailed: false` when no recipients.
- [ ] **SPEC-WFV2-8** — Labour cost preview vs submit drift: if client-submitted rate differs from server-snapshot rate, show a banner to the user.
- [ ] **SPEC-WFV2-9** — Venue category change out of a filter: mark matching cascade children as `not_required`. Document the behaviour in Wave 5.
- [ ] **SPEC-WFV2-10** — `file-type` null result: mark upload `failed`.
- [ ] **SPEC-WFV2-11** — Document that direct metadata-only updates to `completed_at` do not trigger cascade reopen (or broaden the trigger).

Security refinements:

- [ ] **SPEC-SRV2-1** — Executive role on attachments: either remove executive from the short-circuit (venue-scoped like office workers) or explicitly classify what can be attached.
- [ ] **SPEC-SRV2-2** — Explicitly state that `confirmAttachmentUploadAction`, `getAttachmentUrlAction`, `deleteAttachmentAction` use the service-role Supabase client after authorising the user.
- [ ] **SPEC-SRV2-3** — `business_settings` future-sensitive columns: document the rule (future sensitive columns go in a separate `private_business_settings` table with admin-only SELECT).
- [ ] **SPEC-SRV2-4** — Add DB-level CHECK on `attachments.original_filename` length/content.

## ASSUMPTIONS TO RESOLVE

All resolved through v2; no new client questions. One open policy question worth confirming:

- [ ] **Labour rate change during open debrief form** — should the user see a banner if the rate changed between form load and submit? v2 accepts silent change; WFV2-8 proposes a banner. Recommend: show the banner.

## REPO CONVENTIONS TO PRESERVE (unchanged from v1 handoff)

- `recordAuditLogEntry` for app mutations; `logAuthEvent` for auth.
- FormData server action shape.
- `getCurrentUser()` → roles.ts capability helper → venue scoping for office workers.
- `revalidatePath('/route')`.
- snake_case DB / camelCase TS / `fromDb<T>()`.
- `public.current_user_role()` for RLS.
- Signed URLs via server action for private Storage.
- Hardened RPC pattern (service-role only + search_path pinning).
- Resend via `src/lib/notifications.ts` (awaited).
- E.164 via `libphonenumber-js`.
- SOP sections use `label`, seeded set includes Food Development.
- `EventStatus` union must be extended alongside the DB CHECK.

## RE-REVIEW REQUIRED AFTER V3

Run a targeted adversarial pass on v3 with **just two reviewers**:
- Assumption Breaker — verify all 7 CRs + 10 SDs + 11 WFs + 4 SRs are actually fixed, and no new issue introduced.
- Spec Trace Auditor — verify internal consistency.

If v3 review returns clean (or with only advisory findings), unblock implementation. Waves 1, 2, 3 can start immediately.

## REVISION PROMPT

You are revising the Client Enhancement Batch spec (v2 → v3) based on a second adversarial review. The architectural decisions are settled — do NOT reopen: SOP absorbs cascade, `business_settings` typed singleton, three nullable FKs on attachments. Do NOT touch anything on the "DO NOT REWRITE" list.

Apply in order:

1. **One-line migration fix**: `sop_task_templates.venue_filter` default from `'pub'` to `NULL`.
2. **Event status transition trigger**: permit `approved_pending_details → draft` for the creator or venue-scoped office worker when fields are present.
3. **Drop the `storage.objects` over-grant policy** from Wave 6.3. Rely on default-deny.
4. **Cascade guard + parent-sync + SOP RPC reconciliation**: adopt the session-local flag pattern (`set_config('app.cascade_internal', 'on', true)`). Document it as a workspace convention.
5. **Cascade trigger audit inserts**: add `insert into audit_log ...` in both the auto-complete and reopen branches.
6. **SOP generation RPC**: introduce `generate_sop_checklist_v2(planning_item_id uuid) returns jsonb` with explicit return shape. Keep v1 stable.
7. **Attachment INSERT RLS**: per-FK parent edit permission check; force `upload_status = 'pending'` on insert.
8. **Wave 2.1 audit migration**: enumerate every existing action value.
9. **Wave ordering**: rename Wave 2.1 → Wave 0, OR state audit migration runs first.
10. **`/admin/sop` → `/settings`** correction.
11. **Wave 3 → Wave 5 dependency** edge added to the diagram.
12. **Event roll-up query**: include planning_item attachments.
13. **Cascade audit action naming**: use `planning_task.cascade_*` throughout.
14. **SECURITY DEFINER hardening**: add `search_path` pinning and `GRANT EXECUTE TO service_role` for every new function.
15. **Rollback plan**: add `venues.category`, `sop_task_templates.expansion_*`, audit CHECK extension rows.
16. **Cascade projection sweep**: add `src/lib/dashboard.ts` and event-detail page.
17. **Multi-venue RPC**: add `idempotency_key` argument + batch row.
18. **Backfill queue**: add retry/lock/dead-letter columns. Use `FOR UPDATE SKIP LOCKED`.
19. **Attachment failure state cleanup**: sweep failed rows after 24 hours.
20. **`approved_pending_details` reaper**: auto-revert after 14 days OR admin-visible filter.
21. **SLT BCC alias**: require env var or single-recipient per email.
22. **Empty SLT audit meta**: `slt_emailed: false`.
23. **Labour cost drift banner**: show if rate changed between load and submit.
24. **Venue category change out of filter**: cascade children marked `not_required`.
25. **`file-type` null**: mark as `failed`.
26. **Executive on attachments**: either remove short-circuit or document scope.
27. **Confirm/URL/delete actions**: state use of service-role client.
28. **`business_settings` sensitive-column rule**: document.
29. **`attachments.original_filename` DB CHECK**.

After v3 is written, confirm:
- [ ] All 7 blocking CR-V2 revisions applied.
- [ ] All 10 SD-V2 fixes applied.
- [ ] All 11 WF-V2 refinements applied.
- [ ] All 4 SR-V2 refinements applied.
- [ ] No item from the "DO NOT REWRITE" list was touched.
- [ ] Architectural decisions are unchanged.

Then run a targeted two-reviewer pass (Assumption Breaker + Spec Trace Auditor). If clean, unblock implementation.
