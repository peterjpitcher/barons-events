# SOP Assignment Propagation

**Date:** 2026-04-23
**Complexity:** S (2) — 5-6 files, one additive column, established patterns
**Reviewed:** Codex adversarial review 2026-04-23 (3 reviewers, 4 spec revisions applied)

## Purpose

When SOP template assignments (`default_assignee_ids`) change in settings, propagate the new assignments to all matching open planning tasks that haven't been manually reassigned. This keeps the SOP settings as the source of truth for auto-assigned work.

## Requirements

### Propagation Scope

**Task-template level:** When `updateSopTaskTemplateAction` saves a template with changed `default_assignee_ids`:
- Find all `planning_tasks` where `sop_template_task_id` matches the template
- Filter to `status = 'open'` only (never touch completed tasks)
- Filter to `manually_assigned = false` (respect intentional manual overrides)
- Filter to `parent_task_id IS NULL` (skip cascade children — their assignee comes from `venues.default_manager_responsible_id`, not template defaults)
- Update `assignee_id` to the first valid (non-deactivated) user in the new array
- Sync `planning_task_assignees` rows atomically (see Architecture)

**Section level:** When `updateSopSectionAction` saves a section with changed `default_assignee_ids`:
- Find all `sop_task_templates` in that section where `default_assignee_ids` is empty (these inherit from the section)
- For each inherited template, run the same propagation logic above using the section's new assignee IDs
- Re-check template inheritance at propagation time (not from a prior SELECT) to avoid races with concurrent template edits

**Template `[]` vs section inheritance:** Section inheritance only applies at **generation time** (when the SOP checklist is first created). During propagation, the template's array is used directly. If a template is cleared to `[]`, propagation sets `assignee_id = null` and clears `planning_task_assignees` — it does not fall back to section defaults.

### The `manually_assigned` Flag

A new boolean column on `planning_tasks`:
- `false` (default): task was auto-assigned by SOP generation or propagation — eligible for future propagation
- `true`: a user explicitly changed the assignment — protected from propagation

**Set to `true` by:**
- `reassignPlanningTaskAction` — the existing manual reassignment action
- Any future assignment pathway that isn't SOP generation or propagation

**Stays `false` when:**
- SOP checklist generation creates the task (the default)
- Propagation overwrites the assignment (still auto-assigned, just from updated template)

**No reset mechanism.** Once manually assigned, the flag stays `true`. If the user wants the template assignment, they manually reassign to the same person.

### Backfill Strategy

The migration adds `manually_assigned DEFAULT false`, which means existing manually-reassigned tasks would be unprotected. The migration must backfill:

```sql
-- Mark tasks as manually_assigned where the current assignee_id
-- does not match any of the template's default_assignee_ids
UPDATE planning_tasks pt
SET manually_assigned = true
WHERE pt.status = 'open'
  AND pt.sop_template_task_id IS NOT NULL
  AND pt.assignee_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sop_task_templates stt
    WHERE stt.id = pt.sop_template_task_id
      AND pt.assignee_id = ANY(stt.default_assignee_ids)
  );
```

This detects tasks whose current assignee differs from their template's defaults and marks them as manually assigned. Tasks that match their template (or have no template link) remain `false`.

### Edge Cases

- **Empty `default_assignee_ids` on template:** `assignee_id` becomes `null`, `planning_task_assignees` rows cleared. Task drops out of the weekly digest (correct — no assignee, no notification). Does not inherit from section.
- **Deactivated users in the array:** Filter out deactivated users before resolving `assignee_id`, consistent with the generation RPC behaviour.
- **No matching open tasks:** Propagation is a no-op. Audit entry still logged with `tasks_updated: 0`.
- **Cascade children:** Always skipped (`parent_task_id IS NOT NULL`). Their assignee comes from `venues.default_manager_responsible_id`.
- **Weekly digest impact:** Propagation changes `assignee_id`, which redirects digest emails to the new assignee. This is the desired behaviour — the digest follows the assignment.
- **Concurrent manual reassignment during propagation:** Handled by using `UPDATE...RETURNING` to capture affected task IDs atomically (see Architecture).

### Timing

Synchronous — propagation runs inline in the same server action as the template save. Users see updated assignments immediately after page refresh. Bulk UPDATE is fast enough at current volumes (dozens to low hundreds of matching tasks per template).

### Audit Logging

One summary entry per propagation, not per affected task. **Fire-and-forget** — audit failures are caught and logged to console but never thrown. A failed audit insert must not make a successful save appear to fail.

- **Task-template level:** `sop_task_template.assignees_propagated` with `meta: { template_id, old_assignee_ids, new_assignee_ids, tasks_updated }`
- **Section level:** `sop_section.assignees_propagated` with `meta: { section_id, old_assignee_ids, new_assignee_ids, inherited_template_count, tasks_updated }`

## Architecture

### Transaction Boundary

The propagation must be atomic. All writes — `planning_tasks` update, `planning_task_assignees` delete/insert — must happen within a single database transaction or Supabase RPC to prevent partial state on mid-flight failure.

**Recommended approach:** Create a Postgres RPC `propagate_sop_template_assignees(p_template_id uuid, p_new_assignee_ids uuid[])` that:
1. Filters `p_new_assignee_ids` against active users within the function
2. Updates `planning_tasks` with the guarded WHERE clause and uses `RETURNING id` to capture affected task IDs
3. Deletes `planning_task_assignees` rows for those task IDs
4. Inserts new `planning_task_assignees` rows for each valid assignee
5. Returns the count of updated tasks

This eliminates the race condition where a concurrent `reassignPlanningTaskAction` could flip `manually_assigned = true` between the task UPDATE and the junction table sync — the RPC runs as a single transaction.

### Propagation Helper (TypeScript)

Wraps the RPC call and handles change detection + audit logging:

```typescript
async function propagateTemplateAssignees(
  db: SupabaseClient,
  templateId: string,
  oldAssigneeIds: string[],
  newAssigneeIds: string[]
): Promise<number>
```

Steps:
1. Compare old and new arrays — if identical, return 0 (no propagation, no audit)
2. Call the RPC: `db.rpc("propagate_sop_template_assignees", { p_template_id: templateId, p_new_assignee_ids: newAssigneeIds })`
3. Fire-and-forget audit log entry via `recordAuditLogEntry` (wrapped in try/catch)
4. Return count of updated tasks

Called from:
- `updateSopTaskTemplateAction` — directly with the template's new `default_assignee_ids`
- `updateSopSectionAction` — for each inherited template in the section, with the section's new `default_assignee_ids`

### Assignee Change Detection

Only run propagation when `default_assignee_ids` actually changed. Both update actions must fetch the current `default_assignee_ids` before saving so they can compare old vs new. If unchanged, skip propagation entirely.

### Assignment Pathway Audit

`reassignPlanningTaskAction` is confirmed as the only manual assignment pathway in the codebase. The SOP generation RPCs (`generate_sop_checklist_v2`) set assignees at creation time — these are auto-assignments and correctly leave `manually_assigned = false`. No other code paths write to `planning_tasks.assignee_id` or `planning_task_assignees`.

## File Changes

| Action | File | Description |
|--------|------|-------------|
| Create | `supabase/migrations/YYYYMMDD_add_manually_assigned.sql` | Add `manually_assigned boolean NOT NULL DEFAULT false` to `planning_tasks`. Backfill existing manual overrides. Add `sop_task_template.assignees_propagated` and `sop_section.assignees_propagated` to audit_log action CHECK. |
| Create | `supabase/migrations/YYYYMMDD_propagate_sop_assignees_rpc.sql` | Create `propagate_sop_template_assignees` RPC (atomic transaction) |
| Edit | `src/actions/planning.ts` | Set `manually_assigned = true` in `reassignPlanningTaskAction`. Also fix the existing error-checking gap on the final `planning_tasks` update. |
| Edit | `src/actions/sop.ts` | Add propagation logic to `updateSopTaskTemplateAction` and `updateSopSectionAction`, with change detection and fire-and-forget audit logging |
| Edit | `src/lib/planning/types.ts` | Add `manuallyAssigned: boolean` to `PlanningTask` type |
| Create | `src/lib/__tests__/sop-assignment-propagation.test.ts` | Tests for propagation logic |

No UI changes — the flag is set and consumed automatically.

## Testing Strategy

- **Propagation updates auto-assigned tasks:** Template assignee change → matching open tasks get new assignee
- **Propagation skips manually-assigned tasks:** Task with `manually_assigned = true` → unchanged
- **Propagation skips cascade children:** Task with `parent_task_id IS NOT NULL` → unchanged
- **Propagation skips completed tasks:** Task with `status = 'done'` → unchanged
- **Section-level propagation:** Section assignee change → tasks from templates with empty `default_assignee_ids` updated
- **Section-level skips templates with own assignees:** Templates that have their own `default_assignee_ids` → unaffected by section change
- **Template cleared to `[]`:** Unassigns tasks, does not inherit from section
- **Deactivated users filtered:** Deactivated user in array → skipped, next valid user becomes primary
- **Manual reassignment sets flag:** `reassignPlanningTaskAction` → `manually_assigned = true`
- **No change detection:** Template saved with same assignees → no propagation, no audit log
- **Audit logging is non-fatal:** Audit insert failure → logged to console, save still succeeds
- **planning_task_assignees sync:** Junction table rows match the new assignee array after propagation
- **Backfill correctness:** Existing tasks with mismatched assignees → `manually_assigned = true` after migration
- **Atomicity:** RPC updates tasks and junction table in one transaction

Mock Supabase — never hit real APIs.

## Out of Scope

- UI indicator for `manually_assigned` status
- "Reset to template default" action
- Propagation for cascade children (they use venue default manager)
- Batch/async propagation (not needed at current scale)
