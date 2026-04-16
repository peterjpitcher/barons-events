# Manager Responsible User Picker & Debrief Assignment

**Date:** 2026-04-16
**Status:** Approved
**Scope:** Convert `manager_responsible` from free text to user FK, update debrief permissions and dashboard todo scoping

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

No data migration needed — both columns have no values in production.

The migration must also check for and update any functions, triggers, or RLS policies that reference the old column names.

## Event Form Change

In `src/components/events/event-form.tsx`:
- Replace the free text `<Input>` for manager responsible (currently at lines 781-799) with a `<Select>` user picker
- Populate from the list of active users (same source as assignee picker or task assignees)
- When a venue is selected, auto-fill `managerResponsibleId` from `venue.default_manager_responsible_id` (instead of the old text field)
- The picker allows clearing (field is nullable)
- Display user's full name in the picker options

## Venue Settings Change

In `src/components/venues/venues-manager.tsx`:
- Replace the text input for default manager with a user picker `<Select>`
- Populate from active users
- This value auto-fills new events created at the venue

## Debrief Permission Logic

Updated rule in both `src/app/debriefs/[eventId]/page.tsx` (page access) and `src/actions/debriefs.ts` (server action):

A user can submit a debrief if:
1. They are an administrator, OR
2. `event.manager_responsible_id` is set AND equals `user.id`, OR
3. `event.manager_responsible_id` is null AND `event.created_by === user.id`

This preserves backwards compatibility: events without a manager responsible fall back to creator-based permission.

## Dashboard Todo Scoping

In `src/lib/dashboard.ts`, update `fetchDebriefTodos` to scope debrief items:
- If event has `manager_responsible_id` set → show on that user's dashboard only
- If `manager_responsible_id` is null → fall back to `created_by`

Same logic for `getDebriefsDue` (the context card query).

The SQL filter changes from:
```sql
or(created_by.eq.{userId},assignee_id.eq.{userId})
```
To:
```sql
or(manager_responsible_id.eq.{userId},and(manager_responsible_id.is.null,created_by.eq.{userId}))
```

## Event Detail Display

In `src/app/events/[eventId]/page.tsx` (or `event-detail-summary.tsx`), display the manager responsible name in the event summary section. Currently this field is not shown anywhere after being set.

## Files Modified

| File | Change |
|------|--------|
| New migration in `supabase/migrations/` | Drop text columns, add UUID FK columns |
| `src/components/events/event-form.tsx` | Replace text input with user picker, update venue-default auto-fill |
| `src/components/venues/venues-manager.tsx` | Replace text input with user picker |
| `src/actions/events.ts` | Save `manager_responsible_id` instead of `manager_responsible` |
| `src/actions/debriefs.ts` | Update permission check: manager_responsible_id with creator fallback |
| `src/app/debriefs/[eventId]/page.tsx` | Update access check to match new permission rule |
| `src/app/events/[eventId]/page.tsx` | Display manager responsible name |
| `src/lib/dashboard.ts` | Update `fetchDebriefTodos` and `getDebriefsDue` scoping |
| `src/lib/events.ts` | Update event upsert/queries to handle new FK |
| `src/lib/venues.ts` | Update venue types/queries for new FK |
| `src/lib/supabase/types.ts` | Update generated types |
| `src/lib/validation.ts` | Update Zod schemas if manager_responsible is validated |

## Out of Scope

- Migrating historical text values (none exist)
- Changing the `assignee_id` field on events (separate concern)
- Notification to the manager responsible when assigned
