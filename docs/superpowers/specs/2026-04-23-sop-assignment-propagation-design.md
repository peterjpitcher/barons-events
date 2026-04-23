# SOP Assignment Propagation

**Date:** 2026-04-23
**Complexity:** S (2) — 4-5 files, one additive column, established patterns

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
- Delete and re-insert `planning_task_assignees` rows for multi-assignee sync

**Section level:** When `updateSopSectionAction` saves a section with changed `default_assignee_ids`:
- Find all `sop_task_templates` in that section where `default_assignee_ids` is empty (these inherit from the section)
- For each inherited template, run the same propagation logic above using the section's new assignee IDs

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

### Edge Cases

- **Empty `default_assignee_ids`:** `assignee_id` becomes `null`, `planning_task_assignees` rows cleared. Task drops out of the weekly digest (correct — no assignee, no notification).
- **Deactivated users in the array:** Filter out deactivated users before resolving `assignee_id`, consistent with the generation RPC behaviour.
- **No matching open tasks:** Propagation is a no-op. Audit entry still logged with `tasks_updated: 0`.
- **Cascade children:** Always skipped (`parent_task_id IS NOT NULL`). Their assignee comes from `venues.default_manager_responsible_id`.
- **Weekly digest impact:** Propagation changes `assignee_id`, which redirects digest emails to the new assignee. This is the desired behaviour — the digest follows the assignment.

### Timing

Synchronous — propagation runs inline in the same server action as the template save. Users see updated assignments immediately after page refresh. Bulk UPDATE is fast enough at current volumes (dozens to low hundreds of matching tasks per template).

### Audit Logging

One summary entry per propagation, not per affected task:
- **Task-template level:** `sop_task_template.assignees_propagated` with `meta: { template_id, old_assignee_ids, new_assignee_ids, tasks_updated }`
- **Section level:** `sop_section.assignees_propagated` with `meta: { section_id, old_assignee_ids, new_assignee_ids, inherited_template_count, tasks_updated }`

## Architecture

### Propagation Function

Extract the propagation logic into a shared helper (e.g. in `src/lib/planning/sop.ts` or inline in `src/actions/sop.ts`):

```typescript
async function propagateTemplateAssignees(
  db: SupabaseClient,
  templateId: string,
  newAssigneeIds: string[]
): Promise<number>
```

Steps:
1. Filter `newAssigneeIds` against active users (query `users` where `id IN (newAssigneeIds)` and `deactivated_at IS NULL`)
2. Determine primary assignee: first valid user, or `null` if none
3. Update `planning_tasks`: `SET assignee_id = $primary WHERE sop_template_task_id = $templateId AND status = 'open' AND manually_assigned = false AND parent_task_id IS NULL`
4. For each affected task: delete from `planning_task_assignees`, re-insert one row per valid assignee
5. Return count of updated tasks

Called from:
- `updateSopTaskTemplateAction` — directly with the template's new `default_assignee_ids`
- `updateSopSectionAction` — for each inherited template in the section, with the section's new `default_assignee_ids`

### Assignee Change Detection

Only run propagation when `default_assignee_ids` actually changed. Compare the old and new arrays before propagating. If unchanged, skip propagation entirely (no audit log either).

## File Changes

| Action | File | Description |
|--------|------|-------------|
| Create | `supabase/migrations/YYYYMMDD_add_manually_assigned.sql` | Add `manually_assigned boolean NOT NULL DEFAULT false` to `planning_tasks`. Also add `sop_task_template.assignees_propagated` and `sop_section.assignees_propagated` to audit_log action CHECK. |
| Edit | `src/actions/planning.ts` | Set `manually_assigned = true` in `reassignPlanningTaskAction` |
| Edit | `src/actions/sop.ts` | Add propagation logic to `updateSopTaskTemplateAction` and `updateSopSectionAction`, with audit logging |
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
- **Empty assignee array:** Template set to `[]` → `assignee_id` becomes null, `planning_task_assignees` cleared
- **Deactivated users filtered:** Deactivated user in array → skipped, next valid user becomes primary
- **Manual reassignment sets flag:** `reassignPlanningTaskAction` → `manually_assigned = true`
- **No change detection:** Template saved with same assignees → no propagation, no audit log
- **Audit logging:** Propagation logs one entry with correct meta (old/new arrays, task count)
- **planning_task_assignees sync:** Junction table rows match the new assignee array after propagation

Mock Supabase — never hit real APIs.

## Out of Scope

- UI indicator for `manually_assigned` status
- "Reset to template default" action
- Propagation for cascade children (they use venue default manager)
- Batch/async propagation (not needed at current scale)
