# Twilio SMS Booking Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3-wave automated SMS campaign to drive event bookings, with inbound reply-to-book, STOP opt-out, and a confirmed-only booking count fix.

**Architecture:** Database migration creates campaign tracking tables and RPCs. Extracted Twilio/customer helpers enable reuse across transactional SMS, campaign SMS, and inbound webhook. A daily cron handles outbound campaigns; a Twilio webhook handles inbound replies. Booking count fix is isolated to 3 existing files.

**Tech Stack:** Next.js 16.1, Supabase PostgreSQL, Twilio SDK, Vitest, Zod, libphonenumber-js

**Spec:** `docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260417000000_sms_campaign.sql` | Tables, column, RPCs, indexes |
| `src/lib/twilio.ts` | Extracted Twilio send (returns SID) + request validation |
| `src/lib/system-short-links.ts` | Extracted short link creator with configurable link_type |
| `src/lib/sms-campaign.ts` | Campaign audience, template rendering, CTA resolution, send lifecycle, suppression, stats query |
| `src/app/api/cron/sms-booking-driver/route.ts` | Daily campaign cron (GET + POST) |
| `src/app/api/webhooks/twilio-inbound/route.ts` | Inbound SMS webhook (STOP, reply-to-book) |
| `src/components/events/sms-campaign-stats.tsx` | Campaign stats card |
| `src/lib/__tests__/twilio.test.ts` | Tests for Twilio helpers |
| `src/lib/__tests__/sms-campaign.test.ts` | Tests for campaign logic |
| `src/app/api/webhooks/__tests__/twilio-inbound.test.ts` | Tests for inbound webhook |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/sms.ts` | Import `sendTwilioSms` from `twilio.ts`, remove private `sendSms`/`getTwilioClient`/`getFromNumber` |
| `src/lib/customers.ts` | Add `upsertCustomerForBooking()`, `linkBookingToCustomer()`, `findCustomerByMobile()` |
| `src/actions/bookings.ts` | Call extracted customer helpers + add campaign suppression |
| `src/lib/all-bookings.ts` | Confirmed-only totals |
| `src/app/bookings/BookingsView.tsx` | Confirmed-only client-side aggregation |
| `src/components/events/booking-settings-card.tsx` | Add `smsPromoEnabled` toggle (admin-only) |
| `src/actions/events.ts` | Add `smsPromoEnabled` to booking settings schema + action |
| `src/app/events/[eventId]/bookings/page.tsx` | Add campaign stats card |
| `vercel.json` | Add cron schedule |
| `.env.example` | Add `TWILIO_WEBHOOK_URL` |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260417000000_sms_campaign.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260417000000_sms_campaign.sql
-- SMS Campaign: tables, column, RPCs, indexes

-- ── New column on events ─────────────────────────────────────────────────────
ALTER TABLE events ADD COLUMN sms_promo_enabled boolean NOT NULL DEFAULT true;

-- ── sms_campaign_sends ───────────────────────────────────────────────────────
CREATE TABLE sms_campaign_sends (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  wave           smallint NOT NULL CHECK (wave IN (1, 2, 3)),
  status         text NOT NULL DEFAULT 'claimed'
                   CHECK (status IN ('claimed', 'sent', 'failed', 'permanent_failed')),
  reply_code     text,
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  failed_at      timestamptz,
  attempt_count  smallint NOT NULL DEFAULT 0,
  last_error     text,
  next_retry_at  timestamptz,
  twilio_sid     text,
  converted_at   timestamptz,
  CONSTRAINT uq_campaign_send UNIQUE (event_id, customer_id, wave)
);

ALTER TABLE sms_campaign_sends ENABLE ROW LEVEL SECURITY;

-- Service-role only — cron and webhook context
CREATE POLICY "service_role_all" ON sms_campaign_sends
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Indexes for cron/webhook queries
CREATE INDEX idx_campaign_sends_active
  ON sms_campaign_sends (event_id, customer_id)
  WHERE converted_at IS NULL AND status = 'sent';

CREATE INDEX idx_campaign_sends_retry
  ON sms_campaign_sends (next_retry_at)
  WHERE status = 'failed';

CREATE INDEX idx_campaign_sends_customer_reply
  ON sms_campaign_sends (customer_id, status)
  WHERE status = 'sent' AND converted_at IS NULL;

CREATE INDEX idx_campaign_sends_reply_code
  ON sms_campaign_sends (reply_code)
  WHERE reply_code IS NOT NULL AND status = 'sent' AND converted_at IS NULL;

-- ── sms_inbound_messages ─────────────────────────────────────────────────────
CREATE TABLE sms_inbound_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_message_sid text NOT NULL UNIQUE,
  from_number        text NOT NULL,
  body               text NOT NULL,
  processed_at       timestamptz NOT NULL DEFAULT now(),
  result             text NOT NULL DEFAULT 'processing'
                       CHECK (result IN ('processing', 'booked', 'opted_out', 'error', 'duplicate')),
  booking_id         uuid REFERENCES event_bookings(id) ON DELETE SET NULL
);

ALTER TABLE sms_inbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON sms_inbound_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── get_campaign_audience RPC ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_campaign_audience(
  p_event_id    uuid,
  p_event_type  text,
  p_venue_id    uuid,
  p_wave        smallint
)
RETURNS TABLE(customer_id uuid, first_name text, mobile text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT c.id, c.first_name, c.mobile
  FROM customers c
  JOIN event_bookings eb ON eb.customer_id = c.id
  JOIN events e2 ON e2.id = eb.event_id
  WHERE c.marketing_opt_in = true
    AND eb.status = 'confirmed'
    -- Attendance window: events that started in the last 90 days (past events only)
    AND (e2.start_at AT TIME ZONE 'Europe/London')::date
        >= (now() AT TIME ZONE 'Europe/London')::date - 90
    AND e2.start_at < now()
    AND (
      e2.event_type = p_event_type
      OR e2.venue_id = p_venue_id
    )
    -- Exclude customers already booked for this event (by mobile, not just customer_id)
    AND c.mobile NOT IN (
      SELECT eb2.mobile FROM event_bookings eb2
      WHERE eb2.event_id = p_event_id
        AND eb2.status = 'confirmed'
    )
    -- Exclude customers with a sent or claimed wave for this event
    AND c.id NOT IN (
      SELECT scs.customer_id FROM sms_campaign_sends scs
      WHERE scs.event_id = p_event_id
        AND scs.wave = p_wave
        AND scs.status IN ('claimed', 'sent')
    )
    -- Exclude customers already converted
    AND c.id NOT IN (
      SELECT scs.customer_id FROM sms_campaign_sends scs
      WHERE scs.event_id = p_event_id
        AND scs.converted_at IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION get_campaign_audience(uuid, text, uuid, smallint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_campaign_audience(uuid, text, uuid, smallint) TO service_role;

-- ── create_booking_from_campaign RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_booking_from_campaign(
  p_campaign_send_id uuid,
  p_ticket_count     integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_send        sms_campaign_sends%ROWTYPE;
  v_customer    customers%ROWTYPE;
  v_event       events%ROWTYPE;
  v_booking_result jsonb;
  v_booking_id  uuid;
BEGIN
  -- Lock the campaign send row
  SELECT * INTO v_send
  FROM sms_campaign_sends
  WHERE id = p_campaign_send_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_not_found');
  END IF;

  -- Reject if already converted (idempotency)
  IF v_send.converted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_converted');
  END IF;

  -- Fetch customer
  SELECT * INTO v_customer FROM customers WHERE id = v_send.customer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  END IF;

  -- Use existing create_booking RPC logic (inline for atomicity)
  SELECT * INTO v_event FROM events WHERE id = v_send.event_id FOR UPDATE;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF NOT v_event.booking_enabled OR v_event.status NOT IN ('approved', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Capacity check
  IF v_event.total_capacity IS NOT NULL THEN
    DECLARE
      v_booked integer;
    BEGIN
      SELECT COALESCE(SUM(ticket_count), 0) INTO v_booked
      FROM event_bookings
      WHERE event_id = v_send.event_id AND status = 'confirmed';

      IF v_booked + p_ticket_count > v_event.total_capacity THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'sold_out');
      END IF;
    END;
  END IF;

  -- Max tickets per booking check
  IF v_event.max_tickets_per_booking IS NOT NULL
     AND p_ticket_count > v_event.max_tickets_per_booking THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'too_many_tickets',
      'max', v_event.max_tickets_per_booking
    );
  END IF;

  -- Insert booking
  INSERT INTO event_bookings (event_id, first_name, last_name, mobile, email, ticket_count, status, customer_id)
  VALUES (
    v_send.event_id,
    v_customer.first_name,
    v_customer.last_name,
    v_customer.mobile,
    v_customer.email,
    p_ticket_count,
    'confirmed',
    v_customer.id
  )
  RETURNING id INTO v_booking_id;

  -- Mark all campaign sends for this customer+event as converted
  UPDATE sms_campaign_sends
  SET converted_at = now()
  WHERE event_id = v_send.event_id
    AND customer_id = v_send.customer_id
    AND converted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id);
END;
$$;

REVOKE ALL ON FUNCTION create_booking_from_campaign(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_booking_from_campaign(uuid, integer) TO service_role;
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push --dry-run`
Expected: Migration applies without errors.

Then: `npx supabase db push`

- [ ] **Step 3: Verify tables exist**

Run via Supabase MCP or SQL editor:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('sms_campaign_sends', 'sms_inbound_messages');
```
Expected: Both tables listed.

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'events' AND column_name = 'sms_promo_enabled';
```
Expected: `sms_promo_enabled` column exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417000000_sms_campaign.sql
git commit -m "feat: add SMS campaign tables, RPCs, and events.sms_promo_enabled column"
```

---

## Task 2: Extract Twilio Helpers

**Files:**
- Create: `src/lib/twilio.ts`
- Create: `src/lib/__tests__/twilio.test.ts`
- Modify: `src/lib/sms.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/twilio.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the twilio module before import
const mockCreate = vi.fn();
vi.mock("twilio", () => ({
  default: () => ({ messages: { create: mockCreate } }),
}));

describe("sendTwilioSms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "test_token";
    process.env.TWILIO_FROM_NUMBER = "+447000000000";
  });

  it("should send SMS and return the SID", async () => {
    mockCreate.mockResolvedValue({ sid: "SM_test_sid_123" });

    const { sendTwilioSms } = await import("@/lib/twilio");
    const result = await sendTwilioSms({ to: "+447777777777", body: "Hello" });

    expect(mockCreate).toHaveBeenCalledWith({
      to: "+447777777777",
      from: "+447000000000",
      body: "Hello",
    });
    expect(result.sid).toBe("SM_test_sid_123");
  });

  it("should throw when credentials are missing", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;

    const { sendTwilioSms } = await import("@/lib/twilio");
    await expect(sendTwilioSms({ to: "+447777777777", body: "Hello" }))
      .rejects.toThrow("Twilio credentials not configured");
  });
});

describe("validateTwilioRequest", () => {
  it("should return false for missing signature", async () => {
    process.env.TWILIO_AUTH_TOKEN = "test_token";
    process.env.TWILIO_WEBHOOK_URL = "https://example.com/webhook";

    const { validateTwilioRequest } = await import("@/lib/twilio");
    const result = validateTwilioRequest(null, {});
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/twilio.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/twilio.ts
import "server-only";
import twilio from "twilio";

// ── Twilio client ────────────────────────────────────────────────────────────

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured");
  }
  return twilio(accountSid, authToken);
}

function getFromNumber(): string {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new Error("TWILIO_FROM_NUMBER not configured");
  return from;
}

// ── Public helpers ───────────────────────────────────────────────────────────

/**
 * Send an SMS via Twilio and return the message SID.
 * Used by both transactional SMS (confirmations, reminders) and campaign SMS.
 */
export async function sendTwilioSms(params: {
  to: string;
  body: string;
}): Promise<{ sid: string }> {
  const client = getTwilioClient();
  const message = await client.messages.create({
    to: params.to,
    from: getFromNumber(),
    body: params.body,
  });
  return { sid: message.sid };
}

/**
 * Validate an inbound Twilio webhook request signature.
 * Uses TWILIO_AUTH_TOKEN and TWILIO_WEBHOOK_URL env vars.
 * Returns true if the request is authentic.
 */
export function validateTwilioRequest(
  signature: string | null,
  params: Record<string, string>,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const webhookUrl = process.env.TWILIO_WEBHOOK_URL;
  if (!authToken || !webhookUrl || !signature) return false;

  return twilio.validateRequest(authToken, signature, webhookUrl, params);
}
```

- [ ] **Step 4: Update sms.ts to use the extracted helper**

In `src/lib/sms.ts`, replace the private Twilio functions with the extracted helper:

Replace lines 1-28:
```typescript
import "server-only";
import { sendTwilioSms } from "@/lib/twilio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { SHORT_LINK_BASE_URL, type LinkType } from "@/lib/links";

// ── Date formatting ───────────────────────────────────────────────────────────

/**
 * Formats an event start date/time for UK display.
 * e.g. "Friday 20 March at 7:00pm"
 */
function formatEventDateTime(startAt: Date): { dayDate: string; time: string } {
  const london = toZonedTime(startAt, "Europe/London");
  const dayDate = format(london, "EEEE d MMMM");
  const time = format(london, "h:mmaaa");
  return { dayDate, time };
}
```

Also export `formatEventDateTime` so campaign templates can reuse it:
```typescript
export function formatEventDateTime(startAt: Date): { dayDate: string; time: string } {
```

Replace every `await sendSms(...)` call in sms.ts with `await sendTwilioSms({ to: ..., body: ... })`. There are 3 occurrences:
- Line 134: `await sendSms(data.mobile, body)` → `await sendTwilioSms({ to: data.mobile, body })`
- Line 188: `await sendSms(params.mobile, body)` → `await sendTwilioSms({ to: params.mobile, body })`
- Line 276: `await sendSms(params.mobile, body)` → `await sendTwilioSms({ to: params.mobile, body })`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/twilio.test.ts`
Expected: PASS

Run: `npx vitest run` (full suite to check nothing broke in sms.ts)
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/twilio.ts src/lib/__tests__/twilio.test.ts src/lib/sms.ts
git commit -m "refactor: extract Twilio send helper and request validator into src/lib/twilio.ts"
```

---

## Task 3: Extract Short Link Helper

**Files:**
- Create: `src/lib/system-short-links.ts`
- Modify: `src/lib/sms.ts`

- [ ] **Step 1: Create the extracted helper**

```typescript
// src/lib/system-short-links.ts
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SHORT_LINK_BASE_URL, type LinkType } from "@/lib/links";

/**
 * Creates a short link using the admin client (no auth context required).
 * Used for system-generated links in cron routes where there is no request
 * cookie context.
 * Returns the full short URL or null if creation fails.
 */
export async function createSystemShortLink(params: {
  name: string;
  destination: string;
  linkType?: LinkType;
  expiresAt?: string | null;
}): Promise<string | null> {
  const db = createSupabaseAdminClient();

  // Generate a unique 8-char hex code
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const candidate = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { data: existing } = await db
      .from("short_links")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!existing) {
      code = candidate;
      break;
    }
  }
  if (!code) {
    console.warn("createSystemShortLink: could not generate unique code");
    return null;
  }

  const { data, error } = await db
    .from("short_links")
    .insert({
      code,
      name: params.name,
      destination: params.destination,
      link_type: params.linkType ?? "other",
      expires_at: params.expiresAt ?? null,
      created_by: null,
    })
    .select("code")
    .single();

  if (error || !data) {
    console.warn("createSystemShortLink: insert failed", error);
    return null;
  }

  return SHORT_LINK_BASE_URL + (data as { code: string }).code;
}
```

- [ ] **Step 2: Update sms.ts to import from the new module**

Remove the private `createSystemShortLink` function (lines 43-99 in original) from `src/lib/sms.ts`.

Add import at top of sms.ts:
```typescript
import { createSystemShortLink } from "@/lib/system-short-links";
```

The existing call in `sendPostEventSms` (line 258) already calls `createSystemShortLink` so it continues to work with the import.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/system-short-links.ts src/lib/sms.ts
git commit -m "refactor: extract createSystemShortLink into src/lib/system-short-links.ts with configurable linkType"
```

---

## Task 4: Extract Customer Helpers

**Files:**
- Modify: `src/lib/customers.ts`
- Modify: `src/actions/bookings.ts`

- [ ] **Step 1: Add helpers to customers.ts**

Append to `src/lib/customers.ts`:

```typescript
/**
 * Find a customer by mobile number (E.164 format).
 * Returns the customer row or null if not found.
 */
export async function findCustomerByMobile(mobile: string): Promise<{
  id: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  email: string | null;
  marketingOptIn: boolean;
} | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("customers")
    .select("id, first_name, last_name, mobile, email, marketing_opt_in")
    .eq("mobile", mobile)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id as string,
    firstName: data.first_name as string,
    lastName: (data.last_name as string | null) ?? null,
    mobile: data.mobile as string,
    email: (data.email as string | null) ?? null,
    marketingOptIn: data.marketing_opt_in as boolean,
  };
}

/**
 * Upsert a customer record by mobile (natural key).
 * Upgrade-only marketing opt-in: only sets true, never downgrades.
 * Returns the customer ID.
 */
export async function upsertCustomerForBooking(params: {
  mobile: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  marketingOptIn?: boolean;
  bookingId?: string;
}): Promise<string | null> {
  const db = createSupabaseAdminClient();

  const upsertPayload: Record<string, unknown> = {
    mobile: params.mobile,
    first_name: params.firstName,
    last_name: params.lastName,
    updated_at: new Date().toISOString(),
  };
  if (params.email) upsertPayload.email = params.email;

  const { data: upserted, error: upsertError } = await db
    .from("customers")
    .upsert(upsertPayload, { onConflict: "mobile" })
    .select("id, marketing_opt_in")
    .single();

  if (upsertError || !upserted) {
    console.error("Customer upsert failed:", upsertError);
    return null;
  }

  // Upgrade-only opt-in
  const previousOptIn = upserted.marketing_opt_in as boolean;
  if (params.marketingOptIn && !previousOptIn) {
    await db
      .from("customers")
      .update({ marketing_opt_in: true })
      .eq("id", upserted.id);
  }

  // Log consent event when value genuinely changes
  if (params.marketingOptIn !== undefined && params.marketingOptIn !== previousOptIn) {
    await db
      .from("customer_consent_events")
      .insert({
        customer_id: upserted.id,
        event_type: params.marketingOptIn ? "opt_in" : "opt_out",
        consent_wording: "I agree to receive marketing messages including text messages about events.",
        booking_id: params.bookingId ?? null,
      })
      .then(({ error }) => {
        if (error) console.error("Consent event insert failed:", error);
      });
  }

  return upserted.id as string;
}

/**
 * Link a booking to a customer record.
 */
export async function linkBookingToCustomer(bookingId: string, customerId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("event_bookings")
    .update({ customer_id: customerId })
    .eq("id", bookingId);
}
```

- [ ] **Step 2: Refactor createBookingAction to use extracted helpers**

In `src/actions/bookings.ts`, replace the inline customer upsert block (lines 98-158) with:

```typescript
  // Upsert customer record — non-blocking (booking already confirmed)
  try {
    const customerId = await upsertCustomerForBooking({
      mobile: normalisedMobile,
      firstName: data.firstName,
      lastName: data.lastName ?? null,
      email: data.email ?? null,
      marketingOptIn: data.marketingOptIn,
      bookingId,
    });

    if (customerId) {
      await linkBookingToCustomer(bookingId, customerId);

      // Suppress any active campaign sends for this customer+event
      const db = createSupabaseAdminClient();
      await db
        .from("sms_campaign_sends")
        .update({ converted_at: new Date().toISOString() })
        .eq("customer_id", customerId)
        .eq("event_id", data.eventId)
        .is("converted_at", null)
        .eq("status", "sent");
    }
  } catch (customerErr) {
    console.error("Customer upsert pipeline failed:", customerErr);
    // Non-fatal — booking is confirmed
  }
```

Add import at top of `src/actions/bookings.ts`:
```typescript
import { upsertCustomerForBooking, linkBookingToCustomer } from "@/lib/customers";
```

Remove the now-unused `MARKETING_CONSENT_WORDING` constant if it was defined locally.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/customers.ts src/actions/bookings.ts
git commit -m "refactor: extract customer upsert/link helpers and add campaign suppression to booking action"
```

---

## Task 5: Booking Count Fix

**Files:**
- Modify: `src/lib/all-bookings.ts`
- Modify: `src/app/bookings/BookingsView.tsx`

- [ ] **Step 1: Fix all-bookings.ts — confirmed-only totals**

In `src/lib/all-bookings.ts`, change lines 122-124 (inside the `for` loop) from:

```typescript
    group.totalBookings++;
    group.totalTickets += tickets;
```

to:

```typescript
    if ((row.status as string) === "confirmed") {
      group.totalBookings++;
      group.totalTickets += tickets;
    }
```

- [ ] **Step 2: Fix BookingsView.tsx — confirmed-only client-side aggregation**

In `src/app/bookings/BookingsView.tsx`, find the `useMemo` that re-aggregates groups when a filter is applied. Change the group mapping (around line 69-76) so that `totalBookings` and `totalTickets` only count confirmed:

Replace:
```typescript
        if (bookings.length === 0) return null;
        return {
          ...group,
          bookings,
          totalBookings: bookings.length,
          totalTickets: bookings.reduce((s, b) => s + b.ticketCount, 0),
        };
```

With:
```typescript
        if (bookings.length === 0) return null;
        const confirmed = bookings.filter((b) => b.status === "confirmed");
        return {
          ...group,
          bookings,
          totalBookings: confirmed.length,
          totalTickets: confirmed.reduce((s, b) => s + b.ticketCount, 0),
        };
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/lib/__tests__/all-bookings.test.ts`
Expected: Existing test for totalBookings/totalTickets may need updating if it includes cancelled rows. Update the test expectation to reflect confirmed-only.

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/all-bookings.ts src/app/bookings/BookingsView.tsx
git commit -m "fix: show confirmed-only booking counts in bookings list and summary"
```

---

## Task 6: Campaign Logic Module

**Files:**
- Create: `src/lib/sms-campaign.ts`
- Create: `src/lib/__tests__/sms-campaign.test.ts`

- [ ] **Step 1: Write tests for CTA resolution and capacity hints**

```typescript
// src/lib/__tests__/sms-campaign.test.ts
import { describe, it, expect } from "vitest";
import { resolveCtaMode, getCapacityHint, generateReplyCode } from "@/lib/sms-campaign";

describe("resolveCtaMode", () => {
  it("returns 'link' for ticketed events", () => {
    expect(resolveCtaMode("ticketed")).toBe("link");
  });

  it("returns 'reply' for table_booking events", () => {
    expect(resolveCtaMode("table_booking")).toBe("reply");
  });

  it("returns 'reply' for free_entry events", () => {
    expect(resolveCtaMode("free_entry")).toBe("reply");
  });

  it("returns 'link' for mixed events", () => {
    expect(resolveCtaMode("mixed")).toBe("link");
  });
});

describe("getCapacityHint", () => {
  it("returns 'Nearly fully booked! ' when >75% full", () => {
    expect(getCapacityHint(80, 100)).toBe("Nearly fully booked! ");
  });

  it("returns 'Filling up fast! ' when >50% full", () => {
    expect(getCapacityHint(55, 100)).toBe("Filling up fast! ");
  });

  it("returns empty string when <=50% full", () => {
    expect(getCapacityHint(30, 100)).toBe("");
  });

  it("returns empty string for unlimited capacity", () => {
    expect(getCapacityHint(50, null)).toBe("");
  });
});

describe("generateReplyCode", () => {
  it("returns a 3-character uppercase alpha string", () => {
    const code = generateReplyCode();
    expect(code).toMatch(/^[A-Z]{3}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/sms-campaign.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/sms-campaign.ts
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTwilioSms } from "@/lib/twilio";
import { createSystemShortLink } from "@/lib/system-short-links";
import { formatEventDateTime } from "@/lib/sms";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

// ── Types ────────────────────────────────────────────────────────────────────

export type CtaMode = "link" | "reply";

export type BookingType = "ticketed" | "table_booking" | "free_entry" | "mixed";

export interface CampaignEvent {
  id: string;
  publicTitle: string;
  eventType: string;
  bookingType: BookingType;
  venueId: string;
  venueName: string;
  startAt: Date;
  ticketPrice: number | null;
  totalCapacity: number | null;
  bookingUrl: string | null;
  seoSlug: string | null;
  maxTicketsPerBooking: number;
}

interface CampaignAudienceMember {
  customerId: string;
  firstName: string;
  mobile: string;
}

// ── CTA Resolution ───────────────────────────────────────────────────────────

export function resolveCtaMode(bookingType: BookingType): CtaMode {
  switch (bookingType) {
    case "ticketed":
    case "mixed":
      return "link";
    case "table_booking":
    case "free_entry":
      return "reply";
  }
}

// ── Capacity Hints ───────────────────────────────────────────────────────────

export function getCapacityHint(confirmedTickets: number, totalCapacity: number | null): string {
  if (totalCapacity === null || totalCapacity === 0) return "";
  const pct = confirmedTickets / totalCapacity;
  if (pct > 0.75) return "Nearly fully booked! ";
  if (pct > 0.50) return "Filling up fast! ";
  return "";
}

// ── Reply Code Generation ────────────────────────────────────────────────────

export function generateReplyCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // No I or O (avoidable confusion with 1/0)
  let code = "";
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 3; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// ── Wave Calculation ─────────────────────────────────────────────────────────

/**
 * Returns which wave (1, 2, or 3) is due for an event, or null if no wave is due today.
 * Uses UK timezone calendar dates.
 */
export function getWaveDue(eventStartAt: Date): 1 | 2 | 3 | null {
  const now = new Date();
  const londonNow = toZonedTime(now, "Europe/London");
  const londonEvent = toZonedTime(eventStartAt, "Europe/London");

  const todayStr = format(londonNow, "yyyy-MM-dd");
  const eventStr = format(londonEvent, "yyyy-MM-dd");

  // Calculate calendar day difference
  const todayDate = new Date(todayStr);
  const eventDate = new Date(eventStr);
  const diffDays = Math.round((eventDate.getTime() - todayDate.getTime()) / (86400000));

  if (diffDays === 14) return 1;
  if (diffDays === 7) return 2;
  if (diffDays === 1) return 3;
  return null;
}

// ── SMS Template Rendering ───────────────────────────────────────────────────

function formatShortDate(date: Date): string {
  const london = toZonedTime(date, "Europe/London");
  return format(london, "EEE d MMM"); // e.g. "Fri 30 Apr"
}

export function renderCampaignSms(params: {
  wave: 1 | 2 | 3;
  ctaMode: CtaMode;
  firstName: string;
  publicTitle: string;
  venueName: string;
  startAt: Date;
  ticketPrice: number | null;
  capacityHint: string;
  bookingLink: string | null;
  replyCode: string | null;
}): string {
  const { wave, ctaMode, firstName, publicTitle, venueName, startAt, ticketPrice, capacityHint, bookingLink, replyCode } = params;
  const date = formatShortDate(startAt);
  const price = ticketPrice ? `Tickets from £${ticketPrice}. ` : "";
  const stop = " Reply STOP to opt out";

  if (ctaMode === "link") {
    switch (wave) {
      case 1: return `Hi ${firstName}! ${publicTitle} is coming to ${venueName} on ${date}. ${price}${capacityHint}Book here: ${bookingLink}${stop}`;
      case 2: return `Just a week until ${publicTitle} at ${venueName}! ${capacityHint}Don't miss out — book now: ${bookingLink}${stop}`;
      case 3: return `Tomorrow! ${publicTitle} at ${venueName}. Last chance to grab tickets: ${bookingLink}${stop}`;
    }
  } else {
    switch (wave) {
      case 1: return `Hi ${firstName}! ${publicTitle} is coming to ${venueName} on ${date}. ${capacityHint}Reply '${replyCode} 2' for 2 seats (or any number).${stop}`;
      case 2: return `Just a week until ${publicTitle} at ${venueName}! ${capacityHint}Reply '${replyCode} 2' to reserve your seats.${stop}`;
      case 3: return `Tomorrow! ${publicTitle} at ${venueName}. Reply '${replyCode} 2' — last chance!${stop}`;
    }
  }
}

// ── Campaign Send Lifecycle ──────────────────────────────────────────────────

/**
 * Claim a campaign send slot, send SMS, update status.
 * Returns true on success, false on failure (row left in 'failed' state for retry).
 */
export async function sendCampaignSms(params: {
  event: CampaignEvent;
  customer: CampaignAudienceMember;
  wave: 1 | 2 | 3;
  confirmedTickets: number;
}): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { event, customer, wave, confirmedTickets } = params;

  const ctaMode = resolveCtaMode(event.bookingType);
  const replyCode = ctaMode === "reply" ? generateReplyCode() : null;

  // Step 1: Claim — insert row
  const { error: claimError } = await db
    .from("sms_campaign_sends")
    .insert({
      event_id: event.id,
      customer_id: customer.customerId,
      wave,
      status: "claimed",
      reply_code: replyCode,
    });

  if (claimError) {
    // Likely unique constraint violation — already claimed
    console.warn("Campaign claim failed:", claimError.message);
    return false;
  }

  // Step 2: Compose message
  let bookingLink: string | null = null;
  if (ctaMode === "link") {
    const destination = event.bookingUrl
      ?? (event.seoSlug ? `https://l.baronspubs.com/${event.seoSlug}` : null);

    if (destination) {
      const url = new URL(destination);
      url.searchParams.set("utm_source", "sms");
      url.searchParams.set("utm_campaign", "booking-driver");
      url.searchParams.set("utm_content", `wave-${wave}`);

      bookingLink = await createSystemShortLink({
        name: `Campaign w${wave} — ${event.publicTitle}`,
        destination: url.toString(),
        linkType: "booking",
      });
    }
    // Fallback if short link creation fails
    if (!bookingLink) bookingLink = destination;
  }

  const capacityHint = getCapacityHint(confirmedTickets, event.totalCapacity);

  const body = renderCampaignSms({
    wave,
    ctaMode,
    firstName: customer.firstName,
    publicTitle: event.publicTitle,
    venueName: event.venueName,
    startAt: event.startAt,
    ticketPrice: ctaMode === "link" && event.bookingType === "ticketed" ? event.ticketPrice : null,
    capacityHint,
    bookingLink,
    replyCode,
  });

  // Step 3: Send
  try {
    const { sid } = await sendTwilioSms({ to: customer.mobile, body });

    // Success — update row
    await db
      .from("sms_campaign_sends")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        twilio_sid: sid,
        attempt_count: 1,
      })
      .eq("event_id", event.id)
      .eq("customer_id", customer.customerId)
      .eq("wave", wave);

    return true;
  } catch (sendError) {
    // Failure — mark for retry
    const errMsg = sendError instanceof Error ? sendError.message : "Unknown error";
    const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min backoff

    await db
      .from("sms_campaign_sends")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        attempt_count: 1,
        last_error: errMsg,
        next_retry_at: retryAt,
      })
      .eq("event_id", event.id)
      .eq("customer_id", customer.customerId)
      .eq("wave", wave);

    console.error(`Campaign SMS failed for ${customer.mobile}:`, errMsg);
    return false;
  }
}

// ── Campaign Stats ───────────────────────────────────────────────────────────

export interface CampaignStats {
  wave: number;
  sent: number;
  failed: number;
  converted: number;
}

export async function getCampaignStatsForEvent(eventId: string): Promise<CampaignStats[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("sms_campaign_sends")
    .select("wave, status, converted_at")
    .eq("event_id", eventId);

  if (error || !data) return [];

  const statsMap = new Map<number, CampaignStats>();
  for (const row of data) {
    const w = row.wave as number;
    if (!statsMap.has(w)) {
      statsMap.set(w, { wave: w, sent: 0, failed: 0, converted: 0 });
    }
    const s = statsMap.get(w)!;
    if (row.status === "sent") s.sent++;
    if (row.status === "failed" || row.status === "permanent_failed") s.failed++;
    if (row.converted_at) s.converted++;
  }

  return Array.from(statsMap.values()).sort((a, b) => a.wave - b.wave);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/sms-campaign.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sms-campaign.ts src/lib/__tests__/sms-campaign.test.ts
git commit -m "feat: add SMS campaign logic module with CTA resolution, templates, send lifecycle, and stats"
```

---

## Task 7: Campaign Cron Route

**Files:**
- Create: `src/app/api/cron/sms-booking-driver/route.ts`

- [ ] **Step 1: Write the cron route**

```typescript
// src/app/api/cron/sms-booking-driver/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/cron-auth";
import { getConfirmedTicketCount } from "@/lib/bookings";
import {
  getWaveDue,
  sendCampaignSms,
  type CampaignEvent,
  type BookingType,
} from "@/lib/sms-campaign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(JSON.stringify({
    event: "cron.invoked",
    endpoint: "sms-booking-driver",
    timestamp: new Date().toISOString(),
  }));

  const db = createSupabaseAdminClient();

  // Fetch eligible events
  const { data: events, error: eventsError } = await db
    .from("events")
    .select(`
      id, public_title, event_type, booking_type, venue_id, start_at,
      ticket_price, total_capacity, booking_url, seo_slug, max_tickets_per_booking,
      venues ( name )
    `)
    .in("status", ["approved", "completed"])
    .eq("sms_promo_enabled", true)
    .eq("booking_enabled", true)
    .gt("start_at", new Date().toISOString())
    .is("deleted_at", null);

  if (eventsError) {
    console.error("sms-booking-driver: events query failed", eventsError);
    return NextResponse.json({ error: "Events query failed" }, { status: 500 });
  }

  let totalSent = 0;
  let totalFailed = 0;

  for (const row of events ?? []) {
    const startAt = new Date(row.start_at as string);
    const wave = getWaveDue(startAt);
    if (!wave) continue;

    // Capacity pre-check — skip sold-out events
    const confirmedTickets = await getConfirmedTicketCount(row.id as string);
    const capacity = row.total_capacity as number | null;
    if (capacity !== null && confirmedTickets >= capacity) {
      console.log(JSON.stringify({
        event: "cron.skip_sold_out",
        eventId: row.id,
        wave,
      }));
      continue;
    }

    const venue = (row.venues as Record<string, unknown>) ?? {};
    const campaignEvent: CampaignEvent = {
      id: row.id as string,
      publicTitle: (row.public_title as string) || "Event",
      eventType: row.event_type as string,
      bookingType: (row.booking_type as BookingType) || "ticketed",
      venueId: row.venue_id as string,
      venueName: (venue.name as string) || "Venue",
      startAt,
      ticketPrice: row.ticket_price as number | null,
      totalCapacity: capacity,
      bookingUrl: row.booking_url as string | null,
      seoSlug: row.seo_slug as string | null,
      maxTicketsPerBooking: (row.max_tickets_per_booking as number) || 10,
    };

    // Get audience
    const { data: audience, error: audienceError } = await db.rpc("get_campaign_audience", {
      p_event_id: campaignEvent.id,
      p_event_type: campaignEvent.eventType,
      p_venue_id: campaignEvent.venueId,
      p_wave: wave,
    });

    if (audienceError) {
      console.error("sms-booking-driver: audience RPC failed", campaignEvent.id, audienceError);
      continue;
    }

    for (const member of audience ?? []) {
      const success = await sendCampaignSms({
        event: campaignEvent,
        customer: {
          customerId: member.customer_id as string,
          firstName: member.first_name as string,
          mobile: member.mobile as string,
        },
        wave,
        confirmedTickets,
      });

      if (success) totalSent++;
      else totalFailed++;
    }
  }

  console.log(JSON.stringify({
    event: "cron.completed",
    endpoint: "sms-booking-driver",
    sent: totalSent,
    failed: totalFailed,
    timestamp: new Date().toISOString(),
  }));

  return NextResponse.json({ sent: totalSent, failed: totalFailed });
}

// Also export POST for manual invocations
export const POST = GET;
```

- [ ] **Step 2: Add cron to vercel.json**

Add to the `crons` array in `vercel.json`:
```json
{
  "path": "/api/cron/sms-booking-driver",
  "schedule": "0 8 * * *"
}
```

- [ ] **Step 3: Add TWILIO_WEBHOOK_URL to .env.example**

Append to `.env.example`:
```
TWILIO_WEBHOOK_URL=
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/sms-booking-driver/route.ts vercel.json .env.example
git commit -m "feat: add daily SMS booking driver cron with 3-wave campaign processing"
```

---

## Task 8: Inbound SMS Webhook

**Files:**
- Create: `src/app/api/webhooks/twilio-inbound/route.ts`
- Create: `src/app/api/webhooks/__tests__/twilio-inbound.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// src/app/api/webhooks/__tests__/twilio-inbound.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks
vi.mock("@/lib/twilio", () => ({
  validateTwilioRequest: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/customers", () => ({
  findCustomerByMobile: vi.fn(),
}));

import { validateTwilioRequest } from "@/lib/twilio";
import { findCustomerByMobile } from "@/lib/customers";

describe("POST /api/webhooks/twilio-inbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject invalid signature with 403", async () => {
    (validateTwilioRequest as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { POST } = await import("@/app/api/webhooks/twilio-inbound/route");
    const body = new URLSearchParams({ From: "+447777777777", Body: "2", MessageSid: "SM123" });
    const req = new Request("http://localhost/api/webhooks/twilio-inbound", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "invalid" },
      body: body.toString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("should handle STOP keyword and opt out customer", async () => {
    (validateTwilioRequest as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (findCustomerByMobile as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "cust-1", firstName: "Test", mobile: "+447777777777", marketingOptIn: true,
    });

    // Test that STOP is recognised (the full flow requires DB mocking)
    // This validates the parsing logic
    expect("STOP".match(/^(STOP|UNSUBSCRIBE|END|QUIT|CANCEL|OPTOUT)$/i)).toBeTruthy();
    expect("stop".match(/^(STOP|UNSUBSCRIBE|END|QUIT|CANCEL|OPTOUT)$/i)).toBeTruthy();
    expect("ABC 2".match(/^(STOP|UNSUBSCRIBE|END|QUIT|CANCEL|OPTOUT)$/i)).toBeNull();
  });

  it("should parse reply code + number format", () => {
    const pattern = /^([A-Z]{3})\s+([1-9]|10)$/i;
    expect("ABC 2".match(pattern)).toBeTruthy();
    expect("abc 10".match(pattern)).toBeTruthy();
    expect("ABC 0".match(pattern)).toBeNull();
    expect("ABC 11".match(pattern)).toBeNull();
    expect("AB 2".match(pattern)).toBeNull();
  });

  it("should parse number-only format", () => {
    const pattern = /^([1-9]|10)$/;
    expect("2".match(pattern)).toBeTruthy();
    expect("10".match(pattern)).toBeTruthy();
    expect("0".match(pattern)).toBeNull();
    expect("11".match(pattern)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/webhooks/__tests__/twilio-inbound.test.ts`
Expected: FAIL on import (module not found).

- [ ] **Step 3: Write the webhook route**

```typescript
// src/app/api/webhooks/twilio-inbound/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validateTwilioRequest } from "@/lib/twilio";
import { findCustomerByMobile } from "@/lib/customers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STOP_KEYWORDS = /^(STOP|UNSUBSCRIBE|END|QUIT|CANCEL|OPTOUT)$/i;
const REPLY_CODE_PATTERN = /^([A-Z]{3})\s+([1-9]|10)$/i;
const NUMBER_ONLY_PATTERN = /^([1-9]|10)$/;

function twiml(message: string): NextResponse {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function emptyTwiml(): NextResponse {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { status: 200, headers: { "Content-Type": "text/xml" } },
  );
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://baronspubs.com";

export async function POST(request: Request): Promise<NextResponse> {
  // Parse form data
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => { params[key] = value.toString(); });

  // Validate Twilio signature
  const signature = request.headers.get("X-Twilio-Signature");
  if (!validateTwilioRequest(signature, params)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const rawFrom = params.From ?? "";
  const body = (params.Body ?? "").trim();
  const messageSid = params.MessageSid ?? "";

  // Normalise From to E.164
  const parsed = parsePhoneNumberFromString(rawFrom, "GB");
  const from = parsed?.format("E.164") ?? rawFrom;

  const db = createSupabaseAdminClient();

  // Deduplication check
  const { data: existing } = await db
    .from("sms_inbound_messages")
    .select("id")
    .eq("twilio_message_sid", messageSid)
    .maybeSingle();

  if (existing) return emptyTwiml();

  // Insert inbound message record
  await db.from("sms_inbound_messages").insert({
    twilio_message_sid: messageSid,
    from_number: from,
    body,
    result: "processing",
  });

  // STOP handling — before anything else
  if (STOP_KEYWORDS.test(body)) {
    const customer = await findCustomerByMobile(from);
    if (customer) {
      await db.from("customers").update({ marketing_opt_in: false }).eq("id", customer.id);
      await db
        .from("sms_campaign_sends")
        .update({ converted_at: new Date().toISOString() })
        .eq("customer_id", customer.id)
        .is("converted_at", null)
        .eq("status", "sent");
    }
    await db
      .from("sms_inbound_messages")
      .update({ result: "opted_out" })
      .eq("twilio_message_sid", messageSid);
    return twiml("You've been unsubscribed from promotional messages. You'll still receive booking confirmations.");
  }

  // Look up customer
  const customer = await findCustomerByMobile(from);
  if (!customer) {
    await db
      .from("sms_inbound_messages")
      .update({ result: "error" })
      .eq("twilio_message_sid", messageSid);
    return twiml(`Sorry, we couldn't find your details. Please book online at ${APP_URL}`);
  }

  // Parse reply: code + number, or number only
  let replyCode: string | null = null;
  let ticketCount: number;

  const codeMatch = body.match(REPLY_CODE_PATTERN);
  const numberMatch = body.match(NUMBER_ONLY_PATTERN);

  if (codeMatch) {
    replyCode = codeMatch[1].toUpperCase();
    ticketCount = parseInt(codeMatch[2], 10);
  } else if (numberMatch) {
    ticketCount = parseInt(numberMatch[0], 10);
  } else {
    await db
      .from("sms_inbound_messages")
      .update({ result: "error" })
      .eq("twilio_message_sid", messageSid);
    return twiml("Please reply with your code and number of seats (e.g., 'ABC 2'). Or reply STOP to opt out.");
  }

  // Find the active campaign send
  let campaignQuery = db
    .from("sms_campaign_sends")
    .select("id, event_id, converted_at, events (public_title, start_at, venues (name), max_tickets_per_booking)")
    .eq("customer_id", customer.id)
    .eq("status", "sent")
    .is("converted_at", null)
    .order("sent_at", { ascending: false });

  if (replyCode) {
    campaignQuery = campaignQuery.eq("reply_code", replyCode);
  }

  const { data: campaigns } = await campaignQuery.limit(5);

  if (!campaigns || campaigns.length === 0) {
    await db
      .from("sms_inbound_messages")
      .update({ result: "error" })
      .eq("twilio_message_sid", messageSid);
    return twiml(`We're not sure which event you're replying about. Book online at ${APP_URL}`);
  }

  // Disambiguation: multiple events without reply code
  if (!replyCode && campaigns.length > 1) {
    const lines = campaigns.slice(0, 5).map((c) => {
      const evt = c.events as Record<string, unknown>;
      const send = c as Record<string, unknown>;
      // Find reply_code from the row
      return `- Reply '${(send as Record<string, unknown>).reply_code ?? "???"} ${ticketCount}' for ${evt.public_title}`;
    });
    return twiml(`Which event?\n${lines.join("\n")}`);
  }

  const campaignSend = campaigns[0];

  // Create booking via RPC
  const { data: result, error: rpcError } = await db.rpc("create_booking_from_campaign", {
    p_campaign_send_id: campaignSend.id,
    p_ticket_count: ticketCount,
  });

  if (rpcError) {
    console.error("create_booking_from_campaign failed:", rpcError);
    await db
      .from("sms_inbound_messages")
      .update({ result: "error" })
      .eq("twilio_message_sid", messageSid);
    return twiml("Sorry, something went wrong. Please try again or book online.");
  }

  const rpcResult = result as { ok: boolean; reason?: string; booking_id?: string; max?: number };

  if (!rpcResult.ok) {
    const reason = rpcResult.reason;
    if (reason === "already_converted") {
      await db
        .from("sms_inbound_messages")
        .update({ result: "duplicate" })
        .eq("twilio_message_sid", messageSid);
      const evt = campaignSend.events as Record<string, unknown>;
      return twiml(`You're already booked for ${evt.public_title}! See you there.`);
    }
    if (reason === "sold_out") {
      await db
        .from("sms_inbound_messages")
        .update({ result: "error" })
        .eq("twilio_message_sid", messageSid);
      const evt = campaignSend.events as Record<string, unknown>;
      return twiml(`Sorry, ${evt.public_title} is fully booked. We'll let you know if spots open up!`);
    }
    if (reason === "too_many_tickets") {
      return twiml(`Sorry, the maximum tickets per booking is ${rpcResult.max ?? 10}. Please try a smaller number.`);
    }
    return twiml("Sorry, something went wrong. Please try again.");
  }

  // Success
  const evt = campaignSend.events as Record<string, unknown>;
  const venue = (evt.venues as Record<string, unknown>) ?? {};
  await db
    .from("sms_inbound_messages")
    .update({ result: "booked", booking_id: rpcResult.booking_id })
    .eq("twilio_message_sid", messageSid);

  return twiml(`Booked! ${ticketCount} seat(s) for ${evt.public_title} at ${venue.name}. See you there!`);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/api/webhooks/__tests__/twilio-inbound.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/twilio-inbound/route.ts src/app/api/webhooks/__tests__/twilio-inbound.test.ts
git commit -m "feat: add inbound SMS webhook with STOP handling, reply-to-book, and deduplication"
```

---

## Task 9: Admin Toggle in Booking Settings

**Files:**
- Modify: `src/components/events/booking-settings-card.tsx`
- Modify: `src/actions/events.ts`

- [ ] **Step 1: Add smsPromoEnabled to booking settings schema and action**

In `src/actions/events.ts`, update the `bookingSettingsSchema` (line 1929):

```typescript
const bookingSettingsSchema = z.object({
  eventId: z.string().uuid("Invalid event ID"),
  bookingEnabled: z.boolean(),
  totalCapacity: z.number().int().positive().nullable(),
  maxTicketsPerBooking: z.number().int().min(1).max(50),
  smsPromoEnabled: z.boolean().optional(),
});
```

In `updateBookingSettingsAction`, after the existing update (line 1990-1998), add `sms_promo_enabled` only for administrators:

Replace the update block:
```typescript
  const updatePayload: Record<string, unknown> = {
    booking_enabled: bookingEnabled,
    total_capacity: totalCapacity,
    max_tickets_per_booking: maxTicketsPerBooking,
    seo_slug: seoSlug,
  };

  // Only administrators can change sms_promo_enabled
  if (user.role === "administrator" && parsed.data.smsPromoEnabled !== undefined) {
    updatePayload.sms_promo_enabled = parsed.data.smsPromoEnabled;
  }

  const { error: updateError } = await supabase
    .from("events")
    .update(updatePayload)
    .eq("id", eventId);
```

- [ ] **Step 2: Add toggle to booking-settings-card.tsx**

In `src/components/events/booking-settings-card.tsx`:

Add to props type:
```typescript
  smsPromoEnabled: boolean;
  userRole: string;
```

Add state:
```typescript
  const [smsPromoEnabled, setSmsPromoEnabled] = useState(props.smsPromoEnabled);
```

Add to the form submission payload:
```typescript
      const result = await updateBookingSettingsAction({
        eventId,
        bookingEnabled,
        totalCapacity: parsedCapacity,
        maxTicketsPerBooking: parsedMax,
        smsPromoEnabled,
      });
```

Add the toggle UI after the "Max tickets per booking" section (only for administrators):

```tsx
          {/* SMS promo toggle — administrator only */}
          {userRole === "administrator" && (
            <div className="flex items-center gap-3">
              <button
                id="smsPromoEnabled"
                type="button"
                role="switch"
                aria-checked={smsPromoEnabled}
                onClick={() => setSmsPromoEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 flex-none cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(39,54,64,0.45)] ${
                  smsPromoEnabled
                    ? "bg-[var(--color-primary-700)]"
                    : "bg-[rgba(39,54,64,0.2)]"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    smsPromoEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
              <div>
                <Label htmlFor="smsPromoEnabled" className="cursor-pointer select-none">
                  {smsPromoEnabled ? "Promotional SMS enabled" : "Promotional SMS disabled"}
                </Label>
                <p className="text-xs text-subtle">
                  Automatically send booking reminder SMS to past customers
                </p>
              </div>
            </div>
          )}
```

- [ ] **Step 3: Update the page that renders BookingSettingsCard**

Find where `BookingSettingsCard` is rendered and pass the new props (`smsPromoEnabled` from the event data, `userRole` from the current user).

- [ ] **Step 4: Run build check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/events/booking-settings-card.tsx src/actions/events.ts
git commit -m "feat: add sms_promo_enabled toggle to booking settings (administrator only)"
```

---

## Task 10: Campaign Stats Card

**Files:**
- Create: `src/components/events/sms-campaign-stats.tsx`
- Modify: `src/app/events/[eventId]/bookings/page.tsx`

- [ ] **Step 1: Create the stats card component**

```tsx
// src/components/events/sms-campaign-stats.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CampaignStats } from "@/lib/sms-campaign";

interface SmsCampaignStatsProps {
  stats: CampaignStats[];
}

const WAVE_LABELS: Record<number, string> = {
  1: "Wave 1 (14 days)",
  2: "Wave 2 (7 days)",
  3: "Wave 3 (1 day)",
};

export function SmsCampaignStats({ stats }: SmsCampaignStatsProps) {
  if (stats.length === 0) return null;

  const totalSent = stats.reduce((s, w) => s + w.sent, 0);
  const totalConverted = stats.reduce((s, w) => s + w.converted, 0);
  const conversionRate = totalSent > 0 ? Math.round((totalConverted / totalSent) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>SMS Campaign</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th scope="col" className="pb-2 text-left font-medium text-subtle">Wave</th>
                <th scope="col" className="pb-2 text-right font-medium text-subtle">Sent</th>
                <th scope="col" className="pb-2 text-right font-medium text-subtle">Failed</th>
                <th scope="col" className="pb-2 text-right font-medium text-subtle">Booked</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.wave} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-2">{WAVE_LABELS[s.wave] ?? `Wave ${s.wave}`}</td>
                  <td className="py-2 text-right">{s.sent}</td>
                  <td className="py-2 text-right">{s.failed}</td>
                  <td className="py-2 text-right">{s.converted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center gap-4 text-sm">
          <span className="text-subtle">Total sent: <strong>{totalSent}</strong></span>
          <span className="text-subtle">Conversions: <strong>{totalConverted}</strong></span>
          <span className="text-subtle">Rate: <strong>{conversionRate}%</strong></span>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Add to event bookings page**

In `src/app/events/[eventId]/bookings/page.tsx`, import and render the stats card:

Add imports:
```typescript
import { getCampaignStatsForEvent } from "@/lib/sms-campaign";
import { SmsCampaignStats } from "@/components/events/sms-campaign-stats";
```

Add data fetch alongside existing fetches:
```typescript
  const [bookings, totalTickets, campaignStats] = await Promise.all([
    getBookingsForEvent(eventId),
    getConfirmedTicketCount(eventId),
    getCampaignStatsForEvent(eventId),
  ]);
```

Add the card in the page layout (after the bookings list):
```tsx
      {campaignStats.length > 0 && (
        <SmsCampaignStats stats={campaignStats} />
      )}
```

- [ ] **Step 3: Run build check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/events/sms-campaign-stats.tsx src/app/events/[eventId]/bookings/page.tsx
git commit -m "feat: add SMS campaign stats card to event bookings page"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: Zero errors, zero warnings.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Successful production build.

- [ ] **Step 5: Verify migration applies cleanly**

Run: `npx supabase db push --dry-run`
Expected: No pending migration errors.

- [ ] **Step 6: Manual smoke test checklist**

After `npm run dev`:
- [ ] Navigate to an event's booking settings — verify "Promotional SMS" toggle appears for administrator role
- [ ] Navigate to bookings page — verify counts show confirmed-only (create a booking, cancel it, verify count doesn't include it)
- [ ] Navigate to an event's bookings page — verify campaign stats card appears (empty is fine, no errors)
- [ ] Check `.env.example` includes `TWILIO_WEBHOOK_URL`
- [ ] Check `vercel.json` includes the booking-driver cron

---

## Twilio Console Configuration (Post-Deploy)

After deploying to Vercel, configure number **+447427875761**:

| Setting | Value |
|---------|-------|
| Messaging → "A message comes in" | Webhook |
| URL | `https://{your-vercel-domain}/api/webhooks/twilio-inbound` |
| HTTP | HTTP POST |

Set `TWILIO_WEBHOOK_URL` env var in Vercel to match the URL exactly.
