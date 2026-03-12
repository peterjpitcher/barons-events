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
- Wiring into the event detail page (both edit-mode sidebar and read-only layout)

**Out of scope:**
- Email notifications on revert
- Status transitions other than `approved → draft`
- Role restrictions (any authenticated user may revert — this is an intentional product decision)

---

## Architecture

### Server Action — `revertToDraftAction`

**File:** `src/actions/events.ts`

**Signature:** Follows the `useActionState` / `formData` pattern used by `deleteEventAction`:

```typescript
export async function revertToDraftAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult>
```

**Steps:**
1. Get authenticated user via `getCurrentUser()` — if not authenticated, redirect to `/login`
2. Parse and validate `eventId` from `formData` using `z.string().uuid().safeParse()`; return `{ success: false, message: 'Invalid event reference.' }` on failure
3. Fetch event from `events` table selecting `id, status`; return `{ success: false, message: 'Event not found.' }` if missing
4. Guard: if `status !== 'approved'`, return `{ success: false, message: 'Event is not currently approved.' }`
5. Update event: set `status = 'draft'`, `assignee_id = null`, `updated_at = now()`
   - `assignee_id` is cleared because approval clears it (see `reviewerDecisionAction`); reverting undoes that approval state, so clearing the assignee forces re-triage when the event is re-approved. This is consistent with the existing approval flow.
6. Call `recordAuditLogEntry` using the exact same schema as the rest of `events.ts`:
   ```typescript
   await recordAuditLogEntry({
     entity: "event",
     entityId: event.id,
     action: "event.status_changed",
     actorId: user.id,
     meta: {
       status: "draft",
       previousStatus: "approved",
       changes: ["Status"]
     }
   });
   ```
   Using `action: "event.status_changed"` means the audit trail card renders it as "Status changed to Draft (was Approved)" without any code changes to the page.
7. `revalidatePath('/events/' + event.id)`, `revalidatePath('/events')`, `revalidatePath('/reviews')`
8. Return `{ success: true, message: 'Event reverted to draft.' }`

### Client Component — `RevertToDraftButton`

**File:** `src/components/events/revert-to-draft-button.tsx`

- `'use client'` component
- Props: `eventId: string`
- Follows the `DeleteEventButton` pattern: uses `useActionState` with `revertToDraftAction`, renders a `<form>` with a hidden `eventId` input and a submit button
- The button opens a confirmation dialog before submitting (consistent with `DeleteEventButton`)
  - Dialog title: "Revert event to draft?"
  - Dialog body: "This will set the event back to draft, clear the assignee, and remove it from the approved schedule. You can re-approve it at any time."
  - Actions: Cancel / Confirm (destructive variant)
- Shows loading state during submission (button disabled, pending label)
- On `state.success`: toast "Event reverted to draft"
- On `!state.success`: toast with `state.message`

### Page Integration — `src/app/events/[eventId]/page.tsx`

Add a single flag:
```typescript
const canRevertToDraft = event.status === 'approved';
```

The button must appear in **both** layouts since `central_planner` users on an approved event land in the edit-mode layout (`canEdit` includes `approved` for central planners):

**Edit mode (sidebar):** Add `RevertToDraftButton` to the "Save & submit" card's `CardContent`, below `EventFormActions`, when `canRevertToDraft` is true. Separate it with a `<hr />` or a top margin for visual separation.

**Read-only mode (left column):** Add a dedicated card when `canRevertToDraft` is true, rendered below the debrief cards and above/alongside the danger zone card. Use a neutral (not red) border since reverting to draft is reversible.

```tsx
{canRevertToDraft ? (
  <Card>
    <CardHeader>
      <CardTitle>Revert to draft</CardTitle>
      <CardDescription>Pull this event back to draft for further changes.</CardDescription>
    </CardHeader>
    <CardContent>
      <RevertToDraftButton eventId={event.id} />
    </CardContent>
  </Card>
) : null}
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Unauthenticated user | `getCurrentUser()` redirects to `/login` |
| Invalid event ID | Returns `{ success: false, message: 'Invalid event reference.' }` |
| Event not found | Returns `{ success: false, message: 'Event not found.' }` |
| Event not `approved` | Returns `{ success: false, message: 'Event is not currently approved.' }` |
| DB update fails | Returns `{ success: false, message: 'Could not revert event to draft.' }`, toast shown |

---

## Testing

- **Server action — happy path:** authenticated user, approved event → status set to `draft`, `assignee_id` cleared, audit entry created, paths revalidated
- **Server action — guard:** non-approved event returns error without mutating DB
- **Server action — auth:** unauthenticated request redirects to `/login`
- **Component:** confirmation dialog shown on click; cancel does not submit form; confirm submits; loading state shown during action; success/error toasts fire correctly

---

## Files Changed

| File | Change |
|------|--------|
| `src/actions/events.ts` | Add `revertToDraftAction` |
| `src/components/events/revert-to-draft-button.tsx` | New client component |
| `src/app/events/[eventId]/page.tsx` | Add `canRevertToDraft` flag and render button in both edit-mode sidebar and read-only layout |
