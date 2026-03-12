# Revert to Draft — Design Spec

**Date:** 2026-03-12
**Status:** Approved
**Complexity:** S (2) — 3 files touched, no schema changes

---

## Problem

There is no way to revert an approved event back to draft from the event detail page. Planners need this escape hatch when an approved event needs to be pulled back for rework before it goes live.

## Success Criteria

- A "Revert to Draft" button appears on the `/events/[eventId]` page for any authenticated user when the event status is `approved`
- Clicking it shows a confirmation dialog before acting
- On confirm, the event status is set to `draft` and the audit trail is updated
- The button is not visible for any other status

## Scope

**In scope:**
- New `revertToDraftAction` server action
- New `RevertToDraftButton` client component
- Wiring into the event detail page

**Out of scope:**
- Email notifications on revert
- Status transitions other than `approved → draft`
- Role restrictions (any authenticated user may revert)

---

## Architecture

### Server Action — `revertToDraftAction`

**File:** `src/actions/events.ts`

```typescript
export async function revertToDraftAction(
  eventId: string
): Promise<{ success?: boolean; error?: string }>
```

Steps:
1. Get authenticated user via `getSupabaseServerClient()` — return error if unauthenticated
2. Fetch event by `eventId` — return error if not found or deleted
3. Guard: if `status !== 'approved'`, return `{ error: 'Event is not approved' }`
4. Update event: set `status = 'draft'`, `assignee_id = null`, `updated_at = now()`
5. Log audit event: `operation_type: 'revert_to_draft'`, `resource_type: 'event'`, `resource_id: eventId`, `operation_status: 'success'`
6. `revalidatePath('/events/' + eventId)` and `revalidatePath('/events')`
7. Return `{ success: true }`

### Client Component — `RevertToDraftButton`

**File:** `src/components/events/revert-to-draft-button.tsx`

- `'use client'` component
- Props: `eventId: string`
- Renders a destructive-variant button labelled "Revert to Draft"
- On click: opens a confirmation dialog (consistent with existing `DeleteEventButton` pattern)
  - Dialog title: "Revert event to draft?"
  - Dialog body: "This will set the event back to draft and remove it from the approved schedule. You can re-approve it at any time."
  - Actions: Cancel / Confirm
- On confirm: calls `revertToDraftAction(eventId)`, shows loading state
- On success: toast "Event reverted to draft"
- On error: toast with error message

### Page Integration — `src/app/events/[eventId]/page.tsx`

- Add `canRevertToDraft` flag:
  ```typescript
  const canRevertToDraft = event.status === 'approved';
  ```
- Render `<RevertToDraftButton eventId={event.id} />` in the read-only view's left column, within or adjacent to the existing danger zone area (below the delete button if present)
- The button is only rendered when `canRevertToDraft === true`

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Unauthenticated user | Server action returns `{ error: 'Unauthorized' }` |
| Event not found | Server action returns `{ error: 'Event not found' }` |
| Event not in `approved` state | Server action returns `{ error: 'Event is not approved' }` |
| DB update fails | Server action returns `{ error: '...' }`, toast shown to user |

---

## Testing

- Server action: unauthenticated request returns error; non-approved event returns error; approved event transitions to draft and logs audit event
- Component: confirmation dialog shown on click; cancel does nothing; confirm calls action; loading state shown during action

---

## Files Changed

| File | Change |
|------|--------|
| `src/actions/events.ts` | Add `revertToDraftAction` |
| `src/components/events/revert-to-draft-button.tsx` | New client component |
| `src/app/events/[eventId]/page.tsx` | Add `canRevertToDraft` flag and render button |
