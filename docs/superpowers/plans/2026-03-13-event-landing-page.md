# Event Landing Page & Booking System — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public event landing page at `l.baronspubs.com/[slug]` with seat booking, SMS confirmation/reminder/review flows via Twilio, and a staff-facing bookings view in the admin.

**Architecture:** New public route `/l/[slug]` in the existing Next.js app with `l.baronspubs.com` as a second Vercel domain. Middleware rewrites slug-style paths on that domain to `/l/[path]`. Bookings stored in a new `event_bookings` table with an atomic Postgres RPC for race-safe capacity checking. Twilio SMS dispatched from two daily Vercel crons.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS v4, Supabase (PostgreSQL + RLS), Twilio SMS, `libphonenumber-js`, Vitest, Vercel crons.

**Spec:** `docs/superpowers/specs/2026-03-13-event-landing-page-design.md`

**Execution order:**
- Chunk 1 (Foundation) must complete before all others — it defines the DB schema and shared types.
- Chunks 2–5 are **fully independent** and can be executed in parallel by separate agents once Chunk 1 is merged.

---

## Chunk 1: Foundation

> Covers: pre-implementation type fix, rate-limiter refactor, database migration, TypeScript types, DB helper module.

### Task 1: Fix `CreateLinkInput.created_by` type

**Files:**
- Modify: `src/lib/links.ts` (line 29–35)

The current type requires `created_by: string`. The cron jobs that generate Google Review short links run headless and must pass `null`. Fix before anything else.

- [ ] **Step 1: Make the change**

In `src/lib/links.ts`, update `CreateLinkInput`:

```typescript
export type CreateLinkInput = {
  name:        string;
  destination: string;
  link_type:   LinkType;
  expires_at:  string | null;
  created_by:  string | null;  // null for system-generated links
};
```

- [ ] **Step 2: Run typecheck — expect zero errors**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/links.ts
git commit -m "fix: allow null created_by on CreateLinkInput for system-generated short links"
```

---

### Task 2: Refactor rate limiter to support configurable instances

**Files:**
- Modify: `src/lib/public-api/rate-limit.ts`
- Create: `src/lib/public-api/__tests__/rate-limit.test.ts` (if not exists)

The existing module exports a single hardcoded `checkRateLimit()` at 120/60s. We need a configurable `RateLimiter` class so bookings can use a separate 10/600s limit without changing the existing public API behaviour.

- [ ] **Step 1: Write tests for the new class (they will fail)**

Create `src/lib/public-api/__tests__/rate-limit.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter } from "../rate-limit";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
  });

  it("should allow requests within the limit", () => {
    expect(limiter.check("ip1").allowed).toBe(true);
    expect(limiter.check("ip1").allowed).toBe(true);
    expect(limiter.check("ip1").allowed).toBe(true);
  });

  it("should block requests over the limit", () => {
    limiter.check("ip2");
    limiter.check("ip2");
    limiter.check("ip2");
    expect(limiter.check("ip2").allowed).toBe(false);
  });

  it("should track separate identifiers independently", () => {
    limiter.check("ip3");
    limiter.check("ip3");
    limiter.check("ip3");
    limiter.check("ip3"); // blocked
    expect(limiter.check("ip4").allowed).toBe(true); // ip4 unaffected
  });

  it("should return correct remaining count", () => {
    const result = limiter.check("ip5");
    expect(result.remaining).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (RateLimiter not exported)**

```bash
npx vitest run src/lib/public-api/__tests__/rate-limit.test.ts
```

- [ ] **Step 3: Refactor rate-limit.ts to export RateLimiter class**

Replace the entire contents of `src/lib/public-api/rate-limit.ts`:

```typescript
import "server-only";

/**
 * Configurable in-process sliding-window rate limiter.
 *
 * IMPORTANT: In-process — each Vercel cold-start gets a fresh counter.
 * For production multi-instance deployments, replace with Upstash Redis.
 */

type WindowEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export class RateLimiter {
  private store = new Map<string, WindowEntry>();
  private windowMs: number;
  private maxRequests: number;

  constructor({ windowMs, maxRequests }: { windowMs: number; maxRequests: number }) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (entry.resetAt <= now) this.store.delete(key);
      }
    }, windowMs * 2);
    if (interval.unref) interval.unref();
  }

  check(identifier: string): RateLimitResult {
    const now = Date.now();
    const existing = this.store.get(identifier);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.store.set(identifier, { count: 1, resetAt });
      return { allowed: true, remaining: this.maxRequests - 1, resetAt };
    }

    existing.count += 1;
    const allowed = existing.count <= this.maxRequests;
    return {
      allowed,
      remaining: Math.max(0, this.maxRequests - existing.count),
      resetAt: existing.resetAt,
    };
  }
}

/** Default instance for the public event API — 120 req/60 s. */
export const publicApiLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 120 });

/** Backward-compatible export so existing callers don't need updating. */
export function checkRateLimit(identifier: string): RateLimitResult {
  return publicApiLimiter.check(identifier);
}

/**
 * Extract the client IP from a Request, respecting common proxy headers.
 * Falls back to "unknown" if no IP can be determined.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/lib/public-api/__tests__/rate-limit.test.ts
```

- [ ] **Step 5: Run full typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/public-api/rate-limit.ts src/lib/public-api/__tests__/rate-limit.test.ts
git commit -m "refactor: make RateLimiter configurable; keep backward-compatible checkRateLimit export"
```

---

### Task 3: Database migration

**Files:**
- Create: `supabase/migrations/20260313000000_event_bookings.sql`

This migration covers everything: `event_bookings` table, indexes, RLS, anon grant, new columns on `events` and `venues`, unique constraint on `seo_slug`, and the atomic booking RPC function.

- [ ] **Step 1: Create the migration file**

```sql
-- Migration: event_bookings table, booking fields on events/venues, atomic booking RPC
-- 2026-03-13

-- ── event_bookings table ──────────────────────────────────────────────────────

create table event_bookings (
  id                        uuid primary key default gen_random_uuid(),
  event_id                  uuid not null references events(id) on delete cascade,
  first_name                text not null,
  last_name                 text,
  mobile                    text not null,       -- E.164 format
  email                     text,
  ticket_count              int  not null check (ticket_count >= 1),
  status                    text not null default 'confirmed'
                              check (status in ('confirmed', 'cancelled')),
  created_at                timestamptz not null default now(),
  sms_confirmation_sent_at  timestamptz,
  sms_reminder_sent_at      timestamptz,
  sms_post_event_sent_at    timestamptz
);

-- Indexes
create index event_bookings_event_id_idx
  on event_bookings (event_id);

create index event_bookings_reminder_idx
  on event_bookings (sms_reminder_sent_at)
  where sms_reminder_sent_at is null;

create index event_bookings_post_event_idx
  on event_bookings (sms_post_event_sent_at)
  where sms_post_event_sent_at is null;

-- RLS
alter table event_bookings enable row level security;

-- Public (anon) insert — only for events with booking enabled
create policy "public_insert_booking" on event_bookings
  for insert with check (
    exists (
      select 1 from events
      where events.id = event_id
        and events.booking_enabled = true
        and events.deleted_at is null
    )
  );

-- Grant INSERT to anon role (RLS policy above still applies)
grant insert on event_bookings to anon;

-- Staff read — all confirmed bookings (app layer enforces venue scoping)
create policy "staff_read_bookings" on event_bookings
  for select using (auth.uid() is not null);

-- Staff update — cancellations via authenticated server actions
create policy "staff_update_bookings" on event_bookings
  for update using (auth.uid() is not null);

-- ── New columns on events ─────────────────────────────────────────────────────

alter table events
  add column if not exists booking_enabled         boolean not null default false,
  add column if not exists total_capacity          int,
  add column if not exists max_tickets_per_booking int not null default 10;

-- Unique constraint on seo_slug (field existed but had no uniqueness guarantee)
alter table events
  add constraint events_seo_slug_unique unique (seo_slug);

-- ── New column on venues ──────────────────────────────────────────────────────

alter table venues
  add column if not exists google_review_url text;

-- ── Atomic booking RPC ────────────────────────────────────────────────────────
-- Uses FOR UPDATE on the event row to prevent concurrent capacity overruns.
-- Called via service-role client from the booking server action.

create or replace function create_booking(
  p_event_id    uuid,
  p_first_name  text,
  p_last_name   text,
  p_mobile      text,
  p_email       text,
  p_ticket_count int
) returns json
language plpgsql
security definer
as $$
declare
  v_capacity   int;
  v_booked     int;
  v_booking_id uuid;
begin
  -- Lock the event row for the duration of this transaction
  select total_capacity into v_capacity
  from events
  where id = p_event_id
    and booking_enabled = true
    and deleted_at is null
  for update;

  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Capacity check (skip if total_capacity is null = unlimited)
  if v_capacity is not null then
    select coalesce(sum(ticket_count), 0) into v_booked
    from event_bookings
    where event_id = p_event_id
      and status = 'confirmed';

    if v_booked + p_ticket_count > v_capacity then
      return json_build_object('ok', false, 'reason', 'sold_out');
    end if;
  end if;

  insert into event_bookings (event_id, first_name, last_name, mobile, email, ticket_count)
  values (p_event_id, p_first_name, p_last_name, p_mobile, p_email, p_ticket_count)
  returning id into v_booking_id;

  return json_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;
```

- [ ] **Step 2: Apply migration locally**

```bash
npm run supabase:migrate
```

Expected: no errors, migration applied.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260313000000_event_bookings.sql
git commit -m "feat: add event_bookings table, booking fields on events/venues, atomic booking RPC"
```

---

### Task 4: TypeScript types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add EventBooking type and booking-related event/venue extensions**

Append to `src/lib/types.ts`:

```typescript
/** Status of a customer booking. */
export type BookingStatus = "confirmed" | "cancelled";

/** A customer booking for an event. camelCase — convert from DB snake_case using fromDb(). */
export interface EventBooking {
  id: string;
  eventId: string;
  firstName: string;
  lastName: string | null;
  mobile: string;          // E.164
  email: string | null;
  ticketCount: number;
  status: BookingStatus;
  createdAt: Date;
  smsConfirmationSentAt: Date | null;
  smsReminderSentAt: Date | null;
  smsPostEventSentAt: Date | null;
}

/**
 * Booking settings stored on an event record.
 * These fields are fetched alongside the event for the landing page and admin.
 */
export interface EventBookingSettings {
  bookingEnabled: boolean;
  totalCapacity: number | null;       // null = unlimited
  maxTicketsPerBooking: number;
}

/** Result from the create_booking Postgres RPC. */
export type BookingRpcResult =
  | { ok: true; bookingId: string }
  | { ok: false; reason: "not_found" | "sold_out" };
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add EventBooking, EventBookingSettings, and BookingRpcResult types"
```

---

### Task 5: `src/lib/bookings.ts` — DB helpers

**Files:**
- Create: `src/lib/bookings.ts`
- Create: `src/lib/__tests__/bookings.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/bookings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateEventSlug } from "../bookings";

describe("generateEventSlug", () => {
  it("should combine title and date", () => {
    const slug = generateEventSlug("Jazz Night", new Date("2026-03-20T19:00:00Z"));
    expect(slug).toBe("jazz-night-20-mar-2026");
  });

  it("should remove special characters", () => {
    const slug = generateEventSlug("Quiz Night & Curry!", new Date("2026-03-20T19:00:00Z"));
    expect(slug).toBe("quiz-night-curry-20-mar-2026");
  });

  it("should handle recurring event name correctly", () => {
    const slug = generateEventSlug("Quiz Night", new Date("2026-03-13T19:00:00Z"));
    expect(slug).toBe("quiz-night-13-mar-2026");
  });

  it("should collapse multiple spaces and hyphens", () => {
    const slug = generateEventSlug("The  Big   Event", new Date("2026-03-20T19:00:00Z"));
    expect(slug).toBe("the-big-event-20-mar-2026");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/lib/__tests__/bookings.test.ts
```

- [ ] **Step 3: Create `src/lib/bookings.ts`**

```typescript
import "server-only";
import { format } from "date-fns";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { fromDb } from "@/lib/utils";
import type { EventBooking, BookingRpcResult } from "@/lib/types";

// ── Slug generation ────────────────────────────────────────────────────────────

/**
 * Generates a URL slug from an event title and start date.
 * Format: `jazz-night-20-mar-2026`
 * Recurring events get unique slugs because the date always differs.
 */
export function generateEventSlug(title: string, startAt: Date): string {
  const dateStr = format(startAt, "d-MMM-yyyy").toLowerCase();
  const titleSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  return `${titleSlug}-${dateStr}`;
}

/**
 * Generates a unique slug for an event, retrying with a numeric suffix on collision.
 * Uses the service-role client so it can check against all events regardless of RLS.
 */
export async function generateUniqueEventSlug(
  title: string,
  startAt: Date,
): Promise<string> {
  const db = createSupabaseAdminClient();
  const base = generateEventSlug(title, startAt);

  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data } = await db
      .from("events")
      .select("id")
      .eq("seo_slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error("Could not generate a unique slug after 10 attempts.");
}

// ── Booking queries ────────────────────────────────────────────────────────────

/**
 * Fetches all bookings for an event, ordered by creation time.
 * Venue managers only see bookings for their own venue's events — enforce in caller.
 */
export async function getBookingsForEvent(eventId: string): Promise<EventBooking[]> {
  const supabase = await createSupabaseActionClient();
  const { data, error } = await supabase
    .from("event_bookings")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`getBookingsForEvent: ${error.message}`);
  return (data ?? []).map((row) => fromDb<EventBooking>(row));
}

/**
 * Returns total confirmed ticket count for an event.
 */
export async function getConfirmedTicketCount(eventId: string): Promise<number> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("event_bookings")
    .select("ticket_count")
    .eq("event_id", eventId)
    .eq("status", "confirmed");

  if (error) throw new Error(`getConfirmedTicketCount: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + (row.ticket_count as number), 0);
}

// ── Atomic booking RPC ─────────────────────────────────────────────────────────

/**
 * Calls the create_booking Postgres RPC which performs an atomic
 * capacity check + insert inside a transaction with FOR UPDATE locking.
 * Must use the service-role client so the RPC runs as the function definer.
 */
export async function atomicCreateBooking(params: {
  eventId: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  email: string | null;
  ticketCount: number;
}): Promise<BookingRpcResult> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("create_booking", {
    p_event_id:     params.eventId,
    p_first_name:   params.firstName,
    p_last_name:    params.lastName,
    p_mobile:       params.mobile,
    p_email:        params.email,
    p_ticket_count: params.ticketCount,
  });

  if (error) throw new Error(`atomicCreateBooking RPC error: ${error.message}`);

  const result = data as { ok: boolean; reason?: string; booking_id?: string };
  if (!result.ok) {
    return { ok: false, reason: (result.reason ?? "not_found") as "not_found" | "sold_out" };
  }
  return { ok: true, bookingId: result.booking_id! };
}
```

- [ ] **Step 4: Run slug tests — expect PASS**

```bash
npx vitest run src/lib/__tests__/bookings.test.ts
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/bookings.ts src/lib/__tests__/bookings.test.ts
git commit -m "feat: add bookings DB helpers — slug generation, booking queries, atomic RPC wrapper"
```

---

## Chunk 2: Landing Page

> **Prerequisite:** Chunk 1 merged.
> **Independent of:** Chunks 3, 4, 5 — can run in parallel with them.

### Task 6: Booking server actions

**Files:**
- Create: `src/actions/bookings.ts`
- Create: `src/actions/__tests__/bookings.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/actions/__tests__/bookings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heavy dependencies before importing the action
vi.mock("@/lib/bookings", () => ({
  atomicCreateBooking: vi.fn(),
  generateUniqueEventSlug: vi.fn(),
}));
vi.mock("@/lib/sms", () => ({
  sendBookingConfirmationSms: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({})),
}));

import { createBookingAction } from "../bookings";
import { atomicCreateBooking } from "@/lib/bookings";

const mockAtomicCreate = vi.mocked(atomicCreateBooking);

describe("createBookingAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return error for invalid mobile number", async () => {
    const result = await createBookingAction({
      eventId: "event-1",
      firstName: "John",
      lastName: null,
      mobile: "not-a-phone",
      email: null,
      ticketCount: 2,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/mobile/i);
  });

  it("should return sold_out error when event is full", async () => {
    mockAtomicCreate.mockResolvedValue({ ok: false, reason: "sold_out" });
    const result = await createBookingAction({
      eventId: "event-1",
      firstName: "John",
      lastName: null,
      mobile: "+447700900001",
      email: null,
      ticketCount: 2,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("sold_out");
  });

  it("should return success and booking id on valid booking", async () => {
    mockAtomicCreate.mockResolvedValue({ ok: true, bookingId: "booking-uuid" });
    const result = await createBookingAction({
      eventId: "event-1",
      firstName: "Jane",
      lastName: "Smith",
      mobile: "+447700900002",
      email: "jane@example.com",
      ticketCount: 1,
    });
    expect(result.success).toBe(true);
    expect(result.bookingId).toBe("booking-uuid");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/actions/__tests__/bookings.test.ts
```

- [ ] **Step 3: Create `src/actions/bookings.ts`**

```typescript
"use server";

import { z } from "zod";
import { parsePhoneNumber, isValidPhoneNumber } from "libphonenumber-js";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { atomicCreateBooking } from "@/lib/bookings";
import { sendBookingConfirmationSms } from "@/lib/sms";
import { RateLimiter } from "@/lib/public-api/rate-limit";
import { recordAuditLogEntry } from "@/lib/audit-log";

// 10 booking attempts per IP per 10 minutes
const bookingLimiter = new RateLimiter({ windowMs: 600_000, maxRequests: 10 });

const createBookingSchema = z.object({
  eventId:     z.string().uuid(),
  firstName:   z.string().min(1, "First name is required").max(100),
  lastName:    z.string().max(100).nullable(),
  mobile:      z.string().min(1, "Mobile number is required"),
  email:       z.string().email("Invalid email address").nullable(),
  ticketCount: z.number().int().min(1).max(50),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type CreateBookingResult =
  | { success: true; bookingId: string }
  | { success: false; error: string };

export async function createBookingAction(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  // Rate limit — extract IP from headers (works in Server Actions via next/headers)
  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown";

  const rl = bookingLimiter.check(ip);
  if (!rl.allowed) {
    return { success: false, error: "rate_limited" };
  }

  // Validate input
  const parsed = createBookingSchema.safeParse(input);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return { success: false, error: firstError.message };
  }

  const data = parsed.data;

  // Validate + normalise mobile to E.164
  if (!isValidPhoneNumber(data.mobile, "GB")) {
    return { success: false, error: "Invalid mobile number" };
  }
  const normalisedMobile = parsePhoneNumber(data.mobile, "GB").format("E.164");

  // Atomic capacity check + insert via Postgres RPC
  const rpcResult = await atomicCreateBooking({
    eventId:     data.eventId,
    firstName:   data.firstName,
    lastName:    data.lastName,
    mobile:      normalisedMobile,
    email:       data.email,
    ticketCount: data.ticketCount,
  });

  if (!rpcResult.ok) {
    return { success: false, error: rpcResult.reason };
  }

  // Fire confirmation SMS asynchronously — don't await, don't block the response
  sendBookingConfirmationSms(rpcResult.bookingId).catch((err) => {
    console.warn("Failed to send booking confirmation SMS:", err);
  });

  return { success: true, bookingId: rpcResult.bookingId };
}

export type CancelBookingResult = { success: boolean; error?: string };

export async function cancelBookingAction(
  bookingId: string,
  eventId: string,
): Promise<CancelBookingResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Unauthorized" };

  const supabase = await createSupabaseActionClient();
  const { error } = await supabase
    .from("event_bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("event_id", eventId); // extra guard

  if (error) return { success: false, error: error.message };

  await recordAuditLogEntry({
    user_id: user.id,
    operation_type: "cancel_booking",
    resource_type: "event_booking",
    resource_id: bookingId,
    operation_status: "success",
  });

  revalidatePath(`/events/${eventId}`);
  return { success: true };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/actions/__tests__/bookings.test.ts
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/actions/bookings.ts src/actions/__tests__/bookings.test.ts
git commit -m "feat: add createBookingAction and cancelBookingAction server actions"
```

---

### Task 7: BookingForm client component

**Files:**
- Create: `src/app/l/[slug]/BookingForm.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useState } from "react";
import { createBookingAction } from "@/actions/bookings";
import type { CreateBookingInput } from "@/actions/bookings";

interface BookingFormProps {
  eventId: string;
  maxTickets: number;
  isSoldOut: boolean;
}

export function BookingForm({ eventId, maxTickets, isSoldOut }: BookingFormProps) {
  const [ticketCount, setTicketCount] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [bookedMobile, setBookedMobile] = useState("");

  if (isSoldOut) {
    return (
      <div className="rounded-lg bg-[var(--color-canvas)] border border-[var(--color-border)] p-6 text-center">
        <p className="text-[var(--color-text-muted)] font-medium">
          Sorry, this event is fully booked.
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="rounded-lg bg-[var(--color-canvas)] border border-[var(--color-border)] p-6 text-center space-y-2">
        <p className="text-lg font-semibold text-[var(--color-primary)]">You&apos;re booked in!</p>
        <p className="text-[var(--color-text-muted)] text-sm">
          We&apos;ve sent a confirmation text to {bookedMobile}.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const input: CreateBookingInput = {
      eventId,
      firstName: firstName.trim(),
      lastName: lastName.trim() || null,
      mobile: mobile.trim(),
      email: email.trim() || null,
      ticketCount,
    };

    const result = await createBookingAction(input);
    setLoading(false);

    if (!result.success) {
      if (result.error === "sold_out") {
        setError("Sorry, this event is now fully booked.");
      } else if (result.error === "rate_limited") {
        setError("Too many attempts. Please try again in a few minutes.");
      } else {
        setError(result.error || "Something went wrong. Please try again.");
      }
      return;
    }

    setBookedMobile(mobile.trim());
    setSuccess(true);
  }

  return (
    <div className="bg-[var(--color-canvas)] border-t border-[var(--color-border)]">
      <div className="p-6">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-primary)] mb-4">
          Reserve Your Seats
        </h2>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Ticket count stepper */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text-muted)]">How many seats?</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTicketCount((n) => Math.max(1, n - 1))}
                disabled={ticketCount <= 1}
                className="w-8 h-8 rounded-full bg-[var(--color-primary)] text-white font-bold
                           disabled:opacity-40 flex items-center justify-center"
                aria-label="Decrease ticket count"
              >
                −
              </button>
              <span className="text-lg font-bold w-6 text-center" aria-live="polite">
                {ticketCount}
              </span>
              <button
                type="button"
                onClick={() => setTicketCount((n) => Math.min(maxTickets, n + 1))}
                disabled={ticketCount >= maxTickets}
                className="w-8 h-8 rounded-full bg-[var(--color-primary)] text-white font-bold
                           disabled:opacity-40 flex items-center justify-center"
                aria-label="Increase ticket count"
              >
                +
              </button>
            </div>
          </div>

          {/* Name fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className="sr-only">First name</label>
              <input
                id="firstName"
                type="text"
                placeholder="First name *"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoComplete="given-name"
                className="w-full rounded-md border border-[var(--color-border)] bg-white
                           px-3 py-2 text-sm placeholder:text-[var(--color-text-muted)]
                           focus:outline-none focus:ring-2 focus:ring-[var(--color-secondary)]"
              />
            </div>
            <div>
              <label htmlFor="lastName" className="sr-only">Last name</label>
              <input
                id="lastName"
                type="text"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                className="w-full rounded-md border border-[var(--color-border)] bg-white
                           px-3 py-2 text-sm placeholder:text-[var(--color-text-muted)]
                           focus:outline-none focus:ring-2 focus:ring-[var(--color-secondary)]"
              />
            </div>
          </div>

          {/* Mobile */}
          <div>
            <label htmlFor="mobile" className="sr-only">Mobile number</label>
            <input
              id="mobile"
              type="tel"
              placeholder="Mobile number *"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              required
              autoComplete="tel"
              className="w-full rounded-md border border-[var(--color-border)] bg-white
                         px-3 py-2 text-sm placeholder:text-[var(--color-text-muted)]
                         focus:outline-none focus:ring-2 focus:ring-[var(--color-secondary)]"
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="sr-only">Email address</label>
            <input
              id="email"
              type="email"
              placeholder="Email (optional)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-md border border-[var(--color-border)] bg-white
                         px-3 py-2 text-sm placeholder:text-[var(--color-text-muted)]
                         focus:outline-none focus:ring-2 focus:ring-[var(--color-secondary)]"
            />
          </div>

          {/* Error */}
          {error && (
            <p role="alert" className="text-sm text-[var(--color-danger)] font-medium">
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !firstName.trim() || !mobile.trim()}
            className="w-full rounded-md bg-[var(--color-secondary)] text-white font-bold
                       uppercase tracking-wider text-sm py-3 disabled:opacity-50
                       hover:opacity-90 transition-opacity"
          >
            {loading ? "Booking…" : "Book Now — Free Entry"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/app/l/[slug]/BookingForm.tsx
git commit -m "feat: add BookingForm client component with quantity stepper and validation"
```

---

### Task 8: Landing page Server Component

**Files:**
- Create: `src/app/l/[slug]/page.tsx`

First check how event images are fetched — look at `src/lib/events.ts` for the image path field and how `supabase.storage` is used in the codebase.

- [ ] **Step 1: Check how event image URLs are generated**

```bash
grep -n "event_image\|getPublicUrl\|event-images" src/lib/events.ts | head -20
grep -rn "getPublicUrl" src/ --include="*.ts" --include="*.tsx" | head -10
```

Note the pattern — likely `supabase.storage.from('event-images').getPublicUrl(path).data.publicUrl`.

- [ ] **Step 2: Create the landing page**

```typescript
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { BookingForm } from "./BookingForm";

export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function getEventBySlug(slug: string) {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("events")
    .select(`
      id, title, public_title, public_teaser, public_description,
      public_highlights, event_image_path, start_at, end_at,
      booking_enabled, total_capacity, max_tickets_per_booking, seo_slug,
      venues ( id, name, google_review_url )
    `)
    .eq("seo_slug", slug)
    .eq("booking_enabled", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`getEventBySlug: ${error.message}`);
  return data;
}

async function getConfirmedTickets(eventId: string): Promise<number> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("event_bookings")
    .select("ticket_count")
    .eq("event_id", eventId)
    .eq("status", "confirmed");
  return (data ?? []).reduce((sum, r) => sum + (r.ticket_count as number), 0);
}

function getImageUrl(path: string | null): string | null {
  if (!path) return null;
  const db = createSupabaseAdminClient();
  const { data } = db.storage.from("event-images").getPublicUrl(path);
  return data.publicUrl;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/London",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return { title: "Not Found" };

  const title = `${event.public_title ?? event.title} — Barons Pubs`;
  const imageUrl = getImageUrl(event.event_image_path);

  return {
    title,
    description: event.public_teaser ?? undefined,
    openGraph: {
      title,
      description: event.public_teaser ?? undefined,
      images: imageUrl ? [{ url: imageUrl }] : undefined,
    },
  };
}

export default async function EventLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const venue = Array.isArray(event.venues) ? event.venues[0] : event.venues;
  const confirmedTickets = await getConfirmedTickets(event.id);
  const isSoldOut =
    event.total_capacity !== null && confirmedTickets >= event.total_capacity;

  const displayTitle = event.public_title ?? event.title;
  const startDate = new Date(event.start_at as string);
  const imageUrl = getImageUrl(event.event_image_path);
  const highlights = Array.isArray(event.public_highlights)
    ? (event.public_highlights as string[]).filter(Boolean)
    : [];

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      {/* ── Top bar ───────────────────────────────────────────── */}
      <header className="bg-[var(--color-canvas)] border-b border-[var(--color-border)] px-4 py-3 flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-[var(--color-primary)] flex items-center justify-center
                        font-playfair text-[var(--color-secondary)] text-xs font-bold flex-shrink-0">
          B
        </div>
        <span className="font-playfair text-[var(--color-primary)] text-sm font-semibold tracking-wide">
          Barons Pubs
        </span>
      </header>

      {/* ── MOBILE layout (single column) / DESKTOP layout (two columns) ── */}
      <div className="sm:grid sm:grid-cols-2 sm:min-h-[calc(100vh-52px)]">

        {/* ── LEFT column: Image + USPs ───────────────────────── */}
        <div className="bg-[var(--color-primary)]">
          {/* Square event image */}
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={displayTitle}
              className="w-full aspect-square object-cover"
            />
          ) : (
            <div className="w-full aspect-square bg-[var(--color-primary-dark)]" />
          )}

          {/* USPs */}
          {highlights.length > 0 && (
            <div className="p-6">
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--color-secondary)] mb-4">
                What to expect
              </p>
              <ul className="space-y-3">
                {highlights.map((usp, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-[var(--color-secondary)]/20
                                     flex items-center justify-center flex-shrink-0 text-[var(--color-secondary)]
                                     text-xs font-bold">
                      ✓
                    </span>
                    <span className="text-sm text-white/75 leading-snug">{usp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── RIGHT column: Details + Form ────────────────────── */}
        <div className="flex flex-col">
          {/* Event header */}
          <div className="p-6 border-b border-[var(--color-border)]">
            <h1 className="font-playfair text-2xl font-bold text-[var(--color-primary)] leading-tight mb-3">
              {displayTitle}
            </h1>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs font-semibold bg-[var(--color-primary)]/8 text-[var(--color-primary)]
                               px-2 py-1 rounded">
                📅 {dateFormatter.format(startDate)}
              </span>
              <span className="text-xs font-semibold bg-[var(--color-primary)]/8 text-[var(--color-primary)]
                               px-2 py-1 rounded">
                🕗 {timeFormatter.format(startDate)}
              </span>
              {venue?.name && (
                <span className="text-xs font-semibold bg-[var(--color-primary)]/8 text-[var(--color-primary)]
                                 px-2 py-1 rounded">
                  📍 {venue.name}
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="p-6 flex-1">
            {event.public_teaser && (
              <p className="text-sm italic text-[var(--color-text)] mb-3 leading-relaxed">
                {event.public_teaser}
              </p>
            )}
            {event.public_description && (
              <p className="text-sm text-[var(--color-text-muted)] leading-relaxed whitespace-pre-wrap">
                {event.public_description}
              </p>
            )}
          </div>

          {/* Booking form */}
          <BookingForm
            eventId={event.id}
            maxTickets={event.max_tickets_per_booking ?? 10}
            isSoldOut={isSoldOut}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Test locally — start dev server and visit the page**

```bash
npm run dev
# Visit http://localhost:3000/l/test-slug-that-doesnt-exist
# Should return 404
# If you have a dev event with booking_enabled=true, visit its slug
```

- [ ] **Step 4: Commit**

```bash
git add src/app/l/
git commit -m "feat: add public event landing page at /l/[slug]"
```

---

## Chunk 3: SMS Infrastructure & Crons

> **Prerequisite:** Chunk 1 merged.
> **Independent of:** Chunks 2, 4, 5 — can run in parallel.

### Task 9: Twilio SMS helper

**Files:**
- Create: `src/lib/sms.ts`
- Create: `src/lib/__tests__/sms.test.ts`

- [ ] **Step 1: Install Twilio SDK**

```bash
npm install twilio
npm install --save-dev @types/twilio
```

If `@types/twilio` isn't available, `twilio` ships its own types — skip the dev install.

- [ ] **Step 2: Write failing tests (mocked Twilio)**

Create `src/lib/__tests__/sms.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock twilio before importing sms.ts
vi.mock("twilio", () => {
  const send = vi.fn().mockResolvedValue({ sid: "SMS123" });
  return {
    default: vi.fn(() => ({ messages: { create: send } })),
    __mockSend: send,
  };
});

import { sendSms } from "../sms";

describe("sendSms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should call Twilio messages.create with correct params", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "test_token";
    process.env.TWILIO_FROM_NUMBER = "+447700900000";

    await sendSms({ to: "+447700900001", body: "Hello!" });

    const twilio = await import("twilio");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSend = (twilio as any).__mockSend;
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+447700900001", body: "Hello!" })
    );
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx vitest run src/lib/__tests__/sms.test.ts
```

- [ ] **Step 4: Create `src/lib/sms.ts`**

```typescript
import "server-only";
import twilio from "twilio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createShortLink } from "@/lib/links-server";

// ── Twilio client ─────────────────────────────────────────────────────────────

function getTwilioClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Twilio credentials not configured");
  return twilio(sid, token);
}

const FROM = () => {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new Error("TWILIO_FROM_NUMBER not configured");
  return from;
};

// ── Low-level send ────────────────────────────────────────────────────────────

export async function sendSms({ to, body }: { to: string; body: string }): Promise<void> {
  const client = getTwilioClient();
  await client.messages.create({ to, from: FROM(), body });
}

// ── Booking lookup helper ─────────────────────────────────────────────────────

async function getBookingWithEvent(bookingId: string) {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("event_bookings")
    .select(`
      id, first_name, mobile,
      events (
        id, title, public_title, start_at, seo_slug,
        venues ( name, google_review_url )
      )
    `)
    .eq("id", bookingId)
    .single();
  if (error) throw new Error(`getBookingWithEvent: ${error.message}`);
  return data;
}

function eventTitle(event: { title: string; public_title?: string | null }): string {
  return event.public_title ?? event.title;
}

const formatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

// ── Message senders ───────────────────────────────────────────────────────────

export async function sendBookingConfirmationSms(bookingId: string): Promise<void> {
  const booking = await getBookingWithEvent(bookingId);
  const event   = Array.isArray(booking.events) ? booking.events[0] : booking.events;
  const venue   = Array.isArray(event?.venues)  ? event.venues[0]  : event?.venues;
  const start   = new Date(event.start_at as string);

  const body =
    `Hi ${booking.first_name}! You're booked in for ${eventTitle(event)} ` +
    `at ${venue?.name ?? "the venue"} on ${formatter.format(start)} at ${timeFormatter.format(start)}. ` +
    `See you there! — Barons Pubs`;

  await sendSms({ to: booking.mobile, body });

  // Mark confirmation sent
  const db = createSupabaseAdminClient();
  await db
    .from("event_bookings")
    .update({ sms_confirmation_sent_at: new Date().toISOString() })
    .eq("id", bookingId);
}

export async function sendReminderSms(bookingId: string): Promise<void> {
  const booking = await getBookingWithEvent(bookingId);
  const event   = Array.isArray(booking.events) ? booking.events[0] : booking.events;
  const venue   = Array.isArray(event?.venues)  ? event.venues[0]  : event?.venues;
  const start   = new Date(event.start_at as string);

  const body =
    `Just a reminder — ${eventTitle(event)} is tomorrow at ` +
    `${timeFormatter.format(start)} at ${venue?.name ?? "the venue"}. ` +
    `Looking forward to seeing you! — Barons Pubs`;

  await sendSms({ to: booking.mobile, body });

  const db = createSupabaseAdminClient();
  await db
    .from("event_bookings")
    .update({ sms_reminder_sent_at: new Date().toISOString() })
    .eq("id", bookingId);
}

export async function sendPostEventSms(bookingId: string): Promise<void> {
  const booking = await getBookingWithEvent(bookingId);
  const event   = Array.isArray(booking.events) ? booking.events[0] : booking.events;
  const venue   = Array.isArray(event?.venues)  ? event.venues[0]  : event?.venues;

  let reviewPart = "";
  if (venue?.google_review_url) {
    try {
      const reviewUrl = new URL(venue.google_review_url);
      reviewUrl.searchParams.set("utm_source",   "sms");
      reviewUrl.searchParams.set("utm_medium",   "text");
      reviewUrl.searchParams.set("utm_campaign", "post-event-review");
      reviewUrl.searchParams.set("utm_content",  event.seo_slug ?? "event");

      const shortLink = await createShortLink({
        name:        `Review — ${eventTitle(event)}`,
        destination: reviewUrl.toString(),
        link_type:   "general",
        expires_at:  null,
        created_by:  null,
      });

      const { SHORT_LINK_BASE_URL } = await import("@/lib/links");
      reviewPart = ` We'd love to hear what you thought — leave us a Google review: ${SHORT_LINK_BASE_URL}${shortLink.code}`;
    } catch {
      // If short link creation fails, send SMS without review link
    }
  }

  const body =
    `Thanks for coming to ${eventTitle(event)} yesterday! ` +
    `We hope you had a great time.${reviewPart} — Barons Pubs`;

  await sendSms({ to: booking.mobile, body });

  const db = createSupabaseAdminClient();
  await db
    .from("event_bookings")
    .update({ sms_post_event_sent_at: new Date().toISOString() })
    .eq("id", bookingId);
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run src/lib/__tests__/sms.test.ts
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/sms.ts src/lib/__tests__/sms.test.ts
git commit -m "feat: add Twilio SMS helper with confirmation, reminder and post-event senders"
```

---

### Task 10: SMS cron routes

**Files:**
- Create: `src/app/api/cron/sms-reminders/route.ts`
- Create: `src/app/api/cron/sms-post-event/route.ts`
- Modify: `vercel.json`
- Modify: `.env.example`

- [ ] **Step 1: Create the reminders cron**

```typescript
// src/app/api/cron/sms-reminders/route.ts
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendReminderSms } from "@/lib/sms";

export async function GET(req: Request) {
  // Verify Vercel cron secret
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createSupabaseAdminClient();

  // Confirmed bookings for events that start TOMORROW (UK local date), reminder not yet sent
  const { data: bookings, error } = await db
    .from("event_bookings")
    .select("id")
    .eq("status", "confirmed")
    .is("sms_reminder_sent_at", null)
    .filter(
      "events.start_at",
      "gte",
      new Date(
        new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London" }) +
          "T00:00:00+01:00" // will be adjusted — see note below
      ).toISOString()
    );

  // NOTE: Supabase JS doesn't support arbitrary SQL date functions in filters.
  // Use a raw RPC query instead:
  const { data: reminderBookings, error: rpcError } = await db.rpc(
    "get_bookings_for_reminder_sms"
  );

  if (rpcError) {
    console.error("sms-reminders cron error:", rpcError.message);
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const ids: string[] = (reminderBookings ?? []).map((r: { id: string }) => r.id);
  let sent = 0;
  for (const id of ids) {
    try {
      await sendReminderSms(id);
      sent++;
    } catch (err) {
      console.error(`Failed reminder SMS for booking ${id}:`, err);
    }
  }

  return NextResponse.json({ sent, total: ids.length });
}
```

> **Note on date filtering:** The cron route above uses a Postgres RPC `get_bookings_for_reminder_sms` to handle timezone-aware date matching correctly. Add these two helper RPCs to the migration (or a follow-up migration):

```sql
-- Helper RPC for reminder cron (tomorrow in UK time, confirmed, reminder not sent)
create or replace function get_bookings_for_reminder_sms()
returns table (id uuid)
language sql
security definer
as $$
  select eb.id
  from event_bookings eb
  join events e on e.id = eb.event_id
  where eb.status = 'confirmed'
    and eb.sms_reminder_sent_at is null
    and date(e.start_at at time zone 'Europe/London')
        = (current_date at time zone 'Europe/London') + interval '1 day';
$$;

-- Helper RPC for post-event cron (yesterday in UK time, confirmed, post-event SMS not sent)
create or replace function get_bookings_for_post_event_sms()
returns table (id uuid)
language sql
security definer
as $$
  select eb.id
  from event_bookings eb
  join events e on e.id = eb.event_id
  where eb.status = 'confirmed'
    and eb.sms_post_event_sent_at is null
    and date(e.start_at at time zone 'Europe/London')
        = (current_date at time zone 'Europe/London') - interval '1 day';
$$;
```

Add these RPCs to the migration file created in Task 3, then re-apply:

```bash
npm run supabase:migrate
```

- [ ] **Step 2: Create the post-event cron**

```typescript
// src/app/api/cron/sms-post-event/route.ts
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPostEventSms } from "@/lib/sms";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("get_bookings_for_post_event_sms");

  if (error) {
    console.error("sms-post-event cron error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids: string[] = (data ?? []).map((r: { id: string }) => r.id);
  let sent = 0;
  for (const id of ids) {
    try {
      await sendPostEventSms(id);
      sent++;
    } catch (err) {
      console.error(`Failed post-event SMS for booking ${id}:`, err);
    }
  }

  return NextResponse.json({ sent, total: ids.length });
}
```

- [ ] **Step 3: Update vercel.json — add cron schedules**

Open `vercel.json`. It currently has one cron entry. Add two more:

```json
{
  "crons": [
    { "path": "/api/cron/refresh-inspiration", "schedule": "0 6 1 * *" },
    { "path": "/api/cron/sms-reminders",       "schedule": "0 9 * * *" },
    { "path": "/api/cron/sms-post-event",      "schedule": "0 10 * * *" }
  ]
}
```

- [ ] **Step 4: Update .env.example**

Add to `.env.example`:

```
# Twilio SMS
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/sms-reminders/ src/app/api/cron/sms-post-event/ vercel.json .env.example
git commit -m "feat: add daily SMS reminder and post-event cron routes"
```

---

## Chunk 4: Admin UI

> **Prerequisite:** Chunk 1 merged.
> **Independent of:** Chunks 2, 3, 5 — can run in parallel.

### Task 11: Bookings tab on event detail page

**Files:**
- Create: `src/app/events/[eventId]/bookings/page.tsx` — but see note below.

> **Note:** The event detail page (`/events/[eventId]/page.tsx`) is a long scrollable page with no tabs — it renders everything inline with `Card` components. The "bookings" view should be added as a new page at `/events/[eventId]/bookings` reachable via a link/button from the event detail page, rather than a tab. Check the existing page structure before coding to confirm.

First, read the existing event detail page to understand the nav pattern:

- [ ] **Step 1: Read the event detail page structure**

```bash
grep -n "Link\|Button\|href.*eventId\|navigation" src/app/events/\[eventId\]/page.tsx | head -30
```

- [ ] **Step 2: Create the bookings management page**

```typescript
// src/app/events/[eventId]/bookings/page.tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getEventDetail } from "@/lib/events";
import { getBookingsForEvent } from "@/lib/bookings";
import { cancelBookingAction } from "@/actions/bookings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PageProps {
  params: Promise<{ eventId: string }>;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit",
  timeZone: "Europe/London",
});

export default async function EventBookingsPage({ params }: PageProps) {
  const { eventId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const event = await getEventDetail(eventId, user);
  if (!event) notFound();

  // Venue managers can only see bookings for their own venue's events
  if (user.role === "venue_manager" && event.venueId !== user.venueId) {
    redirect("/events");
  }

  const bookings = await getBookingsForEvent(eventId);
  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const totalTickets = confirmed.reduce((sum, b) => sum + b.ticketCount, 0);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Back link */}
      <Link
        href={`/events/${eventId}`}
        className="text-sm text-[var(--color-text-muted)] hover:underline"
      >
        ← Back to event
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-playfair text-[var(--color-primary)]">
            Bookings
          </h1>
          <p className="text-[var(--color-text-muted)] text-sm mt-1">{event.title}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-[var(--color-primary)]">{totalTickets}</p>
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">
            tickets booked
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {bookings.length === 0 ? "No bookings yet" : `${bookings.length} booking${bookings.length !== 1 ? "s" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {bookings.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              No one has booked yet. Share the landing page link to take bookings.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th scope="col" className="text-left py-2 pr-4 font-semibold text-[var(--color-text-muted)]">Name</th>
                    <th scope="col" className="text-left py-2 pr-4 font-semibold text-[var(--color-text-muted)]">Mobile</th>
                    <th scope="col" className="text-left py-2 pr-4 font-semibold text-[var(--color-text-muted)]">Email</th>
                    <th scope="col" className="text-left py-2 pr-4 font-semibold text-[var(--color-text-muted)]">Tickets</th>
                    <th scope="col" className="text-left py-2 pr-4 font-semibold text-[var(--color-text-muted)]">Booked at</th>
                    <th scope="col" className="text-left py-2 font-semibold text-[var(--color-text-muted)]">Status</th>
                    <th scope="col" className="sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking) => (
                    <tr key={booking.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="py-3 pr-4">
                        {booking.firstName} {booking.lastName ?? ""}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">{booking.mobile}</td>
                      <td className="py-3 pr-4 text-[var(--color-text-muted)]">
                        {booking.email ?? "—"}
                      </td>
                      <td className="py-3 pr-4 font-semibold">{booking.ticketCount}</td>
                      <td className="py-3 pr-4 text-[var(--color-text-muted)] whitespace-nowrap">
                        {dateFormatter.format(booking.createdAt)}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={booking.status === "confirmed" ? "default" : "secondary"}>
                          {booking.status === "confirmed" ? "Confirmed" : "Cancelled"}
                        </Badge>
                      </td>
                      <td className="py-3">
                        {booking.status === "confirmed" && (
                          <form action={cancelBookingAction.bind(null, booking.id, eventId)}>
                            <button
                              type="submit"
                              className="text-xs text-[var(--color-danger)] hover:underline"
                            >
                              Cancel
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/app/events/[eventId]/bookings/
git commit -m "feat: add event bookings management page at /events/[eventId]/bookings"
```

---

### Task 12: Booking settings on event — slug generation server action

**Files:**
- Modify: `src/actions/events.ts` — add `updateBookingSettingsAction`
- Modify: `src/app/events/[eventId]/page.tsx` — add booking settings card + "View Bookings" link

- [ ] **Step 1: Add updateBookingSettingsAction to events actions**

Add to `src/actions/events.ts`:

```typescript
export type UpdateBookingSettingsResult = ActionResult & {
  slug?: string;
};

export async function updateBookingSettingsAction(
  eventId: string,
  settings: {
    bookingEnabled: boolean;
    totalCapacity: number | null;
    maxTicketsPerBooking: number;
  }
): Promise<UpdateBookingSettingsResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "Unauthorized" };

  const supabase = await createSupabaseActionClient();

  // Fetch the event to check permissions and current state
  const { data: event } = await supabase
    .from("events")
    .select("id, title, start_at, seo_slug, venue_id")
    .eq("id", eventId)
    .single();

  if (!event) return { success: false, message: "Event not found" };

  // Venue managers can only edit their own venue's events
  if (user.role === "venue_manager" && event.venue_id !== user.venueId) {
    return { success: false, message: "Permission denied" };
  }

  // Auto-generate slug when enabling booking for the first time
  let slugToSave = event.seo_slug as string | null;
  if (settings.bookingEnabled && !slugToSave) {
    const { generateUniqueEventSlug } = await import("@/lib/bookings");
    slugToSave = await generateUniqueEventSlug(
      event.title as string,
      new Date(event.start_at as string)
    );
  }

  const { error } = await supabase
    .from("events")
    .update({
      booking_enabled: settings.bookingEnabled,
      total_capacity: settings.totalCapacity,
      max_tickets_per_booking: settings.maxTicketsPerBooking,
      ...(slugToSave ? { seo_slug: slugToSave } : {}),
    })
    .eq("id", eventId);

  if (error) return { success: false, message: error.message };

  await recordAuditLogEntry({
    user_id: user.id,
    operation_type: "update_booking_settings",
    resource_type: "event",
    resource_id: eventId,
    operation_status: "success",
  });

  revalidatePath(`/events/${eventId}`);
  return { success: true, slug: slugToSave ?? undefined };
}
```

- [ ] **Step 2: Add Booking Settings card and "View Bookings" link to event detail page**

Read the event detail page (`src/app/events/[eventId]/page.tsx`) to find the right place to insert the card. Look for where other action cards/sections are rendered near the bottom of the page. Add:

```typescript
{/* Booking Settings card — shown for venue managers, planners, executives */}
{(user.role !== "reviewer") && (
  <BookingSettingsCard
    event={event}
    onSave={updateBookingSettingsAction}
  />
)}

{/* View bookings link — shown when booking is enabled */}
{event.bookingEnabled && (
  <Link href={`/events/${event.id}/bookings`}>
    <Button variant="outline" type="button">
      View Bookings ({/* ticket count */})
    </Button>
  </Link>
)}
```

Create a `BookingSettingsCard` client component at `src/components/events/booking-settings-card.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateBookingSettingsAction } from "@/actions/events";

interface Props {
  event: {
    id: string;
    bookingEnabled: boolean;
    totalCapacity: number | null;
    maxTicketsPerBooking: number;
    seoSlug: string | null;
  };
}

const LANDING_BASE = "https://l.baronspubs.com/";

export function BookingSettingsCard({ event }: Props) {
  const [enabled, setEnabled]     = useState(event.bookingEnabled);
  const [capacity, setCapacity]   = useState(event.totalCapacity?.toString() ?? "");
  const [maxTickets, setMaxTickets] = useState(event.maxTicketsPerBooking);
  const [slug, setSlug]           = useState(event.seoSlug);
  const [saving, setSaving]       = useState(false);
  const [message, setMessage]     = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const result = await updateBookingSettingsAction(event.id, {
      bookingEnabled: enabled,
      totalCapacity: capacity ? parseInt(capacity, 10) : null,
      maxTicketsPerBooking: maxTickets,
    });
    setSaving(false);
    if (result.success) {
      if (result.slug) setSlug(result.slug);
      setMessage("Saved.");
    } else {
      setMessage(result.message ?? "Failed to save.");
    }
  }

  const landingUrl = slug ? `${LANDING_BASE}${slug}` : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Booking</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <label htmlFor="booking-enabled" className="text-sm font-medium">
            Booking enabled
          </label>
          <input
            id="booking-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
        </div>

        {/* Landing page URL */}
        {landingUrl && (
          <div>
            <p className="text-xs text-[var(--color-text-muted)] mb-1">Landing page URL</p>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-[var(--color-canvas)] border border-[var(--color-border)]
                               rounded px-2 py-1 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {landingUrl}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(landingUrl)}
                className="text-xs text-[var(--color-secondary)] hover:underline whitespace-nowrap"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {/* Capacity */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="total-capacity" className="text-xs font-medium block mb-1">
              Total capacity <span className="text-[var(--color-text-muted)]">(blank = unlimited)</span>
            </label>
            <input
              id="total-capacity"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Unlimited"
              className="w-full rounded border border-[var(--color-border)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="max-tickets" className="text-xs font-medium block mb-1">
              Max tickets per booking
            </label>
            <input
              id="max-tickets"
              type="number"
              min={1}
              max={100}
              value={maxTickets}
              onChange={(e) => setMaxTickets(parseInt(e.target.value, 10))}
              className="w-full rounded border border-[var(--color-border)] px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-[var(--color-primary)] text-white text-sm font-semibold
                       px-4 py-2 disabled:opacity-50 hover:opacity-90"
          >
            {saving ? "Saving…" : "Save booking settings"}
          </button>
          {message && (
            <span className="text-sm text-[var(--color-text-muted)]">{message}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/actions/events.ts src/components/events/booking-settings-card.tsx src/app/events/[eventId]/page.tsx
git commit -m "feat: add booking settings card to event detail page with slug auto-generation"
```

---

### Task 13: Google Review URL on venue edit

**Files:**
- Modify: `src/app/venues/[venueId]/page.tsx` (or wherever the venue edit form lives)
- Modify: `src/lib/venues.ts` (add field to type and query if needed)
- Modify: `src/actions/venues.ts` (add to update action if exists)

- [ ] **Step 1: Locate the venue edit form**

```bash
ls src/app/venues/
cat src/app/venues/\[venueId\]/page.tsx | head -50
grep -n "google_review\|review_url\|googleReview" src/lib/venues.ts src/actions/venues.ts 2>/dev/null
```

- [ ] **Step 2: Add google_review_url to the venue type and query**

In `src/lib/venues.ts`, find the venue SELECT query and add `google_review_url` to the selected fields. Add `googleReviewUrl: string | null` to the `Venue` type (or wherever it's defined).

- [ ] **Step 3: Add the field to the venue update action**

In `src/actions/venues.ts` (or wherever venue updates are handled), accept `googleReviewUrl` and persist it.

- [ ] **Step 4: Add the input to the venue edit form**

In the venue edit form component, add:

```typescript
<div>
  <label htmlFor="google-review-url" className="text-sm font-medium block mb-1">
    Google Review URL
  </label>
  <input
    id="google-review-url"
    type="url"
    placeholder="https://g.page/r/..."
    value={googleReviewUrl}
    onChange={(e) => setGoogleReviewUrl(e.target.value)}
    className="w-full rounded border border-[var(--color-border)] px-3 py-2 text-sm"
  />
  <p className="text-xs text-[var(--color-text-muted)] mt-1">
    Used in post-event SMS messages to request a Google review.
  </p>
</div>
```

- [ ] **Step 5: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/app/venues/ src/lib/venues.ts src/actions/venues.ts
git commit -m "feat: add Google Review URL field to venue settings"
```

---

## Chunk 5: Middleware

> **Prerequisite:** Chunk 1 merged.
> **Independent of:** Chunks 2, 3, 4 — can run in parallel.

### Task 14: Middleware — domain rewrite and public path

**Files:**
- Modify: `middleware.ts`

The current middleware at line 97–100 returns early for `l.baronspubs.com` with no processing. We need to:
1. Add `/l` to `PUBLIC_PATH_PREFIXES`
2. Replace the early return with logic that rewrites non-short-link slugs to `/l/[path]` and then continues

- [ ] **Step 1: Read the full middleware to understand the early-return location**

```bash
cat middleware.ts
```

- [ ] **Step 2: Apply the changes**

In `middleware.ts`:

**Change 1** — Add `/l` to `PUBLIC_PATH_PREFIXES` (add alongside the comment explaining why):

```typescript
const PUBLIC_PATH_PREFIXES = new Set([
  "/login",           // Pre-auth login page
  "/forgot-password", // Pre-auth password reset request
  "/reset-password",  // Pre-auth password update form
  "/auth/confirm",    // Token exchange — no session required
  "/unauthorized",    // Shown to authenticated-but-unauthorised users
  "/l",               // Public event landing pages — no auth required
]);
```

**Change 2** — Replace the early return for `SHORT_LINK_HOST` (currently lines 97–100) with rewrite logic:

```typescript
// Short-link host handling
// - 8-hex-char paths (e.g. /abc12345) → let through to [code] redirect handler
// - All other paths (event landing page slugs) → rewrite to /l/[slug]
if (req.headers.get("host") === SHORT_LINK_HOST) {
  const SHORT_LINK_CODE_PATTERN = /^\/[0-9a-f]{8}$/;
  if (SHORT_LINK_CODE_PATTERN.test(pathname)) {
    return NextResponse.next(); // existing short-link redirect
  }
  // Rewrite slug path to /l/[slug] — the landing page route
  const url = req.nextUrl.clone();
  url.pathname = `/l${pathname}`;
  return NextResponse.rewrite(url);
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Test the routing manually (dev server)**

```bash
npm run dev
# Visit http://localhost:3000/l/some-slug → should hit the landing page (404 if slug doesn't exist)
# Short links (if SHORT_LINK_HOST env var set to localhost:3000) → should redirect
```

- [ ] **Step 5: Commit**

```bash
git add middleware.ts
git commit -m "feat: add /l public path and l.baronspubs.com domain rewrite to middleware"
```

---

## Final: Verification

After all chunks are merged:

- [ ] **Run full verification pipeline**

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

- [ ] **Smoke test the landing page**

1. Enable booking on a test event in the admin
2. Confirm a slug was generated and is shown in the booking settings card
3. Visit `http://localhost:3000/l/[slug]`
4. Submit a booking with a real UK mobile number (test env only)
5. Confirm success state shows

- [ ] **Smoke test cron routes locally**

```bash
curl -H "Authorization: Bearer test-secret" http://localhost:3000/api/cron/sms-reminders
curl -H "Authorization: Bearer test-secret" http://localhost:3000/api/cron/sms-post-event
```

Both should return `{ sent: 0, total: 0 }` (no events due today).

- [ ] **Commit .env.example if not already done**

```bash
git add .env.example
git commit -m "docs: add Twilio environment variables to .env.example"
```
