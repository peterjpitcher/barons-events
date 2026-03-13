# Bookings & Customers — Design Spec

**Date:** 2026-03-13
**Status:** Draft

---

## Overview

Add a `customers` table to deduplicate bookers across events, track marketing opt-in consent (UK GDPR compliant), and surface two new admin pages — All Bookings and Customers — accessible to `central_planner` and `venue_manager` roles.

---

## 1. Database Schema

### 1.1 New `customers` table

```sql
CREATE TABLE customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name       text NOT NULL,
  last_name        text,
  mobile           text UNIQUE NOT NULL,  -- E.164, natural key
  email            text,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
```

### 1.2 New `customer_consent_events` table

Immutable consent audit log, required for UK GDPR Article 7(1) demonstrability.

```sql
CREATE TABLE customer_consent_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  event_type      text NOT NULL,  -- 'opt_in' | 'opt_out'
  consent_wording text NOT NULL,  -- full wording shown to user at time of consent
  booking_id      uuid REFERENCES event_bookings(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);
```

- A row is inserted on every booking where the user interacts with the opt-in checkbox (both opt-in and opt-out events are recorded).
- `consent_wording` captures the exact text displayed, making it immune to future code changes.
- Rows are never updated or deleted (append-only).
- `ON DELETE RESTRICT` on `customer_id` prevents hard-deletion of a customer row while consent events exist — soft erasure (Section 9) is the only permitted path. This enforces the retention requirement at the database level.

### 1.3 `event_bookings` — new FK column

```sql
ALTER TABLE event_bookings
  ADD COLUMN customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
```

Nullable. A NULL `customer_id` means the customer upsert failed. Such bookings appear on the All Bookings page (using name/mobile from the booking row directly) but do not contribute to Customers page aggregates.

### 1.4 Backfill migration

Runs inside a **single transaction** for rollback safety.

```sql
-- idempotent: ON CONFLICT DO NOTHING so re-runs are safe
INSERT INTO customers (mobile, first_name, last_name, email)
SELECT DISTINCT ON (mobile)
  mobile, first_name, last_name, email
FROM event_bookings
WHERE mobile IS NOT NULL
ORDER BY mobile, created_at DESC
ON CONFLICT (mobile) DO NOTHING;

-- link bookings to customers
UPDATE event_bookings eb
SET customer_id = c.id
FROM customers c
WHERE eb.mobile = c.mobile
  AND eb.customer_id IS NULL;
```

- "Most-recent booking's name/email" is determined by `ORDER BY mobile, created_at DESC`.
- `ON CONFLICT DO NOTHING` makes the migration safe to re-run.
- All mobile numbers are normalised to E.164 (via `libphonenumber-js` in a migration script wrapper, not SQL) before the conflict key comparison.
- `marketing_opt_in` defaults to `false` for all backfilled rows — the `event_bookings` table has no existing `marketing_opt_in` column, so there is no historical consent data. `false` is the only legally safe default.
- No `customer_consent_events` rows are inserted for backfilled customers (no historical consent to record).

The migration must be tested against a production-like data snapshot before deployment.

---

## 2. Booking Form — marketing opt-in

Add an unchecked opt-in checkbox to `src/app/l/[slug]/BookingForm.tsx`, between the email field and the privacy policy notice:

```
[ ] Keep me updated with events, offers and news from Barons Pub Company.
    You can unsubscribe at any time.
```

- Checkbox is **unchecked by default** — required for valid UK GDPR consent (ICO guidance; pre-ticked boxes are not permitted).
- State: `marketingOptIn: boolean` (default `false`).
- Passed to `createBookingAction` as `marketingOptIn`.

The privacy policy link already present on the form (`https://www.baronspubs.com/policies/website-privacy/`) satisfies the "by booking you agree to our privacy policy" transparency requirement.

---

## 3. `createBookingAction` — customer upsert

The booking form is public (unauthenticated). The existing `createBookingAtomic` RPC runs with `SECURITY DEFINER` via the Supabase admin client. The customer upsert uses the **admin/service-role client** — this is correct because the endpoint is intentionally unauthenticated. The risk is acknowledged: a bug in this path could write arbitrary customer records with no database-level guard; this is mitigated by input validation (Zod schema) and E.164 mobile normalisation applied before the upsert.

**Mobile normalisation:** Normalised to E.164 via `libphonenumber-js`. Invalid numbers return `{ error: "Please enter a valid UK mobile number." }` before the database is touched.

**Consent wording constant:**

```typescript
export const MARKETING_CONSENT_WORDING =
  "Keep me updated with events, offers and news from Barons Pub Company. You can unsubscribe at any time.";
```

This constant is imported by both the booking form (for display) and the server action (for the consent event record), ensuring they are always in sync.

**Customer upsert — consent never downgraded:**

```sql
INSERT INTO customers (mobile, first_name, last_name, email, marketing_opt_in, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (mobile) DO UPDATE SET
  first_name       = EXCLUDED.first_name,
  last_name        = EXCLUDED.last_name,
  email            = COALESCE(EXCLUDED.email, customers.email),
  -- Only upgrade to true; never downgrade via re-booking
  marketing_opt_in = CASE
                       WHEN EXCLUDED.marketing_opt_in = true THEN true
                       ELSE customers.marketing_opt_in
                     END,
  updated_at       = now()
RETURNING id, marketing_opt_in AS previous_opt_in
```

**Rationale for "never downgrade":** The checkbox is unchecked by default. A returning customer who does not check the box has not actively withdrawn consent — they simply did not re-affirm it. Under UK GDPR, consent once validly given remains valid until explicitly withdrawn. Silently stripping consent via a default-unchecked re-booking form would undermine the consent record.

**Consent withdrawal mechanism:** UK GDPR Article 7(3) requires withdrawal to be as easy as giving consent. The withdrawal path for this system is:
- The privacy policy page (`baronspubs.com/policies/website-privacy/`) must state that marketing consent can be withdrawn by emailing `hello@baronspubs.com`.
- On receipt, a `central_planner` sets `marketing_opt_in = false` on the customer record and inserts a `customer_consent_events` row with `event_type = 'opt_out'` (manually, or via a future admin UI).
- This is proportionate for a small-scale event booking system where the data volume is low and the booking form has no session/login. A self-service unsubscribe link in SMS messages would satisfy Article 7(3) more cleanly and should be added when SMS marketing is implemented.

**Consent event logging:** After the upsert, if the user's `marketingOptIn` value differs from the customer's pre-upsert `marketing_opt_in` value, insert a `customer_consent_events` row:

```typescript
if (marketingOptIn !== previousOptIn) {
  await db.from("customer_consent_events").insert({
    customer_id: customerId,
    event_type: marketingOptIn ? "opt_in" : "opt_out",
    consent_wording: MARKETING_CONSENT_WORDING,
    booking_id: bookingId,
  });
}
```

**Name update:** last-write-wins. A re-booker correcting a name will update the record.

**Upsert failure handling:** Log the error and continue — the booking is confirmed, `customer_id` will be NULL on the booking row.

After upsert, set `event_bookings.customer_id` to the returned customer `id`.

---

## 4. All Bookings page — `/bookings`

### 4.1 Access

- `central_planner`: all venues.
- `venue_manager`: bookings for events at their assigned venue only.

The server-side query is **always scoped by role** before returning data. A `venue_manager` never receives rows outside their venue — client-side filtering operates only on the role-scoped result set. There is no data exposure risk from client-side filtering.

### 4.2 Layout

**Toolbar:** search input (matches first\_name, last\_name, mobile), venue filter (venue managers see only their venue), status filter (All / Confirmed / Cancelled), date range filter (All / This month / Next 30 days). Summary: `{n} bookings · {n} tickets`.

**Event groups:** bookings grouped by event, sorted by event `start_at` descending. Each group header: event name, date, venue name, booking/ticket counts.

**Booking rows:** Name, Mobile, Tickets, Booked (date), Status badge (Confirmed / Cancelled).

**Orphaned bookings** (NULL `customer_id`): shown in event groups using name/mobile from the booking row directly.

### 4.3 Performance

At launch, total bookings is expected to be in the hundreds. Client-side filtering is acceptable. Revisit at 6 months or if row count exceeds ~2,000.

### 4.4 File

`src/app/(authenticated)/bookings/page.tsx` (new).

---

## 5. Customers page — `/customers`

### 5.1 Access

- `central_planner`: all customers.
- `venue_manager`: customers who have **at least one booking at their venue** (past or future). Server query is role-scoped.

### 5.2 Layout

**Toolbar:** search input (name, mobile), venue filter, "Marketing opt-in only" checkbox toggle. Summary: `{n} customers`.

**Customer table:** Name, Mobile, Email (truncated), Bookings (count · ticket count), Mktg (✓ or —), First seen (date of first booking).

**Row click:** opens `/customers/[id]` — read-only booking history (see Section 5.3).

### 5.3 Customer detail page — `/customers/[id]`

A simple read-only page showing:
- Customer name, mobile, email, marketing opt-in status.
- Table of all bookings: Event name, Venue, Date, Tickets, Status.
- Empty state if no bookings.
- Access control: same as Customers page (central\_planner all; venue\_manager scoped to own venue — if the customer has no bookings at the manager's venue, return 404).

### 5.4 File

`src/app/(authenticated)/customers/page.tsx` (new).
`src/app/(authenticated)/customers/[id]/page.tsx` (new).

---

## 6. Navigation

Add **Bookings** and **Customers** as standalone items in the "Core Workspace" section of the sidebar, after Events:

```
Core Workspace
  Dashboard
  Events
  Bookings      ← new
  Customers     ← new
  Artists
  Reviews
```

Both items visible to `central_planner` and `venue_manager`. Hidden from `reviewer` and `executive`.

File: `src/components/layout/app-shell.tsx` (confirm exact file path before editing).

---

## 7. RLS Policies

### `customers` — SELECT

```sql
-- central_planner sees all customers
CREATE POLICY customers_select_central ON customers FOR SELECT
  TO authenticated
  USING (
    (SELECT role FROM user_roles WHERE user_id = auth.uid()) = 'central_planner'
  );

-- venue_manager sees customers with at least one booking at their venue
CREATE POLICY customers_select_venue_manager ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM event_bookings eb
      JOIN events e ON e.id = eb.event_id
      JOIN user_venue_assignments uva ON uva.venue_id = e.venue_id
      WHERE eb.customer_id = customers.id
        AND uva.user_id = auth.uid()
    )
  );
```

**Required indexes** to support the join-based policy:

```sql
CREATE INDEX idx_event_bookings_customer_id ON event_bookings(customer_id);
CREATE INDEX idx_event_bookings_event_id ON event_bookings(event_id);
CREATE INDEX idx_user_venue_assignments_user_id ON user_venue_assignments(user_id);
```

### `customers` — INSERT / UPDATE

RLS is enabled on `customers` with a default-deny posture. No INSERT or UPDATE policy is defined for authenticated or anon roles — all writes use the **service-role client**, which bypasses RLS in Supabase by design. This means direct INSERT/UPDATE via the anon key or any authenticated session is blocked at the database level. Implementers must not add an authenticated INSERT policy to "make it work" — all writes must go through the service-role client in server actions.

### `customer_consent_events` — SELECT

Same visibility as `customers` (join through `customers.id`).

### `event_bookings.customer_id`

No new RLS required.

**Note:** Table/column names for `user_roles` and `user_venue_assignments` must be confirmed against the live schema before writing migration SQL.

---

## 8. Type Changes

### `CreateBookingInput` (`src/actions/bookings.ts`)

```typescript
export interface CreateBookingInput {
  // ... existing fields ...
  marketingOptIn: boolean;  // new
}
```

Return type unchanged.

---

## 9. Right to Erasure (UK GDPR Article 17)

A customer deletion mechanism is required before go-live. Scope for v1:

Hard-deletion of a `customers` row is prohibited (the `ON DELETE RESTRICT` FK on `customer_consent_events` enforces this at the database level). The only permitted path is soft erasure:

- A server action `deleteCustomerAction(customerId)` accessible to `central_planner` only.
- Replaces PII on the `customers` row:
  - `first_name = 'Deleted'`
  - `last_name = null`
  - `email = null`
  - `mobile = 'DELETED-' || customers.id` — uses the customer's own UUID so the value is unique and the UNIQUE constraint on `mobile` is not violated. The `mobile` column must be typed as `text` (not `varchar(15)`) to accommodate this token, which is ~44 characters. E.164 numbers are at most 15 digits; `text` handles both.
- `customer_consent_events` rows are **retained** — `customer_id` FK continues to point to the anonymised record. The consent wording remains for regulatory audit purposes (anonymised name does not affect the legal validity of the consent record).
- `event_bookings` rows: `first_name`, `last_name`, `email`, `mobile` on the booking rows are also zeroed. The `customer_id` FK is retained (pointing to the anonymised record).
- No UI in v1 — the action exists but is invocable by a future admin panel or directly via Supabase Studio.

---

## 10. Error Handling

| Scenario | Behaviour |
|---|---|
| Customer upsert fails | Log error, continue with booking confirmed, `customer_id = null` |
| Mobile normalisation fails | Return `{ error: "Please enter a valid UK mobile number." }` |
| Consent event insert fails | Log error, do not fail booking or upsert |
| No bookings match filters | Empty state: "No bookings found." |
| No customers exist | Empty state: "No customers yet." |
| Customer detail — not found / out of scope | 404 |

---

## 11. Testing Requirements

| Area | Tests required |
|---|---|
| Customer upsert | Opt-in sets consent event; opt-out when already opted-in sets consent event; re-booking with unchecked box does NOT downgrade existing opt-in; email COALESCE; name last-write-wins |
| Mobile normalisation | Valid UK number → E.164; invalid → validation error |
| `createBookingAction` | Happy path sets `customer_id`; upsert failure leaves booking confirmed with null customer\_id |
| RLS policies | central\_planner sees all; venue\_manager scoped; anon client cannot read customers |
| Bookings page | Venue\_manager cannot see other venues; filters return correct subsets |
| Customer detail page | 404 if out of venue\_manager scope |

Minimum coverage: 90% on upsert/normalisation logic, 80% on server actions.

---

## 12. Out of Scope (v1)

- Customer profile slide-out panel (using separate page at `/customers/[id]` instead).
- CSV export.
- Bulk cancel or bulk message.
- SMS/email marketing send from within the app.
- Server-side pagination (acceptable until ~2,000 bookings).
- Admin UI for right-to-erasure requests (action exists but no UI).
- Consent wording versioning beyond the `customer_consent_events` wording snapshot.

---

## 13. Complexity Score

**Score: 4 (L)** — schema changes + backfill migration, two new pages + customer detail, nav update, booking form change, server action update, RLS policies, consent event logging.

Single branch deployment. Schema migration and application code must deploy together.
