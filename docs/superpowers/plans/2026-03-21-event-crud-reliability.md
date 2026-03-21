# Event CRUD Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make event creation and editing 100% reliable — every save persists all fields, every failure is visible, and events never silently disappear.

**Architecture:** Six independent fixes across database (RLS migration), server actions (save verification), datetime (timezone consistency), form state (edit preservation), error surfacing (persistent banners), and event visibility (filter safety nets). Each task produces a working, testable commit.

**Tech Stack:** Next.js 16.1, Supabase PostgreSQL + RLS, React 19 (useActionState), dayjs, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-03-21-event-crud-reliability-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20260321000001_fix_event_update_rls.sql` | Create | RLS policy fix for event updates |
| `src/lib/events.ts` | Modify | Add post-update verification, column-stripping guards |
| `src/lib/datetime.ts` | Modify | Export DISPLAY_TIMEZONE constant |
| `src/actions/events.ts` | Modify | Pre-save checks, actionable error messages, field verification |
| `src/components/events/event-form.tsx` | Modify | Last-saved indicator, state preservation, success/error banners |
| `src/components/events/events-board.tsx` | Modify | Draft visibility, hidden count, dayjs timezone |
| `src/components/events/event-calendar.tsx` | Modify | dayjs timezone for displayed times |
| `src/app/events/[eventId]/page.tsx` | Modify | Add timeZone to Intl.DateTimeFormat instances |
| `src/lib/events.test.ts` | Create | Tests for updateEventDraft verification logic |
| `src/lib/datetime.test.ts` | Modify (or create) | BST/GMT timezone conversion tests |

---

### Task 1: RLS Migration — Allow Central Planners to Update Any Event

**Files:**
- Create: `supabase/migrations/20260321000001_fix_event_update_rls.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Fix: central planners must be able to update events in ANY status.
-- The existing "managers update editable events" policy only allows
-- updates when status in ('draft', 'needs_revisions'). While the
-- separate "planners manage events" policy should grant full access,
-- this belt-and-braces change ensures updates work even if
-- current_user_role() has issues in certain client contexts.

drop policy if exists "managers update editable events" on public.events;

create policy "managers update editable events"
  on public.events
  for update using (
    (auth.uid() = created_by and status in ('draft', 'needs_revisions'))
    or public.current_user_role() = 'central_planner'
  )
  with check (
    auth.uid() = created_by
    or public.current_user_role() = 'central_planner'
  );
```

- [ ] **Step 2: Verify migration syntax**

Run: `npx supabase db push --dry-run` (if linked) or review SQL manually.
Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260321000001_fix_event_update_rls.sql
git commit -m "fix: allow central planners to update events in any status (RLS)"
```

---

### Task 2: Save Action Reliability — Post-Update Verification

**Files:**
- Modify: `src/lib/events.ts` (updateEventDraft function, ~line 515-609)
- Modify: `src/actions/events.ts` (saveEventDraftAction, ~line 592)

- [ ] **Step 1: Read current updateEventDraft in `src/lib/events.ts`**

Understand the retry loop and how `data`/`updateError` are set.

- [ ] **Step 2: Add column-stripping tracking to updateEventDraft**

In `src/lib/events.ts`, inside `updateEventDraft`, before the retry loop, add:
```typescript
const strippedColumns: string[] = [];
```

Inside the loop, where `delete updatePayload[missingColumn]` is called (after the console.warn), add:
```typescript
strippedColumns.push(missingColumn);
```

- [ ] **Step 3: Add post-update row verification to updateEventDraft**

After the retry loop succeeds (after `if (!data || updateError)` check), add verification:
```typescript
// Verify critical fields persisted correctly
const criticalFields: Array<[string, unknown]> = [
  ["title", updates.title],
  ["event_type", updates.event_type],
  ["start_at", updates.start_at],
  ["end_at", updates.end_at],
  ["venue_id", updates.venue_id],
  ["venue_space", updates.venue_space],
  ["notes", updates.notes],
];

const mismatches: string[] = [];
for (const [field, expected] of criticalFields) {
  if (expected !== undefined && data[field as keyof typeof data] !== expected) {
    mismatches.push(field);
  }
}

if (mismatches.length > 0) {
  console.warn(`[save-verify] Field mismatch after update on event ${eventId}:`, mismatches);
}
```

- [ ] **Step 4: Add explicit null-data check**

Replace the existing `if (!data || updateError)` throw with:
```typescript
if (!data || updateError) {
  const detail = updateError?.message ?? "Unknown error";
  if (detail.includes("0 rows") || !data) {
    throw new Error(`Update failed — no rows were affected. The event's current status may prevent editing, or the event no longer exists.`);
  }
  throw new Error(`Could not update event: ${detail}`);
}
```

- [ ] **Step 5: Return strippedColumns and mismatches from updateEventDraft**

Change the return type. Currently returns `EventRow`. Change to return an object:
```typescript
return { event: data, strippedColumns, mismatches };
```

Update callers of `updateEventDraft` throughout `src/actions/events.ts` to destructure `{ event, strippedColumns, mismatches }` instead of receiving the raw row. Update all references from `updated` to `event` (or alias at destructure site: `const { event: updated, strippedColumns, mismatches } = await updateEventDraft(...)`).

- [ ] **Step 6: Surface warnings in saveEventDraftAction**

In `src/actions/events.ts`, in the existing-event branch of `saveEventDraftAction` (after `updateEventDraft` returns), build a warning string:
```typescript
const warnings: string[] = [];
if (strippedColumns.length > 0) {
  warnings.push(`These fields could not be saved: ${strippedColumns.join(", ")}`);
}
if (mismatches.length > 0) {
  warnings.push(`These fields may not have saved correctly: ${mismatches.join(", ")}`);
}
const warningText = warnings.length ? ` (${warnings.join("; ")})` : "";
```

Then in the success return, append: `message: \`Draft updated.${warningText}\``

- [ ] **Step 7: Run lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: Clean pass. Fix any issues from the return type change.

- [ ] **Step 8: Commit**

```bash
git add src/lib/events.ts src/actions/events.ts
git commit -m "fix: add post-save verification and column-stripping visibility"
```

---

### Task 3: DateTime Display Fix — Consistent London Timezone

**Files:**
- Modify: `src/lib/datetime.ts` (~line 1)
- Modify: `src/app/events/[eventId]/page.tsx` (~lines 36-47)
- Modify: `src/components/events/events-board.tsx` (~lines 1-10, 109-110)
- Modify: `src/components/events/event-calendar.tsx`

- [ ] **Step 1: Export DISPLAY_TIMEZONE from datetime.ts**

In `src/lib/datetime.ts`, the constant `LONDON_TIME_ZONE` already exists at line 1 but is not exported. Add an export alias:
```typescript
export const DISPLAY_TIMEZONE = LONDON_TIME_ZONE;
```

- [ ] **Step 2: Fix event detail page formatters**

In `src/app/events/[eventId]/page.tsx`, update the two `Intl.DateTimeFormat` instances:

```typescript
const formatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London"
});

const auditTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London"
});
```

- [ ] **Step 3: Add dayjs timezone plugins to events-board.tsx**

In `src/components/events/events-board.tsx`, add imports after the existing dayjs imports:
```typescript
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);
```

Then update the `normaliseEvents` function (line ~105-113):
```typescript
function normaliseEvents(events: EventSummary[]): EventWithDates[] {
  return events
    .map((event) => ({
      ...event,
      start: dayjs.utc(event.start_at).tz("Europe/London"),
      end: dayjs.utc(event.end_at).tz("Europe/London")
    }))
    .sort((a, b) => a.start.valueOf() - b.start.valueOf());
}
```

- [ ] **Step 4: Add dayjs timezone plugins to event-calendar.tsx**

Same pattern. Read the file, add utc/timezone imports and `dayjs.extend()`. The event objects already come in as `CalendarEvent` with `.start` and `.end` dayjs instances from the board, so the calendar itself may not need changes if it receives pre-converted dayjs objects. Verify by reading the component's props — if it receives `EventWithDates[]` from the board, the timezone is already applied. If it creates its own dayjs instances from raw strings, add `.utc().tz("Europe/London")`.

For any `dayjs()` calls that generate the current time (e.g. `dayjs().format("YYYY-MM-DD")` for `todayKey`), these are date-only comparisons and are timezone-safe as-is. No changes needed for those.

- [ ] **Step 5: Run lint + typecheck + verify**

Run: `npm run lint && npm run typecheck`
Expected: Clean pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/datetime.ts src/app/events/[eventId]/page.tsx src/components/events/events-board.tsx src/components/events/event-calendar.tsx
git commit -m "fix: use Europe/London timezone consistently across all date displays"
```

---

### Task 4: Form State Management — Last-Saved Indicator and Edit Preservation

**Files:**
- Modify: `src/components/events/event-form.tsx`

- [ ] **Step 1: Read the current form state management**

Understand: `isDirty` state, `draftState` useEffect handlers, how `defaultValues` are used.

- [ ] **Step 2: Add lastSavedAt state**

Near the other state declarations (around line 162-178):
```typescript
const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
```

- [ ] **Step 3: Set lastSavedAt on successful save**

In the `useEffect` that watches `draftState?.success` (around line 251-253):
```typescript
useEffect(() => {
  if (draftState?.success) {
    setIsDirty(false);
    setLastSavedAt(new Date());
  }
}, [draftState]);
```

- [ ] **Step 4: Add last-saved display near Save button**

In the save section of the TABBED layout (near the Save button area), and the LEGACY layout's save card, add a save status indicator:

```tsx
{isPending ? (
  <span className="text-xs text-[var(--color-text-muted)] animate-pulse">Saving...</span>
) : lastSavedAt ? (
  <span className="text-xs text-[var(--color-text-muted)]">
    Last saved: {lastSavedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
  </span>
) : isDirty ? (
  <span className="text-xs text-[var(--color-warning)]">Unsaved changes</span>
) : null}
```

Place this adjacent to the save buttons in both layouts.

- [ ] **Step 5: Add success banner on save**

Add a success state alongside the error banner we already added. Near the error banner in both forms:
```tsx
{activeState?.success && activeState?.message && (
  <div className="rounded-lg border border-[var(--color-success)] bg-[var(--color-success)]/10 p-4 text-sm text-[var(--color-success)]" role="status">
    {activeState.message}
  </div>
)}
```

Note: This banner auto-clears when the user submits again (draftState changes).

- [ ] **Step 6: Run lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: Clean pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/events/event-form.tsx
git commit -m "feat: add last-saved indicator and success banner to event form"
```

---

### Task 5: Error Surfacing — Actionable Messages

**Files:**
- Modify: `src/actions/events.ts` (saveEventDraftAction error paths)
- Modify: `src/components/events/event-form.tsx` (verify error banner works in edit mode)

- [ ] **Step 1: Read the current catch block in saveEventDraftAction**

Our earlier changes already include `detail` extraction. Verify the error messages are specific enough.

- [ ] **Step 2: Add specific error messages by failure type**

In the edit path of `saveEventDraftAction`, wrap the `updateEventDraft` call:
```typescript
try {
  const { event: updated, strippedColumns, mismatches } = await updateEventDraft(...);
  // ... existing code
} catch (updateError) {
  const msg = updateError instanceof Error ? updateError.message : "Unknown error";
  if (msg.includes("no rows were affected")) {
    return {
      success: false,
      message: "Could not save — the event's current status may prevent editing. Try reverting to draft first, then editing."
    };
  }
  throw updateError; // Let outer catch handle other errors
}
```

- [ ] **Step 3: Add slow-save indicator**

In `src/components/events/event-form.tsx`, add a timeout effect that shows "Still saving..." if the action takes more than 8 seconds:
```typescript
const [isSlow, setIsSlow] = useState(false);
useEffect(() => {
  if (!isPending) {
    setIsSlow(false);
    return;
  }
  const timer = setTimeout(() => setIsSlow(true), 8000);
  return () => clearTimeout(timer);
}, [isPending]);
```

Then in the save indicator (from Task 4):
```tsx
{isPending ? (
  <span className="text-xs text-[var(--color-text-muted)] animate-pulse">
    {isSlow ? "Still saving — please don't navigate away..." : "Saving..."}
  </span>
) : /* ... rest of indicator */ }
```

- [ ] **Step 4: Verify error banner works in edit mode**

The error banner we added earlier checks `activeState`. In edit mode, `activeState` is `intent === "submit" ? submitState : draftState`. When saving (intent="draft"), `activeState = draftState`. Verify the banner condition works for both create and edit by reading the code.

- [ ] **Step 5: Run lint + typecheck**

Run: `npm run lint && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/actions/events.ts src/components/events/event-form.tsx
git commit -m "fix: add actionable error messages and slow-save indicator"
```

---

### Task 6: Event Visibility — Drafts Always Visible + Hidden Count

**Files:**
- Modify: `src/components/events/events-board.tsx` (~lines 368-372, ~lines 570-580)

- [ ] **Step 1: Read the current listEvents filter**

The `listEvents` useMemo at ~line 368-372:
```typescript
const listEvents = useMemo(() => {
  if (!hidePastEvents) return filteredEvents;
  const now = dayjs();
  return filteredEvents.filter((event) => event.end.isAfter(now));
}, [filteredEvents, hidePastEvents]);
```

- [ ] **Step 2: Add draft and recently-created safety nets**

Replace with:
```typescript
const listEvents = useMemo(() => {
  if (!hidePastEvents) return filteredEvents;
  const now = dayjs();
  const oneDayAgo = now.subtract(24, "hours");
  return filteredEvents.filter(
    (event) =>
      event.end.isAfter(now) ||
      event.status === "draft" ||
      dayjs.utc(event.created_at).isAfter(oneDayAgo)
  );
}, [filteredEvents, hidePastEvents]);
```

Note: `event.created_at` is a string from the DB row. Use `dayjs.utc()` since we added the utc plugin in Task 3.

- [ ] **Step 3: Calculate hidden event count**

Add a new memo after `listEvents`:
```typescript
const hiddenPastCount = useMemo(() => {
  if (!hidePastEvents) return 0;
  return filteredEvents.length - listEvents.length;
}, [filteredEvents, listEvents, hidePastEvents]);
```

- [ ] **Step 4: Display hidden count in the UI**

Find the "Past hidden" button/toggle area (~line 570-580). Below it (or inline), add:
```tsx
{hiddenPastCount > 0 && (
  <span className="text-xs text-[var(--color-text-muted)]">
    {hiddenPastCount} past event{hiddenPastCount !== 1 ? "s" : ""} hidden
  </span>
)}
```

- [ ] **Step 5: Run lint + typecheck**

Run: `npm run lint && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/components/events/events-board.tsx
git commit -m "fix: keep drafts and recently-created events visible, show hidden count"
```

---

### Task 7: Final Verification — Build + Push

- [ ] **Step 1: Run full verification pipeline**

```bash
npm run lint && npm run typecheck && npm run build
```

Expected: All pass with zero errors.

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: All existing tests pass.

- [ ] **Step 3: Push to GitHub**

```bash
git push origin main
```
