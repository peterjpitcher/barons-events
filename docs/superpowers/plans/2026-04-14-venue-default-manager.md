# Venue Default Manager Responsible & Table Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Default Manager Responsible" text field to venues, fix the venues table alignment, and auto-populate the event form's Manager Responsible from the venue default.

**Architecture:** New nullable TEXT column on `venues` table. Venue CRUD actions and helpers extended. Venues table UI fixed by updating colSpan and CSS grid to match 6 header columns. Event form auto-populates using the existing `endDirty` state pattern.

**Tech Stack:** Next.js 16, React 19, Supabase PostgreSQL, Zod, Tailwind CSS, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/20260414120000_add_venue_default_manager.sql` | Create | Add column + constraint |
| `src/lib/supabase/types.ts` | Modify | Add `default_manager_responsible` to venues Row type |
| `src/lib/venues.ts` | Modify | Extend `createVenue` and `updateVenue` signatures + payloads |
| `src/actions/venues.ts` | Modify | Add field to Zod schema, FormData extraction, and persistence calls |
| `src/components/venues/venues-manager.tsx` | Modify | Fix table alignment, add column, icon-only buttons |
| `src/components/events/event-form.tsx` | Modify | Auto-populate manager responsible from venue default |
| `src/actions/__tests__/venues.test.ts` | Create | Tests for venue action changes |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260414120000_add_venue_default_manager.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add default manager responsible to venues
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS default_manager_responsible TEXT;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_default_manager_responsible_len
    CHECK (char_length(default_manager_responsible) <= 200);

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Dry-run the migration**

Run: `npx supabase db push --dry-run`
Expected: Migration applies cleanly, no errors.

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db push`
Expected: Migration applied successfully.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260414120000_add_venue_default_manager.sql
git commit -m "feat: add default_manager_responsible column to venues table"
```

---

### Task 2: Update Generated Types

**Files:**
- Modify: `src/lib/supabase/types.ts:22-33`

- [ ] **Step 1: Add the new column to the venues Row type**

In `src/lib/supabase/types.ts`, inside `venues.Row`, add `default_manager_responsible` after `google_review_url`:

```typescript
      venues: {
        Row: {
          id: string;
          name: string;
          address: string | null;
          capacity: number | null;
          default_reviewer_id: string | null;
          default_manager_responsible: string | null;
          google_review_url: string | null;
          created_at: string;
          updated_at: string;
        };
      };
```

- [ ] **Step 2: Run typecheck to verify no breakage**

Run: `npx tsc --noEmit`
Expected: Clean compilation. The new nullable field won't break existing code since `VenueRow` is a type alias to this Row type, and all reads via `select("*")` will now include the field.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/types.ts
git commit -m "chore: add default_manager_responsible to venues type definition"
```

---

### Task 3: Extend Venue Data Helpers

**Files:**
- Modify: `src/lib/venues.ts:17-58`

- [ ] **Step 1: Update `createVenue` signature and payload**

In `src/lib/venues.ts`, change the `createVenue` function:

```typescript
export async function createVenue(payload: {
  name: string;
  address?: string | null;
  defaultReviewerId?: string | null;
  defaultManagerResponsible?: string | null;
}) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("venues").insert({
    name: payload.name,
    address: payload.address ?? null,
    default_reviewer_id: payload.defaultReviewerId ?? null,
    default_manager_responsible: payload.defaultManagerResponsible ?? null,
  });

  if (error) {
    throw new Error(`Could not create venue: ${error.message}`);
  }
}
```

- [ ] **Step 2: Update `updateVenue` signature and payload**

Change the `updateVenue` function to accept and persist the new field:

```typescript
export async function updateVenue(id: string, updates: {
  name: string;
  address?: string | null;
  defaultReviewerId?: string | null;
  defaultManagerResponsible?: string | null;
  googleReviewUrl?: string | null;
}) {
  const supabase = await createSupabaseActionClient();
  const updatePayload: {
    name: string;
    default_reviewer_id: string | null;
    default_manager_responsible?: string | null;
    address?: string | null;
    google_review_url?: string | null;
  } = {
    name: updates.name,
    default_reviewer_id: updates.defaultReviewerId ?? null,
  };

  if (Object.prototype.hasOwnProperty.call(updates, "defaultManagerResponsible")) {
    updatePayload.default_manager_responsible = updates.defaultManagerResponsible ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "address")) {
    updatePayload.address = updates.address ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "googleReviewUrl")) {
    updatePayload.google_review_url = updates.googleReviewUrl ?? null;
  }

  const { error } = await supabase
    .from("venues")
    .update(updatePayload)
    .eq("id", id);

  if (error) {
    throw new Error(`Could not update venue: ${error.message}`);
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add src/lib/venues.ts
git commit -m "feat: extend venue helpers with defaultManagerResponsible field"
```

---

### Task 4: Update Server Actions

**Files:**
- Modify: `src/actions/venues.ts:21-26,40-43,78-83,96-101`

- [ ] **Step 1: Add field to Zod schema**

In `src/actions/venues.ts`, add `defaultManagerResponsible` to the `venueSchema`:

```typescript
const venueSchema = z.object({
  venueId: z.string().uuid().optional(),
  name: z.string().min(2, "Add a venue name"),
  defaultReviewerId: uuidOrUndefined,
  defaultManagerResponsible: z.string().max(200, "Max 200 characters").optional().or(z.literal("")),
  googleReviewUrl: z.string().url("Enter a valid URL").optional().or(z.literal(""))
});
```

- [ ] **Step 2: Update `createVenueAction` FormData extraction and persistence**

Update the `parsed` call and the `createVenue` call:

```typescript
  const parsed = venueSchema.safeParse({
    name: typeof formData.get("name") === "string" ? formData.get("name") : "",
    defaultReviewerId: typeof formData.get("defaultReviewerId") === "string" ? formData.get("defaultReviewerId") : "",
    defaultManagerResponsible: typeof formData.get("defaultManagerResponsible") === "string" ? formData.get("defaultManagerResponsible") : "",
  });
```

And the persistence call:

```typescript
    await createVenue({
      name: parsed.data.name,
      defaultReviewerId: parsed.data.defaultReviewerId ?? null,
      defaultManagerResponsible: parsed.data.defaultManagerResponsible || null,
    });
```

- [ ] **Step 3: Update `updateVenueAction` FormData extraction and persistence**

Update the `parsed` call:

```typescript
  const parsed = venueSchema.safeParse({
    venueId: formData.get("venueId"),
    name: typeof formData.get("name") === "string" ? formData.get("name") : "",
    defaultReviewerId: typeof formData.get("defaultReviewerId") === "string" ? formData.get("defaultReviewerId") : "",
    defaultManagerResponsible: typeof formData.get("defaultManagerResponsible") === "string" ? formData.get("defaultManagerResponsible") : "",
    googleReviewUrl: typeof formData.get("googleReviewUrl") === "string" ? formData.get("googleReviewUrl") : ""
  });
```

And the persistence call:

```typescript
    await updateVenue(parsed.data.venueId, {
      name: parsed.data.name,
      defaultReviewerId: parsed.data.defaultReviewerId ?? null,
      defaultManagerResponsible: parsed.data.defaultManagerResponsible || null,
      googleReviewUrl: parsed.data.googleReviewUrl || null
    });
```

- [ ] **Step 4: Run typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add src/actions/venues.ts
git commit -m "feat: accept defaultManagerResponsible in venue server actions"
```

---

### Task 5: Fix Venues Table Alignment & Add Column

**Files:**
- Modify: `src/components/venues/venues-manager.tsx`

This is the largest task. Three changes: fix table alignment, add the new column, and make action buttons icon-only.

- [ ] **Step 1: Update the table header to 6 columns**

Replace the `<thead>` in the `VenueTable` function (around line 112-119):

```tsx
        <thead>
          <tr className="bg-[var(--color-muted-surface)] text-left text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
            <th scope="col" className="px-4 py-3">Venue</th>
            <th scope="col" className="px-4 py-3">Manager Responsible</th>
            <th scope="col" className="px-4 py-3">Default Reviewer</th>
            <th scope="col" className="px-4 py-3">Google Review URL</th>
            <th scope="col" className="px-4 py-3">Hours</th>
            <th scope="col" className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
```

- [ ] **Step 2: Fix `VenueRowEditor` — update colSpan and grid**

Replace the entire `<tr>` return in `VenueRowEditor` (lines 160-244). Key changes:
- `colSpan={3}` → `colSpan={6}`
- Grid adds the new input column
- Grid template matches 6 header columns: `md:grid-cols-[minmax(0,18fr)_minmax(0,18fr)_minmax(0,16fr)_minmax(0,28fr)_auto_auto]`
- Action buttons become icon-only

```tsx
  return (
    <tr className="border-t border-[var(--color-border)]">
      <td colSpan={6} className="px-4 py-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,18fr)_minmax(0,18fr)_minmax(0,16fr)_minmax(0,28fr)_auto_auto] md:items-start">
          <form action={formAction} className="contents" noValidate>
            <input type="hidden" name="venueId" value={venue.id} />
            <div className="space-y-2">
              <label className="sr-only" htmlFor={`venue-name-${venue.id}`}>
                Venue name
              </label>
              <Input
                id={`venue-name-${venue.id}`}
                name="name"
                defaultValue={venue.name}
                required
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? nameErrorId : undefined}
                className={cn(nameError ? errorInputClass : undefined)}
              />
              <FieldError id={nameErrorId} message={nameError} />
            </div>
            <div>
              <label className="sr-only" htmlFor={`venue-manager-${venue.id}`}>
                Default manager responsible
              </label>
              <Input
                id={`venue-manager-${venue.id}`}
                name="defaultManagerResponsible"
                defaultValue={venue.default_manager_responsible ?? ""}
                placeholder="Default manager responsible"
                maxLength={200}
              />
            </div>
            <div>
              <label className="sr-only" htmlFor={`venue-reviewer-${venue.id}`}>
                Default reviewer
              </label>
              <Select id={`venue-reviewer-${venue.id}`} name="defaultReviewerId" defaultValue={venue.default_reviewer_id ?? ""}>
                <option value="">No default reviewer</option>
                {reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="sr-only" htmlFor={`venue-google-review-${venue.id}`}>
                Google Review URL
              </label>
              <Input
                id={`venue-google-review-${venue.id}`}
                name="googleReviewUrl"
                type="url"
                defaultValue={venue.google_review_url ?? ""}
                placeholder="Google Review URL"
              />
            </div>
            <div className="flex items-start justify-end">
              <SubmitButton
                label="Save"
                pendingLabel="Saving..."
                variant="secondary"
                size="sm"
                icon={<Save className="h-4 w-4" aria-hidden="true" />}
                hideLabel
              />
            </div>
          </form>
          <div className="flex items-start gap-1 justify-end">
            <Button asChild variant="ghost" size="sm" aria-label={`Opening hours for ${venue.name}`}>
              <Link href={`/venues/${venue.id}/opening-hours`}>
                <Clock className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <form ref={deleteFormRef} action={deleteAction}>
              <input type="hidden" name="venueId" value={venue.id} />
              <Button type="button" variant="destructive" size="sm" aria-label={`Delete ${venue.name}`} onClick={() => setDeleteConfirmOpen(true)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>
            <ConfirmDialog
              open={deleteConfirmOpen}
              title={`Delete ${venue.name}?`}
              description="This will permanently remove the venue. Events linked to it may be affected."
              confirmLabel="Delete"
              variant="danger"
              onConfirm={() => { setDeleteConfirmOpen(false); deleteFormRef.current?.requestSubmit(); }}
              onCancel={() => setDeleteConfirmOpen(false)}
            />
          </div>
        </div>
      </td>
    </tr>
  );
```

- [ ] **Step 3: Update the "Add a venue" form**

In `VenueCreateForm`, update the grid to 4 columns and add the new input. Replace the form (around line 61-94):

```tsx
        <form ref={formRef} action={formAction} className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_auto]" noValidate>
          <div className="space-y-2">
            <Label htmlFor="new-venue-name">Venue name</Label>
            <Input
              id="new-venue-name"
              name="name"
              placeholder="Barons Riverside"
              required
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "new-venue-name-error" : undefined}
              className={nameError ? errorInputClass : undefined}
            />
            <FieldError id="new-venue-name-error" message={nameError} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-venue-manager">Default manager responsible</Label>
            <Input
              id="new-venue-manager"
              name="defaultManagerResponsible"
              placeholder="Manager name"
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-venue-default-reviewer">Default reviewer</Label>
            <Select id="new-venue-default-reviewer" name="defaultReviewerId" defaultValue="">
              <option value="">No default reviewer</option>
              {reviewers.map((reviewer) => (
                <option key={reviewer.id} value={reviewer.id}>
                  {reviewer.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end justify-end">
            <SubmitButton
              label="Add venue"
              pendingLabel="Saving..."
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              hideLabel
            />
          </div>
        </form>
```

- [ ] **Step 4: Run typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/venues/venues-manager.tsx
git commit -m "fix: align venues table columns and add default manager responsible field"
```

---

### Task 6: Auto-Populate Event Form Manager Responsible

**Files:**
- Modify: `src/components/events/event-form.tsx:316-322,439-441,766-780`

- [ ] **Step 1: Add managerDirty state**

After `managerResponsible` state (line 322), add a dirty flag following the `endDirty` pattern:

```typescript
  const [managerResponsible, setManagerResponsible] = useState((defaultValues as any)?.manager_responsible ?? "");
  const [managerDirty, setManagerDirty] = useState(Boolean((defaultValues as any)?.manager_responsible));
```

- [ ] **Step 2: Update handleVenueChange to auto-populate**

Replace the `handleVenueChange` function (line 439-441):

```typescript
  function handleVenueChange(value: string) {
    setSelectedVenueId(value);
    if (!managerDirty) {
      const venue = venues.find((v) => v.id === value);
      setManagerResponsible(venue?.default_manager_responsible ?? "");
    }
  }
```

- [ ] **Step 3: Update the manager responsible input to track manual edits**

Replace the `managerResponsibleField` block (around line 766-780):

```tsx
  const managerResponsibleField = (
    <div className="space-y-2">
      <Label htmlFor="managerResponsible">Manager Responsible</Label>
      <Input
        id="managerResponsible"
        name="managerResponsible"
        maxLength={200}
        value={managerResponsible}
        onChange={(event) => {
          setManagerDirty(true);
          setManagerResponsible(event.target.value);
        }}
        placeholder="Enter manager name"
      />
      <p className="text-xs text-subtle">
        The on-site manager accountable for this event.
      </p>
    </div>
  );
```

- [ ] **Step 4: Auto-populate on mount for new events**

After the `handleVenueChange` function, add a `useEffect` to populate on initial mount when creating a new event with a pre-selected venue:

```typescript
  useEffect(() => {
    if (mode === "create" && !managerDirty && selectedVenueId) {
      const venue = venues.find((v) => v.id === selectedVenueId);
      if (venue?.default_manager_responsible) {
        setManagerResponsible(venue.default_manager_responsible);
      }
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 5: Run typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/events/event-form.tsx
git commit -m "feat: auto-populate event manager responsible from venue default"
```

---

### Task 7: Tests

**Files:**
- Create: `src/actions/__tests__/venues.test.ts`

- [ ] **Step 1: Write tests for venue actions**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/venues", () => ({
  createVenue: vi.fn(),
  updateVenue: vi.fn(),
  deleteVenue: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));
vi.mock("@/lib/form-errors", () => ({
  getFieldErrors: vi.fn(() => ({})),
}));

import { getCurrentUser } from "@/lib/auth";
import { createVenue, updateVenue } from "@/lib/venues";
import { createVenueAction, updateVenueAction } from "../venues";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreateVenue = vi.mocked(createVenue);
const mockUpdateVenue = vi.mocked(updateVenue);

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createVenueAction", () => {
  it("should pass defaultManagerResponsible to createVenue", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "planner@test.com",
      fullName: "Test Planner",
      role: "central_planner",
      venueId: null,
    });
    mockCreateVenue.mockResolvedValue(undefined);

    const fd = makeFormData({
      name: "Test Venue",
      defaultReviewerId: "",
      defaultManagerResponsible: "Sarah Mitchell",
    });

    const result = await createVenueAction(undefined, fd);

    expect(result.success).toBe(true);
    expect(mockCreateVenue).toHaveBeenCalledWith({
      name: "Test Venue",
      defaultReviewerId: null,
      defaultManagerResponsible: "Sarah Mitchell",
    });
  });

  it("should map empty defaultManagerResponsible to null", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "planner@test.com",
      fullName: "Test Planner",
      role: "central_planner",
      venueId: null,
    });
    mockCreateVenue.mockResolvedValue(undefined);

    const fd = makeFormData({
      name: "Test Venue",
      defaultReviewerId: "",
      defaultManagerResponsible: "",
    });

    const result = await createVenueAction(undefined, fd);

    expect(result.success).toBe(true);
    expect(mockCreateVenue).toHaveBeenCalledWith({
      name: "Test Venue",
      defaultReviewerId: null,
      defaultManagerResponsible: null,
    });
  });
});

describe("updateVenueAction", () => {
  it("should pass defaultManagerResponsible to updateVenue", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "planner@test.com",
      fullName: "Test Planner",
      role: "central_planner",
      venueId: null,
    });
    mockUpdateVenue.mockResolvedValue(undefined);

    const fd = makeFormData({
      venueId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Updated Venue",
      defaultReviewerId: "",
      defaultManagerResponsible: "Tom Bradley",
      googleReviewUrl: "",
    });

    const result = await updateVenueAction(undefined, fd);

    expect(result.success).toBe(true);
    expect(mockUpdateVenue).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
      {
        name: "Updated Venue",
        defaultReviewerId: null,
        defaultManagerResponsible: "Tom Bradley",
        googleReviewUrl: null,
      }
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/actions/__tests__/venues.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/actions/__tests__/venues.test.ts
git commit -m "test: add venue action tests for defaultManagerResponsible field"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Expected: All four checks pass with zero errors.

- [ ] **Step 2: Manual smoke test**

Start dev server: `npm run dev`

Verify:
1. `/venues` — table columns align (Venue, Manager Responsible, Default Reviewer, Google Review URL, Hours, Actions)
2. `/venues` — add a venue with a default manager responsible value
3. `/venues` — edit an existing venue's default manager responsible
4. `/events/new` — select a venue that has a default manager → Manager Responsible field auto-fills
5. `/events/new` — manually edit the auto-filled value, then switch venue → value is NOT overwritten
6. `/events/new` — select a venue with no default → Manager Responsible stays empty

- [ ] **Step 3: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "chore: final adjustments from manual verification"
```
