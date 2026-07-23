# Universal Event Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `l.baronspubs.com` resolve for every public event, showing the same event detail page with the booking area driven by the event's own rules, so no event is ever without a customer link.

**Architecture:** Two new pure modules do the thinking: `event-booking-state.ts` resolves one discriminated booking state from event fields, and `event-public-url.ts` builds the always-resolvable URL. The landing page at `src/app/l/[slug]/page.tsx` becomes a thin renderer over that state. A new ID-suffixed URL form (`/l/<anything>--<uuid>`) guarantees a working URL without writing to any existing row, which is what keeps the public API byte-identical for the external brand site.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase (service-role reads on the public page), Vitest, Tailwind v4 with CSS variable design tokens.

**Spec:** `docs/superpowers/specs/2026-07-23-universal-event-landing-page.md` (revision 2)

---

## Critical constraints

Read these before writing any code. Violating either is a failed implementation.

1. **The public API is a fixed contract.** An external developer builds the Barons brand site against `/api/v1/events`. No existing field of `PublicEvent` may change name, type, nullability, or **value** for any existing event. Only additions are allowed. The trap: `PublicEvent.slug` is *derived* from `seo_slug` when present and falls back to `title`, so writing a `seo_slug` to an existing row silently changes `slug`. This is why Task 2 only touches newly created events and there is no backfill.

2. **Never use em dashes (U+2014)** in code, comments, commit messages, or docs. A hook enforces this on file writes. Use a comma, colon, brackets, or a new sentence.

## Background an engineer new to this codebase needs

- **The landing page is served on a second hostname.** `middleware.ts:110-146` rewrites `l.baronspubs.com/<path>` to the internal route `/l/<path>`, except 8-hex-character short link codes and static assets. So on production the customer sees `l.baronspubs.com/jazz-night-2026-03-20` and Next.js sees `/l/jazz-night-2026-03-20`. **Consequence: a server-side redirect to `/l/<slug>` would be rewritten again to `/l/l/<slug>` and 404.** Task 5 derives the redirect target from the incoming `Host` header for this reason.
- `SHORT_LINK_HOST` is not set in `.env.local`, so it defaults to `l.baronspubs.com` even in local dev. Never build a redirect target from it, or local dev will bounce to production.
- The public page reads through the **service-role admin client** (`createSupabaseAdminClient`), bypassing RLS, and enforces visibility itself: not deleted, status `approved` or `completed`, venue not internal.
- Booking formats are strings like `free_seated`, `paid_standing`, `pay_on_arrival_seated`. Helpers live in `src/lib/booking-format.ts`. `isBookingFormat` narrows an unknown string to the union.
- Tests are Vitest, `environment: "node"`, `globals: true`. `server-only` is aliased to a mock (`vitest.config.ts`), so modules importing `server-only` are testable.
- Design tokens are CSS variables (`var(--navy)`, `var(--paper)`, `var(--slate)`). Never hardcode hex.
- Peter is colourblind. Any new status message must carry text, never colour alone.

## File structure

**Create:**

| File | Responsibility |
|---|---|
| `src/lib/event-booking-state.ts` | Pure. Resolves one `EventBookingState` from event fields. No I/O, no `server-only`. |
| `src/lib/__tests__/event-booking-state.test.ts` | Tests for the above. |
| `src/lib/event-slug.ts` | Pure. `slugify` and `buildEventSlug`, moved out of `public-api/events.ts` to break an import cycle. |
| `src/lib/event-public-url.ts` | Pure. URL building and slug/id parsing for the landing page. |
| `src/lib/__tests__/event-public-url.test.ts` | Tests for the above. |
| `src/app/l/[slug]/BookingUnavailableNotice.tsx` | Presentational block shown in place of the booking form. |

**Modify:**

| File | Change |
|---|---|
| `src/actions/bookings.ts:104-158` | Add the finished-event guard to `getPublicBookingEligibility`. |
| `src/actions/__tests__/bookings.test.ts:66-79` | Add `end_at` to the `eligibleEventRow` fixture, add guard tests. |
| `src/lib/events.ts:455-530` | Generate `seo_slug` on insert when the caller supplied none. |
| `src/app/l/[slug]/page.tsx` | Slug-or-ID lookup, canonical redirect, open to all public events, render by state, robots metadata. |
| `src/lib/public-api/events.ts` | Move `slugify`/`buildEventSlug` out to `event-slug.ts` and re-export, then add `eventPageUrl` and `bookingAvailability`. No behaviour change. |
| `src/app/api/cron/sms-booking-driver/route.ts` | Supply `title` to the campaign event, if the type does not already carry it. |
| `src/lib/public-api/__tests__/events.test.ts` | Contract-lock test plus new field tests. |
| `src/lib/sms-campaign.ts:186-196` | Use the shared CTA resolver, drop the null bail-out. |
| `src/app/api/v1/openapi/route.ts:70-110` | Document the two new fields. |
| `docs/WebsitePublishingAPI.md` | Document the two new fields and the compatibility promise. |

**Explicitly out of scope:** the SQL RPC event-insert paths in `supabase/migrations/`. They are gated behind `EVENT_SAVE_USE_RPC`, which is `"true"` nowhere in production, so they are dead code today. Adding slug generation there would be untested and unreachable. Note it in the final commit message rather than changing it.

---

## Task 1: Block bookings on events that have finished

Independent of everything else and closes a live hole: `getPublicBookingEligibility` never looks at the event date, and `completed` is an allowed status, so a customer can currently book an event that already happened.

**Files:**
- Modify: `src/actions/bookings.ts:104-158`
- Test: `src/actions/__tests__/bookings.test.ts`

- [ ] **Step 1: Add `end_at` to the shared test fixture**

Existing tests build event rows through a helper that has no `end_at`. Adding the guard without this makes every existing booking test fail. In `src/actions/__tests__/bookings.test.ts`, change the helper at line 66:

```ts
function eligibleEventRow(overrides: Record<string, unknown> = {}) {
  return {
    booking_enabled: true,
    booking_type: "free_seated",
    booking_url: null,
    status: "approved",
    deleted_at: null,
    end_at: "2999-01-01T22:00:00.000Z",
    total_capacity: 10,
    max_tickets_per_booking: 5,
    venue: { is_internal: false },
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing tests**

Add to `src/actions/__tests__/bookings.test.ts`, inside the `describe("createBookingAction", ...)` block:

```ts
  it("rejects a booking for an event that has already finished", async () => {
    const finishedFrom = vi.fn((table: string) => {
      if (table === "events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: eligibleEventRow({ end_at: "2020-01-01T22:00:00.000Z" }),
                error: null
              })
            })
          })
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      };
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ from: finishedFrom } as never);

    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("not_found");
  });

  it("rejects a booking for a completed event even when booking is still enabled", async () => {
    const completedFrom = vi.fn((table: string) => {
      if (table === "events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: eligibleEventRow({
                  status: "completed",
                  end_at: "2020-01-01T22:00:00.000Z"
                }),
                error: null
              })
            })
          })
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      };
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ from: completedFrom } as never);

    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("not_found");
  });
```

We return `not_found` rather than a new error code because the existing eligibility failure path already collapses to `not_found`, and telling an anonymous caller *why* an event is ineligible leaks scheduling information for no benefit.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/actions/__tests__/bookings.test.ts -t "finished"
```

Expected: FAIL, both new tests report `success: true` or a different error, because no date guard exists yet.

- [ ] **Step 4: Add `end_at` to the select and add the guard**

In `src/actions/bookings.ts`, in `getPublicBookingEligibility`, add `end_at` to the select list (it currently starts at `booking_enabled` on line 110):

```ts
      .select(`
        booking_enabled,
        booking_type,
        booking_url,
        status,
        deleted_at,
        end_at,
        total_capacity,
        max_tickets_per_booking,
        booking_notes_enabled,
        venue:venues!events_venue_id_fkey(is_internal)
      `)
```

Then, immediately after the existing eligibility `if (...)` block that returns `not_found` (currently ending around line 141), add:

```ts
    // An event that has already finished takes no bookings, whatever its
    // status or booking_enabled flag says. Checked here rather than only on
    // the landing page so a replayed form post cannot bypass it.
    const endAt = typeof row.end_at === "string" ? Date.parse(row.end_at) : Number.NaN;
    if (!Number.isNaN(endAt) && endAt <= Date.now()) {
      return { ok: false, reason: "not_found" };
    }
```

`end_at` is stored as UTC and `Date.now()` is UTC, so this is a straight instant comparison. No timezone conversion is needed or wanted here: Europe/London only matters for display.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/actions/__tests__/bookings.test.ts
```

Expected: PASS, all tests in the file, including the pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add src/actions/bookings.ts src/actions/__tests__/bookings.test.ts
git commit -m "fix: block public bookings on events that have already finished"
```

---

## Task 2: Generate a slug when a new event is created

**Files:**
- Modify: `src/lib/events.ts:455-530`
- Test: `src/lib/__tests__/events-create-slug.test.ts` (create)

Only new events. **Do not backfill existing rows** (see Critical constraints).

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/events-create-slug.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn(),
  createSupabaseReadonlyClient: vi.fn()
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ recordAuditLogEntry: vi.fn() }));
vi.mock("@/lib/planning/sop", () => ({ generateSopChecklist: vi.fn() }));
vi.mock("@/lib/bookings", () => ({ generateUniqueEventSlug: vi.fn() }));

import { createEventDraft } from "../events";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { generateUniqueEventSlug } from "@/lib/bookings";

const mockClient = vi.mocked(createSupabaseActionClient);
const mockSlug = vi.mocked(generateUniqueEventSlug);

function buildSupabaseMock(captured: { payload?: Record<string, unknown> }) {
  return {
    from: vi.fn((table: string) => {
      if (table === "events") {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            captured.payload = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "evt-1", ...payload },
                  error: null
                })
              })
            };
          })
        };
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    })
  };
}

const BASE_PAYLOAD = {
  venueId: "venue-1",
  createdBy: "user-1",
  title: "Jazz Night",
  eventType: "Live Music",
  startAt: "2026-03-20T19:00:00.000Z",
  endAt: "2026-03-20T22:00:00.000Z",
  venueSpace: "Main Bar"
};

describe("createEventDraft slug generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a seo_slug when the caller supplies none", async () => {
    const captured: { payload?: Record<string, unknown> } = {};
    mockClient.mockResolvedValue(buildSupabaseMock(captured) as never);
    mockSlug.mockResolvedValue("jazz-night-2026-03-20");

    await createEventDraft(BASE_PAYLOAD);

    expect(mockSlug).toHaveBeenCalledWith("Jazz Night", new Date("2026-03-20T19:00:00.000Z"));
    expect(captured.payload?.seo_slug).toBe("jazz-night-2026-03-20");
  });

  it("keeps a caller-supplied seo_slug untouched", async () => {
    const captured: { payload?: Record<string, unknown> } = {};
    mockClient.mockResolvedValue(buildSupabaseMock(captured) as never);

    await createEventDraft({ ...BASE_PAYLOAD, seoSlug: "hand-written-slug" });

    expect(mockSlug).not.toHaveBeenCalled();
    expect(captured.payload?.seo_slug).toBe("hand-written-slug");
  });

  it("creates the event anyway when slug generation fails", async () => {
    const captured: { payload?: Record<string, unknown> } = {};
    mockClient.mockResolvedValue(buildSupabaseMock(captured) as never);
    mockSlug.mockRejectedValue(new Error("db down"));

    await expect(createEventDraft(BASE_PAYLOAD)).resolves.toBeTruthy();
    expect(captured.payload?.seo_slug).toBeNull();
  });
});
```

That third test encodes a deliberate decision: a slug is a convenience, not a precondition. Failing to mint one must never block someone creating an event, because the ID-suffixed URL from Task 5 still works without it.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/__tests__/events-create-slug.test.ts
```

Expected: FAIL on the first test, `captured.payload?.seo_slug` is `null` because nothing generates it.

- [ ] **Step 3: Implement**

In `src/lib/events.ts`, inside `createEventDraft`, after the `normaliseOptionalHighlights` line and before `const insertPayload`, add:

```ts
  // Every event gets a slug at birth so its public URL is readable from day
  // one. Existing events are deliberately left alone: writing a seo_slug to a
  // live row would change PublicEvent.slug underneath the brand site.
  let seoSlug = normaliseOptionalText(payload.seoSlug);
  if (!seoSlug) {
    try {
      seoSlug = await generateUniqueEventSlug(payload.title, new Date(payload.startAt));
    } catch (error) {
      console.error("Could not generate a slug for the new event:", error);
      seoSlug = null;
    }
  }
```

Then change the `seo_slug` line in `insertPayload` from `seo_slug: payload.seoSlug ?? null,` to:

```ts
    seo_slug: seoSlug,
```

`generateUniqueEventSlug` is already imported at `src/lib/events.ts:10`. Leave the `event_versions` payload alone: it records what the user submitted.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/__tests__/events-create-slug.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Check nothing else regressed**

```bash
npx vitest run src/lib src/actions
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/events.ts src/lib/__tests__/events-create-slug.test.ts
git commit -m "feat: give every newly created event a seo_slug"
```

---

## Task 3: The booking state resolver

**Files:**
- Create: `src/lib/event-booking-state.ts`
- Test: `src/lib/__tests__/event-booking-state.test.ts`

Pure module, no I/O, no `server-only`. All the branching lives here so the page stays a renderer and the rules are testable without mocking Supabase.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/event-booking-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { resolveEventBookingState, type BookingStateInput } from "../event-booking-state";

const NOW = new Date("2026-03-20T12:00:00.000Z");

function input(overrides: Partial<BookingStateInput> = {}): BookingStateInput {
  return {
    bookingUrl: null,
    bookingEnabled: true,
    bookingType: "free_seated",
    endAt: "2026-03-21T22:00:00.000Z",
    totalCapacity: null,
    confirmedTickets: 0,
    now: NOW,
    ...overrides
  };
}

describe("resolveEventBookingState", () => {
  it("returns external when a booking url is set", () => {
    expect(resolveEventBookingState(input({ bookingUrl: "https://example.com/book" })))
      .toEqual({ kind: "external", url: "https://example.com/book" });
  });

  it("prefers external even for a finished event, so old links keep redirecting", () => {
    const state = resolveEventBookingState(
      input({ bookingUrl: "https://example.com/book", endAt: "2020-01-01T00:00:00.000Z" })
    );
    expect(state.kind).toBe("external");
  });

  it("returns finished once the end time has passed", () => {
    expect(resolveEventBookingState(input({ endAt: "2026-03-20T11:59:59.000Z" })))
      .toEqual({ kind: "finished" });
  });

  it("ranks finished above closed for a past event with booking switched off", () => {
    const state = resolveEventBookingState(
      input({ endAt: "2020-01-01T00:00:00.000Z", bookingEnabled: false })
    );
    expect(state.kind).toBe("finished");
  });

  it("ranks finished above sold_out for a past event at capacity", () => {
    const state = resolveEventBookingState(
      input({ endAt: "2020-01-01T00:00:00.000Z", totalCapacity: 10, confirmedTickets: 10 })
    );
    expect(state.kind).toBe("finished");
  });

  it("returns closed when booking is switched off", () => {
    expect(resolveEventBookingState(input({ bookingEnabled: false }))).toEqual({ kind: "closed" });
  });

  it("returns misconfigured when booking is on but no format is set", () => {
    expect(resolveEventBookingState(input({ bookingType: null }))).toEqual({ kind: "misconfigured" });
  });

  it("returns misconfigured for an unrecognised format string", () => {
    expect(resolveEventBookingState(input({ bookingType: "nonsense" }))).toEqual({ kind: "misconfigured" });
  });

  it("returns sold_out when confirmed tickets reach capacity", () => {
    expect(resolveEventBookingState(input({ totalCapacity: 10, confirmedTickets: 10 })))
      .toEqual({ kind: "sold_out" });
  });

  it("does not sell out when capacity is unset", () => {
    expect(resolveEventBookingState(input({ totalCapacity: null, confirmedTickets: 999 })).kind)
      .toBe("open");
  });

  it("returns open with isPaid false for a free format", () => {
    expect(resolveEventBookingState(input({ bookingType: "free_seated" })))
      .toEqual({ kind: "open", format: "free_seated", isPaid: false });
  });

  it("returns open with isPaid true for a paid format", () => {
    expect(resolveEventBookingState(input({ bookingType: "paid_standing" })))
      .toEqual({ kind: "open", format: "paid_standing", isPaid: true });
  });

  it("treats pay on arrival as open and unpaid", () => {
    expect(resolveEventBookingState(input({ bookingType: "pay_on_arrival_seated" })))
      .toEqual({ kind: "open", format: "pay_on_arrival_seated", isPaid: false });
  });

  it("treats an unparseable end date as not finished", () => {
    expect(resolveEventBookingState(input({ endAt: "not-a-date" })).kind).toBe("open");
  });

  it("reports whether a state allows booking", () => {
    expect(resolveEventBookingState(input()).kind).toBe("open");
    expect(resolveEventBookingState(input({ bookingEnabled: false })).kind).toBe("closed");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/__tests__/event-booking-state.test.ts
```

Expected: FAIL, "Failed to resolve import ../event-booking-state".

- [ ] **Step 3: Implement**

Create `src/lib/event-booking-state.ts`:

```ts
import { isBookingFormat, isPaidBookingFormat, type BookingFormat } from "@/lib/booking-format";

/**
 * Every way the booking area of the public landing page can present itself.
 * Exactly one applies to any event at any moment.
 */
export type EventBookingState =
  | { kind: "external"; url: string }
  | { kind: "finished" }
  | { kind: "closed" }
  | { kind: "misconfigured" }
  | { kind: "sold_out" }
  | { kind: "open"; format: BookingFormat; isPaid: boolean };

export type BookingStateInput = {
  bookingUrl: string | null;
  bookingEnabled: boolean;
  bookingType: string | null;
  endAt: string;
  totalCapacity: number | null;
  confirmedTickets: number;
  /** Injected for testability. Defaults to the current instant. */
  now?: Date;
};

/**
 * True once the event's end time has passed. Both sides are absolute instants
 * (end_at is stored UTC), so no timezone conversion is involved. Europe/London
 * matters for display only.
 *
 * An unparseable date returns false: we would rather show a live booking form
 * for an event with bad data than wrongly tell customers it has finished.
 */
function hasEventFinished(endAt: string, now: Date = new Date()): boolean {
  const parsed = Date.parse(endAt);
  if (Number.isNaN(parsed)) return false;
  return parsed <= now.getTime();
}

/**
 * Resolve the single booking state for an event. Order is significant:
 *
 * 1. external  - an external booking URL short-circuits everything, including
 *                finished, so links already in the wild keep redirecting.
 * 2. finished  - a past event reads as finished, not as closed or sold out.
 * 3. closed    - booking deliberately switched off.
 * 4. misconfigured - booking on but no usable format. Presented to the customer
 *                exactly like closed; distinct only so we can spot it.
 * 5. sold_out  - capacity reached.
 * 6. open      - take the booking.
 */
export function resolveEventBookingState(input: BookingStateInput): EventBookingState {
  const bookingUrl = input.bookingUrl?.trim();
  if (bookingUrl) {
    return { kind: "external", url: bookingUrl };
  }

  if (hasEventFinished(input.endAt, input.now ?? new Date())) {
    return { kind: "finished" };
  }

  if (!input.bookingEnabled) {
    return { kind: "closed" };
  }

  if (!isBookingFormat(input.bookingType)) {
    return { kind: "misconfigured" };
  }

  if (input.totalCapacity != null && input.confirmedTickets >= input.totalCapacity) {
    return { kind: "sold_out" };
  }

  return {
    kind: "open",
    format: input.bookingType,
    isPaid: isPaidBookingFormat(input.bookingType)
  };
}

/** True when the state should be kept out of search results. */
export function shouldNoIndex(state: EventBookingState): boolean {
  return state.kind === "finished" || state.kind === "closed" || state.kind === "misconfigured";
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/__tests__/event-booking-state.test.ts
```

Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-booking-state.ts src/lib/__tests__/event-booking-state.test.ts
git commit -m "feat: add a pure resolver for public event booking state"
```

---

## Task 4: Public event URL builders and slug parsing

**Files:**
- Create: `src/lib/event-slug.ts`
- Create: `src/lib/event-public-url.ts`
- Modify: `src/lib/public-api/events.ts`
- Test: `src/lib/__tests__/event-public-url.test.ts`

Two URL builders with different jobs. `buildEventLandingUrl` always returns a BaronsHub URL, so the API can hand the brand site one stable link that survives a ticketing provider change. `resolveEventCtaUrl` prefers the external booking URL, because that value is a tracked short link carrying UTM attribution and SMS should not add a redirect hop in front of it.

Plus two parsing helpers the landing page needs in Task 5. They live here, not in the page, because a page component cannot be unit tested without mocking `next/navigation` and Supabase, and these rules are worth testing directly.

- [ ] **Step 0: Break the import cycle before it exists**

`event-public-url.ts` needs `buildEventSlug`, which currently lives in `src/lib/public-api/events.ts`. Task 8 then makes `public-api/events.ts` import from `event-public-url.ts`. That is a cycle. Move the slug helpers down into a leaf module first.

Create `src/lib/event-slug.ts` and move `slugify` and `buildEventSlug` into it verbatim from `src/lib/public-api/events.ts:122-133`:

```ts
/**
 * Slug helpers, kept in a leaf module so both the public API serialiser and the
 * public URL builder can use them without importing each other.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function buildEventSlug(event: { id: string; title: string; seoSlug?: string | null }): string {
  const slugBase = typeof event.seoSlug === "string" && event.seoSlug.trim().length ? event.seoSlug : event.title;
  const base = slugify(slugBase) || "event";
  return `${base}--${event.id}`;
}
```

In `src/lib/public-api/events.ts`, delete both function bodies and re-export them so the module's public surface is unchanged (`src/lib/public-api/__tests__/events.test.ts` imports both from there, and that import must keep working):

```ts
import { buildEventSlug, slugify } from "@/lib/event-slug";

export { buildEventSlug, slugify };
```

Run the existing suite to prove the move changed nothing:

```bash
npx vitest run src/lib/public-api/__tests__/events.test.ts
```

Expected: PASS, unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/event-public-url.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import {
  buildEventLandingUrl,
  canonicalEventPath,
  parseEventIdFromSlug,
  resolveEventCtaUrl
} from "../event-public-url";
import { buildEventSlug } from "@/lib/event-slug";

const EVENT_ID = "aaaaaaa1-0000-4000-8000-000000000001";

describe("buildEventLandingUrl", () => {
  it("uses the seo slug when the event has one", () => {
    expect(
      buildEventLandingUrl({ id: EVENT_ID, title: "Jazz Night", seoSlug: "jazz-night-2026-03-20" })
    ).toBe("https://l.baronspubs.com/jazz-night-2026-03-20");
  });

  it("falls back to an id-suffixed slug when there is none", () => {
    expect(buildEventLandingUrl({ id: EVENT_ID, title: "Jazz Night", seoSlug: null }))
      .toBe(`https://l.baronspubs.com/jazz-night--${EVENT_ID}`);
  });

  it("treats a blank seo slug as absent", () => {
    expect(buildEventLandingUrl({ id: EVENT_ID, title: "Jazz Night", seoSlug: "   " }))
      .toBe(`https://l.baronspubs.com/jazz-night--${EVENT_ID}`);
  });

  it("produces a fallback path identical to the public api slug", () => {
    const url = buildEventLandingUrl({ id: EVENT_ID, title: "City Tap Jazz Brunch", seoSlug: null });
    const apiSlug = buildEventSlug({ id: EVENT_ID, title: "City Tap Jazz Brunch" });
    expect(url).toBe(`https://l.baronspubs.com/${apiSlug}`);
  });

  it("percent-encodes an awkward slug", () => {
    expect(buildEventLandingUrl({ id: EVENT_ID, title: "x", seoSlug: "café night" }))
      .toBe("https://l.baronspubs.com/caf%C3%A9%20night");
  });

  it("never returns an empty path", () => {
    const url = buildEventLandingUrl({ id: EVENT_ID, title: "   ", seoSlug: null });
    expect(url).toBe(`https://l.baronspubs.com/event--${EVENT_ID}`);
  });
});

describe("resolveEventCtaUrl", () => {
  it("prefers the external booking url", () => {
    expect(
      resolveEventCtaUrl({
        id: EVENT_ID,
        title: "Jazz Night",
        seoSlug: "jazz-night-2026-03-20",
        bookingUrl: "https://l.baronspubs.com/1a2b3c4d"
      })
    ).toBe("https://l.baronspubs.com/1a2b3c4d");
  });

  it("falls back to the landing url when there is no booking url", () => {
    expect(
      resolveEventCtaUrl({ id: EVENT_ID, title: "Jazz Night", seoSlug: "jazz-night-2026-03-20", bookingUrl: null })
    ).toBe("https://l.baronspubs.com/jazz-night-2026-03-20");
  });

  it("falls back through to the id-suffixed url when nothing is set", () => {
    expect(resolveEventCtaUrl({ id: EVENT_ID, title: "Jazz Night", seoSlug: null, bookingUrl: "  " }))
      .toBe(`https://l.baronspubs.com/jazz-night--${EVENT_ID}`);
  });
});

describe("parseEventIdFromSlug", () => {
  it("extracts the id from the suffixed form", () => {
    expect(parseEventIdFromSlug(`jazz-night--${EVENT_ID}`)).toBe(EVENT_ID);
  });

  it("extracts the id when the prefix contains double hyphens of its own", () => {
    expect(parseEventIdFromSlug(`a--b--c--${EVENT_ID}`)).toBe(EVENT_ID);
  });

  it("accepts an uppercase id", () => {
    expect(parseEventIdFromSlug(`jazz-night--${EVENT_ID.toUpperCase()}`)).toBe(EVENT_ID.toUpperCase());
  });

  it("returns null for an ordinary slug", () => {
    expect(parseEventIdFromSlug("jazz-night-2026-03-20")).toBeNull();
  });

  it("returns null for a malformed uuid", () => {
    expect(parseEventIdFromSlug("jazz-night--not-a-uuid")).toBeNull();
  });

  it("returns null when the uuid is not at the end", () => {
    expect(parseEventIdFromSlug(`jazz--${EVENT_ID}--extra`)).toBeNull();
  });

  it("returns null for a bare uuid with no separator", () => {
    expect(parseEventIdFromSlug(EVENT_ID)).toBeNull();
  });
});

describe("canonicalEventPath", () => {
  it("omits the /l prefix on the short link host", () => {
    expect(canonicalEventPath("jazz-night-2026-03-20", "l.baronspubs.com"))
      .toBe("/jazz-night-2026-03-20");
  });

  it("keeps the /l prefix on any other host", () => {
    expect(canonicalEventPath("jazz-night-2026-03-20", "localhost:3000"))
      .toBe("/l/jazz-night-2026-03-20");
  });

  it("keeps the /l prefix when the host header is missing", () => {
    expect(canonicalEventPath("jazz-night-2026-03-20", null)).toBe("/l/jazz-night-2026-03-20");
  });

  it("ignores host casing and a port", () => {
    expect(canonicalEventPath("jazz", "L.BaronsPubs.com:443")).toBe("/jazz");
  });

  it("encodes an awkward slug", () => {
    expect(canonicalEventPath("café night", "l.baronspubs.com")).toBe("/caf%C3%A9%20night");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/__tests__/event-public-url.test.ts
```

Expected: FAIL, "Failed to resolve import ../event-public-url".

- [ ] **Step 3: Implement**

Create `src/lib/event-public-url.ts`:

```ts
import { SHORT_LINK_BASE_URL, SHORT_LINK_HOST } from "@/lib/short-link-config";
import { buildEventSlug } from "@/lib/event-slug";

/** Matches the `--<uuid>` tail of the id-suffixed URL form. */
const EVENT_ID_SUFFIX_PATTERN =
  /--([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export type EventUrlInput = {
  id: string;
  title: string;
  seoSlug: string | null;
};

/**
 * The BaronsHub landing page URL for an event. Always resolvable.
 *
 * When the event has no seo_slug we fall back to the id-suffixed form, which
 * the /l/[slug] route resolves by id. That is what lets us guarantee a URL for
 * every event without writing a seo_slug to any existing row: doing so would
 * change PublicEvent.slug underneath the external brand site.
 *
 * The fallback deliberately reuses buildEventSlug so this path is always
 * byte-identical to PublicEvent.slug.
 */
export function buildEventLandingUrl(event: EventUrlInput): string {
  const slug = event.seoSlug?.trim();
  const path = slug && slug.length ? slug : buildEventSlug({ id: event.id, title: event.title });
  return `${SHORT_LINK_BASE_URL}${encodeURIComponent(path).replace(/%2F/gi, "/")}`;
}

/**
 * The link to put in front of a customer: SMS, QR codes, campaign copy.
 *
 * Prefers the external booking URL because that value is already a tracked
 * short link carrying UTM attribution, and routing through our landing page
 * would add a redirect hop for no gain. Never returns null.
 */
export function resolveEventCtaUrl(event: EventUrlInput & { bookingUrl: string | null }): string {
  const bookingUrl = event.bookingUrl?.trim();
  if (bookingUrl) return bookingUrl;
  return buildEventLandingUrl(event);
}

/**
 * Pull the event id out of a `<anything>--<uuid>` path segment.
 *
 * Returns null for an ordinary slug, so the caller can try the slug lookup
 * first and only fall through to an id lookup when this matches.
 */
export function parseEventIdFromSlug(slug: string): string | null {
  return slug.match(EVENT_ID_SUFFIX_PATTERN)?.[1] ?? null;
}

/**
 * The canonical path for an event on the host the request arrived on.
 *
 * On the short link host, middleware rewrites `/<slug>` to `/l/<slug>`, so a
 * redirect to `/l/<slug>` from that host would be rewritten again to
 * `/l/l/<slug>` and 404. Deriving from the request host also keeps local dev on
 * localhost rather than bouncing to production, which building from
 * SHORT_LINK_HOST would do: it defaults to l.baronspubs.com and is unset in
 * .env.local.
 */
export function canonicalEventPath(slug: string, host: string | null): string {
  const normalisedHost = host?.toLowerCase().replace(/:\d+$/, "") ?? "";
  const encoded = encodeURIComponent(slug);
  return normalisedHost === SHORT_LINK_HOST.toLowerCase() ? `/${encoded}` : `/l/${encoded}`;
}
```

`buildEventSlug` already defaults a blank title to `"event"` (now `src/lib/event-slug.ts`), which is what makes the "never returns an empty path" test pass.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/__tests__/event-public-url.test.ts
```

Expected: PASS, 21 tests.

- [ ] **Step 5: Confirm the slug move broke nothing**

```bash
npx vitest run src/lib src/actions src/app
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/event-slug.ts src/lib/event-public-url.ts src/lib/public-api/events.ts src/lib/__tests__/event-public-url.test.ts
git commit -m "feat: add always-resolvable public event url builders"
```

---

## Task 5: Resolve the landing page by slug or by id

**Files:**
- Modify: `src/app/l/[slug]/page.tsx:56-146`

The page currently looks up by `seo_slug` only. After this task it also resolves the `--<uuid>` form and canonicalises.

- [ ] **Step 1: Extend the row type and select**

In `src/app/l/[slug]/page.tsx`, add `end_at` to the `EventRow` type after `start_at: string;`:

```ts
  end_at: string;
```

Add `end_at` to the select string in `getEventBySlug` (insert after `start_at,`):

```ts
      "id, title, public_title, public_teaser, public_description, public_highlights, event_image_path, start_at, end_at, seo_slug, booking_enabled, booking_notes_enabled, booking_type, booking_url, ticket_price, total_capacity, max_tickets_per_booking, status, venue:venues!events_venue_id_fkey(id, name, is_internal)"
```

And add to the returned object, after `start_at: raw.start_at as string,`:

```ts
    end_at: raw.end_at as string,
```

- [ ] **Step 2: Extract the row mapper and add id lookup**

Still in `src/app/l/[slug]/page.tsx`, replace `getEventBySlug` with the following. The visibility filters (`deleted_at`, status, internal venue) are identical on both paths: an event must not become reachable just because someone used the id form.

```ts
const EVENT_SELECT =
  "id, title, public_title, public_teaser, public_description, public_highlights, event_image_path, start_at, end_at, seo_slug, booking_enabled, booking_notes_enabled, booking_type, booking_url, ticket_price, total_capacity, max_tickets_per_booking, status, venue:venues!events_venue_id_fkey(id, name, is_internal)";

/** Shape the raw Supabase row into EventRow, or null if it is not publicly visible. */
function mapEventRow(data: unknown): EventRow | null {
  if (!data) return null;
  const raw = data as Record<string, unknown>;
  const venueRaw = raw.venue;
  const venue = Array.isArray(venueRaw)
    ? (venueRaw[0] as { id: string; name: string; is_internal?: boolean } | undefined) ?? null
    : (venueRaw as { id: string; name: string; is_internal?: boolean } | null) ?? null;

  if (venue?.is_internal) return null;

  return {
    id: raw.id as string,
    title: raw.title as string,
    public_title: typeof raw.public_title === "string" ? normaliseWebsiteTimeText(raw.public_title) : null,
    public_teaser: typeof raw.public_teaser === "string" ? normaliseWebsiteTimeText(raw.public_teaser) : null,
    public_description:
      typeof raw.public_description === "string" ? normaliseWebsiteTimeText(raw.public_description) : null,
    public_highlights: Array.isArray(raw.public_highlights)
      ? (raw.public_highlights as string[]).map(normaliseWebsiteTimeText)
      : null,
    event_image_path: (raw.event_image_path as string | null) ?? null,
    start_at: raw.start_at as string,
    end_at: raw.end_at as string,
    seo_slug: (raw.seo_slug as string | null) ?? null,
    booking_enabled: raw.booking_enabled as boolean,
    booking_notes_enabled: raw.booking_notes_enabled as boolean,
    booking_type: (raw.booking_type as string | null) ?? null,
    booking_url: (raw.booking_url as string | null) ?? null,
    ticket_price: (raw.ticket_price as number | null) ?? null,
    total_capacity: (raw.total_capacity as number | null) ?? null,
    max_tickets_per_booking: (raw.max_tickets_per_booking as number) ?? 10,
    status: raw.status as string,
    venue,
  };
}

/**
 * Resolve a public event from a URL path segment.
 *
 * Tries the seo_slug first, then the id-suffixed form (`anything--<uuid>`)
 * that PublicEvent.slug already publishes. The id form is what guarantees a
 * working URL for events that have no slug, and keeps old links alive when
 * somebody edits a slug.
 *
 * Uses the service-role client so we control visibility here rather than
 * through RLS: not deleted, approved or completed, venue not internal.
 */
async function getEventBySlug(slug: string): Promise<EventRow | null> {
  const db = createSupabaseAdminClient();

  const bySlug = await db
    .from("events")
    .select(EVENT_SELECT)
    .eq("seo_slug", slug)
    .is("deleted_at", null)
    .in("status", ["approved", "completed"])
    .maybeSingle();

  if (bySlug.error) {
    console.error("getEventBySlug error:", bySlug.error);
    return null;
  }
  if (bySlug.data) return mapEventRow(bySlug.data);

  const eventId = parseEventIdFromSlug(slug);
  if (!eventId) return null;

  const byId = await db
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", eventId)
    .is("deleted_at", null)
    .in("status", ["approved", "completed"])
    .maybeSingle();

  if (byId.error) {
    console.error("getEventById error:", byId.error);
    return null;
  }
  return mapEventRow(byId.data);
}
```

- [ ] **Step 3: Import the tested helpers**

Add at the top of the file:

```ts
import { buildEventLandingUrl, canonicalEventPath, parseEventIdFromSlug } from "@/lib/event-public-url";
```

`buildEventLandingUrl` is used for the canonical tag in Task 6. Both parsing helpers are unit tested in Task 4, which is why they live in `event-public-url.ts` rather than in this page.

- [ ] **Step 4: Redirect the id form to the canonical slug**

In `EventLandingPage`, replace the current guard block (lines 132-146) with:

```ts
export default async function EventLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);

  if (!event) {
    notFound();
  }

  const headersList = await headers();
  const host = headersList.get("host");

  // Reached via the id-suffixed form but the event has a real slug: send the
  // customer to the pretty URL and let search engines follow the equity.
  if (event.seo_slug && event.seo_slug !== slug) {
    permanentRedirect(canonicalEventPath(event.seo_slug, host));
  }
```

Note the `!event.booking_enabled` condition is gone from the 404. That is Task 6's job to render, and it is deliberate.

The existing `const headersList = await headers();` and `const nonce = ...` further down the function must now be deleted, since `headersList` is defined above. Keep `const nonce = headersList.get("x-nonce") ?? undefined;` where the state is assembled.

- [ ] **Step 5: Type check**

```bash
npm run typecheck
```

Expected: PASS. If it complains that `permanentRedirect` is unused or `event.booking_url` is now unreachable, that is because Task 6 has not landed yet. It is acceptable for the page to still contain the old `if (event.booking_url) permanentRedirect(...)` block at this point; leave it in place until Task 6 replaces it.

- [ ] **Step 6: Commit**

```bash
git add src/app/l/[slug]/page.tsx
git commit -m "feat: resolve event landing pages by slug or id-suffixed url"
```

---

## Task 6: Render every public event, with the booking area driven by state

**Files:**
- Create: `src/app/l/[slug]/BookingUnavailableNotice.tsx`
- Modify: `src/app/l/[slug]/page.tsx`

- [ ] **Step 1: Create the notice component**

Create `src/app/l/[slug]/BookingUnavailableNotice.tsx`:

```tsx
/**
 * Shown in place of the booking form when an event takes no bookings.
 *
 * Deliberately carries no call to action and no colour-only signal: the text
 * itself states the situation.
 */
export function BookingUnavailableNotice({ message }: { message: string }) {
  return (
    <div className="rounded-[8px] bg-[var(--paper)] border border-[var(--hair)] p-6 text-center shadow-card">
      <p className="text-[var(--slate)] font-medium">{message}</p>
    </div>
  );
}
```

That mirrors the markup `BookingForm` already uses for its sold-out state (`src/app/l/[slug]/BookingForm.tsx:96-104`), so the page looks consistent across states.

- [ ] **Step 2: Wire the state into the page**

In `src/app/l/[slug]/page.tsx`, add imports:

```ts
import { resolveEventBookingState, shouldNoIndex } from "@/lib/event-booking-state";
import { BookingUnavailableNotice } from "./BookingUnavailableNotice";
```

Remove the now-unused `isBookingFormat` and `isPaidBookingFormat` imports if nothing else in the file uses them.

Replace everything from the old external-URL redirect down to the end of the sold-out calculation with:

```ts
  const confirmedCount = await getConfirmedTicketCount(event.id);
  const bookingState = resolveEventBookingState({
    bookingUrl: event.booking_url,
    bookingEnabled: event.booking_enabled,
    bookingType: event.booking_type,
    endAt: event.end_at,
    totalCapacity: event.total_capacity,
    confirmedTickets: confirmedCount
  });

  // An external booking link short-circuits the local flow.
  // permanentRedirect issues an HTTP 308 - search engines forward link equity
  // to the destination, browsers preserve method, and the slug remains a
  // shareable handle should the URL ever be cleared.
  if (bookingState.kind === "external") {
    permanentRedirect(bookingState.url);
  }
```

Delete the old `bookingFormat`, `isPaidInAppBooking` and `isSoldOut` locals: the state carries all of it.

- [ ] **Step 3: Render by state**

Replace the booking form block at the bottom of the JSX (currently lines 280-292) with:

```tsx
          {/* Booking area - what shows here is decided by the event's own rules */}
          <div className="mt-auto">
            {bookingState.kind === "open" ? (
              <BookingForm
                eventId={event.id}
                maxTickets={event.max_tickets_per_booking}
                isSoldOut={false}
                bookingType={bookingState.format}
                isPaidBooking={bookingState.isPaid}
                ticketPrice={event.ticket_price}
                bookingNotesEnabled={event.booking_notes_enabled}
                nonce={nonce}
              />
            ) : (
              <BookingUnavailableNotice message={BOOKING_STATE_MESSAGES[bookingState.kind]} />
            )}
          </div>
```

Add the message map near the top of the file, below the imports:

```ts
/**
 * Customer-facing copy per non-bookable state. "misconfigured" reads exactly
 * like "closed" on purpose: an event with booking switched on but no format
 * set is our data problem, not something to explain to a customer.
 */
const BOOKING_STATE_MESSAGES: Record<"finished" | "closed" | "misconfigured" | "sold_out", string> = {
  finished: "This event has finished.",
  closed: "No booking needed, just come along.",
  misconfigured: "No booking needed, just come along.",
  sold_out: "Sorry, this event is fully booked."
};
```

`sold_out` keeps the exact wording `BookingForm` used, so nothing regresses for existing bookable events.

- [ ] **Step 4: Add robots metadata**

In `generateMetadata`, after `const imageUrl = buildImageUrl(event.event_image_path);`, add:

```ts
  // Non-bookable pages duplicate the main Barons website's own event pages,
  // so keep them out of the index while still following their links.
  const state = resolveEventBookingState({
    bookingUrl: event.booking_url,
    bookingEnabled: event.booking_enabled,
    bookingType: event.booking_type,
    endAt: event.end_at,
    totalCapacity: null,
    confirmedTickets: 0
  });
```

and add to the returned metadata object:

```ts
    robots: shouldNoIndex(state) ? { index: false, follow: true } : undefined,
    alternates: {
      // Self-referencing canonical so the id-suffixed form never competes with
      // the slug form in search results.
      canonical: buildEventLandingUrl({ id: event.id, title: event.title, seoSlug: event.seo_slug })
    },
```

Capacity is passed as null here on purpose: a sold-out event stays indexable, and `generateMetadata` should not pay for a ticket-count query.

The canonical is built from `SHORT_LINK_BASE_URL`, not the request host, which is correct and deliberate: a canonical must be the one true public address, whereas a redirect must stay on the host the request arrived on. Those are genuinely different needs, which is why Task 4 has two separate functions.

- [ ] **Step 5: Type check and lint**

```bash
npm run typecheck && npm run lint
```

Expected: PASS, zero warnings.

- [ ] **Step 6: Run the whole suite**

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/l/[slug]/page.tsx src/app/l/[slug]/BookingUnavailableNotice.tsx
git commit -m "feat: show the event landing page for every public event"
```

---

## Task 7: SMS campaigns use the shared CTA resolver

**Files:**
- Modify: `src/lib/sms-campaign.ts:186-196`
- Test: `src/lib/__tests__/sms-campaign.test.ts`

Today the campaign driver silently abandons a send when an event has neither a booking URL nor a slug (`console.warn("Campaign link unavailable")` then `return false`). With a guaranteed URL that branch is dead.

- [ ] **Step 1: Read the existing test file first**

```bash
npx vitest run src/lib/__tests__/sms-campaign.test.ts
```

Confirm it passes before you change anything, and read it to see how `SmsCampaignEvent` objects are built there. The event object needs `id`, `title`, `bookingUrl` and `seoSlug` for the resolver.

- [ ] **Step 2: Write the failing test**

Add to `src/lib/__tests__/sms-campaign.test.ts`, matching the file's existing setup style for building a campaign event:

```ts
  it("still sends a link when the event has no booking url and no slug", async () => {
    // An event with neither used to abandon the send. The id-suffixed landing
    // URL means there is always something to link to.
    const event = buildCampaignEvent({ bookingUrl: null, seoSlug: null });
    const sent = await sendCampaignMessage({ event, customer, wave, confirmedTickets: 0 });
    expect(sent).toBe(true);
  });
```

If the existing file has no `buildCampaignEvent` helper or does not export `sendCampaignMessage`, test `resolveEventCtaUrl` integration at the boundary instead: assert that the message body built for such an event contains `l.baronspubs.com/` and the event id. Do not export a private function purely to test it.

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run src/lib/__tests__/sms-campaign.test.ts
```

Expected: FAIL, the send returns false.

- [ ] **Step 4: Implement**

In `src/lib/sms-campaign.ts`, add the import:

```ts
import { resolveEventCtaUrl } from "@/lib/event-public-url";
```

Replace lines 187-196 with:

```ts
  const linkDestination =
    ctaMode === "link"
      ? resolveEventCtaUrl({
          id: event.id,
          title: event.title,
          seoSlug: event.seoSlug,
          bookingUrl: event.bookingUrl
        })
      : null;
```

Delete the `if (ctaMode === "link" && !linkDestination) { ... return false; }` block entirely. The resolver never returns null, so the branch is unreachable.

If `SmsCampaignEvent` (declared around `src/lib/sms-campaign.ts:29`) has no `title` field, add `title: string;` to the type and populate it in the caller at `src/app/api/cron/sms-booking-driver/route.ts:80` by adding `title: row.title as string,` and adding `title` to the select on line 34.

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run src/lib/__tests__/sms-campaign.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sms-campaign.ts src/lib/__tests__/sms-campaign.test.ts src/app/api/cron/sms-booking-driver/route.ts
git commit -m "feat: sms campaigns always have an event link to send"
```

---

## Task 8: Additive public API fields, with a contract lock

**Files:**
- Modify: `src/lib/public-api/events.ts`
- Test: `src/lib/public-api/__tests__/events.test.ts`

- [ ] **Step 1: Write the contract-lock test first**

This is the most important test in the change. Add to `src/lib/public-api/__tests__/events.test.ts`:

```ts
  it("locks the existing contract: no field changes value for an event with no slug", () => {
    // Regression guard for the external brand site. PublicEvent.slug is derived
    // from seo_slug when present, so anything that writes a slug to an existing
    // row would silently change this value. If this test fails, the change
    // breaks somebody else's site.
    const event = toPublicEvent({
      id: "aaaaaaa1-0000-4000-8000-000000000009",
      title: "Quiz Night",
      public_title: null,
      public_teaser: null,
      public_description: null,
      public_highlights: null,
      booking_type: null,
      ticket_price: null,
      check_in_cutoff_minutes: null,
      age_policy: null,
      accessibility_notes: null,
      cancellation_window_hours: null,
      terms_and_conditions: null,
      booking_url: null,
      booking_enabled: false,
      event_image_path: null,
      seo_title: null,
      seo_description: null,
      seo_slug: null,
      event_type: "Quiz Night",
      status: "approved",
      start_at: "2026-03-20T19:00:00.000Z",
      end_at: "2026-03-20T22:00:00.000Z",
      venue_space: "Main Bar",
      wet_promo: null,
      food_promo: null,
      updated_at: "2026-03-01T12:00:00.000Z",
      venue: {
        id: "9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7",
        name: "Barons Riverside",
        address: "12 River Walk, Guildford",
        capacity: 180
      }
    });

    expect(event.slug).toBe("quiz-night--aaaaaaa1-0000-4000-8000-000000000009");
    expect(event.seoSlug).toBeNull();
    expect(event.bookingUrl).toBeNull();
    expect(event.bookingEnabled).toBe(false);
    expect(event.bookingPageUrl).toBeNull();
  });

  it("adds eventPageUrl and bookingAvailability without touching anything else", () => {
    const base = {
      id: "aaaaaaa1-0000-4000-8000-000000000010",
      title: "Quiz Night",
      public_title: null,
      public_teaser: null,
      public_description: null,
      public_highlights: null,
      booking_type: null,
      ticket_price: null,
      check_in_cutoff_minutes: null,
      age_policy: null,
      accessibility_notes: null,
      cancellation_window_hours: null,
      terms_and_conditions: null,
      booking_url: null,
      booking_enabled: false,
      event_image_path: null,
      seo_title: null,
      seo_description: null,
      seo_slug: null,
      event_type: "Quiz Night",
      status: "approved" as const,
      start_at: "2026-03-20T19:00:00.000Z",
      end_at: "2026-03-20T22:00:00.000Z",
      venue_space: "Main Bar",
      wet_promo: null,
      food_promo: null,
      updated_at: "2026-03-01T12:00:00.000Z",
      venue: {
        id: "9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7",
        name: "Barons Riverside",
        address: "12 River Walk, Guildford",
        capacity: 180
      }
    };

    const none = toPublicEvent(base);
    expect(none.bookingAvailability).toBe("none");
    expect(none.eventPageUrl).toBe(
      "https://l.baronspubs.com/quiz-night--aaaaaaa1-0000-4000-8000-000000000010"
    );

    const external = toPublicEvent({ ...base, booking_url: "https://example.com/book" });
    expect(external.bookingAvailability).toBe("external");
    // eventPageUrl is always ours, even when an external booking url exists,
    // so the brand site holds one link that survives a provider change.
    expect(external.eventPageUrl).toBe(
      "https://l.baronspubs.com/quiz-night--aaaaaaa1-0000-4000-8000-000000000010"
    );

    const inApp = toPublicEvent({
      ...base,
      booking_enabled: true,
      booking_type: "free_seated",
      seo_slug: "quiz-night-2026-03-20"
    });
    expect(inApp.bookingAvailability).toBe("in_app");
    expect(inApp.eventPageUrl).toBe("https://l.baronspubs.com/quiz-night-2026-03-20");
    expect(inApp.bookingPageUrl).toBe("https://l.baronspubs.com/quiz-night-2026-03-20");
  });
```

- [ ] **Step 2: Run to verify the new-field test fails**

```bash
npx vitest run src/lib/public-api/__tests__/events.test.ts
```

Expected: the contract-lock test PASSES already (good, it documents current behaviour), the new-field test FAILS on `bookingAvailability` being undefined.

- [ ] **Step 3: Implement**

In `src/lib/public-api/events.ts`, add to the `PublicEvent` type after `bookingPageUrl: string | null;`:

```ts
  /** Always present. The BaronsHub landing page for this event. */
  eventPageUrl: string;
  /** How booking is handled for this event, as configured. */
  bookingAvailability: BookingAvailability;
```

Add above the `PublicEvent` type:

```ts
export type BookingAvailability = "external" | "in_app" | "none";
```

Add the import at the top:

```ts
import { buildEventLandingUrl } from "@/lib/event-public-url";
```

Add a helper beside `buildBookingPageUrl`:

```ts
/**
 * How booking is handled, as configured. Describes setup, not live
 * availability: it does not change as an event sells out or passes, so it stays
 * cache-friendly. The landing page owns live state.
 */
function resolveBookingAvailability(
  bookingUrl: string | null,
  bookingEnabled: boolean,
  bookingType: BookingFormat | null
): BookingAvailability {
  if (bookingUrl) return "external";
  if (bookingEnabled && bookingType) return "in_app";
  return "none";
}
```

In the object returned by `toPublicEvent`, add after `bookingPageUrl: buildBookingPageUrl(seoSlug, bookingEnabled),`:

```ts
    eventPageUrl: buildEventLandingUrl({ id: row.id, title, seoSlug }),
    bookingAvailability: resolveBookingAvailability(bookingUrl, bookingEnabled, bookingType),
```

There is no circular import here because Task 4 Step 0 already moved the slug helpers into the leaf module `src/lib/event-slug.ts`. If you skipped that step, stop and do it now: `event-public-url.ts` importing from `public-api/events.ts` while `public-api/events.ts` imports back is a genuine cycle.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/public-api/__tests__/events.test.ts
```

Expected: PASS, all tests including the pre-existing serialisation test.

- [ ] **Step 5: Run the whole public API suite**

```bash
npx vitest run src/lib/public-api
```

Expected: PASS. If `routes-service-role.test.ts` or `no-calendar-notes.test.ts` snapshot the payload shape, update them for the two additions only.

- [ ] **Step 6: Commit**

```bash
git add src/lib/public-api/events.ts src/lib/public-api/__tests__/events.test.ts
git commit -m "feat: add eventPageUrl and bookingAvailability to the public events api"
```

---

## Task 9: Document the API additions

**Files:**
- Modify: `src/app/api/v1/openapi/route.ts:70-110`
- Modify: `docs/WebsitePublishingAPI.md`

- [ ] **Step 1: Update the OpenAPI schema**

In `src/app/api/v1/openapi/route.ts`, after the `bookingPageUrl` property (line 77) add:

```ts
          eventPageUrl: { type: "string", format: "uri" },
          bookingAvailability: { type: "string", enum: ["external", "in_app", "none"] },
```

And after `"bookingPageUrl",` in the required array (line 108) add:

```ts
          "eventPageUrl",
          "bookingAvailability",
```

- [ ] **Step 2: Update the integration doc**

In `docs/WebsitePublishingAPI.md`, in the type block, after the `bookingPageUrl` line (around line 168) add:

```ts
  eventPageUrl: string; // always present; the BaronsHub event page, which redirects to bookingUrl when one is set
  bookingAvailability: "external" | "in_app" | "none"; // how booking is handled, as configured
```

In the example payload after the `bookingPageUrl` line (around line 208) add:

```json
  "eventPageUrl": "https://l.baronspubs.com/quiz-night-with-elliott-2026-01-06",
  "bookingAvailability": "external",
```

In the field sourcing list after the `bookingPageUrl` line (around line 237) add:

```markdown
- `PublicEvent.eventPageUrl` → computed from `events.seo_slug`, falling back to `<slug>--<id>`; always present
- `PublicEvent.bookingAvailability` → `external` when `events.booking_url` is set, `in_app` when booking is enabled with a booking type, otherwise `none`
```

Then add a new section at the end of the field sourcing block:

```markdown
### Compatibility note (2026-07-23)

`eventPageUrl` and `bookingAvailability` are additions. No existing field changed name, type,
nullability or value. In particular `slug`, `seoSlug` and `bookingPageUrl` are untouched for every
event that already existed.

Every public event now has a working `eventPageUrl`, including events that take no bookings. That
page shows the event detail with no booking controls, so it is safe to link to unconditionally.
Use `bookingAvailability` rather than the presence of `bookingPageUrl` to decide whether to label a
link "Book now" or "More info".
```

- [ ] **Step 3: Verify the OpenAPI route still builds**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/openapi/route.ts docs/WebsitePublishingAPI.md
git commit -m "docs: document eventPageUrl and bookingAvailability for the brand site"
```

---

## Task 10: Full verification

- [ ] **Step 1: Run the pipeline**

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

Expected: all four PASS, lint with zero warnings.

- [ ] **Step 2: Confirm no migration was added**

```bash
git status --short supabase/
```

Expected: empty output apart from the pre-existing `supabase/.temp/cli-latest` change. This plan adds **no** migration and **no** backfill. If a migration appeared, something went wrong: re-read the Critical constraints.

- [ ] **Step 3: Confirm the API contract held**

```bash
npx vitest run src/lib/public-api/__tests__/events.test.ts -t "locks the existing contract"
```

Expected: PASS.

- [ ] **Step 4: Report**

Summarise: which tasks landed, the full pipeline output, and anything skipped with the reason. Do not claim completion without pasting the actual command output.

---

## Manual verification (after deploy to preview)

Not automatable, so it belongs to a human. Pick one event per state from production data and check the preview URL:

1. An event with `booking_url` set: confirm the 308 to the external destination still works.
2. An upcoming event with booking disabled: confirm the detail page renders with "No booking needed, just come along" and no form.
3. A past event: confirm "This event has finished".
4. An event with in-app booking enabled: confirm the form still works end to end, including a real submission.
5. Any event, using the id-suffixed URL: confirm it 308s to the pretty slug URL.
6. An event with no image and no highlights: confirm the layout does not collapse.

Check 2 and 3 on a mobile width as well as desktop.

## Notes for the reviewer

- Complexity 3 (M). No schema change, no migration, no backfill.
- The riskiest single line in this change is `eventPageUrl: buildEventLandingUrl(...)` in `toPublicEvent`. It is additive, but it is on the path of a contract consumed by someone outside the team. The contract-lock test in Task 8 is the guard.
- Task 1 is independently valuable and could be cherry-picked and shipped alone if the rest needs to wait.
