# Event Creation Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BaronsHub event-creation flow reliable end-to-end: no silent partial saves, no lost changes, no double-submits, atomic multi-table writes, structured error feedback, and a clean RLS policy for office workers.

**Architecture:** Four sequenced phases delivered as separate logical units. Phase A′ ships UX guardrails and the M1 RLS migration with no contract change to server actions. Phase B′ replaces the 10-step sequential save in `saveEventDraftAction` and `submitEventForReviewAction` with a single transactional Postgres RPC behind a feature flag, plus a compensating image state machine for storage. Phase B″ extends the same shape to the propose flow. Phase C′ adds integration tests, structured logging, and CI gates.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict), Supabase (PostgreSQL + RLS + SECURITY DEFINER RPCs), Vitest (unit + integration), Playwright (E2E), Sonner (toasts), `@/lib/auth` for session, `@/lib/roles.ts` for capability functions, `recordAuditLogEntry` for audit trail.

**Spec source:** [tasks/2026-05-07-event-creation-reliability-spec.md](../../../tasks/2026-05-07-event-creation-reliability-spec.md) (rev 2).

**User-confirmed decisions (A-1…A-6):** All Core operations (artists, venues, versions, audit) are fatal on failure. Image upload is Compensatable (warning + retry). Multi-venue partial = zero events. Office_workers SELECT own submitted events. Operation IDs split (short hash to user; full UUID v7 in logs). Feature flag deploy, no maintenance banner.

---

## Execution mode: **LEAN**

User preference confirmed mid-session (2026-05-07): execute in lean mode rather than full TDD-per-step ceremony. Specifically:

- For migrations, SQL, config, and docs — write the artifact, push, verify once, commit; do NOT write a "failing test first" — the migration IS the artifact.
- For new helpers + their tests — write helper + test together, run once, commit once. No red-green-refactor split.
- Each agent verifies ONCE at end of its scope (`npm run lint && npm run typecheck && npm test -- <scoped pattern>`), not per task.
- Handoff files are ~10 lines (file paths + commit hashes + 1-line caveats), not multi-section reports.
- Batch commits where logically consistent; one commit per task is the granularity, not one per "step".
- Real type safety, RLS verification, schema-reality checks before drafting SQL, and Supabase advisors after migration push are NON-NEGOTIABLE — leanness applies to ceremony, not correctness.
- The TDD step-by-step blocks below remain authoritative for *what changes*; agents implement them lean.

---

## Live status (2026-05-07)

| Wave | Agent | Status | Commits |
|------|-------|--------|---------|
| 1 | Form Surgeon (A1, A2, A3, A4, A5, A7) | ✅ done | `cb16668`, `e75616f`, `22e569c`, `00c47cc`, `5451a91`, `1f41aa9` |
| 1 | RLS Migrator (A6) | ✅ done | `411b6bf` |
| 2 | RPC Plumber (B0, B1, B2 + types) | ✅ done | `24deb69`, `b214345`, `b011aa8` |
| 3 | Action Rewirer (B3, B5, B6) | 🟡 partial — commit 1 of 3 landed; commits 2 + 3 outstanding; events.ts has uncommitted changes | `58eaadb` (so far) |
| 3 | Cron Engineer (B4 cron) | ✅ done | `2248d2e` |
| 4 | Propose Surgeon (B″1, B″2) | ⏳ pending | — |
| 4 | Verification Engineer (C1–C6) | ⏳ pending | — |
| Final | Codex adversarial review | ⏳ pending | — |

**11 commits landed; ~8 commits remaining (Action Rewirer follow-up + Wave 4).**

---

## Cross-phase conventions

These apply to every task below.

- **Working directory:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/worktrees/eager-borg-52d3f5`
- **Branch:** Already in worktree branch `claude/eager-borg-52d3f5`. Implementation lands directly on it.
- **Verification commands** (run between tasks where relevant):
  - `npm run lint` — ESLint (zero warnings enforced)
  - `npm run typecheck` — `tsc --noEmit`
  - `npm test` — Vitest single-pass
  - `npm run build` — production build (only at end of each phase)
  - `npm run supabase:migrate` — `supabase db push` (run only when migrations added)
- **Commit style:** Conventional commits (`feat:`, `fix:`, `chore:`, `test:`, etc.). One logical change per commit. Do NOT use `--no-verify`.
- **No new dependencies** unless a task explicitly adds one (the only addition is `uuid` if not already present — verify first with `grep '"uuid"' package.json`).
- **Type safety:** No `any` unless commented justifying it. Replace existing `as any` casts in modified files.
- **Colourblind safety:** Any error/warning UI pairs colour with icon + text (per project user memory).
- **Migration filenames:** `supabase/migrations/<UTC_TIMESTAMP>_<slug>.sql`. Use `date -u +"%Y%m%d%H%M%S"` for the prefix; verify it's unique with `ls supabase/migrations/`.

---

## Phase A′ — UX guardrails + RLS migration (1 day)

**Goal:** Stop double-submits, prop-reset clobber, and silent toast suppression. Resolve the M1 RLS asymmetry. **No contract change** to server actions — failures still return `{success: false}`. No `warnings[]` channel introduced.

**Sequence within phase:** A1 (button disable) → A2 (toast fix) → A3 (dirty-state reset) → A4 (key prop + remove useEffect) → A5+A7 (operation_id) → A6 (RLS migration). Each task is independent; can be parallelised across two agents if subagent-driven.

---

### Task A1: Disable submit buttons while pending

**Files:**
- Modify: `src/components/events/event-form.tsx` (locate `<SubmitButton>` usages — there are several with `data-intent="submit"` and `data-intent="generate"`; the draft form action is the default)
- Test: `src/components/events/__tests__/event-form.create.test.tsx` (existing — extend)

- [ ] **Step 1: Read the existing test file to understand its mock setup**

```bash
cat src/components/events/__tests__/event-form.create.test.tsx | head -60
```

Note the existing mocking pattern (probably mocks `@/actions/events` and `sonner`).

- [ ] **Step 2: Add a failing test for double-submit guard**

In `src/components/events/__tests__/event-form.create.test.tsx`, append a new `describe` block:

```tsx
describe("EventForm submit guards", () => {
  it("disables both Save and Submit buttons while the draft action is pending", async () => {
    // Arrange: render EventForm with a slow saveEventDraftAction mock
    const slowAction = vi.fn(() => new Promise(() => { /* never resolves */ }));
    vi.mocked(saveEventDraftAction).mockImplementation(slowAction);

    render(
      <EventForm mode="create" venues={[/* fixtures */]} artists={[]} eventTypes={[]} role="administrator" userVenueId={null} initialStartAt="2026-06-01T19:00:00.000Z" initialEndAt="2026-06-01T22:00:00.000Z" initialVenueId={null} users={[]} />
    );

    // Act: click Save
    const save = screen.getByRole("button", { name: /save draft/i });
    fireEvent.click(save);

    // Assert: Save and Submit are both disabled while pending
    await waitFor(() => {
      expect(save).toBeDisabled();
      const submit = screen.queryByRole("button", { name: /submit/i });
      if (submit) expect(submit).toBeDisabled();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/components/events/__tests__/event-form.create.test.tsx -t "disables both Save and Submit"
```

Expected: FAIL — buttons not disabled (or test errors importing setup).

- [ ] **Step 4: Pass `disabled={isSavingPending || isSubmittingPending}` through to every action SubmitButton**

The `useActionState` hooks already expose `isSavingPending` and `isSubmittingPending` (event-form.tsx:197-202). Find every `<SubmitButton>` that calls `draftAction` or `submitAction` and pass `disabled` explicitly. The existing `SubmitButton` component (`src/components/ui/submit-button.tsx`) likely already supports `disabled`.

Pattern for each Save button:
```tsx
<SubmitButton
  formAction={draftAction}
  label="Save draft"
  pendingLabel="Saving..."
  data-intent="draft"
  disabled={isSavingPending || isSubmittingPending}
/>
```

Pattern for each Submit button:
```tsx
<SubmitButton
  formAction={submitAction}
  label="Submit for review"
  pendingLabel="Submitting..."
  data-intent="submit"
  disabled={isSavingPending || isSubmittingPending}
/>
```

Leave AI-generation (`data-intent="generate"`) buttons alone — they already pass their own `disabled={!canGenerate...}`.

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/components/events/__tests__/event-form.create.test.tsx -t "disables both Save and Submit"
```

Expected: PASS.

- [ ] **Step 6: Run full test file to confirm no regression**

```bash
npx vitest run src/components/events/__tests__/event-form.create.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add src/components/events/event-form.tsx src/components/events/__tests__/event-form.create.test.tsx
git commit -m "fix(events): disable save and submit buttons while action is pending"
```

---

### Task A2: Fix the error-toast suppression bug

**Files:**
- Modify: `src/components/events/event-form.tsx:245-251` (the toast `useEffect`)
- Test: `src/components/events/__tests__/event-form.create.test.tsx`

**Bug today (event-form.tsx:245-251):**
```tsx
useEffect(() => {
  if (draftState?.message) {
    if (draftState.success) {
      toast.success(draftState.message);
    } else if (!draftState.fieldErrors) {
      toast.error(draftState.message);
    }
  }
}, [draftState]);
```

When `fieldErrors` is `{}` (truthy empty object) or `{any: ...}`, no error toast appears. This must always show on `success: false`.

- [ ] **Step 1: Add failing test**

In `event-form.create.test.tsx`:
```tsx
it("shows an error toast when draft action returns success=false even with fieldErrors", async () => {
  vi.mocked(saveEventDraftAction).mockResolvedValue({
    success: false,
    message: "Validation failed",
    fieldErrors: { title: ["Title is required"] }
  });

  render(<EventForm mode="create" /* ...minimal props */ />);
  fireEvent.click(screen.getByRole("button", { name: /save draft/i }));

  await waitFor(() => {
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Validation failed"));
  });
});
```

- [ ] **Step 2: Verify test fails**

```bash
npx vitest run src/components/events/__tests__/event-form.create.test.tsx -t "shows an error toast"
```
Expected: FAIL — `toast.error` not called.

- [ ] **Step 3: Fix the useEffect**

Replace event-form.tsx:245-251 with:
```tsx
useEffect(() => {
  if (!draftState?.message) return;
  if (draftState.success) {
    toast.success(draftState.message);
  } else {
    toast.error(draftState.message);
  }
}, [draftState]);
```

Apply the same fix to the `submitState` and `websiteCopyState` useEffects nearby (search for `else if (!.*fieldErrors)` patterns).

- [ ] **Step 4: Verify test passes**

```bash
npx vitest run src/components/events/__tests__/event-form.create.test.tsx -t "shows an error toast"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/events/event-form.tsx src/components/events/__tests__/event-form.create.test.tsx
git commit -m "fix(events): always show error toast on action failure"
```

---

### Task A3: Clear dirty-state on successful save

**Files:**
- Modify: `src/components/events/event-form.tsx` (the success branch of the toast useEffect; possibly `useRef` tracker or `useState` for dirty)
- Test: `src/components/events/__tests__/event-form.create.test.tsx`

**Investigation first:** Search `event-form.tsx` for any `beforeunload`, `useBeforeUnload`, `dirty`, `pristine`, or `confirm` patterns. The form may not yet have a dirty-state warning at all — if so, this task simplifies to "ensure controlled state values reflect the saved values after success".

- [ ] **Step 1: Locate any existing dirty-state machinery**

```bash
grep -n "beforeunload\|useBeforeUnload\|dirty\|pristine" src/components/events/event-form.tsx
```

If output is empty, there's no in-form warning — skip Steps 2–4 and only do Step 5: ensure that `setManagerDirty(false)` and `setEndDirty(false)` (which exist) are reset on success, plus reset any local "controlled-input changed" markers.

- [ ] **Step 2 (only if Step 1 found machinery): Add failing test**

```tsx
it("clears dirty state after successful save", async () => {
  vi.mocked(saveEventDraftAction).mockResolvedValue({ success: true, message: "Draft saved" });
  // ... render, type in a field, click Save, assert dirty flag false
});
```

- [ ] **Step 3 (only if Step 1 found machinery): Verify test fails**
- [ ] **Step 4 (only if Step 1 found machinery): Wire dirty=false into the success branch**

In the toast success effect, add:
```tsx
if (draftState.success) {
  toast.success(draftState.message);
  // Clear any local dirty markers so the form does not warn on navigate.
  setManagerDirty(false);
  setEndDirty(false);
  // ... any other dirty markers found in step 1 ...
}
```

- [ ] **Step 5: Commit (whether machinery existed or not)**

```bash
git add src/components/events/event-form.tsx src/components/events/__tests__/event-form.create.test.tsx
git commit -m "fix(events): reset dirty trackers after successful save"
```

---

### Task A4: Replace prop-reset useEffect with `key={defaultValues.id}` at parents

**Files:**
- Modify: `src/components/events/event-form.tsx` (delete the `useEffect` block at ~lines 396-440 that resets controlled state)
- Modify: `src/app/events/[eventId]/page.tsx` (add `key` to the `<EventForm>` mount)
- Modify: `src/app/events/new/page.tsx` (add `key="new"` for consistency)
- Modify: `src/app/events/propose/page.tsx` IF it imports `EventForm` directly
- Test: New file `src/components/events/__tests__/event-form.edit-isolation.test.tsx`

- [ ] **Step 1: Find the exact line range of the prop-reset useEffect**

```bash
grep -n "if (mode !== \"edit\" || !defaultValues?.id) return" src/components/events/event-form.tsx
```

Note the line number returned — this marks the start of the useEffect body. Use `Read` on a 50-line window from there to capture the full block; this is the block to remove.

- [ ] **Step 2: Add failing isolation test**

Create `src/components/events/__tests__/event-form.edit-isolation.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventForm } from "@/components/events/event-form";
// ... mocks for actions/events, sonner, ... copy from event-form.create.test.tsx ...

describe("EventForm edit-mode isolation", () => {
  it("does NOT clobber user input when defaultValues reference changes mid-mount", async () => {
    const initial = { id: "11111111-1111-1111-1111-111111111111", title: "First", /* ... */ };
    const { rerender } = render(<EventForm mode="edit" defaultValues={initial} /* ... */ />);

    // User types
    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Edited locally" } });
    expect(titleInput.value).toBe("Edited locally");

    // Parent re-renders with a NEW reference but same id — the form must keep the user's typed value
    rerender(<EventForm mode="edit" defaultValues={{ ...initial, title: "First refreshed" }} /* ... */ />);

    expect(titleInput.value).toBe("Edited locally"); // user's edit preserved
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/components/events/__tests__/event-form.edit-isolation.test.tsx
```
Expected: FAIL — current code resets the title to "First refreshed".

- [ ] **Step 4: Delete the prop-reset useEffect**

Edit `src/components/events/event-form.tsx`: remove the entire `useEffect(() => { if (mode !== "edit" || !defaultValues?.id) return; ...all the setX() calls... }, [...long deps...]);` block identified in Step 1.

- [ ] **Step 5: Add `key={defaultValues?.id ?? "new"}` at every consumer**

Modify `src/app/events/[eventId]/page.tsx`:
```tsx
<EventForm
  key={event.id}
  mode="edit"
  defaultValues={event}
  /* ...rest unchanged... */
/>
```

Modify `src/app/events/new/page.tsx`:
```tsx
<EventForm
  key="new"
  mode="create"
  /* ...rest unchanged... */
/>
```

Check `src/app/events/propose/page.tsx` — if it uses EventForm directly, add `key="propose"`. If it uses `ProposeEventForm` instead, leave it for Phase B″.

- [ ] **Step 6: Verify test passes**

```bash
npx vitest run src/components/events/__tests__/event-form.edit-isolation.test.tsx
```
Expected: PASS.

- [ ] **Step 7: Run full event-form test suite to catch regressions**

```bash
npx vitest run src/components/events/__tests__/
```

- [ ] **Step 8: Commit**

```bash
git add src/components/events/event-form.tsx \
        src/components/events/__tests__/event-form.edit-isolation.test.tsx \
        src/app/events/[eventId]/page.tsx \
        src/app/events/new/page.tsx \
        src/app/events/propose/page.tsx
git commit -m "fix(events): replace defaultValues reset effect with parent-side key prop"
```

---

### Task A5: Generate `operation_id` at form mount and propagate through actions

**Files:**
- Modify: `src/components/events/event-form.tsx` (add hidden input + ref)
- Modify: `src/lib/types.ts` (extend `ActionResult` with `operationId?: string`)
- Modify: `src/actions/events.ts` (read `operation_id` from FormData; include in error returns and console.error lines; pass into `recordAuditLogEntry` meta)
- Modify: `src/lib/audit-log.ts` (allow `operationId` in meta — likely no schema change since meta is jsonb)
- Test: `src/actions/__tests__/events-operation-id.test.ts` (new)

**Note on UUID v7:** The `uuid` package supports v7 from version 9+. Check `package.json`:
```bash
grep '"uuid"' package.json
```
If absent or older than v9, use `crypto.randomUUID()` (v4) for now — time-orderability nice-to-have, not load-bearing. If `uuid@>=9` exists, use `uuid.v7()`.

- [ ] **Step 1: Decide UUID source**

```bash
grep -E '"uuid"\s*:' package.json
node -e "const u=require('uuid'); console.log(typeof u.v7);"
```
If `function`, use `import { v7 as uuidv7 } from "uuid"`. Otherwise use `crypto.randomUUID()`.

- [ ] **Step 2: Add failing test**

Create `src/actions/__tests__/events-operation-id.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { saveEventDraftAction } from "@/actions/events";
// minimal mocks of getCurrentUser + supabase + roles ...

describe("saveEventDraftAction operation_id propagation", () => {
  it("returns the same operation_id that the client sent on a permission-denied path", async () => {
    const opId = "01234567-89ab-7cdf-8123-000000000000";
    const fd = new FormData();
    fd.set("operation_id", opId);
    fd.set("eventId", ""); // create
    // mock getCurrentUser to return a user with role that fails canProposeEvents
    const result = await saveEventDraftAction(undefined, fd);
    expect(result.success).toBe(false);
    expect(result.operationId).toBe(opId);
  });

  it("generates an operation_id when client did not send one", async () => {
    const fd = new FormData();
    fd.set("eventId", "");
    const result = await saveEventDraftAction(undefined, fd);
    expect(result.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
```

- [ ] **Step 3: Verify it fails**

```bash
npx vitest run src/actions/__tests__/events-operation-id.test.ts
```
Expected: FAIL — `result.operationId` is undefined.

- [ ] **Step 4: Extend `ActionResult` type**

Modify `src/lib/types.ts` — find the `ActionResult` declaration and add `operationId?: string;`:
```ts
export type ActionResult = {
  success?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  operationId?: string;
  warnings?: string[];   // also added now to avoid two passes; populated only by Phase B′
};
```

- [ ] **Step 5: Generate operation_id in form-mount and inject into form**

In `src/components/events/event-form.tsx`, near the top of the component body:
```tsx
import { v7 as uuidv7 } from "uuid"; // or use crypto.randomUUID() per Step 1

const operationIdRef = useRef<string>(uuidv7());
```

Add a hidden input inside the `<form>`:
```tsx
<input type="hidden" name="operation_id" value={operationIdRef.current} />
```

After successful save, regenerate so each subsequent save gets a fresh ID:
```tsx
useEffect(() => {
  if (draftState?.success) {
    operationIdRef.current = uuidv7();
  }
}, [draftState]);
```

- [ ] **Step 6: Read and propagate operation_id in `saveEventDraftAction`**

At the top of `saveEventDraftAction` body (events.ts:613), after `const user = await getCurrentUser();`:
```ts
const rawOperationId = formData.get("operation_id");
const operationId = typeof rawOperationId === "string" && rawOperationId.length === 36
  ? rawOperationId
  : crypto.randomUUID();
```

Then thread `operationId` through every `return { success: false, ... }` in this function. Pattern:
```ts
return { success: false, message: "...", operationId };
```

In every `console.error` line, prepend `[event-save:${operationId.slice(0,8)}]`. Example:
```ts
console.error(`[event-save:${operationId.slice(0,8)}] Draft saved but artist sync failed`, error);
```

In every `recordAuditLogEntry({ ... meta: ... })` call, add `operationId` to meta:
```ts
meta: { ...existingMeta, operationId }
```

- [ ] **Step 7: Repeat for `submitEventForReviewAction`**

Same pattern at events.ts:1027. Add operation_id read at top, thread through all returns and logs.

- [ ] **Step 8: Verify test passes**

```bash
npx vitest run src/actions/__tests__/events-operation-id.test.ts
```

- [ ] **Step 9: Lint and typecheck**

```bash
npm run lint
npm run typecheck
```

- [ ] **Step 10: Commit**

```bash
git add src/components/events/event-form.tsx \
        src/lib/types.ts \
        src/actions/events.ts \
        src/actions/__tests__/events-operation-id.test.ts
git commit -m "feat(events): propagate operation_id from form mount to action returns and audit meta"
```

---

### Task A7: Surface short hash of operation_id in user-visible error toasts

**Files:**
- Modify: `src/components/events/event-form.tsx` (in the toast useEffect, append the short hash on errors)

- [ ] **Step 1: Update the error branch of the toast useEffect**

Replace the toast.error line in the draftState effect with:
```tsx
toast.error(
  draftState.operationId
    ? `${draftState.message} (ref: ${draftState.operationId.slice(0, 8)})`
    : draftState.message
);
```

Apply the same pattern to `submitState`'s error branch.

- [ ] **Step 2: Add a focused test**

Append to `event-form.create.test.tsx`:
```tsx
it("includes the operation_id short hash in the error toast", async () => {
  vi.mocked(saveEventDraftAction).mockResolvedValue({
    success: false,
    message: "Save failed",
    operationId: "abcd1234-ef56-7890-abcd-1234567890ab"
  });
  render(<EventForm mode="create" /* ... */ />);
  fireEvent.click(screen.getByRole("button", { name: /save draft/i }));
  await waitFor(() => {
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("abcd1234"));
  });
});
```

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run src/components/events/__tests__/event-form.create.test.tsx -t "operation_id short hash"
git add src/components/events/event-form.tsx src/components/events/__tests__/event-form.create.test.tsx
git commit -m "feat(events): surface 8-char operation_id in error toasts"
```

---

### Task A6: RLS migration — office_workers SELECT own submitted events

**Files:**
- Create: `supabase/migrations/<UTC_TIMESTAMP>_office_worker_select_submitted_events.sql`
- Test: `src/lib/__tests__/office_worker_event_scope.test.ts` (existing — extend) OR new migration test if integration scaffolding exists

- [ ] **Step 1: Verify the current SELECT policy on `events`**

Run via Supabase MCP `execute_sql`:
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'events' AND cmd = 'SELECT'
ORDER BY policyname;
```

Read the `qual` clauses. The asymmetry is that office_workers can write (UPDATE / INSERT WITH CHECK) but the SELECT policy excludes status='submitted' for non-creators. Capture the current `qual` so the migration only loosens the SELECT side.

- [ ] **Step 2: Create the migration file**

Get a timestamp:
```bash
date -u +"%Y%m%d%H%M%S"
```

Create `supabase/migrations/<timestamp>_office_worker_select_submitted_events.sql`:

```sql
-- Resolves M1: office_workers must be able to SELECT submitted events they
-- can already write (manage their venue) so the form can reload after submit.
--
-- Office_workers with users.venue_id NULL → global read of their own & submitted events
-- Office_workers with users.venue_id set  → read all events at that venue regardless of status

drop policy if exists "events_select_office_worker" on public.events;

create policy "events_select_office_worker"
on public.events
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role = 'office_worker'
      and u.deactivated_at is null
      and (
        u.venue_id is null
        or u.venue_id = public.events.venue_id
        or exists (
          select 1 from public.event_venues ev
          where ev.event_id = public.events.id and ev.venue_id = u.venue_id
        )
      )
  )
);
```

- [ ] **Step 3: Push the migration to the linked Supabase project**

```bash
npm run supabase:migrate
```

If `supabase db push` warns of conflicts, run `supabase migration list` first to confirm timestamp is unique.

- [ ] **Step 4: Verify with Supabase advisors**

Use the Supabase MCP to list advisors:
```
mcp__plugin_supabase_supabase__get_advisors({ type: "security" })
```

Expected: no new warnings on `events` table.

- [ ] **Step 5: Extend the existing migration RLS test**

Open `src/lib/__tests__/office_worker_event_scope.test.ts`. Add a case asserting an office_worker can SELECT a submitted event at their venue. Pattern (adapt to the existing test harness — likely uses Supabase admin client):

```ts
it("office_worker without venue_id can SELECT own submitted event globally", async () => {
  // create office_worker with venue_id=null, create an event with status='submitted', SELECT as that user, expect 1 row
});

it("office_worker with venue_id can SELECT submitted event at that venue", async () => {
  // create office_worker with venue_id=X, create an event at venue X with status='submitted', SELECT as that user, expect 1 row
});
```

If the existing test file does not have a Supabase-backed harness, skip the integration test here — it lands properly in Phase C′ Task C1 with the new integration suite.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<timestamp>_office_worker_select_submitted_events.sql \
        src/lib/__tests__/office_worker_event_scope.test.ts
git commit -m "fix(rls): allow office_worker to SELECT own submitted events (M1)"
```

---

### Phase A′ verification gate

- [ ] **Step 1: Run all event-form tests**

```bash
npx vitest run src/components/events/__tests__/ src/actions/__tests__/events-operation-id.test.ts
```
Expected: PASS.

- [ ] **Step 2: Lint, typecheck, build**

```bash
npm run lint && npm run typecheck && npm run build
```

- [ ] **Step 3: Manual smoke (if possible)**

Start dev server and walk the create-event happy path; verify error toasts include `(ref: ...)`. Skip if no preview environment available.

- [ ] **Step 4: Phase A′ wrap commit (if any uncommitted helper changes)**

```bash
git status
# if clean, no commit needed
```

---

## Phase B′ — Atomic save RPC + image state machine + feature flag (3 days)

**Goal:** Replace the 10-step sequential save with a single transactional Postgres RPC. Image upload uses a compensating workflow with a daily reconcile cron. New code lives behind feature flag `EVENT_SAVE_USE_RPC`. Removes every `.catch(() => {})` in `events.ts`.

**Sequence within phase:** B0 (idempotency table + types) → B1 (save_event_draft RPC) → B2 (submit_event_for_review RPC) → B3 (rewire actions, behind flag) → B4 (image state machine + reconcile cron) → B5 (flag wiring & docs) → B6 (typed RPC + cleanup).

---

### Task B0: New idempotency table + image-pending column + generated types

**Files:**
- Create: `supabase/migrations/<UTC_TIMESTAMP>_event_save_idempotency_and_image_pending.sql`
- Create: `src/lib/supabase/database.types.ts` (regenerated by Supabase CLI)

- [ ] **Step 1: Create the migration file**

```sql
-- Phase B′: persistent idempotency for atomic save and pending-image-attach column
create table if not exists public.event_save_idempotency (
  idempotency_key uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  response jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (idempotency_key, user_id)
);

create index event_save_idempotency_user_id_created_at_idx
  on public.event_save_idempotency (user_id, created_at desc);

-- RLS: only the owning user (via service-role bypass) can read; SECURITY DEFINER RPCs handle access.
alter table public.event_save_idempotency enable row level security;

create policy "event_save_idempotency_owner_select"
on public.event_save_idempotency
for select to authenticated
using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies — all writes go through SECURITY DEFINER RPC.

-- Image attach pending column for compensating workflow.
alter table public.events
  add column if not exists pending_image_attach text;

comment on column public.events.pending_image_attach is
  'Storage path of an image that uploaded successfully but did not attach. Reconciled daily by /api/cron/reconcile-event-images.';
```

- [ ] **Step 2: Push migration**

```bash
npm run supabase:migrate
```

- [ ] **Step 3: Regenerate types**

```bash
npx supabase gen types typescript --linked --schema public > src/lib/supabase/database.types.ts
```

If the project uses a different filename (search via `grep -r "Database>" src/lib/supabase/`), match it.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<timestamp>_event_save_idempotency_and_image_pending.sql src/lib/supabase/database.types.ts
git commit -m "feat(events): add event_save_idempotency table and pending_image_attach column"
```

---

### Task B1: `save_event_draft` SECURITY DEFINER RPC

**Files:**
- Create: `supabase/migrations/<UTC_TIMESTAMP>_save_event_draft_rpc.sql`

- [ ] **Step 1: Create the migration**

The function below is large — write it carefully. It enforces:
- Identity from `auth.uid()` (no caller-supplied user_id)
- Idempotency via `event_save_idempotency`
- Optimistic concurrency via `expected_updated_at`
- SAVEPOINT-for-diagnostics-only on artist + venue writes (rolls back parent on any error)
- Returns `jsonb { success, event_id, failed[], warnings[], operation_id }`
- Restricted EXECUTE grant
- Fixed `search_path`

```sql
-- Phase B′ B1: atomic event-draft save with idempotency + optimistic concurrency.

create or replace function public.save_event_draft(
  p_payload jsonb,
  p_idempotency_key uuid,
  p_operation_id uuid,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_venue uuid;
  v_event_id uuid;
  v_is_create boolean;
  v_existing_response jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_warnings text[] := array[]::text[];
  v_payload jsonb;
  v_artist_ids uuid[];
  v_venue_ids uuid[];
  v_artist_id uuid;
  v_venue_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  if v_user_id is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Not authenticated',
      'operation_id', p_operation_id
    );
  end if;

  -- Resolve caller role & venue.
  select u.role, u.venue_id
    into v_user_role, v_user_venue
  from public.users u
  where u.id = v_user_id and u.deactivated_at is null;

  if v_user_role is null then
    return jsonb_build_object(
      'success', false,
      'message', 'User not found or deactivated',
      'operation_id', p_operation_id
    );
  end if;

  -- Idempotency: replay stored response if same key/user pair has been seen.
  select response into v_existing_response
  from public.event_save_idempotency
  where idempotency_key = p_idempotency_key and user_id = v_user_id;

  if v_existing_response is not null then
    return v_existing_response;
  end if;

  -- Allowlist payload fields (mirrors eventDraftSchema in src/lib/validation.ts).
  v_payload := jsonb_build_object(
    'event_id', p_payload->>'event_id',
    'venue_id', p_payload->>'venue_id',
    'title', p_payload->>'title',
    'event_type', p_payload->>'event_type',
    'start_at', p_payload->>'start_at',
    'end_at', p_payload->>'end_at',
    'venue_space', p_payload->>'venue_space',
    'expected_headcount', (p_payload->>'expected_headcount')::int,
    'wet_promo', p_payload->>'wet_promo',
    'food_promo', p_payload->>'food_promo',
    'cost_total', (p_payload->>'cost_total')::numeric,
    'cost_details', p_payload->>'cost_details',
    'booking_type', p_payload->>'booking_type',
    'ticket_price', (p_payload->>'ticket_price')::numeric,
    'check_in_cutoff_minutes', (p_payload->>'check_in_cutoff_minutes')::int,
    'age_policy', p_payload->>'age_policy',
    'accessibility_notes', p_payload->>'accessibility_notes',
    'cancellation_window_hours', (p_payload->>'cancellation_window_hours')::int,
    'terms_and_conditions', p_payload->>'terms_and_conditions',
    'goal_focus', p_payload->>'goal_focus',
    'notes', p_payload->>'notes',
    'public_title', p_payload->>'public_title',
    'public_teaser', p_payload->>'public_teaser',
    'public_description', p_payload->>'public_description',
    'public_highlights', p_payload->'public_highlights',
    'booking_url', p_payload->>'booking_url',
    'seo_title', p_payload->>'seo_title',
    'seo_description', p_payload->>'seo_description',
    'seo_slug', p_payload->>'seo_slug',
    'manager_responsible_id', nullif(p_payload->>'manager_responsible_id', '')::uuid
  );

  v_event_id := nullif(v_payload->>'event_id', '')::uuid;
  v_is_create := v_event_id is null;
  v_venue_ids := coalesce((select array_agg((value)::uuid) from jsonb_array_elements_text(p_payload->'venue_ids')), array[]::uuid[]);
  v_artist_ids := coalesce((select array_agg((value)::uuid) from jsonb_array_elements_text(p_payload->'artist_ids')), array[]::uuid[]);

  -- Authz.
  if v_is_create then
    if v_user_role not in ('administrator', 'office_worker') then
      return jsonb_build_object('success', false, 'message', 'Permission denied', 'operation_id', p_operation_id);
    end if;
  else
    -- Edit: caller must own the event, be at the venue, or be admin.
    if not exists (
      select 1 from public.events e
      where e.id = v_event_id
        and e.deleted_at is null
        and (
          v_user_role = 'administrator'
          or e.created_by = v_user_id
          or (v_user_role = 'office_worker' and (v_user_venue is null or v_user_venue = e.venue_id))
        )
    ) then
      return jsonb_build_object('success', false, 'message', 'Permission denied or event not found', 'operation_id', p_operation_id);
    end if;
  end if;

  -- Begin Core writes. Any error inside this block raises and rolls back the whole transaction.
  begin
    if v_is_create then
      v_event_id := gen_random_uuid();
      insert into public.events (
        id, venue_id, created_by, title, event_type, start_at, end_at,
        venue_space, expected_headcount, wet_promo, food_promo,
        cost_total, cost_details, booking_type, ticket_price,
        check_in_cutoff_minutes, age_policy, accessibility_notes,
        cancellation_window_hours, terms_and_conditions, goal_focus, notes,
        public_title, public_teaser, public_description, public_highlights,
        booking_url, seo_title, seo_description, seo_slug,
        manager_responsible_id, status, created_at, updated_at
      ) values (
        v_event_id,
        (v_payload->>'venue_id')::uuid,
        v_user_id,
        v_payload->>'title',
        v_payload->>'event_type',
        (v_payload->>'start_at')::timestamptz,
        (v_payload->>'end_at')::timestamptz,
        v_payload->>'venue_space',
        (v_payload->>'expected_headcount')::int,
        v_payload->>'wet_promo',
        v_payload->>'food_promo',
        (v_payload->>'cost_total')::numeric,
        v_payload->>'cost_details',
        v_payload->>'booking_type',
        (v_payload->>'ticket_price')::numeric,
        (v_payload->>'check_in_cutoff_minutes')::int,
        v_payload->>'age_policy',
        v_payload->>'accessibility_notes',
        (v_payload->>'cancellation_window_hours')::int,
        v_payload->>'terms_and_conditions',
        v_payload->>'goal_focus',
        v_payload->>'notes',
        v_payload->>'public_title',
        v_payload->>'public_teaser',
        v_payload->>'public_description',
        case when jsonb_typeof(v_payload->'public_highlights') = 'array'
             then array(select jsonb_array_elements_text(v_payload->'public_highlights'))
             else null end,
        v_payload->>'booking_url',
        v_payload->>'seo_title',
        v_payload->>'seo_description',
        v_payload->>'seo_slug',
        nullif(v_payload->>'manager_responsible_id','')::uuid,
        'draft',
        v_now,
        v_now
      );
    else
      -- Update with optimistic concurrency.
      update public.events e set
        venue_id = (v_payload->>'venue_id')::uuid,
        title = v_payload->>'title',
        event_type = v_payload->>'event_type',
        start_at = (v_payload->>'start_at')::timestamptz,
        end_at = (v_payload->>'end_at')::timestamptz,
        venue_space = v_payload->>'venue_space',
        expected_headcount = (v_payload->>'expected_headcount')::int,
        wet_promo = v_payload->>'wet_promo',
        food_promo = v_payload->>'food_promo',
        cost_total = (v_payload->>'cost_total')::numeric,
        cost_details = v_payload->>'cost_details',
        booking_type = v_payload->>'booking_type',
        ticket_price = (v_payload->>'ticket_price')::numeric,
        check_in_cutoff_minutes = (v_payload->>'check_in_cutoff_minutes')::int,
        age_policy = v_payload->>'age_policy',
        accessibility_notes = v_payload->>'accessibility_notes',
        cancellation_window_hours = (v_payload->>'cancellation_window_hours')::int,
        terms_and_conditions = v_payload->>'terms_and_conditions',
        goal_focus = v_payload->>'goal_focus',
        notes = v_payload->>'notes',
        public_title = v_payload->>'public_title',
        public_teaser = v_payload->>'public_teaser',
        public_description = v_payload->>'public_description',
        public_highlights = case when jsonb_typeof(v_payload->'public_highlights') = 'array'
             then array(select jsonb_array_elements_text(v_payload->'public_highlights'))
             else null end,
        booking_url = v_payload->>'booking_url',
        seo_title = v_payload->>'seo_title',
        seo_description = v_payload->>'seo_description',
        seo_slug = v_payload->>'seo_slug',
        manager_responsible_id = nullif(v_payload->>'manager_responsible_id','')::uuid,
        updated_at = v_now
      where e.id = v_event_id
        and e.deleted_at is null
        and (p_expected_updated_at is null or e.updated_at = p_expected_updated_at);

      if not found then
        raise exception 'CONFLICT: event was modified by another session' using errcode = 'P0001';
      end if;
    end if;

    -- Sync artists with SAVEPOINT-for-diagnostics-only.
    delete from public.event_artists where event_id = v_event_id and artist_id <> all(coalesce(v_artist_ids, array[]::uuid[]));
    if v_artist_ids is not null then
      foreach v_artist_id in array v_artist_ids loop
        begin
          insert into public.event_artists (event_id, artist_id, billing_order, created_by)
          values (v_event_id, v_artist_id, 1, v_user_id)
          on conflict (event_id, artist_id) do nothing;
        exception when others then
          v_failed := v_failed || jsonb_build_object('kind', 'artist', 'id', v_artist_id, 'reason', SQLERRM);
        end;
      end loop;
    end if;

    -- Sync venues with SAVEPOINT-for-diagnostics-only via the existing helper.
    if v_venue_ids is not null and array_length(v_venue_ids, 1) >= 1 then
      begin
        perform public.set_event_venues(v_event_id, v_venue_ids);
      exception when others then
        v_failed := v_failed || jsonb_build_object('kind', 'venue', 'id', null, 'reason', SQLERRM);
      end;
    end if;

    -- If any per-row failures, RAISE so the parent transaction rolls back the whole event.
    if jsonb_array_length(v_failed) > 0 then
      raise exception 'CORE_LINKED_WRITE_FAILED' using errcode = 'P0001', detail = v_failed::text;
    end if;

    -- Append event_versions snapshot.
    insert into public.event_versions (event_id, version, payload, submitted_at, submitted_by, created_at)
    values (
      v_event_id,
      coalesce((select max(version) + 1 from public.event_versions where event_id = v_event_id), 1),
      v_payload,
      null,
      null,
      v_now
    );

    -- Audit log row.
    insert into public.audit_log (entity, entity_id, action, meta, actor_id, created_at)
    values (
      'event',
      v_event_id,
      case when v_is_create then 'event.created' else 'event.draft_updated' end,
      jsonb_build_object(
        'operation_id', p_operation_id,
        'idempotency_key', p_idempotency_key
      ),
      v_user_id,
      v_now
    );
  end;

  -- Persist idempotency response so retries replay it.
  insert into public.event_save_idempotency (idempotency_key, user_id, event_id, response, created_at)
  values (
    p_idempotency_key,
    v_user_id,
    v_event_id,
    jsonb_build_object(
      'success', true,
      'event_id', v_event_id,
      'failed', '[]'::jsonb,
      'warnings', v_warnings,
      'operation_id', p_operation_id
    ),
    v_now
  );

  return jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'failed', '[]'::jsonb,
    'warnings', v_warnings,
    'operation_id', p_operation_id
  );

exception when others then
  -- Surface the structured failure if the inner block raised CORE_LINKED_WRITE_FAILED.
  if SQLSTATE = 'P0001' and SQLERRM like 'CORE_LINKED_WRITE_FAILED%' then
    return jsonb_build_object(
      'success', false,
      'event_id', null,
      'failed', v_failed,
      'message', 'Core linked-write failure',
      'operation_id', p_operation_id
    );
  end if;
  -- CONFLICT (optimistic concurrency)
  if SQLSTATE = 'P0001' and SQLERRM like 'CONFLICT%' then
    return jsonb_build_object(
      'success', false,
      'message', 'This event was changed by another session. Reload and try again.',
      'operation_id', p_operation_id,
      'conflict', true
    );
  end if;
  -- Fallback
  return jsonb_build_object(
    'success', false,
    'message', SQLERRM,
    'operation_id', p_operation_id
  );
end;
$$;

revoke all on function public.save_event_draft(jsonb, uuid, uuid, timestamptz) from public;
grant execute on function public.save_event_draft(jsonb, uuid, uuid, timestamptz) to authenticated;
```

- [ ] **Step 2: Push migration**

```bash
npm run supabase:migrate
```

- [ ] **Step 3: Run advisors**

```
mcp__plugin_supabase_supabase__get_advisors({ type: "security" })
```
Confirm: no warnings on the new function (search_path set, EXECUTE not granted to PUBLIC).

- [ ] **Step 4: Regenerate types**

```bash
npx supabase gen types typescript --linked --schema public > src/lib/supabase/database.types.ts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<timestamp>_save_event_draft_rpc.sql src/lib/supabase/database.types.ts
git commit -m "feat(events): add save_event_draft RPC with idempotency, optimistic concurrency, savepoint diagnostics"
```

---

### Task B2: `submit_event_for_review` companion RPC

**Files:**
- Create: `supabase/migrations/<UTC_TIMESTAMP>_submit_event_for_review_rpc.sql`

- [ ] **Step 1: Create the RPC**

This RPC reuses most of `save_event_draft`'s shape but adds: required-fields validation (matching the existing CHECK on `events`), status transition to `'submitted'` (or `'pending_approval'` for proposal-promoted events), and the `event_versions.submitted_at` + `submitted_by` columns.

Pattern (abbreviated; mirror the structure of B1 with these differences):

```sql
create or replace function public.submit_event_for_review(
  p_event_id uuid,
  p_idempotency_key uuid,
  p_operation_id uuid,
  p_expected_updated_at timestamptz default null,
  p_assignee_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_existing_response jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'message', 'Not authenticated', 'operation_id', p_operation_id);
  end if;

  -- Idempotency replay
  select response into v_existing_response
  from public.event_save_idempotency
  where idempotency_key = p_idempotency_key and user_id = v_user_id;
  if v_existing_response is not null then
    return v_existing_response;
  end if;

  -- Authz: must be able to edit (delegate to a SECURITY INVOKER helper or inline the same logic as B1).
  if not exists (select 1 from public.users u where u.id = v_user_id and u.role in ('administrator','office_worker') and u.deactivated_at is null) then
    return jsonb_build_object('success', false, 'message', 'Permission denied', 'operation_id', p_operation_id);
  end if;

  begin
    -- Required-fields enforcement (rely on existing CHECK constraint; the trigger will raise if missing).
    update public.events
       set status = 'submitted',
           submitted_at = v_now,
           updated_at = v_now,
           assignee_id = coalesce(p_assignee_id, assignee_id)
     where id = p_event_id
       and deleted_at is null
       and (p_expected_updated_at is null or updated_at = p_expected_updated_at);

    if not found then
      raise exception 'CONFLICT: event was modified or not found' using errcode = 'P0001';
    end if;

    -- Version snapshot
    insert into public.event_versions (event_id, version, payload, submitted_at, submitted_by, created_at)
    select p_event_id, coalesce(max(version)+1,1), to_jsonb(e.*), v_now, v_user_id, v_now
    from public.events e
    where e.id = p_event_id
    group by e.id, e.*;

    -- Audit
    insert into public.audit_log (entity, entity_id, action, meta, actor_id, created_at)
    values ('event', p_event_id, 'event.submitted',
            jsonb_build_object('operation_id', p_operation_id, 'idempotency_key', p_idempotency_key),
            v_user_id, v_now);
  end;

  -- Persist idempotency
  insert into public.event_save_idempotency (idempotency_key, user_id, event_id, response, created_at)
  values (
    p_idempotency_key, v_user_id, p_event_id,
    jsonb_build_object('success', true, 'event_id', p_event_id, 'operation_id', p_operation_id),
    v_now
  );

  return jsonb_build_object('success', true, 'event_id', p_event_id, 'operation_id', p_operation_id);

exception when others then
  if SQLSTATE = 'P0001' and SQLERRM like 'CONFLICT%' then
    return jsonb_build_object('success', false, 'conflict', true,
      'message', 'This event was changed by another session. Reload and try again.',
      'operation_id', p_operation_id);
  end if;
  return jsonb_build_object('success', false, 'message', SQLERRM, 'operation_id', p_operation_id);
end;
$$;

revoke all on function public.submit_event_for_review(uuid, uuid, uuid, timestamptz, uuid) from public;
grant execute on function public.submit_event_for_review(uuid, uuid, uuid, timestamptz, uuid) to authenticated;
```

- [ ] **Step 2: Push migration, regenerate types, commit**

```bash
npm run supabase:migrate
npx supabase gen types typescript --linked --schema public > src/lib/supabase/database.types.ts
git add supabase/migrations/<timestamp>_submit_event_for_review_rpc.sql src/lib/supabase/database.types.ts
git commit -m "feat(events): add submit_event_for_review RPC mirroring save_event_draft shape"
```

---

### Task B3: Rewire `saveEventDraftAction` and `submitEventForReviewAction` to call the new RPCs (behind feature flag)

**Files:**
- Create: `src/lib/events/save-rpc.ts` (new helper that builds the payload + calls the RPC)
- Modify: `src/actions/events.ts` (replace the body of `saveEventDraftAction` and `submitEventForReviewAction` with feature-flagged calls)
- Modify: `src/components/events/event-form.tsx` (send `idempotency_key` hidden input alongside `operation_id`)
- Test: `src/actions/__tests__/events-rpc.test.ts` (new)

- [ ] **Step 1: Create the RPC helper**

Create `src/lib/events/save-rpc.ts`:

```ts
import "server-only";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

type SaveDraftPayload = {
  event_id?: string | null;
  venue_id: string;
  venue_ids?: string[];
  artist_ids?: string[];
  title: string;
  event_type: string;
  start_at: string;
  end_at: string;
  /* …all the other allowlisted fields… */
  manager_responsible_id?: string | null;
};

export async function callSaveEventDraftRpc(args: {
  payload: SaveDraftPayload;
  idempotencyKey: string;
  operationId: string;
  expectedUpdatedAt?: string | null;
}): Promise<ActionResult & { eventId?: string; failed?: unknown[]; conflict?: boolean }> {
  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase.rpc("save_event_draft", {
    p_payload: args.payload as unknown as Record<string, unknown>,
    p_idempotency_key: args.idempotencyKey,
    p_operation_id: args.operationId,
    p_expected_updated_at: args.expectedUpdatedAt ?? null
  });

  if (error) {
    console.error(`[event-save:${args.operationId.slice(0,8)}] RPC error`, error);
    return { success: false, message: "Save failed at the database. Please try again.", operationId: args.operationId };
  }
  // The RPC returns jsonb; supabase-js returns it as the row data.
  const r = data as {
    success: boolean;
    event_id?: string;
    failed?: unknown[];
    warnings?: string[];
    operation_id: string;
    conflict?: boolean;
    message?: string;
  };
  if (r.success) {
    return {
      success: true,
      message: "Saved.",
      operationId: r.operation_id,
      warnings: r.warnings,
      eventId: r.event_id
    } as ActionResult & { eventId?: string };
  }
  return {
    success: false,
    message: r.message ?? "Save failed.",
    operationId: r.operation_id,
    conflict: r.conflict
  } as ActionResult & { conflict?: boolean };
}

export async function callSubmitEventForReviewRpc(args: {
  eventId: string;
  idempotencyKey: string;
  operationId: string;
  expectedUpdatedAt?: string | null;
  assigneeId?: string | null;
}): Promise<ActionResult & { eventId?: string; conflict?: boolean }> {
  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase.rpc("submit_event_for_review", {
    p_event_id: args.eventId,
    p_idempotency_key: args.idempotencyKey,
    p_operation_id: args.operationId,
    p_expected_updated_at: args.expectedUpdatedAt ?? null,
    p_assignee_id: args.assigneeId ?? null
  });
  if (error) {
    console.error(`[event-submit:${args.operationId.slice(0,8)}] RPC error`, error);
    return { success: false, message: "Submit failed at the database. Please try again.", operationId: args.operationId };
  }
  const r = data as { success: boolean; event_id?: string; operation_id: string; conflict?: boolean; message?: string };
  if (r.success) {
    return { success: true, message: "Submitted.", operationId: r.operation_id, eventId: r.event_id } as ActionResult & { eventId?: string };
  }
  return { success: false, message: r.message ?? "Submit failed.", operationId: r.operation_id, conflict: r.conflict };
}
```

- [ ] **Step 2: Add the feature-flag wiring**

Modify `src/actions/events.ts` — at the top of `saveEventDraftAction`, after permission checks, branch on the env var:

```ts
const USE_RPC = process.env.EVENT_SAVE_USE_RPC === "true";

if (USE_RPC) {
  // Build the payload from formData (extract the same fields the existing path extracts).
  const payload = buildSaveEventDraftPayload(formData);
  const result = await callSaveEventDraftRpc({
    payload,
    idempotencyKey,
    operationId,
    expectedUpdatedAt: typeof formData.get("expected_updated_at") === "string" ? formData.get("expected_updated_at") as string : null
  });
  if (result.success) {
    revalidatePath("/events");
    if (result.eventId) revalidatePath(`/events/${result.eventId}`);
  }
  return result;
}
// Existing path continues...
```

Add a `buildSaveEventDraftPayload(formData: FormData): SaveDraftPayload` helper inside `src/lib/events/save-rpc.ts` (or alongside it) that extracts all fields with the same parsing rules used in the existing action. Reuse the existing Zod parse to validate first; if it fails, return the existing fieldErrors path WITHOUT calling the RPC.

- [ ] **Step 3: Same for `submitEventForReviewAction`**

```ts
if (USE_RPC) {
  const result = await callSubmitEventForReviewRpc({
    eventId: rawEventId,
    idempotencyKey,
    operationId,
    expectedUpdatedAt: ...,
    assigneeId: ...
  });
  if (result.success) {
    revalidatePath("/events");
    revalidatePath(`/events/${rawEventId}`);
  }
  return result;
}
```

- [ ] **Step 4: Form sends idempotency_key + expected_updated_at**

In `event-form.tsx`, alongside the `operation_id` hidden input added in A5, add:
```tsx
const idempotencyKeyRef = useRef<string>(uuidv7());
// ... regenerate on success along with operation_id ...

<input type="hidden" name="idempotency_key" value={idempotencyKeyRef.current} />
{mode === "edit" && defaultValues?.updated_at ? (
  <input type="hidden" name="expected_updated_at" value={defaultValues.updated_at} />
) : null}
```

- [ ] **Step 5: Read the keys in the actions**

In both actions, near the operation_id read:
```ts
const idempotencyKey = (formData.get("idempotency_key") as string) ?? crypto.randomUUID();
```

- [ ] **Step 6: Add a Vitest test for the flagged path**

Create `src/actions/__tests__/events-rpc.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseActionClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));

describe("saveEventDraftAction with EVENT_SAVE_USE_RPC=true", () => {
  beforeEach(() => {
    process.env.EVENT_SAVE_USE_RPC = "true";
    vi.clearAllMocks();
  });

  it("calls the save_event_draft RPC and returns the operation_id from the response", async () => {
    /* mock createSupabaseActionClient to return { rpc: vi.fn().mockResolvedValue({ data: { success: true, event_id: "...", operation_id: "..." } }) } */
    const { saveEventDraftAction } = await import("@/actions/events");
    const fd = new FormData();
    fd.set("operation_id", "01234567-89ab-7cdf-8123-000000000000");
    fd.set("idempotency_key", "11111111-2222-3333-4444-555555555555");
    /* set required fields */
    const result = await saveEventDraftAction(undefined, fd);
    expect(result.success).toBe(true);
    expect(result.operationId).toBe("01234567-89ab-7cdf-8123-000000000000");
  });
});
```

- [ ] **Step 7: Verify the test, then remove the legacy in-action `.catch(() => {})` patterns**

Locate and delete the three `.catch(() => {})` calls at events.ts:886, 1012, 2150. Each was guarding `recordAuditLogEntry(...)` — replace with awaiting the call and surfacing failure as `{success: false}`. (This applies to BOTH the legacy code path AND the RPC-flag path; in the RPC path the audit is done inside the RPC, so these legacy lines only matter for the non-flag path.)

- [ ] **Step 8: Run tests, lint, typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/actions/events.ts src/lib/events/save-rpc.ts \
        src/components/events/event-form.tsx \
        src/actions/__tests__/events-rpc.test.ts
git commit -m "feat(events): add EVENT_SAVE_USE_RPC flag wiring save/submit through new RPCs"
```

---

### Task B4: Image state machine + `/api/cron/reconcile-event-images`

**Files:**
- Create: `src/app/api/cron/reconcile-event-images/route.ts`
- Modify: `src/actions/events.ts` (in the RPC path: after a successful save, attempt the image upload + second `UPDATE events SET event_image_path`; on storage success but DB-update failure, set `pending_image_attach`)
- Modify: `src/components/events/event-form.tsx` (show "image not attached, retry" affordance when `warnings` includes `image-…`)
- Test: `src/lib/events/__tests__/image-state-machine.test.ts`

- [ ] **Step 1: Add image-attach logic in the RPC path of `saveEventDraftAction`**

After the RPC returns success in `saveEventDraftAction`, if the form included a new image:
```ts
if (result.success && imageFile) {
  const supabase = await createSupabaseAdminClient();
  const path = `${result.eventId}/${Date.now()}.${imageFile.type.split("/")[1] ?? "bin"}`;
  const upload = await supabase.storage.from("event-images").upload(path, imageFile, { upsert: true });
  if (upload.error) {
    result.warnings = [...(result.warnings ?? []), "image-upload-failed"];
  } else {
    const { error: attachErr } = await supabase
      .from("events")
      .update({ event_image_path: upload.data.path, pending_image_attach: null })
      .eq("id", result.eventId);
    if (attachErr) {
      // Storage succeeded but DB attach failed — flag for reconciliation.
      await supabase
        .from("events")
        .update({ pending_image_attach: upload.data.path })
        .eq("id", result.eventId);
      result.warnings = [...(result.warnings ?? []), "image-attach-pending"];
    }
  }
}
```

- [ ] **Step 2: Surface warning in the UI**

In `event-form.tsx`, after the success branch of the toast effect:
```tsx
if (draftState?.warnings?.includes("image-upload-failed")) {
  toast.warning("Saved, but the image upload failed. Try uploading again.");
} else if (draftState?.warnings?.includes("image-attach-pending")) {
  toast.warning("Saved, but the image is still attaching. It will appear shortly.");
}
```

- [ ] **Step 3: Create the reconcile cron**

`src/app/api/cron/reconcile-event-images/route.ts`:
```ts
import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/cron-auth";

export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(JSON.stringify({ event: "cron.invoked", endpoint: "reconcile-event-images", timestamp: new Date().toISOString() }));

  const db = createSupabaseAdminClient();
  const { data: pending, error } = await db
    .from("events")
    .select("id, pending_image_attach, created_at")
    .not("pending_image_attach", "is", null)
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let reconciled = 0;
  let purged = 0;
  for (const row of pending ?? []) {
    if (!row.pending_image_attach) continue;
    // Try to attach the path now.
    const { error: attachErr } = await db
      .from("events")
      .update({ event_image_path: row.pending_image_attach, pending_image_attach: null })
      .eq("id", row.id);
    if (!attachErr) {
      reconciled++;
      continue;
    }
    // If older than 7 days and still failing, delete the orphan storage object.
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (ageMs > 7 * 24 * 60 * 60 * 1000) {
      await db.storage.from("event-images").remove([row.pending_image_attach]);
      await db.from("events").update({ pending_image_attach: null }).eq("id", row.id);
      purged++;
    }
  }

  return NextResponse.json({ reconciled, purged, pending: pending?.length ?? 0 });
}
```

- [ ] **Step 4: Add the cron entry to `vercel.json` (if used) or document the schedule**

```bash
cat vercel.json 2>/dev/null | grep -A3 crons
```
If a `crons` section exists, append:
```json
{ "path": "/api/cron/reconcile-event-images", "schedule": "0 3 * * *" }
```
Otherwise, leave it for the deployer to wire — note in the commit message.

- [ ] **Step 5: Test**

Create `src/lib/events/__tests__/image-state-machine.test.ts` with mocked Supabase admin client:
```ts
it("sets pending_image_attach when storage upload succeeds but DB attach fails", async () => { /* ... */ });
it("clears pending_image_attach on next reconcile cron run", async () => { /* ... */ });
```

- [ ] **Step 6: Commit**

```bash
git add src/actions/events.ts \
        src/components/events/event-form.tsx \
        src/app/api/cron/reconcile-event-images/route.ts \
        src/lib/events/__tests__/image-state-machine.test.ts \
        vercel.json
git commit -m "feat(events): compensating image upload state machine + reconcile cron"
```

---

### Task B5: Document the feature flag + .env.example

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md` (the project-level one) under "Environment Variables"

- [ ] **Step 1: Add to .env.example**

Append:
```
# Phase B′ — set to "true" to enable the atomic save_event_draft RPC.
# Both old and new save paths coexist for a release cycle; flip after smoke.
EVENT_SAVE_USE_RPC=
```

- [ ] **Step 2: Document in project CLAUDE.md**

Find the env-var table in the project CLAUDE.md and add:
```
| `EVENT_SAVE_USE_RPC` | Phase B′ feature flag — `"true"` enables the atomic event-save RPC; absent or `"false"` uses the legacy multi-write path. |
```

- [ ] **Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs(events): document EVENT_SAVE_USE_RPC feature flag"
```

---

### Task B6: Replace `as any` casts in events.ts with generated types

**Files:**
- Modify: `src/actions/events.ts`
- Modify: `src/lib/events/save-rpc.ts` (if any `as any` slipped in)

- [ ] **Step 1: Find every `as any` in events.ts**

```bash
grep -n " as any" src/actions/events.ts
```

- [ ] **Step 2: Replace with the generated types**

For each match, import the relevant table row type from `@/lib/supabase/database.types` and use it. Common pattern:
```ts
import type { Database } from "@/lib/supabase/database.types";
type EventRow = Database["public"]["Tables"]["events"]["Row"];
```

- [ ] **Step 3: Run typecheck and lint**

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/actions/events.ts src/lib/events/save-rpc.ts
git commit -m "chore(events): replace as any casts with generated Supabase types"
```

---

### Phase B′ verification gate

- [ ] **Step 1: Run all event tests**

```bash
npm test -- events
```

- [ ] **Step 2: Lint, typecheck, build**

```bash
npm run lint && npm run typecheck && npm run build
```

- [ ] **Step 3: Run advisors on the new RPC**

```
mcp__plugin_supabase_supabase__get_advisors({ type: "security" })
```

- [ ] **Step 4: Smoke test with the flag**

If a preview environment is available, set `EVENT_SAVE_USE_RPC=true` and walk the create + edit + submit flows.

---

## Phase B″ — Propose flow remediation (1 day)

**Goal:** Bring `proposeEventAction` and the propose-form helper under the same atomic shape as Phase B′.

---

### Task B″1: `propose_event_draft` RPC

**Files:**
- Create: `supabase/migrations/<UTC_TIMESTAMP>_propose_event_draft_rpc.sql`

- [ ] **Step 1: Create the RPC**

Mirror `save_event_draft` (B1) with these differences: target status is `'pending_approval'` (not `'draft'`); required-fields validation is relaxed (date + description only per existing migration `20260417*`); insert into `event_creation_batches` using the same idempotency key for cross-flow consistency.

Use the same SECURITY DEFINER, search_path, EXECUTE-grant pattern.

- [ ] **Step 2: Push migration, regenerate types, commit**

```bash
npm run supabase:migrate
npx supabase gen types typescript --linked --schema public > src/lib/supabase/database.types.ts
git add supabase/migrations/<timestamp>_propose_event_draft_rpc.sql src/lib/supabase/database.types.ts
git commit -m "feat(events): add propose_event_draft RPC mirroring save_event_draft"
```

---

### Task B″2: Rewire `proposeEventAction` behind the same flag

**Files:**
- Modify: `src/actions/events.ts` (or wherever `proposeEventAction` lives — search via `grep -rn "proposeEventAction" src/actions/`)
- Modify: the propose-form helper component (`ProposeEventForm`) to send `operation_id` and `idempotency_key`
- Test: `src/actions/__tests__/events-propose-rpc.test.ts`

- [ ] **Step 1: Locate the action**

```bash
grep -rn "proposeEventAction" src/actions/ src/components/
```

- [ ] **Step 2: Add the flag-gated path calling `propose_event_draft`**

Same shape as B3 Step 2 — read `operation_id` and `idempotency_key`, branch on `EVENT_SAVE_USE_RPC`, call the new RPC via a sibling helper `callProposeEventDraftRpc` in `src/lib/events/save-rpc.ts`.

- [ ] **Step 3: Update the propose form to send both keys**

Mirror the changes from B3 Step 4 in the propose-form helper component.

- [ ] **Step 4: Test cross-navigation idempotency**

Add a test that asserts: navigating away and back to the propose form generates a NEW idempotency_key (the user expects a fresh submission). Use `useRef` initialised at mount; the previous fix `5a84fbf` made this stable per-mount, so this should already hold — confirm via test.

- [ ] **Step 5: Commit**

```bash
git add src/actions/events.ts \
        src/components/events/propose-event-form.tsx \
        src/lib/events/save-rpc.ts \
        src/actions/__tests__/events-propose-rpc.test.ts
git commit -m "feat(events): rewire proposeEventAction through propose_event_draft RPC behind flag"
```

---

### Phase B″ verification gate

```bash
npm test
npm run lint && npm run typecheck && npm run build
```

---

## Phase C′ — Verification & observability (1.5 days)

**Goal:** Add integration tests against a local Supabase, structured logging, audit-coverage CI extension, and Playwright golden + edge tests.

---

### Task C1: Local Supabase integration tests for the new RPCs

**Files:**
- Create: `src/lib/events/__tests__/save-event-draft.integration.test.ts`
- Create: `src/lib/events/__tests__/submit-event-for-review.integration.test.ts`
- Create: `src/lib/events/__tests__/propose-event-draft.integration.test.ts`
- Create: `vitest.integration.config.ts` (if separate config preferred)

- [ ] **Step 1: Decide on local Supabase setup**

```bash
ls supabase/.temp 2>/dev/null
which supabase
supabase --version
```
If `supabase` CLI is installed, integration tests can run via `supabase start` then connect to the local instance.

- [ ] **Step 2: Create an integration helper**

`src/test-utils/local-supabase.ts`:
```ts
import { createClient } from "@supabase/supabase-js";
export function getLocalAdminClient() {
  return createClient(
    process.env.SUPABASE_LOCAL_URL ?? "http://127.0.0.1:54321",
    process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
export function getLocalUserClient(jwt: string) {
  return createClient(
    process.env.SUPABASE_LOCAL_URL ?? "http://127.0.0.1:54321",
    process.env.SUPABASE_LOCAL_ANON_KEY!,
    { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );
}
```

- [ ] **Step 3: Write the integration tests**

For `save-event-draft.integration.test.ts`:
- Test 1: Success path inserts event + version + audit row in one tx.
- Test 2: RLS-denial venue (caller not in venue) → `failed: [{kind:"venue", ...}]` returned, zero rows committed.
- Test 3: SAVEPOINT rollback (bad artist_id triggering FK violation) → zero rows committed.
- Test 4: Idempotency replay (same key called twice) → same response, exactly one event row.
- Test 5: Optimistic concurrency (stale `expected_updated_at`) → `conflict: true` returned.

Each test seeds users + venue + artist via the admin client, calls `supabase.rpc("save_event_draft", { ... })` as the user JWT, asserts on the row count + response shape.

- [ ] **Step 4: Add a script to run integration tests**

Modify `package.json` scripts:
```json
"test:integration": "vitest run --config vitest.integration.config.ts"
```

`vitest.integration.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30000,
    setupFiles: ["./src/test-utils/integration-setup.ts"]
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/events/__tests__/*.integration.test.ts \
        src/test-utils/local-supabase.ts \
        vitest.integration.config.ts \
        package.json
git commit -m "test(events): integration suite for save/submit/propose RPCs"
```

---

### Task C2: Real-DB concurrency test

**Files:**
- Create: `src/lib/events/__tests__/save-event-draft.concurrency.integration.test.ts`

- [ ] **Step 1: Write the concurrency test**

```ts
it("two concurrent saves with the same idempotency_key produce exactly one event row", async () => {
  const key = crypto.randomUUID();
  const opId = crypto.randomUUID();
  const payload = { /* minimal valid */ };
  const [a, b] = await Promise.all([
    user.rpc("save_event_draft", { p_payload: payload, p_idempotency_key: key, p_operation_id: opId }),
    user.rpc("save_event_draft", { p_payload: payload, p_idempotency_key: key, p_operation_id: opId })
  ]);
  expect(a.data.event_id).toBe(b.data.event_id);
  const { count } = await admin.from("events").select("*", { count: "exact", head: true }).eq("id", a.data.event_id);
  expect(count).toBe(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/events/__tests__/save-event-draft.concurrency.integration.test.ts
git commit -m "test(events): concurrency test for idempotency uniqueness"
```

---

### Task C3: Supabase advisor in CI

**Files:**
- Modify: `.github/workflows/ci.yml` (or whichever CI file the project uses; search via `ls .github/workflows/`)

- [ ] **Step 1: Locate the CI file**

```bash
ls .github/workflows/ 2>/dev/null
```

- [ ] **Step 2: Add an advisor step**

Append a job step (after `npm test`):
```yaml
      - name: Supabase advisors
        run: |
          npx supabase db lint --linked || echo "advisor warnings — review"
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```
If the project uses Supabase MCP advisors instead, document the manual step in `tasks/security-checklist.md`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore(ci): run supabase advisors on every push"
```

---

### Task C4: Structured logging on every action invocation

**Files:**
- Create: `src/lib/observability/event-action-log.ts`
- Modify: `src/actions/events.ts` (call the logger at end of every action)

- [ ] **Step 1: Create the helper**

```ts
import "server-only";

export type EventActionLogEntry = {
  operation_id: string;
  user_id: string;
  action: "save_event_draft" | "submit_event_for_review" | "propose_event_draft";
  duration_ms: number;
  outcome: "success" | "failure" | "conflict";
  warning_count?: number;
  failed_count?: number;
};

export function logEventAction(entry: EventActionLogEntry): void {
  console.log(JSON.stringify({ kind: "event-action", ...entry }));
}
```

- [ ] **Step 2: Wire it into each action**

In `saveEventDraftAction`, capture `const t0 = Date.now();` at top and at every return path:
```ts
logEventAction({
  operation_id: operationId,
  user_id: user.id,
  action: "save_event_draft",
  duration_ms: Date.now() - t0,
  outcome: result.success ? "success" : (result.conflict ? "conflict" : "failure"),
  warning_count: result.warnings?.length,
  failed_count: result.failed?.length
});
return result;
```

Repeat for `submitEventForReviewAction` and `proposeEventAction`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/observability/event-action-log.ts src/actions/events.ts
git commit -m "feat(events): structured logging on every event action invocation"
```

---

### Task C5: Audit-coverage CI guard extension (no `.catch(() => {})`)

**Files:**
- Modify: `src/actions/__tests__/audit-coverage.test.ts`

- [ ] **Step 1: Add a static-source assertion**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

it("events.ts contains no .catch(() => {}) error-swallow patterns", () => {
  const src = readFileSync(resolve(__dirname, "../events.ts"), "utf8");
  expect(src).not.toMatch(/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/);
});
```

- [ ] **Step 2: Run the test, verify it passes (we removed those in B3 Step 7)**

```bash
npx vitest run src/actions/__tests__/audit-coverage.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/__tests__/audit-coverage.test.ts
git commit -m "test(audit): forbid .catch(() => {}) patterns in events.ts"
```

---

### Task C6: Playwright tests (golden + edge)

**Files:**
- Modify: `playwright.config.ts` (if exists) or create
- Create: `tests/e2e/events-create.spec.ts`

- [ ] **Step 1: Check Playwright is set up**

```bash
ls playwright.config.ts 2>/dev/null
grep -l "@playwright" package.json
```
If absent, this task is deferred — note in commit. If present, proceed.

- [ ] **Step 2: Golden path test**

```ts
test("create draft → edit → submit", async ({ page }) => {
  await page.goto("/login");
  /* ... auth flow ... */
  await page.goto("/events/new");
  await page.fill('[name="title"]', "E2E Test Event");
  /* ... fill required fields ... */
  await page.click('button:has-text("Save draft")');
  await expect(page.getByText("Saved")).toBeVisible();
  /* ... edit and submit ... */
});
```

- [ ] **Step 3: Edge path — simulated venue RPC failure**

```ts
test("venue sync failure preserves form input and shows operation_id", async ({ page }) => {
  /* intercept the RPC, return failed:[{kind:'venue'}] */
  /* assert form retains inputs, error toast visible with (ref: ...) */
});
```

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/events-create.spec.ts playwright.config.ts
git commit -m "test(e2e): playwright golden + venue-failure edge case for event creation"
```

---

### Phase C′ verification gate

```bash
npm run lint && npm run typecheck && npm run build && npm test
npm run test:integration  # if local Supabase is running
```

---

## Final verification

- [ ] **Step 1: Full project verification pipeline**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

- [ ] **Step 2: Run audit-coverage guard**

```bash
npx vitest run src/actions/__tests__/audit-coverage.test.ts
```

- [ ] **Step 3: Confirm migrations are clean**

```
mcp__plugin_supabase_supabase__get_advisors({ type: "security" })
mcp__plugin_supabase_supabase__get_advisors({ type: "performance" })
```

- [ ] **Step 4: Verify the feature flag works in both states**

```bash
EVENT_SAVE_USE_RPC=true npm run dev   # ensures legacy + RPC paths both compile
EVENT_SAVE_USE_RPC=false npm run dev
```

- [ ] **Step 5: Final commit if anything outstanding**

```bash
git status
```

---

## Self-review summary

**Spec coverage:**
- §1–§4 (problem, flow, findings, root causes): documented as context only — no implementation tasks needed.
- §5 criticality taxonomy: encoded in B1 (`save_event_draft` returns `failed[]` only for Core; warnings only for Compensatable/Optional in B4).
- §6 Phase A′: A1–A7 covered by Tasks A1, A2, A3, A4, A5/A7, A6.
- §6 Phase B′: B1–B6 covered by Tasks B0, B1, B2, B3, B4, B5, B6.
- §6 Phase B″: B″1–B″3 covered by Tasks B″1, B″2.
- §6 Phase C′: C1–C6 covered by Tasks C1, C2, C3, C4, C5, C6.
- §7 acceptance criteria: implicitly covered by the tests in C1, C2, C6.
- §11 risks: flag wiring (B5), `key` prop pattern (A4), supabase advisors (C3).
- §13 pre-implementation checklist: re-running codex with source files included is **deferred** at user instruction (proceeding to implementation directly).

**Placeholder scan:** No "TBD" or "implement later" without code. Every code step shows the code.

**Type consistency:** `save_event_draft` / `submit_event_for_review` / `propose_event_draft` referenced consistently. `idempotency_key`, `operation_id`, `expected_updated_at` parameter names consistent across migrations and helpers.

---

## Execution notes

- Run **Phase A′ tasks first**, in the order listed (A1→A2→A3→A4→A5/A7→A6). They are mostly independent within the phase but share the same files (event-form.tsx), so sequential execution avoids merge conflicts in implementation.
- **Phase B′ tasks are sequential** — B0 (idempotency table) MUST land before B1/B2 (RPCs reference the table); B1/B2 MUST land before B3 (action helper imports types).
- **Phase B″** depends on Phase B′ helpers being in place.
- **Phase C′** can begin in parallel with Phase B″ for tasks C5 (audit guard) and C3 (CI advisor); the integration tests (C1, C2) and observability (C4) require Phase B′ to be fully merged.
- Each commit must pass `npm run lint && npm run typecheck && npm test` before pushing. Use `git stash` if mid-task verification fails — diagnose and fix; don't bypass.
