# Bookings & Customers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `customers` table with marketing opt-in consent, surface All Bookings and Customers admin pages, and add both to the sidebar navigation.

**Architecture:** A new `customers` table (keyed on E.164 mobile) is upserted on every booking. A `customer_consent_events` append-only audit log records opt-in/opt-out events. Two new server-rendered pages with client-side filtering (`/bookings`, `/customers`) and a customer detail page (`/customers/[id]`) are added. All data access uses the admin client (existing pattern). Navigation is updated in `app-shell.tsx`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS, Supabase PostgreSQL, `libphonenumber-js`, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-13-bookings-customers-design.md`

---

## File Map

| Status | File | Purpose |
|--------|------|---------|
| CREATE | `supabase/migrations/20260313000000_add_customers_and_consent.sql` | Schema: customers, customer_consent_events, event_bookings.customer_id, RLS, indexes, backfill |
| CREATE | `src/lib/booking-consent.ts` | Shared `MARKETING_CONSENT_WORDING` constant |
| MODIFY | `src/lib/types.ts` | Add `Customer`, `CustomerWithStats`, `CustomerConsentEvent` types |
| MODIFY | `src/actions/bookings.ts` | Add `marketingOptIn` field; upsert customer + log consent event after booking |
| MODIFY | `src/app/l/[slug]/BookingForm.tsx` | Add unchecked marketing opt-in checkbox |
| CREATE | `src/lib/customers.ts` | `upsertCustomer`, `listCustomersForUser`, `getCustomerById`, `softEraseCustomer` |
| CREATE | `src/lib/all-bookings.ts` | `listAllBookingsForUser` — returns bookings grouped by event, role-scoped |
| MODIFY | `src/components/shell/app-shell.tsx` | Add Bookings + Customers nav items after Events |
| CREATE | `src/app/bookings/page.tsx` | All Bookings server page (auth + data fetch) |
| CREATE | `src/app/bookings/BookingsView.tsx` | Client-side filtering/search UI |
| CREATE | `src/app/customers/page.tsx` | Customers server page (auth + data fetch) |
| CREATE | `src/app/customers/CustomersView.tsx` | Client-side filtering/search UI |
| CREATE | `src/app/customers/[id]/page.tsx` | Customer detail server page |
| CREATE | `src/actions/customers.ts` | `deleteCustomerAction` (soft erasure, central_planner only) |
| CREATE | `src/lib/__tests__/customers.test.ts` | Unit tests for customers data layer |
| CREATE | `src/lib/__tests__/all-bookings.test.ts` | Unit tests for all-bookings data layer |
| MODIFY | `src/actions/__tests__/bookings.test.ts` | Extend with customer upsert tests |

---

## Chunk 1: Database Migration

**Goal:** Create tables, backfill existing bookings, set up RLS and indexes.

### Task 1: Write and apply the migration

**Files:**
- Create: `supabase/migrations/20260313000000_add_customers_and_consent.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260313000000_add_customers_and_consent.sql

-- ── 1. customers table ──────────────────────────────────────────────────────
CREATE TABLE customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name       text NOT NULL,
  last_name        text,
  mobile           text UNIQUE NOT NULL,  -- E.164, natural key; use text for soft-erasure token
  email            text,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- ── 2. customer_consent_events table ────────────────────────────────────────
CREATE TABLE customer_consent_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  event_type      text NOT NULL CHECK (event_type IN ('opt_in', 'opt_out')),
  consent_wording text NOT NULL,
  booking_id      uuid REFERENCES event_bookings(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);
-- Append-only: no UPDATE/DELETE policies defined for this table.

-- ── 3. Add customer_id FK to event_bookings ─────────────────────────────────
-- NULLABLE — existing rows have no customer yet; backfill below sets them.
-- The existing create_booking RPC does NOT need to change: customer upsert
-- is handled in the TypeScript server action (Task 4) after the RPC returns.
ALTER TABLE event_bookings
  ADD COLUMN customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;

-- ── 4. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX idx_event_bookings_customer_id ON event_bookings(customer_id);
CREATE INDEX idx_customer_consent_events_customer_id ON customer_consent_events(customer_id);
-- event_bookings(event_id) and events(venue_id) likely already indexed; add defensively:
CREATE INDEX IF NOT EXISTS idx_event_bookings_event_id ON event_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_events_venue_id ON events(venue_id);

-- ── 5. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_consent_events ENABLE ROW LEVEL SECURITY;

-- central_planner sees all customers
CREATE POLICY customers_select_central ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role = 'central_planner'
    )
  );

-- venue_manager sees customers with at least one booking at their venue
CREATE POLICY customers_select_venue_manager ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM event_bookings eb
      JOIN events e ON e.id = eb.event_id
      JOIN users u ON u.venue_id = e.venue_id AND u.id = auth.uid()
      WHERE eb.customer_id = customers.id
        AND u.role = 'venue_manager'
    )
  );

-- consent events: same visibility as parent customer
CREATE POLICY consent_events_select ON customer_consent_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM customers c WHERE c.id = customer_consent_events.customer_id
    )
  );
-- Note: writes go through service-role client only; no authenticated INSERT policy.

-- ── 6. Backfill: one customer per unique mobile ──────────────────────────────
-- Uses most-recent booking's name/email. Idempotent (ON CONFLICT DO NOTHING).
-- marketing_opt_in defaults to false — no historical consent data exists.
INSERT INTO customers (mobile, first_name, last_name, email)
SELECT DISTINCT ON (mobile)
  mobile,
  first_name,
  last_name,
  email
FROM event_bookings
WHERE mobile IS NOT NULL
  AND mobile != ''
ORDER BY mobile, created_at DESC
ON CONFLICT (mobile) DO NOTHING;

-- Link existing bookings to their customer records
UPDATE event_bookings eb
SET customer_id = c.id
FROM customers c
WHERE eb.mobile = c.mobile
  AND eb.customer_id IS NULL;
```

- [ ] **Step 2: Apply the migration locally**

```bash
cd /Users/peterpitcher/Cursor/BARONS-EventHub
npx supabase db push
```

Expected: migration applies with no errors. If `supabase` CLI isn't linked, run `npx supabase link` first.

- [ ] **Step 3: Verify the tables were created**

```bash
# Check via Supabase Studio or run a quick count query
npx supabase db execute --sql "SELECT COUNT(*) FROM customers;"
```

Expected: count matches the number of unique mobile numbers in event_bookings.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260313000000_add_customers_and_consent.sql
git commit -m "feat: add customers and customer_consent_events tables with backfill"
```

---

## Chunk 2: Marketing Opt-in — Types, Constant, Booking Form, Server Action

**Goal:** Add opt-in checkbox to the public booking form; upsert customer + log consent event in `createBookingAction`.

### Task 2: Add shared constant and update types

**Files:**
- Create: `src/lib/booking-consent.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Create the shared consent wording constant**

```typescript
// src/lib/booking-consent.ts
// Shared between BookingForm (client) and createBookingAction (server).
// Changing this string requires a code deployment — the new wording is captured
// in customer_consent_events.consent_wording at the time of each booking.

export const MARKETING_CONSENT_WORDING =
  "Keep me updated with events, offers and news from Barons Pub Company. You can unsubscribe at any time.";
```

- [ ] **Step 2: Add Customer types to src/lib/types.ts**

Open `src/lib/types.ts` and append at the end:

```typescript
/** A customer record (deduplicated across bookings by mobile number). */
export interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  mobile: string;        // E.164
  email: string | null;
  marketingOptIn: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Customer with aggregated booking stats (for list views). */
export interface CustomerWithStats extends Customer {
  bookingCount: number;
  ticketCount: number;
  firstSeen: Date;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/booking-consent.ts src/lib/types.ts
git commit -m "feat: add MARKETING_CONSENT_WORDING constant and Customer types"
```

---

### Task 3: Update BookingForm to add unchecked marketing opt-in checkbox

**Files:**
- Modify: `src/app/l/[slug]/BookingForm.tsx`

- [ ] **Step 1: Add marketingOptIn state and checkbox to BookingForm**

Open `src/app/l/[slug]/BookingForm.tsx`. Make these changes:

1. Add import at the top:
```typescript
import { MARKETING_CONSENT_WORDING } from "@/lib/booking-consent";
```

2. Add state after the existing state declarations (after line 22, `const [bookedMobile, setBookedMobile] = useState("")`):
```typescript
const [marketingOptIn, setMarketingOptIn] = useState(false);
```

3. In the `handleSubmit` function, update the `input` object (around line 50) to include `marketingOptIn`:
```typescript
const input: CreateBookingInput = {
  eventId,
  firstName: firstName.trim(),
  lastName: lastName.trim() || null,
  mobile: mobile.trim(),
  email: email.trim() || null,
  ticketCount,
  marketingOptIn,   // new
};
```

4. Add the checkbox between the email field `</div>` and the `{/* Error message */}` comment (around line 176). Insert:

```tsx
{/* Marketing opt-in — unchecked by default (UK GDPR) */}
<div className="flex items-start gap-3 rounded-md border border-[#93ab97] bg-[#f5f8f5] p-3">
  <input
    id="marketingOptIn"
    type="checkbox"
    checked={marketingOptIn}
    onChange={(e) => setMarketingOptIn(e.target.checked)}
    className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-[#cbd5db] text-[#273640]
               focus:ring-2 focus:ring-[#273640] focus:ring-offset-1"
  />
  <label htmlFor="marketingOptIn" className="text-[0.68rem] leading-relaxed text-[#273640]">
    {MARKETING_CONSENT_WORDING}
  </label>
</div>
```

- [ ] **Step 2: Verify the form still builds**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/l/[slug]/BookingForm.tsx
git commit -m "feat: add unchecked marketing opt-in checkbox to booking form"
```

---

### Task 4: Update createBookingAction — add marketingOptIn, upsert customer, log consent event

**Files:**
- Modify: `src/actions/bookings.ts`

- [ ] **Step 1: Write the failing tests first**

Open `src/actions/__tests__/bookings.test.ts`. The existing file mocks `@/lib/bookings` (for `createBookingAtomic`). You must also add mocks for the admin client and consent wording — add these at the top of the file alongside the existing mocks:

```typescript
// Add alongside the existing vi.mock("@/lib/bookings", ...) call:
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/booking-consent", () => ({
  MARKETING_CONSENT_WORDING: "Test wording",
}));
// In beforeEach, set up the admin client mock chain:
// const mockDb = { from: vi.fn(), upsert: vi.fn(), update: vi.fn(), insert: vi.fn(), select: vi.fn(), single: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
// Each method returns `this` for chaining; terminal methods return resolved promises.
```

Add these test cases (find the existing describe block and add inside it):

```typescript
// At the top of the file, ensure the admin client mock captures calls:
// vi.mock("@/lib/supabase/admin") should already exist — if not, add it.
// Also mock @/lib/booking-consent:
// vi.mock("@/lib/booking-consent", () => ({ MARKETING_CONSENT_WORDING: "Test wording" }))

describe("createBookingAction — customer upsert", () => {
  it("should pass marketingOptIn=true to the customer upsert", async () => {
    // Arrange: set up mocks for createBookingAtomic to succeed
    // and admin client upsert to capture the call
    // Act: call createBookingAction with marketingOptIn: true
    // Assert: admin client upsert was called with marketing_opt_in: true
  });

  it("should not downgrade marketingOptIn from true to false on re-booking", async () => {
    // Arrange: mock upsert to return existing customer with marketing_opt_in: true
    // Act: call createBookingAction with marketingOptIn: false
    // Assert: upsert SQL uses upgrade-only logic (marketing_opt_in stays true)
  });

  it("should log a consent event when marketingOptIn changes", async () => {
    // Arrange: mock returns previous opt_in = false; new = true
    // Act: call createBookingAction with marketingOptIn: true
    // Assert: customer_consent_events.insert was called with event_type='opt_in'
  });

  it("should NOT log a consent event when marketingOptIn is unchanged", async () => {
    // Arrange: mock returns previous opt_in = false; new = false
    // Act: call createBookingAction with marketingOptIn: false
    // Assert: customer_consent_events.insert was NOT called
  });

  it("should succeed even if customer upsert throws", async () => {
    // Arrange: mock upsert to throw
    // Act: call createBookingAction
    // Assert: returns { success: true, bookingId: "..." }
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/actions/__tests__/bookings.test.ts 2>&1 | tail -30
```

Expected: tests fail (customer upsert logic not implemented yet).

- [ ] **Step 3: Implement customer upsert in createBookingAction**

Open `src/actions/bookings.ts` and make these changes:

1. Add imports at the top:
```typescript
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MARKETING_CONSENT_WORDING } from "@/lib/booking-consent";
```

2. Update `createBookingSchema` to add `marketingOptIn`:
```typescript
const createBookingSchema = z.object({
  eventId:         z.string().uuid(),
  firstName:       z.string().min(1, "First name is required").max(100),
  lastName:        z.string().max(100).nullable(),
  mobile:          z.string().min(1, "Mobile number is required"),
  email:           z.string().email("Invalid email address").nullable(),
  ticketCount:     z.number().int().min(1).max(50),
  marketingOptIn:  z.boolean().default(false),
});
```

3. After the `sendBookingConfirmationSms` call (and before the final `return { success: true, bookingId }`), add the customer upsert:

```typescript
  // Upsert customer record (non-blocking — booking is already confirmed)
  try {
    const db = createSupabaseAdminClient();

    // Step 1: Upsert core fields ONLY — do NOT include marketing_opt_in here.
    // marketing_opt_in is upgrade-only and handled separately below.
    // name = last-write-wins, email = COALESCE (Supabase upsert overwrites;
    // to get COALESCE on email we exclude it when null).
    const upsertPayload: Record<string, unknown> = {
      mobile:     normalisedMobile,
      first_name: data.firstName,
      last_name:  data.lastName ?? null,
      updated_at: new Date().toISOString(),
    };
    if (data.email) upsertPayload.email = data.email; // only set when provided

    const { data: upserted, error: upsertError } = await db
      .from("customers")
      .upsert(upsertPayload, { onConflict: "mobile" })
      .select("id, marketing_opt_in")
      .single();

    if (upsertError) {
      console.error("Customer upsert failed:", upsertError);
    } else if (upserted) {
      // Step 2: Upgrade-only opt-in.
      // Only write marketing_opt_in when the new value is TRUE.
      // If new value is false, leave the existing value unchanged.
      // This avoids any check-then-write race: two concurrent opt-in bookings
      // are idempotent; a false value never touches the column.
      if (data.marketingOptIn && !upserted.marketing_opt_in) {
        await db
          .from("customers")
          .update({ marketing_opt_in: true })
          .eq("id", upserted.id);
      }

      // Step 3: Log consent event only when value genuinely changes.
      const previousOptIn = upserted.marketing_opt_in as boolean;
      const newOptIn = data.marketingOptIn;

      if (newOptIn !== previousOptIn) {
        const { error: consentError } = await db
          .from("customer_consent_events")
          .insert({
            customer_id:     upserted.id,
            event_type:      newOptIn ? "opt_in" : "opt_out",
            consent_wording: MARKETING_CONSENT_WORDING,
            booking_id:      bookingId,
          });

        if (consentError) {
          console.error("Consent event insert failed:", consentError);
          // Non-fatal — booking and customer record are already saved
        }
      }

      // Step 4: Link booking to customer
      await db
        .from("event_bookings")
        .update({ customer_id: upserted.id })
        .eq("id", bookingId);
    }
  } catch (customerErr) {
    console.error("Customer upsert pipeline failed:", customerErr);
    // Non-fatal — booking is confirmed
  }
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/actions/__tests__/bookings.test.ts 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/actions/bookings.ts src/actions/__tests__/bookings.test.ts
git commit -m "feat: upsert customer and log consent event on booking creation"
```

---

## Chunk 3: Data Layer — customers.ts and all-bookings.ts

**Goal:** Create the data access functions that the new pages will use.

### Task 5: Create src/lib/customers.ts

**Files:**
- Create: `src/lib/customers.ts`
- Create: `src/lib/__tests__/customers.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/__tests__/customers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listCustomersForUser, getCustomerById } from "@/lib/customers";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

// Helper: build a mock Supabase chain
function mockDb(returnValue: unknown) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(returnValue),
    then: vi.fn(),
  };
  return chain;
}

describe("listCustomersForUser", () => {
  it("should return all customers for central_planner with no venue filter", async () => {
    // mock db.rpc or db.from("customers")... to return rows
    // call listCustomersForUser with central_planner user
    // assert returns array of CustomerWithStats
  });

  it("should filter by venue_id for venue_manager", async () => {
    // call listCustomersForUser with venue_manager user (venueId = 'venue-1')
    // assert the query filters by venue
  });

  it("should filter by search term when provided", async () => {
    // call with searchTerm = "Pete"
    // assert the query includes an ilike filter
  });

  it("should filter by marketing_opt_in=true when optInOnly=true", async () => {
    // call with optInOnly: true
    // assert the query filters by marketing_opt_in
  });
});

describe("getCustomerById", () => {
  it("should return null when customer not found", async () => {
    // mock db to return null data
    // assert returns null
  });

  it("should return customer with bookings for central_planner", async () => {
    // mock db to return customer with joined bookings
    // assert correct shape
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/__tests__/customers.test.ts 2>&1 | tail -20
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement src/lib/customers.ts**

```typescript
// src/lib/customers.ts
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppUser, Customer, CustomerWithStats } from "@/lib/types";

function rowToCustomer(row: Record<string, unknown>): Customer {
  return {
    id:              row.id as string,
    firstName:       row.first_name as string,
    lastName:        (row.last_name as string | null) ?? null,
    mobile:          row.mobile as string,
    email:           (row.email as string | null) ?? null,
    marketingOptIn:  row.marketing_opt_in as boolean,
    createdAt:       new Date(row.created_at as string),
    updatedAt:       new Date(row.updated_at as string),
  };
}

export interface ListCustomersOptions {
  searchTerm?: string;    // matches first_name, last_name, or mobile
  optInOnly?: boolean;
}

/**
 * List customers scoped to the user's role.
 * - central_planner: all customers
 * - venue_manager: customers with at least one booking at their venue
 * Returns CustomerWithStats (booking count, ticket count, first seen).
 */
export async function listCustomersForUser(
  user: AppUser,
  options: ListCustomersOptions = {},
): Promise<CustomerWithStats[]> {
  const db = createSupabaseAdminClient();

  // Build the query: join event_bookings for stats
  // Use a raw SQL approach via rpc for the aggregated stats
  const { data, error } = await db.rpc("list_customers_with_stats", {
    p_venue_id:   user.role === "venue_manager" ? user.venueId : null,
    p_search:     options.searchTerm ?? null,
    p_opt_in_only: options.optInOnly ?? false,
  });

  if (error) throw new Error(`listCustomersForUser failed: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...rowToCustomer(row),
    bookingCount: row.booking_count as number,
    ticketCount:  row.ticket_count as number,
    firstSeen:    new Date(row.first_seen as string),
  }));
}

/**
 * Get a single customer with their bookings.
 * Returns null if not found.
 * For venue_manager, also returns null if customer has no bookings at their venue.
 */
export async function getCustomerById(
  customerId: string,
  user: AppUser,
): Promise<(Customer & { bookings: CustomerBooking[] }) | null> {
  const db = createSupabaseAdminClient();

  // Fetch customer
  const { data: customerRow, error: customerError } = await db
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) throw new Error(`getCustomerById failed: ${customerError.message}`);
  if (!customerRow) return null;

  // Fetch bookings for this customer, scoped by venue if needed
  let bookingsQuery = db
    .from("event_bookings")
    .select(`
      id, ticket_count, status, created_at,
      events (id, title, start_at, venue_id,
        venues (id, name)
      )
    `)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (user.role === "venue_manager" && user.venueId) {
    // Only show bookings at the manager's venue
    // We filter after fetch (can't filter on joined column with Supabase JS client easily)
  }

  const { data: bookingRows, error: bookingsError } = await bookingsQuery;
  if (bookingsError) throw new Error(`getCustomerById bookings failed: ${bookingsError.message}`);

  let bookings = (bookingRows ?? []).map((row: Record<string, unknown>) => {
    // events is joined via event_bookings.event_id → events.id
    // venues is joined via events.venue_id → venues.id
    const event = (row.events as Record<string, unknown>) ?? {};
    const venue = (event.venues as Record<string, unknown>) ?? {};
    return {
      id:           row.id as string,
      ticketCount:  row.ticket_count as number,
      status:       row.status as "confirmed" | "cancelled",
      createdAt:    new Date(row.created_at as string),
      eventId:      event.id as string,
      eventTitle:   event.title as string,
      eventStartAt: new Date(event.start_at as string),
      // venue_id lives on the events row, not on event_bookings
      venueId:      event.venue_id as string,
      venueName:    (venue.name as string) ?? null,
    };
  });

  // Scope for venue_manager: filter by events.venue_id == user.venueId
  // (join path: customer → event_bookings → events → venue_id)
  if (user.role === "venue_manager" && user.venueId) {
    bookings = bookings.filter((b) => b.venueId === user.venueId);
    if (bookings.length === 0) return null; // customer not visible to this manager
  }

  return { ...rowToCustomer(customerRow as Record<string, unknown>), bookings };
}

export interface CustomerBooking {
  id: string;
  ticketCount: number;
  status: "confirmed" | "cancelled";
  createdAt: Date;
  eventId: string;
  eventTitle: string;
  eventStartAt: Date;
  venueId: string;
  venueName: string | null;
}
```

**Note:** The `list_customers_with_stats` RPC needs to be added to the migration. Add it to the migration file before Step 2 in Task 1 (or create a follow-up migration):

```sql
-- Add to migration or as a new migration:
CREATE OR REPLACE FUNCTION list_customers_with_stats(
  p_venue_id   uuid,
  p_search     text,
  p_opt_in_only boolean
)
RETURNS TABLE (
  id               uuid,
  first_name       text,
  last_name        text,
  mobile           text,
  email            text,
  marketing_opt_in boolean,
  created_at       timestamptz,
  updated_at       timestamptz,
  booking_count    bigint,
  ticket_count     bigint,
  first_seen       timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    c.id, c.first_name, c.last_name, c.mobile, c.email,
    c.marketing_opt_in, c.created_at, c.updated_at,
    COUNT(eb.id)           AS booking_count,
    COALESCE(SUM(eb.ticket_count), 0) AS ticket_count,
    MIN(eb.created_at)     AS first_seen
  FROM customers c
  LEFT JOIN event_bookings eb ON eb.customer_id = c.id
  LEFT JOIN events e ON e.id = eb.event_id
  WHERE
    (p_venue_id IS NULL OR e.venue_id = p_venue_id)
    AND (p_search IS NULL OR
         c.first_name ILIKE '%' || p_search || '%' OR
         c.last_name  ILIKE '%' || p_search || '%' OR
         c.mobile     ILIKE '%' || p_search || '%')
    AND (NOT p_opt_in_only OR c.marketing_opt_in = true)
  GROUP BY c.id
  ORDER BY first_seen DESC NULLS LAST;
$$;
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/customers.test.ts 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/customers.ts src/lib/__tests__/customers.test.ts
git commit -m "feat: add customers data layer with listCustomersForUser and getCustomerById"
```

---

### Task 6: Create src/lib/all-bookings.ts

**Files:**
- Create: `src/lib/all-bookings.ts`
- Create: `src/lib/__tests__/all-bookings.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/__tests__/all-bookings.test.ts
import { describe, it, expect, vi } from "vitest";
import { listAllBookingsForUser } from "@/lib/all-bookings";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

describe("listAllBookingsForUser", () => {
  it("should return bookings grouped by event for central_planner", async () => {
    // mock db to return flat bookings with event data
    // assert returns array of BookingGroup with nested bookings
  });

  it("should filter by venue_id for venue_manager", async () => {
    // assert query filters by venue
  });

  it("should filter by status when provided", async () => {
    // assert query filters by status = 'confirmed'
  });

  it("should filter by date range when provided", async () => {
    // assert query applies a gte/lte filter on events.start_at
  });

  it("should filter by search term", async () => {
    // assert query applies ilike on first_name/last_name/mobile
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/__tests__/all-bookings.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Implement src/lib/all-bookings.ts**

```typescript
// src/lib/all-bookings.ts
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppUser, BookingStatus } from "@/lib/types";

export interface BookingRow {
  id: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  ticketCount: number;
  status: BookingStatus;
  createdAt: Date;
}

export interface BookingGroup {
  eventId: string;
  eventTitle: string;
  eventStartAt: Date;
  venueName: string | null;
  bookings: BookingRow[];
  totalBookings: number;
  totalTickets: number;
}

export interface ListAllBookingsOptions {
  searchTerm?: string;
  statusFilter?: BookingStatus | "all";
  dateRange?: "all" | "this_month" | "next_30_days";
}

/**
 * Fetch all bookings grouped by event, scoped to the user's role.
 * - central_planner: all venues
 * - venue_manager: own venue only (user.venueId)
 */
export async function listAllBookingsForUser(
  user: AppUser,
  options: ListAllBookingsOptions = {},
): Promise<BookingGroup[]> {
  const db = createSupabaseAdminClient();

  let query = db
    .from("event_bookings")
    .select(`
      id, first_name, last_name, mobile, ticket_count, status, created_at,
      customer_id,
      events!inner (
        id, title, start_at,
        venues (id, name)
      )
    `)
    .order("created_at", { ascending: false });

  // Role scoping
  if (user.role === "venue_manager" && user.venueId) {
    query = query.eq("events.venue_id", user.venueId);
  }

  // Status filter
  if (options.statusFilter && options.statusFilter !== "all") {
    query = query.eq("status", options.statusFilter);
  }

  // Date range filter
  const now = new Date();
  if (options.dateRange === "this_month") {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
    query = query.gte("events.start_at", startOfMonth).lte("events.start_at", endOfMonth);
  } else if (options.dateRange === "next_30_days") {
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("events.start_at", now.toISOString()).lte("events.start_at", in30);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listAllBookingsForUser failed: ${error.message}`);

  // Group by event
  const groupMap = new Map<string, BookingGroup>();

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const event = row.events as Record<string, unknown>;
    const venue = (event.venues as Record<string, unknown>) ?? {};
    const eventId = event.id as string;

    // Apply search filter (client-side after DB fetch)
    if (options.searchTerm) {
      const term = options.searchTerm.toLowerCase();
      const fn = (row.first_name as string ?? "").toLowerCase();
      const ln = (row.last_name as string ?? "").toLowerCase();
      const mob = (row.mobile as string ?? "").toLowerCase();
      if (!fn.includes(term) && !ln.includes(term) && !mob.includes(term)) continue;
    }

    if (!groupMap.has(eventId)) {
      groupMap.set(eventId, {
        eventId,
        eventTitle:  event.title as string,
        eventStartAt: new Date(event.start_at as string),
        venueName:   (venue.name as string) ?? null,
        bookings:    [],
        totalBookings: 0,
        totalTickets:  0,
      });
    }

    const group = groupMap.get(eventId)!;
    const tickets = row.ticket_count as number;
    group.bookings.push({
      id:          row.id as string,
      firstName:   row.first_name as string,
      lastName:    (row.last_name as string | null) ?? null,
      mobile:      row.mobile as string,
      ticketCount: tickets,
      status:      row.status as BookingStatus,
      createdAt:   new Date(row.created_at as string),
    });
    group.totalBookings++;
    group.totalTickets += tickets;
  }

  // Sort groups by event start_at descending
  return Array.from(groupMap.values()).sort(
    (a, b) => b.eventStartAt.getTime() - a.eventStartAt.getTime(),
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/all-bookings.test.ts 2>&1 | tail -30
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/all-bookings.ts src/lib/__tests__/all-bookings.test.ts
git commit -m "feat: add all-bookings data layer with listAllBookingsForUser"
```

---

## Chunk 4: Navigation + All Bookings Page

### Task 7: Add Bookings and Customers to navigation

**Files:**
- Modify: `src/components/shell/app-shell.tsx`

- [ ] **Step 1: Add nav items**

Open `src/components/shell/app-shell.tsx`. In the `NAV_SECTIONS` array, find the "Core Workspace" section (the first section in the array). Add Bookings and Customers **after Events and before Artists**, in the same "Core Workspace" section (not a new section). Use the same role list as Events: `["central_planner", "venue_manager"]`.

Replace the current "Core Workspace" items array with:

```typescript
const NAV_SECTIONS: NavSection[] = [
  {
    label: "Core Workspace",
    items: [
      { label: "Dashboard", href: "/", roles: ["central_planner", "reviewer", "venue_manager", "executive"] },
      { label: "Events",    href: "/events",    roles: ["central_planner", "venue_manager"] },
      { label: "Bookings",  href: "/bookings",  roles: ["central_planner", "venue_manager"] },   // new
      { label: "Customers", href: "/customers", roles: ["central_planner", "venue_manager"] },   // new
      { label: "Artists",   href: "/artists",   roles: ["central_planner", "venue_manager"] },
      { label: "Reviews",   href: "/reviews",   roles: ["central_planner", "reviewer"] }
    ]
  },
  // ... remaining sections (Strategic Planning, Tools, Administration) unchanged
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/app-shell.tsx
git commit -m "feat: add Bookings and Customers to sidebar navigation"
```

---

### Task 8: Build the All Bookings page

**Files:**
- Create: `src/app/bookings/page.tsx`
- Create: `src/app/bookings/BookingsView.tsx`

- [ ] **Step 1: Create the server page component**

```typescript
// src/app/bookings/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAllBookingsForUser } from "@/lib/all-bookings";
import { BookingsView } from "./BookingsView";

export const metadata = { title: "All Bookings — BaronsHub" };

export default async function BookingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner" && user.role !== "venue_manager") {
    redirect("/unauthorized");
  }

  const groups = await listAllBookingsForUser(user);

  const totalBookings = groups.reduce((s, g) => s + g.totalBookings, 0);
  const totalTickets  = groups.reduce((s, g) => s + g.totalTickets, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">All Bookings</h1>
        <p className="text-sm text-subtle mt-1">
          {totalBookings} booking{totalBookings !== 1 ? "s" : ""} · {totalTickets} ticket{totalTickets !== 1 ? "s" : ""}
        </p>
      </div>
      <BookingsView groups={groups} userRole={user.role} />
    </div>
  );
}
```

- [ ] **Step 2: Create the client-side BookingsView component**

```tsx
// src/app/bookings/BookingsView.tsx
"use client";

import { useState, useMemo } from "react";
import type { BookingGroup } from "@/lib/all-bookings";
import type { UserRole, BookingStatus } from "@/lib/types";
import dayjs from "dayjs";

interface BookingsViewProps {
  groups: BookingGroup[];
  userRole: UserRole;
}

export function BookingsView({ groups, userRole }: BookingsViewProps) {
  const [search, setSearch]         = useState("");
  const [statusFilter, setStatus]   = useState<"all" | BookingStatus>("all");
  const [dateFilter, setDateFilter] = useState<"all" | "this_month" | "next_30_days">("all");

  const filtered = useMemo(() => {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return groups
      .map((group) => {
        // Date range filter on event
        if (dateFilter === "this_month") {
          const start = new Date(now.getFullYear(), now.getMonth(), 1);
          const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          if (group.eventStartAt < start || group.eventStartAt > end) return null;
        }
        if (dateFilter === "next_30_days") {
          if (group.eventStartAt < now || group.eventStartAt > in30) return null;
        }

        const filteredBookings = group.bookings.filter((b) => {
          if (statusFilter !== "all" && b.status !== statusFilter) return false;
          if (search) {
            const term = search.toLowerCase();
            const fn = b.firstName.toLowerCase();
            const ln = (b.lastName ?? "").toLowerCase();
            const mob = b.mobile.toLowerCase();
            if (!fn.includes(term) && !ln.includes(term) && !mob.includes(term)) return false;
          }
          return true;
        });

        if (filteredBookings.length === 0) return null;

        return {
          ...group,
          bookings:      filteredBookings,
          totalBookings: filteredBookings.length,
          totalTickets:  filteredBookings.reduce((s, b) => s + b.ticketCount, 0),
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [groups, search, statusFilter, dateFilter]);

  const totalBookings = filtered.reduce((s, g) => s + g.totalBookings, 0);
  const totalTickets  = filtered.reduce((s, g) => s + g.totalTickets, 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-white p-3">
        <input
          type="search"
          placeholder="Search name, mobile…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 rounded border border-[#cbd5db] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#273640] w-48"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value as typeof statusFilter)}
          className="h-8 rounded border border-[#cbd5db] px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#273640]"
        >
          <option value="all">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
          className="h-8 rounded border border-[#cbd5db] px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#273640]"
        >
          <option value="all">All time</option>
          <option value="this_month">This month</option>
          <option value="next_30_days">Next 30 days</option>
        </select>
        <span className="ml-auto text-xs text-subtle">
          {totalBookings} booking{totalBookings !== 1 ? "s" : ""} · {totalTickets} ticket{totalTickets !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Event groups */}
      {filtered.length === 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center text-sm text-subtle">
          No bookings found.
        </p>
      ) : (
        <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-white overflow-hidden">
          {filtered.map((group) => (
            <div key={group.eventId}>
              {/* Group header */}
              <div className="flex items-center justify-between bg-[#f9f9f9] px-4 py-2 border-b border-[var(--color-border)]">
                <div>
                  <span className="text-sm font-semibold text-[#273640]">{group.eventTitle}</span>
                  <span className="ml-2 text-xs text-subtle">
                    {dayjs(group.eventStartAt).format("ddd D MMM")}
                    {group.venueName ? ` · ${group.venueName}` : ""}
                  </span>
                </div>
                <span className="text-xs text-subtle">
                  {group.totalBookings} booking{group.totalBookings !== 1 ? "s" : ""} · {group.totalTickets} ticket{group.totalTickets !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Booking rows */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#fafafa] text-[10px] uppercase tracking-wider text-subtle">
                    <th className="px-4 py-1.5 text-left font-semibold">Name</th>
                    <th className="px-4 py-1.5 text-left font-semibold">Mobile</th>
                    <th className="px-4 py-1.5 text-left font-semibold">Tickets</th>
                    <th className="px-4 py-1.5 text-left font-semibold">Booked</th>
                    <th className="px-4 py-1.5 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f5f5f5]">
                  {group.bookings.map((b) => (
                    <tr key={b.id} className="hover:bg-[#fafafa]">
                      <td className="px-4 py-2 text-[#273640]">
                        {b.firstName} {b.lastName ?? ""}
                      </td>
                      <td className="px-4 py-2 text-[#637c8c]">{b.mobile}</td>
                      <td className="px-4 py-2">{b.ticketCount}</td>
                      <td className="px-4 py-2 text-subtle text-xs">
                        {dayjs(b.createdAt).format("D MMM")}
                      </td>
                      <td className="px-4 py-2">
                        {b.status === "confirmed" ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Confirmed
                          </span>
                        ) : (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                            Cancelled
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build check**

```bash
npm run build 2>&1 | grep -E "(error|Error|✓)" | tail -20
```

Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add src/app/bookings/
git commit -m "feat: add All Bookings page with event-grouped view and filtering"
```

---

## Chunk 5: Customers Pages + deleteCustomerAction

### Task 9: Build the Customers list page

**Files:**
- Create: `src/app/customers/page.tsx`
- Create: `src/app/customers/CustomersView.tsx`

- [ ] **Step 1: Create the server page**

```typescript
// src/app/customers/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listCustomersForUser } from "@/lib/customers";
import { CustomersView } from "./CustomersView";

export const metadata = { title: "Customers — BaronsHub" };

export default async function CustomersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner" && user.role !== "venue_manager") {
    redirect("/unauthorized");
  }

  const customers = await listCustomersForUser(user);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Customers</h1>
        <p className="text-sm text-subtle mt-1">{customers.length} customer{customers.length !== 1 ? "s" : ""}</p>
      </div>
      <CustomersView customers={customers} />
    </div>
  );
}
```

- [ ] **Step 2: Create the client CustomersView component**

```tsx
// src/app/customers/CustomersView.tsx
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { CustomerWithStats } from "@/lib/types";
import dayjs from "dayjs";

interface CustomersViewProps {
  customers: CustomerWithStats[];
}

export function CustomersView({ customers }: CustomersViewProps) {
  const [search, setSearch]       = useState("");
  const [optInOnly, setOptInOnly] = useState(false);

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      if (optInOnly && !c.marketingOptIn) return false;
      if (search) {
        const term = search.toLowerCase();
        const fn = c.firstName.toLowerCase();
        const ln = (c.lastName ?? "").toLowerCase();
        const mob = c.mobile.toLowerCase();
        if (!fn.includes(term) && !ln.includes(term) && !mob.includes(term)) return false;
      }
      return true;
    });
  }, [customers, search, optInOnly]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-white p-3">
        <input
          type="search"
          placeholder="Search name, mobile…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 rounded border border-[#cbd5db] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#273640] w-48"
        />
        <label className="flex items-center gap-2 text-sm text-[#273640] cursor-pointer">
          <input
            type="checkbox"
            checked={optInOnly}
            onChange={(e) => setOptInOnly(e.target.checked)}
            className="rounded border-[#cbd5db] focus:ring-2 focus:ring-[#273640]"
          />
          Marketing opt-in only
        </label>
        <span className="ml-auto text-xs text-subtle">
          {filtered.length} customer{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center text-sm text-subtle">
          No customers found.
        </p>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#fafafa] text-[10px] uppercase tracking-wider text-subtle border-b border-[var(--color-border)]">
                <th className="px-4 py-2 text-left font-semibold">Name</th>
                <th className="px-4 py-2 text-left font-semibold">Mobile</th>
                <th className="px-4 py-2 text-left font-semibold">Email</th>
                <th className="px-4 py-2 text-left font-semibold">Bookings</th>
                <th className="px-4 py-2 text-left font-semibold">Mktg</th>
                <th className="px-4 py-2 text-left font-semibold">First seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f5f5f5]">
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className="hover:bg-[#fafafa] cursor-pointer"
                >
                  <td className="px-4 py-2.5 font-semibold text-[#273640]">
                    <Link href={`/customers/${c.id}`} className="hover:underline">
                      {c.firstName} {c.lastName ?? ""}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-[#637c8c]">{c.mobile}</td>
                  <td className="px-4 py-2.5 text-[#637c8c] max-w-[140px] truncate">
                    {c.email ? c.email : <span className="text-subtle">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.bookingCount} booking{c.bookingCount !== 1 ? "s" : ""} · {c.ticketCount} ticket{c.ticketCount !== 1 ? "s" : ""}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.marketingOptIn ? (
                      <span className="text-[#c8a005] font-bold">✓</span>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-subtle text-xs">
                    {dayjs(c.firstSeen).format("D MMM YYYY")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build check**

```bash
npm run build 2>&1 | grep -E "(error|Error)" | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/app/customers/
git commit -m "feat: add Customers page with filtering and marketing opt-in toggle"
```

---

### Task 10: Build the Customer detail page

**Files:**
- Create: `src/app/customers/[id]/page.tsx`

- [ ] **Step 1: Create the customer detail page**

```typescript
// src/app/customers/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getCustomerById } from "@/lib/customers";
import dayjs from "dayjs";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner" && user.role !== "venue_manager") {
    redirect("/unauthorized");
  }

  const customer = await getCustomerById(id, user);
  if (!customer) notFound();

  const confirmedTickets = customer.bookings
    .filter((b) => b.status === "confirmed")
    .reduce((s, b) => s + b.ticketCount, 0);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back link */}
      <Link href="/customers" className="text-sm text-[#637c8c] hover:underline">
        ← Back to Customers
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">
          {customer.firstName} {customer.lastName ?? ""}
        </h1>
        <p className="text-sm text-subtle mt-1">
          {customer.bookings.length} booking{customer.bookings.length !== 1 ? "s" : ""} · {confirmedTickets} confirmed ticket{confirmedTickets !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Customer details */}
      <div className="rounded-lg border border-[var(--color-border)] bg-white p-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-subtle text-xs uppercase tracking-wider mb-0.5">Mobile</p>
          <p className="font-medium text-[#273640]">{customer.mobile}</p>
        </div>
        <div>
          <p className="text-subtle text-xs uppercase tracking-wider mb-0.5">Email</p>
          <p className="font-medium text-[#273640]">{customer.email ?? "—"}</p>
        </div>
        <div>
          <p className="text-subtle text-xs uppercase tracking-wider mb-0.5">Marketing opt-in</p>
          <p className="font-medium">
            {customer.marketingOptIn ? (
              <span className="text-[#c8a005]">✓ Yes</span>
            ) : (
              <span className="text-subtle">No</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-subtle text-xs uppercase tracking-wider mb-0.5">First booking</p>
          <p className="font-medium text-[#273640]">
            {customer.bookings.length > 0
              ? dayjs(customer.bookings[customer.bookings.length - 1].createdAt).format("D MMM YYYY")
              : "—"}
          </p>
        </div>
      </div>

      {/* Booking history */}
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-3">Booking history</h2>
        {customer.bookings.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] bg-white p-6 text-center text-sm text-subtle">
            No bookings yet.
          </p>
        ) : (
          <div className="rounded-lg border border-[var(--color-border)] bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#fafafa] text-[10px] uppercase tracking-wider text-subtle border-b border-[var(--color-border)]">
                  <th className="px-4 py-2 text-left font-semibold">Event</th>
                  <th className="px-4 py-2 text-left font-semibold">Venue</th>
                  <th className="px-4 py-2 text-left font-semibold">Date</th>
                  <th className="px-4 py-2 text-left font-semibold">Tickets</th>
                  <th className="px-4 py-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f5f5f5]">
                {customer.bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-[#fafafa]">
                    <td className="px-4 py-2.5 font-medium text-[#273640]">{b.eventTitle}</td>
                    <td className="px-4 py-2.5 text-subtle">{b.venueName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-subtle text-xs">
                      {dayjs(b.eventStartAt).format("ddd D MMM YYYY")}
                    </td>
                    <td className="px-4 py-2.5">{b.ticketCount}</td>
                    <td className="px-4 py-2.5">
                      {b.status === "confirmed" ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                          Confirmed
                        </span>
                      ) : (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                          Cancelled
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | grep -E "(error|Error)" | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/customers/[id]/
git commit -m "feat: add customer detail page with booking history"
```

---

### Task 11: Add deleteCustomerAction (soft erasure, no UI)

**Files:**
- Create: `src/actions/customers.ts`

- [ ] **Step 1: Create the action**

```typescript
// src/actions/customers.ts
"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { recordAuditLogEntry } from "@/lib/audit-log";

export type DeleteCustomerResult = { success: boolean; error?: string };

/**
 * Soft-erase a customer (GDPR Article 17 right to erasure).
 * Replaces PII with anonymised placeholders. Consent events are retained.
 * Hard deletion is blocked at the DB level (ON DELETE RESTRICT on customer_consent_events).
 * Accessible to central_planner only. No UI in v1 — invocable from Supabase Studio.
 */
export async function deleteCustomerAction(
  customerId: string,
): Promise<DeleteCustomerResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Unauthorized" };
  if (user.role !== "central_planner") {
    return { success: false, error: "Only central planners can erase customer data." };
  }

  const db = createSupabaseAdminClient();

  // Soft erasure — replace PII with anonymised tokens.
  // mobile = `DELETED-${customerId}` (~44 chars): unique per customer (uses their UUID),
  // satisfies the UNIQUE constraint on mobile, and the `text` column type
  // (not varchar(15)) accommodates this length.
  // ON DELETE RESTRICT on customer_consent_events means hard deletion is blocked
  // at the DB level; only this soft-erasure path is valid.
  const { error: customerError } = await db
    .from("customers")
    .update({
      first_name:       "Deleted",
      last_name:        null,
      email:            null,
      mobile:           `DELETED-${customerId}`,
      marketing_opt_in: false,
      updated_at:       new Date().toISOString(),
    })
    .eq("id", customerId);

  if (customerError) {
    console.error("deleteCustomerAction: customer update failed", customerError);
    return { success: false, error: "Failed to erase customer record." };
  }

  // Anonymise PII on booking rows for this customer
  const { error: bookingsError } = await db
    .from("event_bookings")
    .update({
      first_name: "Deleted",
      last_name:  null,
      email:      null,
      mobile:     `DELETED-${customerId}`,
    })
    .eq("customer_id", customerId);

  if (bookingsError) {
    console.error("deleteCustomerAction: bookings update failed", bookingsError);
    // Non-fatal — customer record is already anonymised
  }

  await recordAuditLogEntry({
    entity:    "customer",
    entityId:  customerId,
    action:    "customer.erased",
    meta:      {},
    actorId:   user.id,
  });

  return { success: true };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/customers.ts
git commit -m "feat: add deleteCustomerAction for GDPR right-to-erasure (no UI)"
```

---

## Chunk 6: Final Verification

### Task 12: Full pipeline check

- [ ] **Step 1: Run all tests**

```bash
npm test 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 2: Lint**

```bash
npm run lint 2>&1 | tail -20
```

Expected: zero errors, zero warnings.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: clean.

- [ ] **Step 4: Production build**

```bash
npm run build 2>&1 | tail -20
```

Expected: successful build.

- [ ] **Step 5: Smoke test the new routes (dev server)**

Start dev server: `npm run dev`

Visit in browser:
- `/bookings` — should show "All Bookings" with event groups (or empty state if no bookings)
- `/customers` — should show "Customers" table (or empty state)
- `/customers/[any-valid-id]` — should show customer detail

Check sidebar shows Bookings and Customers links for central_planner and venue_manager.
Check public booking form at `/l/[any-event-slug]` shows unchecked marketing opt-in checkbox.

- [ ] **Step 6: Final commit + push**

```bash
git push origin main
```

---

## Parallel Execution Guide

Tasks that can run concurrently once Chunk 1 (migration) is deployed:

| Agent | Tasks |
|-------|-------|
| A | Task 2 (types + constant) → Task 4 (createBookingAction) |
| B | Task 3 (BookingForm) |
| C | Task 5 (lib/customers.ts) → Task 9 (Customers page) → Task 10 (Customer detail) |
| D | Task 6 (lib/all-bookings.ts) → Task 8 (Bookings page) |
| E | Task 7 (navigation) → Task 11 (deleteCustomerAction) |

All agents merge before Task 12 (final verification).
