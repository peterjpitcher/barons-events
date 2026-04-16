# Manager Responsible User Picker & Debrief Assignment

**Date:** 2026-04-16
**Status:** Approved (revised after adversarial review)
**Scope:** Convert `manager_responsible` from free text to user FK, update debrief permissions, RLS, dashboard todo scoping, and user reassignment RPCs

## Overview

The `manager_responsible` field on events is currently a free text input. It should be a FK to the users table so that:
1. The event form uses a people picker instead of a text field
2. Debrief submission is assigned to the manager responsible (with creator fallback)
3. Dashboard todo items for debriefs appear on the correct person's dashboard

The venue `default_manager_responsible` field gets the same treatment — becomes a user FK that auto-fills new events.

## Schema Changes

### Events table
- Drop: `manager_responsible` (text, currently unpopulated)
- Add: `manager_responsible_id UUID REFERENCES users(id) ON DELETE SET NULL`

### Venues table
- Drop: `default_manager_responsible` (text, currently unpopulated)
- Add: `default_manager_responsible_id UUID REFERENCES users(id) ON DELETE SET NULL`

No data migration needed — both columns have no values in production (verified: 89 events, 12 venues, all null/empty).

### RLS Policy Updates (debrief insert/update)

The current debrief RLS insert policy allows office workers to insert debriefs only for events they created. This must be updated to also allow the `manager_responsible_id` user:

```sql
-- Updated debrief insert policy for office_worker
CREATE POLICY "office_worker_insert_debrief" ON debriefs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_id
      AND e.deleted_at IS NULL
      AND e.status IN ('approved', 'completed')
      AND (
        e.manager_responsible_id = (SELECT auth.uid())
        OR (e.manager_responsible_id IS NULL AND e.created_by = (SELECT auth.uid()))
      )
    )
  );
```

Same pattern for debrief update and select policies.

### Reassignment RPC Updates

The `reassign_user_content` RPC must be updated to also reassign:
- `events.manager_responsible_id` → target user
- `venues.default_manager_responsible_id` → target user

The `UserImpactSummary` in `src/actions/users.ts` must also count events where the user is `manager_responsible_id` and venues where they are `default_manager_responsible_id`.

### Migration Checklist

The migration must:
1. Drop `events.manager_responsible` text column
2. Add `events.manager_responsible_id` UUID FK
3. Drop `venues.default_manager_responsible` text column
4. Add `venues.default_manager_responsible_id` UUID FK
5. Update debrief RLS policies (insert, update, select) to include `manager_responsible_id`
6. Update `reassign_user_content` RPC to reassign both new FK columns
7. Verify no functions/triggers reference the old column names

## Event Form Change

In `src/components/events/event-form.tsx`:
- Replace the free text `<Input>` for manager responsible with a `<Select>` user picker
- **The form does not currently receive a user list as props.** Add `users: Array<{ id: string; name: string }>` to `EventFormProps`, populated from `listAssignableUsers()` on the event pages that render the form.
- When a venue is selected, auto-fill `managerResponsibleId` from `venue.default_manager_responsible_id` (instead of the old text field)
- The picker allows clearing (field is nullable) — normalize empty string to null
- Display user's full name in the picker options
- Use `managerResponsibleId` in form state and FormData, mapped to `manager_responsible_id` at action boundary

### Write Permission Restriction

**Only administrators can set `manager_responsible_id` on events they don't own.** Office workers can set it on events they created. This prevents a same-venue office worker from self-assigning as manager on someone else's event to gain debrief access. Enforce in `src/actions/events.ts` event update action: if the user is not admin and not the event creator, strip `manager_responsible_id` from the update payload.

## Venue Settings Change

In `src/components/venues/venues-manager.tsx`:
- Replace the text input for default manager with a user picker `<Select>`
- The component currently only has admin users available (via `reviewers` prop). **Pass a full active users list** instead — source from `listAssignableUsers()` or a new `listActiveUsersForPicker()` if needed.
- This value auto-fills new events created at the venue

## Debrief Permission Logic

Updated rule in both `src/app/debriefs/[eventId]/page.tsx` (page access) and `src/actions/debriefs.ts` (server action):

A user can submit a debrief if:
1. They are an administrator, OR
2. `event.manager_responsible_id` is set AND equals `user.id`, OR
3. `event.manager_responsible_id` is null AND `event.created_by === user.id`

The debrief action must fetch `manager_responsible_id` in addition to `created_by` and `status`. The post-debrief status update to `completed` must also work for the manager responsible user (currently filters by `created_by`).

## Dashboard Todo Scoping

In `src/lib/dashboard.ts`, update `fetchDebriefTodos` and `getDebriefsDue`:

```
or(manager_responsible_id.eq.{userId},and(manager_responsible_id.is.null,created_by.eq.{userId}))
```

This pattern is already used elsewhere in the codebase (e.g. `src/app/api/v1/events/route.ts` uses nested `or/and` PostgREST filters).

**Add tests** for: manager set (shows on manager's dashboard), manager null (falls back to creator), unrelated user (does not see it).

## Event Detail Display

In `src/app/events/[eventId]/page.tsx`, display the manager responsible name in the event summary. Follow the existing `getUsersByIds` resolution pattern — include `manager_responsible_id` in the collected user IDs and render the resolved name. Do NOT add a one-off users join.

## Zod Schema Update

In `src/lib/validation.ts`, update `eventDraftBaseSchema`:
- Replace `managerResponsible: z.string().max(200).optional().nullable()` with `managerResponsibleId: z.string().uuid().optional().nullable()`
- Normalize empty string to null in the action before validation

## Event Version Payload Tolerance

18 existing version rows have a blank `managerResponsible` key in their JSONB payload. Any version diff/display code must tolerate both old `managerResponsible` (text) and new `managerResponsibleId` (UUID) payloads without errors. No migration of existing payloads needed.

## Supabase Types

`src/lib/supabase/types.ts` is manually maintained. Update:
- `events` Row: remove `manager_responsible: string | null`, add `manager_responsible_id: string | null`
- `venues` Row: remove `default_manager_responsible: string | null`, add `default_manager_responsible_id: string | null`

## Files Modified

| File | Change |
|------|--------|
| New migration in `supabase/migrations/` | Drop text columns, add UUID FK columns, update debrief RLS, update reassignment RPC |
| `src/components/events/event-form.tsx` | Add users prop, replace text input with user picker, update venue-default auto-fill |
| `src/components/venues/venues-manager.tsx` | Replace text input with user picker, wire full user list |
| `src/actions/events.ts` | Save `manager_responsible_id`, restrict write permission for non-owners |
| `src/actions/debriefs.ts` | Update permission check and status update to use manager_responsible_id |
| `src/actions/users.ts` | Update `UserImpactSummary` to count manager_responsible_id references |
| `src/app/debriefs/[eventId]/page.tsx` | Update access check to match new permission rule |
| `src/app/events/[eventId]/page.tsx` | Display manager responsible name, pass users to EventForm |
| `src/app/events/new/page.tsx` | Pass users to EventForm |
| `src/lib/dashboard.ts` | Update `fetchDebriefTodos` and `getDebriefsDue` scoping |
| `src/lib/events.ts` | Update event upsert/queries to handle new FK |
| `src/lib/venues.ts` | Update venue types/queries for new FK |
| `src/lib/supabase/types.ts` | Manually update Row types |
| `src/lib/validation.ts` | Update Zod schemas to UUID |

## Out of Scope

- Migrating historical text values (none exist)
- Migrating event_versions JSONB payloads (tolerate both formats)
- Changing the `assignee_id` field on events (separate concern)
- Notification to the manager responsible when assigned
- Public API exposure of manager_responsible_id (intentionally excluded)
