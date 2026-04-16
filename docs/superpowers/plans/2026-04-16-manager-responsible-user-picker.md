# Manager Responsible User Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `manager_responsible` from free text to a user FK with people picker, and wire debrief assignment to the manager responsible with creator fallback.

**Architecture:** Migration drops text columns and adds UUID FKs + updates RLS and reassignment RPCs. Event form and venue settings get user picker selects. Debrief permissions and dashboard todo scoping use manager_responsible_id with created_by fallback.

**Tech Stack:** PostgreSQL (Supabase), Next.js 16.1, React 19, TypeScript, Tailwind CSS, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-manager-responsible-user-picker-design.md`

---

## File Structure

### Modified Files
| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDD_manager_responsible_fk.sql` | New migration |
| `src/lib/supabase/types.ts` | Update Row types |
| `src/lib/validation.ts` | Zod schema: text → UUID |
| `src/lib/venues.ts` | Update venue create/update signatures |
| `src/lib/events.ts` | Update event upsert to use new FK |
| `src/actions/events.ts` | FormData field rename, write permission restriction |
| `src/actions/debriefs.ts` | Permission check + status update with manager_responsible_id |
| `src/actions/users.ts` | UserImpactSummary counts for new FKs |
| `src/actions/venues.ts` | FormData field rename |
| `src/app/debriefs/[eventId]/page.tsx` | Page access check with manager_responsible_id |
| `src/app/events/[eventId]/page.tsx` | Pass users to EventForm, display manager name |
| `src/app/events/new/page.tsx` | Pass users to EventForm |
| `src/components/events/event-form.tsx` | Add users prop, replace Input with Select |
| `src/components/venues/venues-manager.tsx` | Replace text input with user picker |
| `src/lib/dashboard.ts` | Update debrief scoping filters |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260416120000_manager_responsible_fk.sql`

- [ ] **Step 1: Create the migration file**

Read existing migration files in `supabase/migrations/` to find the latest timestamp and confirm column names. Then create:

```sql
-- Convert manager_responsible from text to user FK
-- Both columns are currently unpopulated (verified: 89 events, 12 venues, all null/empty)

-- 1. Events: drop text, add FK
ALTER TABLE events DROP COLUMN IF EXISTS manager_responsible;
ALTER TABLE events ADD COLUMN manager_responsible_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- 2. Venues: drop text, add FK
ALTER TABLE venues DROP COLUMN IF EXISTS default_manager_responsible;
ALTER TABLE venues ADD COLUMN default_manager_responsible_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- 3. Update debrief RLS policies to include manager_responsible_id
-- Drop existing office_worker debrief insert policy and recreate
DO $$
BEGIN
  -- Find and drop existing debrief insert policies for office_worker
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'debriefs' AND policyname LIKE '%office%insert%') THEN
    EXECUTE format('DROP POLICY IF EXISTS %I ON debriefs',
      (SELECT policyname FROM pg_policies WHERE tablename = 'debriefs' AND policyname LIKE '%office%insert%' LIMIT 1));
  END IF;
END $$;

-- Recreate with manager_responsible_id support
-- Note: Read actual policy names from the DB first, then drop/recreate by exact name
-- The migration agent should query pg_policies for exact names before writing DROP statements

-- 4. Update reassign_user_content RPC
CREATE OR REPLACE FUNCTION reassign_user_content(from_user_id uuid, to_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Existing reassignments (preserve all current lines)
  UPDATE events SET created_by = to_user_id WHERE created_by = from_user_id;
  UPDATE events SET assignee_id = to_user_id WHERE assignee_id = from_user_id;
  -- NEW: reassign manager_responsible_id
  UPDATE events SET manager_responsible_id = to_user_id WHERE manager_responsible_id = from_user_id;
  UPDATE planning_items SET owner_id = to_user_id WHERE owner_id = from_user_id;
  UPDATE planning_items SET created_by = to_user_id WHERE created_by = from_user_id;
  UPDATE planning_series SET owner_id = to_user_id WHERE owner_id = from_user_id;
  UPDATE planning_series SET created_by = to_user_id WHERE created_by = from_user_id;
  UPDATE planning_tasks SET assignee_id = to_user_id WHERE assignee_id = from_user_id;
  UPDATE planning_task_assignees SET user_id = to_user_id WHERE user_id = from_user_id;
  UPDATE planning_series_task_templates SET default_assignee_id = to_user_id WHERE default_assignee_id = from_user_id;
  UPDATE venues SET default_approver_id = to_user_id WHERE default_approver_id = from_user_id;
  -- NEW: reassign venue default manager
  UPDATE venues SET default_manager_responsible_id = to_user_id WHERE default_manager_responsible_id = from_user_id;
  UPDATE short_links SET created_by = to_user_id WHERE created_by = from_user_id;
  UPDATE event_artists SET created_by = to_user_id WHERE created_by = from_user_id;
END;
$$;
```

**IMPORTANT:** The migration agent must read the current `reassign_user_content` function body from the actual migration files first, then add the two new UPDATE lines. Do NOT guess the existing function body — read it from `supabase/migrations/20260416000000_user_deactivation.sql`.

Similarly, read the actual debrief RLS policy names from `supabase/migrations/20260415180000_rbac_renovation.sql` before writing DROP/CREATE statements.

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Expected: Migration applied successfully

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260416120000_manager_responsible_fk.sql
git commit -m "feat: migrate manager_responsible from text to user FK"
```

---

### Task 2: Update TypeScript Types, Zod Validation, and Lib Functions

**Files:**
- Modify: `src/lib/supabase/types.ts`
- Modify: `src/lib/validation.ts`
- Modify: `src/lib/venues.ts`
- Modify: `src/lib/events.ts`

- [ ] **Step 1: Update supabase types**

In `src/lib/supabase/types.ts`, find the events Row type and replace `manager_responsible: string | null` with `manager_responsible_id: string | null`. Find the venues Row type and replace `default_manager_responsible: string | null` with `default_manager_responsible_id: string | null`.

- [ ] **Step 2: Update Zod validation**

In `src/lib/validation.ts`, find `managerResponsible: z.string().max(200).optional().nullable()` (line ~130) and replace with:

```typescript
managerResponsibleId: z.string().uuid().optional().nullable(),
```

- [ ] **Step 3: Update venues lib**

In `src/lib/venues.ts`, update `createVenue` and `updateVenue` to use `defaultManagerResponsibleId` (camelCase) mapped to `default_manager_responsible_id` (snake_case). Read the file first to find exact locations.

- [ ] **Step 4: Update events lib**

In `src/lib/events.ts`, find where `manager_responsible` is written in event insert/upsert and change to `manager_responsible_id`. Read the file first.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Will show errors in actions/components that still reference old field names — that's expected, we'll fix those in subsequent tasks

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase/types.ts src/lib/validation.ts src/lib/venues.ts src/lib/events.ts
git commit -m "feat: update types, validation, and lib for manager_responsible_id FK"
```

---

### Task 3: Update Event Actions and Write Permission Restriction

**Files:**
- Modify: `src/actions/events.ts`

- [ ] **Step 1: Update FormData reading**

Find where `managerResponsible` is read from FormData (around line 653) and change to `managerResponsibleId`. Find where it's mapped to snake_case (around line 712) and change `manager_responsible` to `manager_responsible_id`.

Normalize empty string to null:
```typescript
manager_responsible_id: values.managerResponsibleId || null,
```

- [ ] **Step 2: Add write permission restriction**

In the event update action, after the permission check, add logic to strip `manager_responsible_id` if the user is not admin and not the event creator:

```typescript
// Only admin or event creator can set manager_responsible_id
if (user.role !== "administrator" && existingEvent.created_by !== user.id) {
  delete updatePayload.manager_responsible_id;
}
```

Read the file first to find the exact update action and where to insert this check.

- [ ] **Step 3: Commit**

```bash
git add src/actions/events.ts
git commit -m "feat: update event actions for manager_responsible_id FK with write restriction"
```

---

### Task 4: Update Debrief Permissions

**Files:**
- Modify: `src/actions/debriefs.ts`
- Modify: `src/app/debriefs/[eventId]/page.tsx`

- [ ] **Step 1: Update debrief action permission check**

In `src/actions/debriefs.ts`, find where the event is fetched (selecting `id, created_by, status`). Add `manager_responsible_id` to the select. Then update the permission check:

Replace the office_worker creator check with:
```typescript
// Manager responsible check with creator fallback
if (user.role !== "administrator") {
  const isManager = event.manager_responsible_id === user.id;
  const isCreatorFallback = !event.manager_responsible_id && event.created_by === user.id;
  if (!isManager && !isCreatorFallback) {
    return { success: false, message: "You do not have permission to submit this debrief." };
  }
}
```

- [ ] **Step 2: Update post-debrief status update**

Find the status update to "completed" (around line 126-135). Update the office_worker filter:

Replace:
```typescript
if (user.role === "office_worker") {
  updateQuery = updateQuery.eq("created_by", user.id);
}
```

With:
```typescript
if (user.role !== "administrator") {
  // Manager responsible can also update status
  updateQuery = updateQuery.or(
    `manager_responsible_id.eq.${user.id},and(manager_responsible_id.is.null,created_by.eq.${user.id})`
  );
}
```

- [ ] **Step 3: Update debrief page access check**

In `src/app/debriefs/[eventId]/page.tsx`, find the access check (around line 20). The page fetches the event — ensure `manager_responsible_id` is included. Then update:

Replace:
```typescript
const allowed =
  user.role === "administrator" || (user.role === "office_worker" && event.created_by === user.id);
```

With:
```typescript
const isManager = event.manager_responsible_id === user.id;
const isCreatorFallback = !event.manager_responsible_id && event.created_by === user.id;
const allowed = user.role === "administrator" || isManager || isCreatorFallback;
```

- [ ] **Step 4: Commit**

```bash
git add src/actions/debriefs.ts src/app/debriefs/[eventId]/page.tsx
git commit -m "feat: update debrief permissions for manager_responsible_id with creator fallback"
```

---

### Task 5: Update Dashboard Todo Scoping

**Files:**
- Modify: `src/lib/dashboard.ts`

- [ ] **Step 1: Update fetchDebriefTodos filter**

In `src/lib/dashboard.ts`, find `fetchDebriefTodos`. Replace the current filter:
```typescript
query = query.or(`created_by.eq.${user.id},assignee_id.eq.${user.id}`);
```

With:
```typescript
query = query.or(`manager_responsible_id.eq.${user.id},and(manager_responsible_id.is.null,created_by.eq.${user.id})`);
```

- [ ] **Step 2: Update getDebriefsDue filter**

Same change in `getDebriefsDue`:
```typescript
query = query.or(`manager_responsible_id.eq.${user.id},and(manager_responsible_id.is.null,created_by.eq.${user.id})`);
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboard.ts
git commit -m "feat: update dashboard debrief scoping for manager_responsible_id"
```

---

### Task 6: Event Form — User Picker

**Files:**
- Modify: `src/components/events/event-form.tsx`
- Modify: `src/app/events/[eventId]/page.tsx`
- Modify: `src/app/events/new/page.tsx`

- [ ] **Step 1: Add users prop to EventFormProps**

In `src/components/events/event-form.tsx`, add to the `EventFormProps` type:
```typescript
users?: Array<{ id: string; name: string }>;
```

- [ ] **Step 2: Replace state variables**

Replace:
```typescript
const [managerResponsible, setManagerResponsible] = useState((defaultValues as any)?.manager_responsible ?? "");
const [managerDirty, setManagerDirty] = useState(Boolean((defaultValues as any)?.manager_responsible));
```

With:
```typescript
const [managerResponsibleId, setManagerResponsibleId] = useState<string>((defaultValues as any)?.manager_responsible_id ?? "");
const [managerDirty, setManagerDirty] = useState(Boolean((defaultValues as any)?.manager_responsible_id));
```

- [ ] **Step 3: Update venue auto-fill**

Find `handleVenueChange` and the mount useEffect. Replace `default_manager_responsible` with `default_manager_responsible_id`:

```typescript
function handleVenueChange(value: string) {
  setSelectedVenueId(value);
  if (!managerDirty) {
    const venue = venues.find((v) => v.id === value);
    setManagerResponsibleId(venue?.default_manager_responsible_id ?? "");
  }
}
```

Same for the mount useEffect.

- [ ] **Step 4: Replace Input with Select**

Replace the manager responsible Input JSX with a Select:

```typescript
const managerResponsibleField = (
  <div className="space-y-2">
    <Label htmlFor="managerResponsibleId">Manager Responsible</Label>
    <select
      id="managerResponsibleId"
      name="managerResponsibleId"
      value={managerResponsibleId}
      onChange={(e) => {
        setManagerDirty(true);
        setManagerResponsibleId(e.target.value);
      }}
      className="flex h-10 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-400)] focus-visible:ring-offset-2"
    >
      <option value="">No manager assigned</option>
      {(users ?? []).map((u) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </select>
    <p className="text-xs text-subtle">
      The on-site manager accountable for this event.
    </p>
  </div>
);
```

- [ ] **Step 5: Wire users into event pages**

In `src/app/events/[eventId]/page.tsx`, `listAssignableUsers` is already called. Pass the result to EventForm:

```typescript
<EventForm
  // ... existing props
  users={assignableUsers.map((u) => ({ id: u.id, name: u.name }))}
/>
```

In `src/app/events/new/page.tsx`, add the same — read the file first to understand its current data fetching, then add `listAssignableUsers` and pass to EventForm.

- [ ] **Step 6: Display manager name on event detail**

In `src/app/events/[eventId]/page.tsx`, find where `getUsersByIds` is called. Add `event.manager_responsible_id` to the actor IDs set if it's not null. Then display the resolved name in the event summary section.

- [ ] **Step 7: Commit**

```bash
git add src/components/events/event-form.tsx src/app/events/[eventId]/page.tsx src/app/events/new/page.tsx
git commit -m "feat: replace manager responsible text input with user picker"
```

---

### Task 7: Venue Settings — User Picker

**Files:**
- Modify: `src/components/venues/venues-manager.tsx`
- Modify: `src/actions/venues.ts`
- Modify: `src/app/venues/page.tsx` (or wherever VenuesManager is rendered)

- [ ] **Step 1: Update venues action**

In `src/actions/venues.ts`, find where `defaultManagerResponsible` is read from FormData and mapped to DB. Change to `defaultManagerResponsibleId` / `default_manager_responsible_id`. Normalize empty string to null.

- [ ] **Step 2: Update VenuesManager component**

Read `src/components/venues/venues-manager.tsx`. Replace the text Input for default manager with a select picker. The component receives `reviewers` but that's admin-only users — it needs a full active users list. Check how the parent page passes data and update accordingly.

Replace:
```html
<Input
  id={`venue-manager-${venue.id}`}
  name="defaultManagerResponsible"
  defaultValue={venue.default_manager_responsible ?? ""}
  placeholder="Default manager responsible"
  maxLength={200}
/>
```

With:
```html
<select
  id={`venue-manager-${venue.id}`}
  name="defaultManagerResponsibleId"
  defaultValue={venue.default_manager_responsible_id ?? ""}
  className="flex h-10 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
>
  <option value="">No default manager</option>
  {users.map((u) => (
    <option key={u.id} value={u.id}>{u.name}</option>
  ))}
</select>
```

- [ ] **Step 3: Wire user list into venues page**

Read the parent page that renders VenuesManager. Add `listAssignableUsers` call and pass results as a `users` prop.

- [ ] **Step 4: Commit**

```bash
git add src/components/venues/venues-manager.tsx src/actions/venues.ts src/app/venues/page.tsx
git commit -m "feat: replace venue default manager text input with user picker"
```

---

### Task 8: Update UserImpactSummary

**Files:**
- Modify: `src/actions/users.ts`

- [ ] **Step 1: Add counts for new FK columns**

In `src/actions/users.ts`, find the UserImpactSummary query (around line 383). Add counts for events where user is `manager_responsible_id` and venues where user is `default_manager_responsible_id`.

Read the file first. Add to the query:
```typescript
// Count events where user is manager responsible
const { count: managerResponsibleCount } = await db
  .from("events")
  .select("id", { count: "exact", head: true })
  .eq("manager_responsible_id", userId)
  .is("deleted_at", null);

// Count venues where user is default manager
const { count: defaultManagerCount } = await db
  .from("venues")
  .select("id", { count: "exact", head: true })
  .eq("default_manager_responsible_id", userId);
```

Add these to the returned summary object.

- [ ] **Step 2: Commit**

```bash
git add src/actions/users.ts
git commit -m "feat: add manager_responsible counts to UserImpactSummary"
```

---

### Task 9: Verification Pipeline

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean compilation

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Successful build

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: No new errors

- [ ] **Step 5: Manual smoke test**

Start dev server with `npm run dev` and verify:
1. Event form shows user picker for manager responsible (not text input)
2. Selecting a venue auto-fills the default manager
3. Venue settings shows user picker for default manager
4. Event detail page displays manager responsible name
5. Debrief page accessible to the manager responsible user
6. Dashboard todo shows debriefs on manager's dashboard

- [ ] **Step 6: Push migration**

Run: `npx supabase db push`
Expected: Migration applied to live database

- [ ] **Step 7: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: address verification pipeline findings"
```
