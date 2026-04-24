# Office Worker Global Read Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give all office workers read access to all events data (bookings, customers, artists, reviews, debriefs) across all venues, with navigation items visible and no dead ends.

**Architecture:** Five-layer change: (1) RLS migration adds global SELECT for office workers, (2) new `canView*` capability functions separate read from write, (3) page guards use `canView*` for entry, (4) data-fetching functions remove venue scoping for office workers, (5) navigation + UI components conditionally hide write controls. Write operations remain venue-scoped — only read access is globalised.

**Tech Stack:** Supabase (PostgreSQL RLS), Next.js App Router (server components), TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20260424090000_office_worker_global_read.sql` | Create | RLS SELECT policies for artists, debriefs, event_artists, approvals |
| `src/lib/roles.ts` | Modify | Add `canViewBookings`, `canViewCustomers`, `canViewArtists`, `canViewReviews` |
| `src/lib/auth/__tests__/rbac.test.ts` | Modify | Tests for new capability functions |
| `src/app/bookings/page.tsx` | Modify | Guard: `canManageBookings` → `canViewBookings` |
| `src/app/customers/page.tsx` | Modify | Guard: `canManageCustomers` → `canViewCustomers` |
| `src/app/customers/[id]/page.tsx` | Modify | Guard: `canManageCustomers` → `canViewCustomers` |
| `src/app/artists/page.tsx` | Modify | Guard: `canManageArtists` → `canViewArtists`, pass `canEdit` |
| `src/app/artists/[artistId]/page.tsx` | Modify | Guard: `canManageArtists` → `canViewArtists`, pass `canEdit` |
| `src/app/reviews/page.tsx` | Modify | Guard: remove hardcoded role block, use `canViewReviews`, hide DecisionForm |
| `src/app/debriefs/[eventId]/page.tsx` | Modify | Allow all office workers read access, hide form for non-editors |
| `src/components/artists/artists-manager.tsx` | Modify | Accept `canEdit` prop, conditionally show create/archive UI |
| `src/components/artists/artist-detail-editor.tsx` | Modify | Accept `canEdit` prop, conditionally show edit/archive forms |
| `src/components/shell/app-shell.tsx` | Modify | Add `office_worker` to nav roles |
| `src/lib/all-bookings.ts` | Modify | Remove venue scoping for office workers |
| `src/lib/customers.ts` | Modify | Remove venue scoping for office workers |
| `src/app/debriefs/page.tsx` | Modify | Remove venue scoping for office workers |

---

### Task 1: Add `canView*` Capability Functions

**Files:**
- Modify: `src/lib/roles.ts`
- Modify: `src/lib/auth/__tests__/rbac.test.ts`

- [ ] **Step 1: Write failing tests for new capability functions**

Add to `src/lib/auth/__tests__/rbac.test.ts` after the existing `canViewDebriefs` tests:

```typescript
describe("canViewBookings", () => {
  it("all roles can view bookings", () => {
    expect(canViewBookings("administrator")).toBe(true);
    expect(canViewBookings("office_worker")).toBe(true);
    expect(canViewBookings("executive")).toBe(false);
  });
});

describe("canViewCustomers", () => {
  it("admin and office_worker can view customers", () => {
    expect(canViewCustomers("administrator")).toBe(true);
    expect(canViewCustomers("office_worker")).toBe(true);
    expect(canViewCustomers("executive")).toBe(false);
  });
});

describe("canViewArtists", () => {
  it("admin and office_worker can view artists", () => {
    expect(canViewArtists("administrator")).toBe(true);
    expect(canViewArtists("office_worker")).toBe(true);
    expect(canViewArtists("executive")).toBe(false);
  });
});

describe("canViewReviews", () => {
  it("admin and office_worker can view reviews", () => {
    expect(canViewReviews("administrator")).toBe(true);
    expect(canViewReviews("office_worker")).toBe(true);
    expect(canViewReviews("executive")).toBe(false);
  });
});
```

Also add the imports at the top of the test file:
```typescript
import { canViewBookings, canViewCustomers, canViewArtists, canViewReviews } from "@/lib/roles";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement the capability functions**

Add to `src/lib/roles.ts` after the existing `canViewDebriefs` function (line ~110):

```typescript
/** Can view bookings list (admin + office_worker; not executive) */
export function canViewBookings(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can view customers list (admin + office_worker; not executive) */
export function canViewCustomers(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can view artists directory (admin + office_worker; not executive) */
export function canViewArtists(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can view the review pipeline read-only (admin + office_worker; not executive) */
export function canViewReviews(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts src/lib/auth/__tests__/rbac.test.ts
git commit -m "feat(roles): add canView* read-only capability functions for office workers"
```

---

### Task 2: Database Migration — Global SELECT for Office Workers

**Files:**
- Create: `supabase/migrations/20260424090000_office_worker_global_read.sql`

**Context:** Several tables use `createSupabaseReadonlyClient()` (cookie-based, respects RLS). Office workers currently can't SELECT from these unless they're the event creator/assignee or have a venue_id. This migration adds global SELECT for all office workers.

Tables that use admin client (bypass RLS) and do NOT need migration changes: `event_bookings`, `customers`.

- [ ] **Step 1: Create the migration file**

```sql
-- =============================================================================
-- Office worker global read access
-- Give all office workers SELECT on artists, debriefs, event_artists, approvals
-- so they can browse these pages regardless of venue assignment.
-- =============================================================================

-- ─── artists: split FOR ALL into separate SELECT + write ────────────────────
-- Current "artists managed by admins and venue workers" is FOR ALL but requires
-- venue_id for office_worker. Replace with: global SELECT for admin + OW,
-- keep write restricted to admin + venue-OW.

DROP POLICY IF EXISTS "artists managed by admins and venue workers" ON public.artists;

-- Read: all office workers (with or without venue_id)
CREATE POLICY "artists readable by admins and office workers"
  ON public.artists
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN ('administrator', 'office_worker')
  );

-- Write: admin always; office_worker only with venue_id
CREATE POLICY "artists writable by admins and venue workers"
  ON public.artists
  FOR ALL TO authenticated
  USING (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
    )
  );

-- ─── debriefs: add global SELECT for office workers ─────────────────────────
-- Current "debriefs visible with event" only allows admin/creator/assignee.
-- Add a separate policy for office_worker global read.

CREATE POLICY "debriefs readable by office workers"
  ON public.debriefs
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'office_worker'
  );

-- ─── approvals: add global SELECT for office workers ────────────────────────
-- Current "approvals visible with event" only allows admin/creator/assignee.
-- Add a separate policy for office_worker global read (reviews page).

CREATE POLICY "approvals readable by office workers"
  ON public.approvals
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'office_worker'
  );

-- ─── event_artists: add global SELECT for office workers ────────────────────
-- Current policy (from 20260420170000) restricts SELECT to admin/creator/assignee
-- or office_worker with venue match. Add global read for all office workers.

-- Drop and recreate the SELECT policy to include all office workers
DROP POLICY IF EXISTS "event artists visible with event" ON public.event_artists;
CREATE POLICY "event artists visible with event"
  ON public.event_artists
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN ('administrator', 'office_worker')
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (auth.uid() = e.created_by OR auth.uid() = e.assignee_id)
    )
  );
```

- [ ] **Step 2: Dry-run the migration**

Run: `npx supabase db push --dry-run`
Expected: Migration listed, no errors

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db push`
Expected: Migration applied successfully

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424090000_office_worker_global_read.sql
git commit -m "feat(rls): add global SELECT policies for office workers on artists, debriefs, approvals, event_artists"
```

---

### Task 3: Update Page Guards to Use `canView*`

**Files:**
- Modify: `src/app/bookings/page.tsx`
- Modify: `src/app/customers/page.tsx`
- Modify: `src/app/customers/[id]/page.tsx`
- Modify: `src/app/events/page.tsx` (already correct, verify only)

- [ ] **Step 1: Update bookings page guard**

In `src/app/bookings/page.tsx`, change the import and guard:

```typescript
// Change import
import { canViewBookings } from "@/lib/roles";

// Change guard (line 12)
if (!canViewBookings(user.role)) {
```

- [ ] **Step 2: Update customers page guard**

In `src/app/customers/page.tsx`, change:

```typescript
// Change import
import { canViewCustomers } from "@/lib/roles";

// Change guard (line 12)
if (!canViewCustomers(user.role)) {
```

- [ ] **Step 3: Update customer detail page guard**

In `src/app/customers/[id]/page.tsx`, change:

```typescript
// Change import
import { canViewCustomers } from "@/lib/roles";

// Change guard (line 36)
if (!canViewCustomers(user.role, user.venueId)) {
```

Note: `canViewCustomers` only takes `role`, so remove the second argument:
```typescript
if (!canViewCustomers(user.role)) {
```

- [ ] **Step 4: Verify events page — no change needed**

`src/app/events/page.tsx` already uses `canViewEvents` which returns true for all roles. No change needed.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors

- [ ] **Step 6: Commit**

```bash
git add src/app/bookings/page.tsx src/app/customers/page.tsx src/app/customers/[id]/page.tsx
git commit -m "feat(pages): use canView* guards for bookings and customers read access"
```

---

### Task 4: Update Artists Pages with Read-Only Support

**Files:**
- Modify: `src/app/artists/page.tsx`
- Modify: `src/app/artists/[artistId]/page.tsx`
- Modify: `src/components/artists/artists-manager.tsx`
- Modify: `src/components/artists/artist-detail-editor.tsx`

- [ ] **Step 1: Update artists list page**

In `src/app/artists/page.tsx`:

```typescript
import { canViewArtists, canManageArtists } from "@/lib/roles";

// Change guard (line 18) to use view permission
if (!canViewArtists(user.role)) {
  redirect("/unauthorized");
}

// Pass canEdit prop to component
const canEdit = canManageArtists(user.role, user.venueId);

// In the JSX, change:
<ArtistsManager artists={artists} canEdit={canEdit} />
```

- [ ] **Step 2: Update ArtistsManager component**

In `src/components/artists/artists-manager.tsx`:

Update the props type (around line 18):
```typescript
type ArtistsManagerProps = {
  artists: ArtistPerformanceSummary[];
  canEdit?: boolean;
};
```

Update the function signature:
```typescript
export function ArtistsManager({ artists, canEdit = false }: ArtistsManagerProps) {
```

Wrap the "Add artist" form section (the Card with the create form) in a `canEdit` check:
```typescript
{canEdit ? (
  // ... existing Card with create form ...
) : null}
```

Wrap each artist row's archive button in the artist table with a `canEdit` check. Find the archive form/button in the table and wrap:
```typescript
{canEdit ? (
  // ... existing archive form/button ...
) : null}
```

- [ ] **Step 3: Update artist detail page**

In `src/app/artists/[artistId]/page.tsx`:

```typescript
import { canViewArtists, canManageArtists } from "@/lib/roles";

// Change guard to view permission
if (!canViewArtists(user.role)) {
  redirect("/unauthorized");
}

const canEdit = canManageArtists(user.role, user.venueId);

return <ArtistDetailEditor artist={artist} canEdit={canEdit} />;
```

- [ ] **Step 4: Update ArtistDetailEditor component**

In `src/components/artists/artist-detail-editor.tsx`:

Update props type:
```typescript
type ArtistDetailEditorProps = {
  artist: ArtistDetail;
  canEdit?: boolean;
};
```

Update function signature:
```typescript
export function ArtistDetailEditor({ artist, canEdit = false }: ArtistDetailEditorProps) {
```

For the edit form: wrap the save/submit button and archive button in `canEdit` checks. Make form inputs `disabled={!canEdit}` or wrap the entire form action section:

```typescript
{canEdit ? (
  // ... existing form with SubmitButton ...
) : (
  // Read-only display: show the same fields but as plain text, not inputs
  // Re-use the existing layout but replace Input/Select/Textarea with <p> or <span>
)}
```

Simpler approach — keep the form layout but disable all inputs and hide action buttons:
- Add `disabled={!canEdit}` to each Input, Select, Textarea
- Wrap SubmitButton (save) in `{canEdit ? ... : null}`
- Wrap archive form in `{canEdit ? ... : null}`

- [ ] **Step 5: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/artists/page.tsx src/app/artists/[artistId]/page.tsx \
  src/components/artists/artists-manager.tsx src/components/artists/artist-detail-editor.tsx
git commit -m "feat(artists): read-only access for office workers, write gated by canManageArtists"
```

---

### Task 5: Update Reviews Page with Read-Only Support

**Files:**
- Modify: `src/app/reviews/page.tsx`

- [ ] **Step 1: Update reviews page guard and UI**

In `src/app/reviews/page.tsx`:

Replace the hardcoded role block with `canViewReviews`:

```typescript
import { canViewReviews, canReviewEvents } from "@/lib/roles";

// Replace lines 30-32:
if (!canViewReviews(user.role)) {
  redirect("/unauthorized");
}
```

Update the heading (line 40) — all viewers see "Review pipeline" since no one has a personal queue anymore unless they're admin:
```typescript
<h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">
  Review pipeline
</h1>
```

Update the action area (lines 76-82) to check `canReviewEvents` instead of role:
```typescript
{canReviewEvents(user.role) ? (
  <DecisionForm eventId={event.id} />
) : (
  <Button variant="secondary" asChild>
    <Link href={`/events/${event.id}`}>View event</Link>
  </Button>
)}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/reviews/page.tsx
git commit -m "feat(reviews): read-only access for office workers, decisions restricted to canReviewEvents"
```

---

### Task 6: Update Debriefs for Global Read Access

**Files:**
- Modify: `src/app/debriefs/page.tsx`
- Modify: `src/app/debriefs/[eventId]/page.tsx`

- [ ] **Step 1: Remove venue scoping from debriefs list page**

In `src/app/debriefs/page.tsx`, remove lines 37-39 (the venue-scoped filter):

```typescript
// DELETE these lines:
// if (user.role === "office_worker" && user.venueId) {
//   query = query.eq("events.venue_id", user.venueId);
// }
```

The RLS migration (Task 2) already grants global SELECT to all office workers, so the query will return all debriefs.

- [ ] **Step 2: Update debrief detail page for read-only access**

In `src/app/debriefs/[eventId]/page.tsx`, the current guard (around line 29-30):
```typescript
const allowed = user.role === "administrator" || isManager || isCreatorFallback;
```

Change to allow all office workers to VIEW, but only allow editing for those with write access:

```typescript
const canEdit = user.role === "administrator" || isManager || isCreatorFallback;
const canView = canEdit || user.role === "office_worker";

if (!canView) {
  redirect("/unauthorized");
}
```

Then pass `canEdit` to the DebriefForm (or render a read-only view when `!canEdit`). Check how the page currently renders the form and conditionally disable it:

If the page renders `<DebriefForm>` directly, wrap it:
```typescript
{canEdit ? (
  <DebriefForm eventId={eventId} ... />
) : (
  // Read-only debrief summary using the same data
  <DebriefReadOnlyView debrief={existingDebrief} />
)}
```

The simpler approach: pass `readOnly` prop to DebriefForm and have it render inputs as disabled with the submit button hidden. Check the component's current interface and add the prop.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/debriefs/page.tsx src/app/debriefs/[eventId]/page.tsx
git commit -m "feat(debriefs): global read access for office workers, edit restricted to event manager/creator"
```

---

### Task 7: Remove Venue Scoping from Data Fetching

**Files:**
- Modify: `src/lib/all-bookings.ts`
- Modify: `src/lib/customers.ts`

- [ ] **Step 1: Update bookings data fetch**

In `src/lib/all-bookings.ts`, remove the venue scoping (lines 56-58):

```typescript
// DELETE these lines:
// if (user.role === "office_worker" && user.venueId) {
//   query = (query as typeof query).eq("events.venue_id", user.venueId);
// }
```

This uses admin client so RLS is bypassed — the function was the only scoping mechanism. Removing it gives all office workers global read. Write operations remain gated by `canManageBookings` in server actions.

- [ ] **Step 2: Update customers data fetch**

In `src/lib/customers.ts`, change the `p_venue_id` parameter (line 38):

```typescript
// Change from:
// p_venue_id: user.role === "office_worker" ? (user.venueId ?? null) : null,
// To:
p_venue_id: null,
```

All roles now see all customers. Write operations remain gated by `canManageCustomers` in server actions.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/all-bookings.ts src/lib/customers.ts
git commit -m "feat(data): remove venue scoping for office worker read access on bookings and customers"
```

---

### Task 8: Update Navigation

**Files:**
- Modify: `src/components/shell/app-shell.tsx`

- [ ] **Step 1: Add office_worker to nav item roles**

In `src/components/shell/app-shell.tsx`, update the NAV_SECTIONS constant:

Events parent (line 39):
```typescript
roles: ["administrator", "office_worker"],
```

Bookings (line 45):
```typescript
{ label: "Bookings", href: "/bookings", roles: ["administrator", "office_worker"] },
```

Customers (line 46):
```typescript
{ label: "Customers", href: "/customers", roles: ["administrator", "office_worker"] },
```

Artists (line 47):
```typescript
{ label: "Artists", href: "/artists", roles: ["administrator", "office_worker"] },
```

Reviews (line 48):
```typescript
{ label: "Reviews", href: "/reviews", roles: ["administrator", "office_worker"] },
```

Debriefs (line 49):
```typescript
{ label: "Debriefs", href: "/debriefs", roles: ["administrator", "office_worker"] },
```

- [ ] **Step 2: Verify Events parent is now a clickable link for office workers**

With `office_worker` in the Events parent roles, the `labelOnly` logic (lines 123-133) will no longer trigger for office workers — `parentMatches` will be true, so `labelOnly` will be false. The Events link will be clickable.

- [ ] **Step 3: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/shell/app-shell.tsx
git commit -m "feat(nav): show events, bookings, customers, artists, reviews, debriefs for office workers"
```

---

### Task 9: Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Manual smoke test**

Start dev server (`npm run dev`) and test as an office worker:

1. **Navigation**: All items visible — Events, Bookings, Customers, Artists, Reviews, Debriefs
2. **Events list**: Clickable, shows all events across all venues
3. **Bookings**: Shows all bookings across all venues
4. **Customers**: Shows all customers, click into detail page works
5. **Artists**: Shows all artists, create/archive buttons hidden for non-venue OW
6. **Artist detail**: View works, edit form disabled for non-venue OW
7. **Reviews**: Shows review pipeline read-only, no DecisionForm visible
8. **Debriefs list**: Shows all debriefs across all venues
9. **Debrief detail**: Viewable, form disabled/hidden for non-editors
10. **No dead ends**: Every link in the nav leads to a working page; every list item that links to a detail page loads correctly

- [ ] **Step 4: Commit and verify**

```bash
# Final verification
npm run lint && npx tsc --noEmit && npm test && npm run build
```
