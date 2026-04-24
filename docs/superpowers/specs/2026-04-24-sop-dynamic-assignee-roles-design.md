# SOP Dynamic Assignee Roles

**Date:** 2026-04-24
**Complexity:** M (3) — 5-6 files, RPC rewrite, picker UI change
**Reviewed:** Code review feedback applied — 5 P1 issues and 5 minor issues corrected.

## Purpose

Allow SOP task templates to be assigned to dynamic roles ("Manager Responsible", "Event Creator") alongside specific people. When a checklist is generated for an event, the dynamic roles resolve to the actual person in that role for that event.

## How It Works

Two reserved UUID values (sentinels) represent dynamic roles:

| Sentinel | Label | Resolves to |
|----------|-------|-------------|
| `00000000-0000-0000-0000-000000000001` | Manager Responsible | `events.manager_responsible_id` |
| `00000000-0000-0000-0000-000000000002` | Event Creator | `events.created_by` (fetched from the event row, NOT `p_created_by` which is the calling user) |

These are stored in the existing `default_assignee_ids uuid[]` array on `sop_task_templates` and `sop_sections`, just like real user IDs. No schema changes needed.

### Assignment modes for a template task

1. **Specific people** — pick Harry, Georgia, etc. from the list
2. **Dynamic role** — pick "Manager Responsible" or "Event Creator" from the list
3. **Mixed** — pick a dynamic role and specific people together (e.g. "Manager Responsible" + "Georgia")
4. **Blank (task level)** — inherits from the section's `default_assignee_ids` (existing behaviour)
5. **Blank (both task and section)** — nobody assigned

## Picker UI

In `src/components/settings/sop-template-editor.tsx`:

- **Both** the section-level and task-level `MultiSelect` components add the two sentinel options at the top of the options list, above a visual divider
- Labels: "Manager Responsible" and "Event Creator"
- They behave exactly like people — click to toggle, shown as selected chips
- They can be selected alongside real people
- The sentinel UUIDs are stored in `default_assignee_ids` just like any user ID
- **Read-only display:** When displaying selected assignees (e.g. chips or labels), sentinel IDs must be resolved to their label ("Manager Responsible") rather than showing "Unknown". Use the `DYNAMIC_ROLE_LABELS` map for lookup before falling back to the user list.

**Validation:** Server actions (`updateSopTaskTemplateAction`, `updateSopSectionAction`) currently validate assignee IDs with `z.string().min(1)`. Update the Zod schema to accept either a valid user UUID or one of the two sentinel values.

## Generation RPC

The current `generate_sop_checklist_v2` (as replaced by `20260418160000_sop_v3_uses_item_venues.sql`) has schema mismatches — it references `t.default_assignee_id` (singular), `t.section_label`, `t.section_sort_order`, and `t.archived_at` which don't match the actual `sop_task_templates` columns (`default_assignee_ids` plural, `section_id`, etc.). The new migration must fix these while adding sentinel resolution.

### Sentinel resolution logic

When resolving assignees for a task:

1. Start with the candidate array (`default_assignee_ids` from task, or from section if task array is empty)
2. For each ID, check if it's a sentinel:
   - `00000000-0000-0000-0000-000000000001` → replace with the event's `manager_responsible_id`
   - `00000000-0000-0000-0000-000000000002` → replace with the event's `created_by`
3. Fetch both event fields from the event row via `planning_items.event_id` join (NOT from `p_created_by` which is the calling user):
   ```sql
   SELECT e.manager_responsible_id, e.created_by
   INTO v_event_manager, v_event_creator
   FROM planning_items pi
   JOIN events e ON e.id = pi.event_id
   WHERE pi.id = p_planning_item_id;
   ```
4. If `event_id` is null (planning item not linked to an event), both fields are null — sentinels are skipped
5. If the resolved field is null (e.g. no manager set), skip that sentinel
6. Remove duplicates while preserving input order (important: first valid ID becomes `planning_tasks.assignee_id`)
7. Continue with the normal flow: filter deactivated users, insert into `planning_task_assignees`, set `assignee_id` to first valid

### Deduplication order

After sentinel resolution, the array may contain duplicates (e.g. template has `[ROLE_MANAGER_RESPONSIBLE, "user-1"]` and the manager IS user-1). Deduplicate preserving the original input order, so the first occurrence determines position. This matters because position [0] becomes the primary `assignee_id`.

## Propagation Interaction

The `propagate_sop_template_assignees` RPC runs when template assignees change in settings. It updates tasks across all events — it doesn't have a single event context.

**Problem:** The current propagation deletes all `planning_task_assignees` rows for affected tasks and re-inserts from the new array. Simply filtering out sentinels would remove the previously resolved dynamic assignees, not preserve them.

**Solution:** The propagation RPC must:

1. Filter sentinel IDs out of `p_new_assignee_ids` to get the "static" assignee list
2. For each affected task, resolve sentinels per-task by looking up the task's event context (via `planning_tasks → planning_items → events`)
3. Merge: static assignees from the template + resolved sentinels from that task's event = the complete new assignee set
4. Update `assignee_id` to the first valid user from the merged set
5. Delete/re-insert `planning_task_assignees` with the merged set

This means if a template changes from `["Manager Responsible", "Georgia"]` to `["Manager Responsible", "Harry"]`:
- "Georgia" is replaced by "Harry" across all tasks
- "Manager Responsible" re-resolves to the current `manager_responsible_id` for each task's event (which may differ per event)

If a template changes from `["Georgia"]` to `["Manager Responsible", "Georgia"]`:
- Georgia stays
- Manager Responsible is resolved per-task and added

## Constants

Defined in `src/lib/planning/constants.ts`:

```typescript
export const ROLE_MANAGER_RESPONSIBLE = "00000000-0000-0000-0000-000000000001";
export const ROLE_EVENT_CREATOR = "00000000-0000-0000-0000-000000000002";

export const DYNAMIC_ROLE_LABELS: Record<string, string> = {
  [ROLE_MANAGER_RESPONSIBLE]: "Manager Responsible",
  [ROLE_EVENT_CREATOR]: "Event Creator",
};

export function isDynamicRole(id: string): boolean {
  return id === ROLE_MANAGER_RESPONSIBLE || id === ROLE_EVENT_CREATOR;
}
```

Same sentinel values defined as SQL constants in the RPC migrations.

## File Changes

| Action | File | Description |
|--------|------|-------------|
| Create | `src/lib/planning/constants.ts` | Sentinel UUID constants + helpers |
| Edit | `src/components/settings/sop-template-editor.tsx` | Add dynamic role options to both section and task assignee pickers, handle sentinel display labels |
| Edit | `src/actions/sop.ts` | Update Zod validation to accept sentinel UUIDs alongside real user IDs |
| Create | `supabase/migrations/YYYYMMDD_sop_dynamic_assignee_resolution.sql` | Replace `generate_sop_checklist_v2` — fix schema mismatches from v3 migration + add sentinel resolution |
| Create | `supabase/migrations/YYYYMMDD_propagation_resolve_sentinels.sql` | Replace `propagate_sop_template_assignees` — resolve sentinels per-task via event context |
| Create | `src/lib/__tests__/sop-dynamic-assignees.test.ts` | Unit tests for TypeScript helpers and action validation |

## Testing Strategy

### Unit tests (TypeScript)
- **`isDynamicRole` helper:** Correctly identifies sentinels vs real UUIDs
- **Picker renders sentinel options:** Both section and task pickers show "Manager Responsible" and "Event Creator"
- **Sentinel labels in read-only display:** Sentinel IDs render as labels, not "Unknown"
- **Validation accepts sentinels:** Zod schema passes for sentinel UUIDs
- **Validation rejects garbage:** Random strings still rejected

### RPC tests (SQL-level — run against test database or via integration tests)
- **Sentinel resolves to event manager:** Template has `[ROLE_MANAGER_RESPONSIBLE]`, event has `manager_responsible_id = "user-1"` → task assigned to "user-1"
- **Sentinel resolves to event creator:** Template has `[ROLE_EVENT_CREATOR]`, event has `created_by = "user-2"` → task assigned to "user-2"
- **Sentinel with null event field:** Event has `manager_responsible_id = null` → sentinel skipped, task unassigned
- **Non-event planning item:** Planning item has no `event_id` → sentinels skipped
- **Mixed sentinels and people:** Template has `[ROLE_MANAGER_RESPONSIBLE, "user-2"]` → both resolved
- **Deduplication preserves order:** Template has `[ROLE_MANAGER_RESPONSIBLE, "user-1"]` where manager IS user-1 → deduplicated to one assignee, order preserved
- **Propagation resolves per-task:** Template change propagates, resolving sentinels against each task's own event
- **Propagation with sentinel-only template:** Template has only `[ROLE_MANAGER_RESPONSIBLE]` → propagation resolves per-task, different events get different assignees

## Out of Scope

- Adding more dynamic roles beyond these two
- Resolving dynamic roles retroactively on existing tasks (only at generation and propagation time)
- Changing how per-venue cascade children are assigned (they still use `venues.default_manager_responsible_id`)
