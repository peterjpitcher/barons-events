# Booking Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the public booking flow by removing the anon INSERT bypass, making Turnstile fail-closed for bookings, enforcing per-mobile caps and max ticket limits atomically in the RPC, and gating bookings on event status.

**Architecture:** All data-level invariants (mobile cap, max tickets, status check) move into the `create_booking` RPC under its existing `FOR UPDATE` lock for atomicity. Application-level concerns (Turnstile, rate limiting, phone normalisation) stay in the TypeScript action. The shared `verifyTurnstile` function gains a `mode` parameter to avoid breaking auth callers.

**Tech Stack:** PostgreSQL (PL/pgSQL), Supabase migrations, TypeScript, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md`

---

### Task 1: Migration — Remove anon INSERT on event_bookings

**Files:**
- Create: `supabase/migrations/20260414120000_remove_anon_booking_insert.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Remove the anon INSERT policy and revoke INSERT from anon on event_bookings.
-- All public bookings go through the create_booking RPC (SECURITY DEFINER, service_role only).
-- No in-repo application code uses direct anon inserts (verified by grep).

DROP POLICY IF EXISTS "public_insert_booking" ON public.event_bookings;

REVOKE INSERT ON public.event_bookings FROM anon;
```

- [ ] **Step 2: Dry-run the migration**

Run: `npx supabase db push --dry-run 2>&1 | tail -20`
Expected: Migration listed, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260414120000_remove_anon_booking_insert.sql
git commit -m "fix: remove anon INSERT policy on event_bookings

Closes the direct-insert bypass that allowed attackers to write bookings
straight to Supabase, skipping Turnstile, rate limiting, and validation."
```

---

### Task 2: Migration — Harden create_booking RPC

**Files:**
- Create: `supabase/migrations/20260414120001_harden_create_booking_rpc.sql`

This migration replaces the `create_booking` function to add: per-mobile booking cap (3), max_tickets_per_booking enforcement, and event status gate (`approved`/`completed`). All checks run under the existing `FOR UPDATE` lock.

- [ ] **Step 1: Create the migration file**

```sql
-- Harden create_booking RPC:
-- 1. Enforce event status must be 'approved' or 'completed'
-- 2. Enforce max_tickets_per_booking per event
-- 3. Enforce per-mobile cap of 3 confirmed bookings per event
--
-- All checks are atomic under the existing FOR UPDATE lock.

CREATE OR REPLACE FUNCTION create_booking(
  p_event_id     uuid,
  p_first_name   text,
  p_last_name    text,
  p_mobile       text,
  p_email        text,
  p_ticket_count int
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event        RECORD;
  v_booked       int;
  v_mobile_count int;
  v_booking_id   uuid;
BEGIN
  -- Lock the event row for the duration of this transaction
  SELECT total_capacity, max_tickets_per_booking, status, booking_enabled, deleted_at
  INTO v_event
  FROM events
  WHERE id = p_event_id
  FOR UPDATE;

  -- Event must exist, be bookable, not deleted, and in a public status
  IF NOT FOUND
     OR v_event.booking_enabled IS NOT TRUE
     OR v_event.deleted_at IS NOT NULL
     OR v_event.status NOT IN ('approved', 'completed')
  THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Per-booking ticket limit
  IF p_ticket_count > v_event.max_tickets_per_booking THEN
    RETURN json_build_object('ok', false, 'reason', 'too_many_tickets');
  END IF;

  -- Per-mobile cap: max 3 confirmed bookings per event per mobile
  SELECT count(*) INTO v_mobile_count
  FROM event_bookings
  WHERE event_id = p_event_id
    AND mobile = p_mobile
    AND status = 'confirmed';

  IF v_mobile_count >= 3 THEN
    RETURN json_build_object('ok', false, 'reason', 'booking_limit_reached');
  END IF;

  -- Capacity check (skip if total_capacity is null = unlimited)
  IF v_event.total_capacity IS NOT NULL THEN
    SELECT coalesce(sum(ticket_count), 0) INTO v_booked
    FROM event_bookings
    WHERE event_id = p_event_id
      AND status = 'confirmed';

    IF v_booked + p_ticket_count > v_event.total_capacity THEN
      RETURN json_build_object('ok', false, 'reason', 'sold_out');
    END IF;
  END IF;

  INSERT INTO event_bookings (event_id, first_name, last_name, mobile, email, ticket_count)
  VALUES (p_event_id, p_first_name, p_last_name, p_mobile, p_email, p_ticket_count)
  RETURNING id INTO v_booking_id;

  RETURN json_build_object('ok', true, 'booking_id', v_booking_id);
END;
$$;

-- Re-apply execution restrictions (the CREATE OR REPLACE resets grants)
REVOKE ALL ON FUNCTION public.create_booking(uuid, text, text, text, text, int)
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_booking(uuid, text, text, text, text, int)
  TO service_role;
```

- [ ] **Step 2: Dry-run the migration**

Run: `npx supabase db push --dry-run 2>&1 | tail -20`
Expected: Migration listed, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260414120001_harden_create_booking_rpc.sql
git commit -m "feat: harden create_booking RPC with status, mobile cap, and max tickets

Adds three atomic checks under the existing FOR UPDATE lock:
- Event must be approved or completed (not just booking_enabled)
- Per-booking ticket count must not exceed max_tickets_per_booking
- Max 3 confirmed bookings per mobile per event"
```

---

### Task 3: Update BookingRpcResult type

**Files:**
- Modify: `src/lib/types.ts:84-87`

- [ ] **Step 1: Update the type**

In `src/lib/types.ts`, replace the `BookingRpcResult` type:

```typescript
/** Result from the create_booking Postgres RPC. */
export type BookingRpcResult =
  | { ok: true; bookingId: string }
  | { ok: false; reason: "not_found" | "sold_out" | "booking_limit_reached" | "too_many_tickets" };
```

- [ ] **Step 2: Update the RPC result mapper in bookings helper**

In `src/lib/bookings.ts`, update the `createBookingAtomic` function's result mapping (around line 56-60):

```typescript
  const result = data as { ok: boolean; reason?: string; booking_id?: string };
  if (!result.ok) {
    return { ok: false, reason: result.reason as "not_found" | "sold_out" | "booking_limit_reached" | "too_many_tickets" };
  }
  return { ok: true, bookingId: result.booking_id! };
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit 2>&1; echo "EXIT: $?"`
Expected: `EXIT: 0`

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/bookings.ts
git commit -m "chore: extend BookingRpcResult with new RPC reason codes"
```

---

### Task 4: Add mode parameter to verifyTurnstile

**Files:**
- Modify: `src/lib/turnstile.ts`
- Create: `src/lib/__tests__/turnstile.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/turnstile.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Store original env
const originalEnv = { ...process.env };

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { verifyTurnstile } from "../turnstile";

describe("verifyTurnstile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("strict mode", () => {
    it("should return false when no token is provided", async () => {
      const result = await verifyTurnstile(null, "booking", "strict");
      expect(result).toBe(false);
    });

    it("should return false when secret key is missing in production", async () => {
      delete process.env.TURNSTILE_SECRET_KEY;
      const result = await verifyTurnstile("some-token", "booking", "strict");
      expect(result).toBe(false);
    });

    it("should return false when siteverify API is unreachable", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const result = await verifyTurnstile("some-token", "booking", "strict");
      expect(result).toBe(false);
    });

    it("should return false when siteverify returns non-OK", async () => {
      mockFetch.mockResolvedValue({ ok: false });
      const result = await verifyTurnstile("some-token", "booking", "strict");
      expect(result).toBe(false);
    });

    it("should return true when siteverify succeeds", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, action: "booking" }),
      });
      const result = await verifyTurnstile("valid-token", "booking", "strict");
      expect(result).toBe(true);
    });

    it("should return false on action mismatch", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, action: "login" }),
      });
      const result = await verifyTurnstile("valid-token", "booking", "strict");
      expect(result).toBe(false);
    });
  });

  describe("lenient mode (default)", () => {
    it("should return true when no token is provided", async () => {
      const result = await verifyTurnstile(null, "booking");
      expect(result).toBe(true);
    });

    it("should return true when secret key is missing", async () => {
      delete process.env.TURNSTILE_SECRET_KEY;
      const result = await verifyTurnstile("some-token", "booking");
      expect(result).toBe(true);
    });

    it("should return true when siteverify API is unreachable", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const result = await verifyTurnstile("some-token", "booking");
      expect(result).toBe(true);
    });

    it("should return true when siteverify succeeds", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, action: "booking" }),
      });
      const result = await verifyTurnstile("valid-token", "booking");
      expect(result).toBe(true);
    });

    it("should return false on action mismatch even in lenient mode", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, action: "login" }),
      });
      const result = await verifyTurnstile("valid-token", "booking");
      expect(result).toBe(false);
    });
  });

  describe("strict mode in development", () => {
    it("should return true when secret key is missing in non-production", async () => {
      delete process.env.TURNSTILE_SECRET_KEY;
      process.env.NODE_ENV = "development";
      const result = await verifyTurnstile("some-token", "booking", "strict");
      expect(result).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/turnstile.test.ts 2>&1 | tail -20`
Expected: Multiple failures (strict mode tests fail because current implementation always returns `true` for missing tokens).

- [ ] **Step 3: Implement the mode parameter**

Replace the contents of `src/lib/turnstile.ts`:

```typescript
/**
 * Verifies a Cloudflare Turnstile token server-side.
 *
 * Modes:
 * - "lenient" (default): fails soft — returns true when token is missing,
 *   secret is absent, or the API is unreachable. Used by auth pages.
 * - "strict": fails closed — returns false in all degraded paths.
 *   Used by public booking flow. Secret-key bypass still allowed in dev.
 */
export async function verifyTurnstile(
  token: string | null,
  action: string,
  mode: "strict" | "lenient" = "lenient",
): Promise<boolean> {
  if (!token) {
    if (mode === "strict") return false;
    console.warn("[turnstile] No token received — widget may not have loaded. Failing soft.");
    return true;
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // In strict mode, allow dev convenience only outside production
    if (mode === "strict" && process.env.NODE_ENV === "production") return false;
    console.warn("[turnstile] TURNSTILE_SECRET_KEY not set — skipping verification");
    return true;
  }

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });

    if (!res.ok) {
      if (mode === "strict") return false;
      console.warn("[turnstile] siteverify API unavailable — failing soft");
      return true;
    }

    const data = (await res.json()) as { success: boolean; action?: string };
    if (data.action && data.action !== action) {
      return false; // action mismatch — always reject
    }
    return data.success === true;
  } catch {
    if (mode === "strict") return false;
    console.warn("[turnstile] siteverify error — failing soft");
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/turnstile.test.ts 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run: `npm test 2>&1 | tail -20`
Expected: All tests pass. Auth callers use default `"lenient"` mode — no signature change needed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/turnstile.ts src/lib/__tests__/turnstile.test.ts
git commit -m "feat: add strict/lenient mode to verifyTurnstile

Strict mode (fail-closed) for public bookings. Lenient mode (fail-soft,
default) preserves existing auth behaviour. No changes needed to auth.ts."
```

---

### Task 5: Update booking action — required token, new RPC reasons

**Files:**
- Modify: `src/actions/bookings.ts`
- Modify: `src/actions/__tests__/bookings.test.ts`

- [ ] **Step 1: Write the new failing tests**

Add these tests to `src/actions/__tests__/bookings.test.ts`. First, add the Turnstile mock at the top alongside the other mocks:

```typescript
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));
```

Add the import:

```typescript
import { verifyTurnstile } from "@/lib/turnstile";
const mockVerifyTurnstile = vi.mocked(verifyTurnstile);
```

Update `VALID_INPUT` to include `turnstileToken`:

```typescript
const VALID_INPUT = {
  eventId: "550e8400-e29b-41d4-a716-446655440000",
  firstName: "John",
  lastName: null,
  mobile: "+447911123456",
  email: null,
  ticketCount: 2,
  marketingOptIn: false,
  turnstileToken: "valid-token",
} as const;
```

Add new test cases inside the `createBookingAction` describe block:

```typescript
  it("should reject booking when turnstileToken is missing", async () => {
    const result = await createBookingAction({
      ...VALID_INPUT,
      turnstileToken: undefined as unknown as string,
    });
    expect(result.success).toBe(false);
  });

  it("should call verifyTurnstile with strict mode", async () => {
    mockCreateBookingAtomic.mockResolvedValue({ ok: true, bookingId: "booking-uuid" });
    await createBookingAction(VALID_INPUT);
    expect(mockVerifyTurnstile).toHaveBeenCalledWith("valid-token", "booking", "strict");
  });

  it("should reject when Turnstile verification fails", async () => {
    mockVerifyTurnstile.mockResolvedValue(false);
    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/security/i);
  });

  it("should return booking_limit_reached from RPC", async () => {
    mockCreateBookingAtomic.mockResolvedValue({ ok: false, reason: "booking_limit_reached" });
    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("booking_limit_reached");
  });

  it("should return too_many_tickets from RPC", async () => {
    mockCreateBookingAtomic.mockResolvedValue({ ok: false, reason: "too_many_tickets" });
    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("too_many_tickets");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/actions/__tests__/bookings.test.ts 2>&1 | tail -30`
Expected: New tests fail (turnstileToken not required yet, strict mode not passed, new reasons not in type).

- [ ] **Step 3: Update the booking action**

In `src/actions/bookings.ts`, make these changes:

1. Change the Zod schema — `turnstileToken` from optional to required:

```typescript
  turnstileToken: z.string().min(1),
```

2. Change the `verifyTurnstile` call to use strict mode:

```typescript
  const turnstileValid = await verifyTurnstile(input.turnstileToken ?? null, "booking", "strict");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/actions/__tests__/bookings.test.ts 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit 2>&1; echo "EXIT: $?"`
Expected: `EXIT: 0`

- [ ] **Step 6: Commit**

```bash
git add src/actions/bookings.ts src/actions/__tests__/bookings.test.ts
git commit -m "feat: require Turnstile token and use strict mode for bookings

turnstileToken is now required in the Zod schema. verifyTurnstile is
called with 'strict' mode (fail-closed). Auth pages are unaffected
(they use the default 'lenient' mode)."
```

---

### Task 6: Update BookingForm error handling

**Files:**
- Modify: `src/app/l/[slug]/BookingForm.tsx:72-80`

- [ ] **Step 1: Update error handling in BookingForm**

In `src/app/l/[slug]/BookingForm.tsx`, replace the error handling block (around lines 72-80):

```typescript
    if (!result.success) {
      if (result.error === "sold_out") {
        setError("Sorry, this event is now fully booked.");
      } else if (result.error === "rate_limited") {
        setError("Too many attempts. Please try again in a few minutes.");
      } else if (result.error === "booking_limit_reached") {
        setError("You've reached the maximum number of bookings for this event.");
      } else if (result.error === "too_many_tickets") {
        setError("Too many tickets requested. Please reduce your selection.");
      } else {
        setError(result.error || "Something went wrong. Please try again.");
      }
      return;
    }
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1; echo "EXIT: $?"`
Expected: `EXIT: 0`

- [ ] **Step 3: Commit**

```bash
git add src/app/l/[slug]/BookingForm.tsx
git commit -m "feat: add error messages for booking_limit_reached and too_many_tickets"
```

---

### Task 7: Add event status gate to public page

**Files:**
- Modify: `src/app/l/[slug]/page.tsx`

- [ ] **Step 1: Add status to the query and type**

In `src/app/l/[slug]/page.tsx`, add `status` to the `EventRow` type (after `max_tickets_per_booking`):

```typescript
  status: string;
```

Add `status` to the select query string (around line 58):

```typescript
    "id, title, public_title, public_teaser, public_description, public_highlights, event_image_path, start_at, seo_slug, booking_enabled, total_capacity, max_tickets_per_booking, status, venue:venues(id, name)"
```

Add `status` to the return object from `getEventBySlug` (around line 92):

```typescript
    status: raw.status as string,
```

- [ ] **Step 2: Add status gate to the page**

Update the `notFound` condition (around line 120-122):

```typescript
  if (!event || !event.booking_enabled || !["approved", "completed"].includes(event.status)) {
    notFound();
  }
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit 2>&1; echo "EXIT: $?"`
Expected: `EXIT: 0`

- [ ] **Step 4: Commit**

```bash
git add src/app/l/[slug]/page.tsx
git commit -m "feat: gate public booking page on approved/completed event status

Draft or submitted events now return 404 even if booking_enabled is true.
Matches the public API's status restriction."
```

---

### Task 8: Full verification pipeline

**Files:** None (verification only)

- [ ] **Step 1: Run linting**

Run: `npm run lint 2>&1; echo "EXIT: $?"`
Expected: `EXIT: 0`

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1; echo "EXIT: $?"`
Expected: `EXIT: 0`

- [ ] **Step 3: Run all tests**

Run: `npm test 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 4: Run build**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 5: Dry-run migrations**

Run: `npx supabase db push --dry-run 2>&1 | tail -20`
Expected: Both new migrations listed, no errors.
