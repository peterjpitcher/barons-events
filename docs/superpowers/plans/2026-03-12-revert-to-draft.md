# Revert to Draft — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Revert to Draft" button on the `/events/[eventId]` page that sets an approved event's status back to `draft`.

**Architecture:** Three independent units — a server action (with tests), a client component, and page wiring. Tasks 1 and 2 are fully independent and can be parallelised. Task 3 depends on both.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (anon + service role), Vitest, Sonner (toasts), Lucide icons, shadcn/ui `Button` + `ConfirmDialog`

**Spec:** `docs/superpowers/specs/2026-03-12-revert-to-draft-design.md`

---

## Chunk 1: Server Action

### Task 1: `revertToDraftAction` — tests then implementation

**Files:**
- Create: `src/actions/__tests__/revert-to-draft.test.ts`
- Modify: `src/actions/events.ts` (append at end of file)

---

- [ ] **Step 1.1 — Write the failing tests**

Create `src/actions/__tests__/revert-to-draft.test.ts` with this exact content:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Must mock these BEFORE importing the action (hoisted by Vitest)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseActionClient: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/audit-log', () => ({ recordAuditLogEntry: vi.fn() }));

import { revertToDraftAction } from '@/actions/events';
import { createSupabaseActionClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth';
import { recordAuditLogEntry } from '@/lib/audit-log';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUser(role = 'central_planner') {
  return { id: 'user-abc', role };
}

/** Builds a minimal chainable Supabase mock for event fetch + update */
function makeDb(eventRow: Record<string, unknown> | null, updateError: unknown = null) {
  const mockSingle = vi.fn().mockResolvedValue({ data: eventRow, error: eventRow ? null : { message: 'not found' } });
  const mockEqSelect = vi.fn().mockReturnValue({ single: mockSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEqSelect });

  const mockEqUpdate = vi.fn().mockResolvedValue({ error: updateError });
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEqUpdate });

  const mockFrom = vi.fn((table: string) => {
    if (table === 'events') {
      return { select: mockSelect, update: mockUpdate };
    }
    return { select: mockSelect, update: mockUpdate };
  });

  return { from: mockFrom, update: mockUpdate, _mockSingle: mockSingle, _mockEqUpdate: mockEqUpdate };
}

function makeFormData(eventId: string) {
  const fd = new FormData();
  fd.set('eventId', eventId);
  return fd;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('revertToDraftAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redirects to /login when user is not authenticated', async () => {
    (getCurrentUser as Mock).mockResolvedValue(null);
    await revertToDraftAction(undefined, makeFormData('some-id'));
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('returns error for invalid (non-UUID) event ID', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const result = await revertToDraftAction(undefined, makeFormData('not-a-uuid'));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invalid event reference/i);
  });

  it('returns error when event is not found', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb(null);
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    const result = await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/event not found/i);
  });

  it('returns error when event is not approved', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb({ id: '00000000-0000-0000-0000-000000000001', status: 'submitted' });
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    const result = await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not currently approved/i);
  });

  it('sets status to draft and clears assignee for an approved event', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb({ id: '00000000-0000-0000-0000-000000000001', status: 'approved' });
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    const result = await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(result.success).toBe(true);
    expect(db.from).toHaveBeenCalledWith('events');
    expect(db._mockEqUpdate).toHaveBeenCalledWith('id', '00000000-0000-0000-0000-000000000001');
    // Verify the update payload includes status: 'draft' and assignee_id: null
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft', assignee_id: null })
    );
  });

  it('writes an audit log entry with correct schema', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb({ id: '00000000-0000-0000-0000-000000000001', status: 'approved' });
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(recordAuditLogEntry).toHaveBeenCalledWith({
      entity: 'event',
      entityId: '00000000-0000-0000-0000-000000000001',
      action: 'event.status_changed',
      actorId: 'user-abc',
      meta: expect.objectContaining({
        status: 'draft',
        previousStatus: 'approved',
      }),
    });
  });

  it('revalidates events, event detail, and reviews paths', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb({ id: '00000000-0000-0000-0000-000000000001', status: 'approved' });
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(revalidatePath).toHaveBeenCalledWith('/events/00000000-0000-0000-0000-000000000001');
    expect(revalidatePath).toHaveBeenCalledWith('/events');
    expect(revalidatePath).toHaveBeenCalledWith('/reviews');
  });

  it('returns error when database update fails', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser());
    const db = makeDb(
      { id: '00000000-0000-0000-0000-000000000001', status: 'approved' },
      { message: 'db error' }
    );
    (createSupabaseActionClient as Mock).mockResolvedValue(db);
    const result = await revertToDraftAction(undefined, makeFormData('00000000-0000-0000-0000-000000000001'));
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 1.2 — Run tests to confirm they all fail**

```bash
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && npx vitest run src/actions/__tests__/revert-to-draft.test.ts
```

Expected: all 8 tests fail (function not exported yet).

- [ ] **Step 1.3 — Implement `revertToDraftAction`**

Append to the end of `src/actions/events.ts` (after the closing `}` of `deleteEventAction`):

```typescript
export async function revertToDraftAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const eventId = formData.get("eventId");
  const parsedEvent = z.string().uuid().safeParse(eventId);
  if (!parsedEvent.success) {
    return { success: false, message: "Invalid event reference." };
  }

  const supabase = await createSupabaseActionClient();

  try {
    const { data: event, error: fetchError } = await supabase
      .from("events")
      .select("id, status")
      .eq("id", parsedEvent.data)
      .single();

    if (fetchError || !event) {
      return { success: false, message: "Event not found." };
    }

    if (event.status !== "approved") {
      return { success: false, message: "Event is not currently approved." };
    }

    const { error: updateError } = await supabase
      .from("events")
      .update({ status: "draft", assignee_id: null, updated_at: new Date().toISOString() })
      .eq("id", event.id);

    if (updateError) {
      return { success: false, message: "Could not revert event to draft." };
    }

    await recordAuditLogEntry({

      entity: "event",
      entityId: event.id,
      action: "event.status_changed",
      actorId: user.id,
      meta: {
        status: "draft",
        previousStatus: "approved",
        changes: ["Status"],
      },
    });

    revalidatePath(`/events/${event.id}`);
    revalidatePath("/events");
    revalidatePath("/reviews");

    return { success: true, message: "Event reverted to draft." };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    console.error(error);
    return { success: false, message: "Could not revert event to draft." };
  }
}
```

- [ ] **Step 1.4 — Run tests to confirm they all pass**

```bash
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && npx vitest run src/actions/__tests__/revert-to-draft.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 1.5 — Run full lint + typecheck**

```bash
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && npm run lint && npm run typecheck
```

Expected: zero errors and zero warnings.

- [ ] **Step 1.6 — Commit**

```bash
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && git add src/actions/events.ts src/actions/__tests__/revert-to-draft.test.ts && git commit -m "feat: add revertToDraftAction server action with tests"
```

---

## Chunk 2: Client Component

### Task 2: `RevertToDraftButton` component

**Files:**
- Create: `src/components/events/revert-to-draft-button.tsx`

No unit test needed — this is a thin UI wrapper over the server action. The action is fully tested in Task 1. See `testing.md`: "Simple UI wrappers — lowest priority, skip if time-constrained."

---

- [ ] **Step 2.1 — Create the component**

Create `src/components/events/revert-to-draft-button.tsx` with this exact content:

```typescript
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { revertToDraftAction } from "@/actions/events";

type RevertToDraftButtonProps = {
  eventId: string;
};

export function RevertToDraftButton({ eventId }: RevertToDraftButtonProps) {
  const [state, formAction, isPending] = useActionState(revertToDraftAction, undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message ?? "Event reverted to draft.");
    } else if (state?.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  function handleConfirm() {
    setConfirmOpen(false);
    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="eventId" value={eventId} />
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() => setConfirmOpen(true)}
        >
          <RotateCcwIcon className="mr-2 h-4 w-4" />
          {isPending ? "Reverting..." : "Revert to draft"}
        </Button>
      </form>
      <ConfirmDialog
        open={confirmOpen}
        title="Revert event to draft?"
        description="This will set the event back to draft, clear the assignee, and remove it from the approved schedule. You can re-approve it at any time."
        confirmLabel="Revert to draft"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
```

- [ ] **Step 2.2 — Run typecheck**

```bash
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && npm run typecheck
```

Expected: zero errors. If `ConfirmDialog` `variant` prop doesn't accept `"default"`, change to `"secondary"` or remove the prop entirely (check `src/components/ui/confirm-dialog.tsx` for accepted values).

- [ ] **Step 2.3 — Commit**

```bash
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && git add src/components/events/revert-to-draft-button.tsx && git commit -m "feat: add RevertToDraftButton client component"
```

---

## Chunk 3: Page Integration

### Task 3: Wire button into the event detail page

**Files:**
- Modify: `src/app/events/[eventId]/page.tsx`

**Depends on:** Tasks 1 and 2 complete.

---

- [ ] **Step 3.1 — Add import and flag**

In `src/app/events/[eventId]/page.tsx`:

1. Add import at the top alongside the other event component imports (e.g. after the `DeleteEventButton` import on line 6):

```typescript
import { RevertToDraftButton } from "@/components/events/revert-to-draft-button";
```

2. Add the `canRevertToDraft` flag after `canDelete` (around line 89), before the `reassignAssignee` inline action:

```typescript
const canRevertToDraft = event.status === "approved";
```

- [ ] **Step 3.2 — Add button to the read-only layout**

In the read-only layout section (the `else` branch starting at line ~514), add a new card in the left column below `{debriefSnapshotCard}` and above the existing danger zone card:

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

The left column in read-only mode renders: `<EventDetailSummary>`, `{debriefSubmitCard}`, `{debriefSnapshotCard}`, then the danger zone. Insert the new card between `{debriefSnapshotCard}` and the danger zone block.

- [ ] **Step 3.3 — Add button to the edit-mode sidebar**

In the edit-mode sidebar (the `EventForm` `sidebar` prop, around line 490), add the button inside the "Save & submit" `CardContent`, after `<EventFormActions ... />`:

```tsx
<CardContent>
  <EventFormActions eventId={event.id} canDelete={canDelete} />
  {canRevertToDraft ? (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <RevertToDraftButton eventId={event.id} />
    </div>
  ) : null}
</CardContent>
```

- [ ] **Step 3.4 — Run lint + typecheck**

```bash
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && npm run lint && npm run typecheck
```

Expected: zero errors and zero warnings.

- [ ] **Step 3.5 — Run full test suite**

```bash
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && npm test
```

Expected: all tests pass, including the 8 new revert-to-draft tests.

- [ ] **Step 3.6 — Run build**

```bash
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && npm run build
```

Expected: successful production build with no errors.

- [ ] **Step 3.7 — Commit**

```bash
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && git add src/app/events/[eventId]/page.tsx && git commit -m "feat: wire RevertToDraftButton into event detail page"
```

---

## Parallelisation Note

Tasks 1 and 2 are **fully independent** — they touch different files with no shared state. A subagent team should run them in parallel. Task 3 must run after both are complete.
