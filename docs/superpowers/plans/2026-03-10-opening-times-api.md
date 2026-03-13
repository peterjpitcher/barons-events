# Opening Times API Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GET /api/v1/opening-times` endpoint that returns resolved, day-by-day opening hours for all venues (or one), with overrides already merged so the consumer never has to calculate effective hours themselves.

**Architecture:** A pure `resolveOpeningTimes()` function added to `src/lib/opening-hours.ts` handles the merge logic (weekly template → override wins). The thin route handler fetches all required data via the service-role Supabase client, passes it to the pure function, and returns the JSON response. This keeps the route handler testable-by-inspection and the merge logic fully unit-testable without any mocking.

**Tech Stack:** Next.js App Router API route, Supabase service-role client, Vitest (unit tests on pure function — no mocking required)

---

## Chunk 1: Pure merge function + tests

### Task 1: Write failing tests for `resolveOpeningTimes`

**Files:**
- Create: `src/lib/public-api/__tests__/opening-times.test.ts`

These tests import `resolveOpeningTimes` from `src/lib/opening-hours.ts` — which doesn't exist yet, so the tests will fail to compile. That's the expected failure state.

- [ ] **Step 1: Create the test file**

```typescript
// src/lib/public-api/__tests__/opening-times.test.ts
import { describe, it, expect } from "vitest";
import { resolveOpeningTimes } from "@/lib/opening-hours";
import type { ServiceTypeRow, OpeningHoursRow, OpeningOverrideRow } from "@/lib/opening-hours";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const ST_BAR: ServiceTypeRow = {
  id: "st-bar",
  name: "Bar",
  display_order: 0,
  created_at: "2026-01-01T00:00:00Z",
};
const ST_KITCHEN: ServiceTypeRow = {
  id: "st-kitchen",
  name: "Kitchen",
  display_order: 1,
  created_at: "2026-01-01T00:00:00Z",
};

const VENUE_1 = { id: "v1", name: "The Fox" };
const VENUE_2 = { id: "v2", name: "The Swan" };

// 2026-03-09 = Monday (DB day_of_week = 0)
// 2026-03-10 = Tuesday (DB day_of_week = 1)
const FROM = "2026-03-09"; // Monday

function makeWeeklyRow(
  venueId: string,
  serviceTypeId: string,
  dayOfWeek: number,
  openTime: string | null,
  closeTime: string | null,
  isClosed = false
): OpeningHoursRow {
  return {
    id: `${venueId}-${serviceTypeId}-${dayOfWeek}`,
    venue_id: venueId,
    service_type_id: serviceTypeId,
    day_of_week: dayOfWeek,
    open_time: openTime,
    close_time: closeTime,
    is_closed: isClosed,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function makeOverride(
  overrideDate: string,
  serviceTypeId: string,
  venueIds: string[],
  openTime: string | null,
  closeTime: string | null,
  isClosed = false,
  note: string | null = null
): OpeningOverrideRow {
  return {
    id: `override-${overrideDate}-${serviceTypeId}`,
    override_date: overrideDate,
    service_type_id: serviceTypeId,
    open_time: openTime,
    close_time: closeTime,
    is_closed: isClosed,
    note,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    venue_ids: venueIds,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveOpeningTimes", () => {
  it("uses the weekly template when no override is present", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00")],
      overrides: [],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const service = result.venues[0].days[0].services[0];
    expect(service.isOpen).toBe(true);
    expect(service.openTime).toBe("11:00");
    expect(service.closeTime).toBe("23:00");
    expect(service.isOverride).toBe(false);
    expect(service.note).toBeNull();
  });

  it("override replaces template for the same date, service type, and venue", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00")],
      overrides: [makeOverride("2026-03-09", "st-bar", ["v1"], "12:00", "22:00")],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const service = result.venues[0].days[0].services[0];
    expect(service.openTime).toBe("12:00");
    expect(service.closeTime).toBe("22:00");
    expect(service.isOverride).toBe(true);
  });

  it("override for one venue does not affect another venue", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [
        makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00"),
        makeWeeklyRow("v2", "st-bar", 0, "11:00", "23:00"),
      ],
      // Override only applies to v1
      overrides: [makeOverride("2026-03-09", "st-bar", ["v1"], "09:00", "18:00")],
      venues: [VENUE_1, VENUE_2],
      from: FROM,
      days: 1,
    });

    const v1Service = result.venues[0].days[0].services[0];
    const v2Service = result.venues[1].days[0].services[0];
    expect(v1Service.isOverride).toBe(true);
    expect(v1Service.openTime).toBe("09:00");
    expect(v2Service.isOverride).toBe(false);
    expect(v2Service.openTime).toBe("11:00");
  });

  it("service type is omitted when neither template nor override exists for a venue", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR, ST_KITCHEN],
      // Only Bar has hours; Kitchen has none
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00")],
      overrides: [],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const services = result.venues[0].days[0].services;
    expect(services).toHaveLength(1);
    expect(services[0].serviceType).toBe("Bar");
  });

  it("is_closed on template produces isOpen: false, isOverride: false", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, null, null, true)],
      overrides: [],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const service = result.venues[0].days[0].services[0];
    expect(service.isOpen).toBe(false);
    expect(service.openTime).toBeNull();
    expect(service.closeTime).toBeNull();
    expect(service.isOverride).toBe(false);
    expect(service.note).toBeNull();
  });

  it("is_closed on override produces isOpen: false, isOverride: true, with note", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00")],
      overrides: [
        makeOverride("2026-03-09", "st-bar", ["v1"], null, null, true, "Deep clean"),
      ],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const service = result.venues[0].days[0].services[0];
    expect(service.isOpen).toBe(false);
    expect(service.isOverride).toBe(true);
    expect(service.note).toBe("Deep clean");
  });

  it("returns correct dayOfWeek label for each date", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [
        makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00"), // Monday
        makeWeeklyRow("v1", "st-bar", 1, "11:00", "23:00"), // Tuesday
      ],
      overrides: [],
      venues: [VENUE_1],
      from: FROM, // 2026-03-09 = Monday
      days: 2,
    });

    expect(result.venues[0].days[0].dayOfWeek).toBe("Monday");
    expect(result.venues[0].days[1].dayOfWeek).toBe("Tuesday");
  });

  it("returns correct from and to dates", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [],
      weeklyHours: [],
      overrides: [],
      venues: [VENUE_1],
      from: "2026-03-09",
      days: 7,
    });

    expect(result.from).toBe("2026-03-09");
    expect(result.to).toBe("2026-03-15");
  });

  it("services are ordered by service type display_order", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR, ST_KITCHEN], // Bar display_order=0, Kitchen=1
      weeklyHours: [
        makeWeeklyRow("v1", "st-kitchen", 0, "12:00", "21:00"),
        makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00"),
      ],
      overrides: [],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const services = result.venues[0].days[0].services;
    expect(services[0].serviceType).toBe("Bar");
    expect(services[1].serviceType).toBe("Kitchen");
  });

  it("override note is null when not set", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [],
      overrides: [makeOverride("2026-03-09", "st-bar", ["v1"], "10:00", "20:00")],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    expect(result.venues[0].days[0].services[0].note).toBeNull();
  });

  it("venueId scoping: only the supplied venue appears in the result", () => {
    // Caller pre-filters the venues array to just the requested venue;
    // this test verifies resolveOpeningTimes honours that scope exactly.
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [
        makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00"),
        makeWeeklyRow("v2", "st-bar", 0, "10:00", "22:00"),
      ],
      overrides: [],
      venues: [VENUE_1], // only VENUE_1 passed in
      from: FROM,
      days: 1,
    });

    expect(result.venues).toHaveLength(1);
    expect(result.venues[0].venueId).toBe("v1");
  });

  it("days=1 produces a single-day result", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00")],
      overrides: [],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    expect(result.venues[0].days).toHaveLength(1);
    expect(result.from).toBe(result.to);
  });
});
```

- [ ] **Step 2: Run to confirm compile failure**

```bash
npm test -- opening-times
```

Expected: fails with "resolveOpeningTimes is not exported from @/lib/opening-hours"

---

**Note on `days` default/cap:** The `days` parameter is validated (default 7, cap 90) in the route handler (Task 3), not in the pure function. The pure function accepts any positive integer and is not responsible for clamping. The smoke tests in Task 3 cover the invalid-`days` → 400 path.

**Note on function signature vs spec:** The design spec described the signature as `resolveOpeningTimes(venueId?, from, to)` as a simplified shorthand. The implementation uses a pure function that accepts pre-fetched data collections. This is intentional: `venueId` scoping happens at the route layer (by pre-filtering the venues array before passing it in), keeping the function free of DB dependencies and fully unit-testable without mocks.

---

### Task 2: Implement `resolveOpeningTimes` in `src/lib/opening-hours.ts`

**Files:**
- Modify: `src/lib/opening-hours.ts` (append at end of file)

- [ ] **Step 1: Append types and function to `src/lib/opening-hours.ts`**

Add the following at the end of the file, after the existing exports:

```typescript
// ─── Public API: resolved opening times ───────────────────────────────────────

export type ResolvedServiceHours = {
  serviceTypeId: string;
  serviceType: string;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  isOverride: boolean;
  note: string | null;
};

export type ResolvedDay = {
  date: string;       // YYYY-MM-DD
  dayOfWeek: string;  // "Monday" … "Sunday"
  services: ResolvedServiceHours[];
};

export type ResolvedVenueHours = {
  venueId: string;
  venueName: string;
  days: ResolvedDay[];
};

export type ResolvedOpeningTimes = {
  from: string;
  to: string;
  venues: ResolvedVenueHours[];
};

// DB day_of_week: 0 = Monday … 6 = Sunday
// JS Date.getUTCDay():  0 = Sunday … 6 = Saturday
const DB_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function jsDayToDbDay(jsUtcDay: number): number {
  return (jsUtcDay + 6) % 7;
}

function buildDateRange(from: string, days: number): string[] {
  const dates: string[] = [];
  const start = new Date(from + "T00:00:00Z");
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Pure function — no DB access. Accepts pre-fetched data and returns the
 * effective opening hours for each venue × day, with overrides applied.
 * Service types with no template and no override for a given venue are omitted.
 */
export function resolveOpeningTimes(params: {
  serviceTypes: ServiceTypeRow[];
  weeklyHours: OpeningHoursRow[];
  overrides: OpeningOverrideRow[];
  venues: { id: string; name: string }[];
  from: string;
  days: number;
}): ResolvedOpeningTimes {
  const { serviceTypes, weeklyHours, overrides, venues, from, days } = params;

  // Index weekly hours: "venueId|serviceTypeId|dayOfWeek" → row
  const weeklyMap = new Map<string, OpeningHoursRow>();
  for (const row of weeklyHours) {
    weeklyMap.set(`${row.venue_id}|${row.service_type_id}|${row.day_of_week}`, row);
  }

  // Index overrides: "date|serviceTypeId|venueId" → row
  const overrideMap = new Map<string, OpeningOverrideRow>();
  for (const override of overrides) {
    for (const venueId of override.venue_ids) {
      overrideMap.set(`${override.override_date}|${override.service_type_id}|${venueId}`, override);
    }
  }

  const dates = buildDateRange(from, days);
  const to = dates[dates.length - 1];

  const resolvedVenues: ResolvedVenueHours[] = venues.map((venue) => {
    const resolvedDays: ResolvedDay[] = dates.map((date) => {
      const jsUtcDay = new Date(date + "T00:00:00Z").getUTCDay();
      const dbDay = jsDayToDbDay(jsUtcDay);

      const services: ResolvedServiceHours[] = [];

      // serviceTypes is already ordered by display_order (from DB query)
      for (const st of serviceTypes) {
        const override = overrideMap.get(`${date}|${st.id}|${venue.id}`);
        const weekly = weeklyMap.get(`${venue.id}|${st.id}|${dbDay}`);

        if (override) {
          services.push({
            serviceTypeId: st.id,
            serviceType: st.name,
            isOpen: !override.is_closed,
            openTime: override.open_time ?? null,
            closeTime: override.close_time ?? null,
            isOverride: true,
            note: override.note ?? null,
          });
        } else if (weekly) {
          services.push({
            serviceTypeId: st.id,
            serviceType: st.name,
            isOpen: !weekly.is_closed,
            openTime: weekly.open_time ?? null,
            closeTime: weekly.close_time ?? null,
            isOverride: false,
            note: null,
          });
        }
        // Neither template nor override → omit
      }

      return { date, dayOfWeek: DB_DAY_NAMES[dbDay], services };
    });

    return { venueId: venue.id, venueName: venue.name, days: resolvedDays };
  });

  return { from, to, venues: resolvedVenues };
}
```

- [ ] **Step 2: Run tests**

```bash
npm test -- opening-times
```

Expected: all tests pass

- [ ] **Step 3: Type-check**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/opening-hours.ts src/lib/public-api/__tests__/opening-times.test.ts
git commit -m "feat: add resolveOpeningTimes pure function with tests"
```

---

## Chunk 2: Route handler + OpenAPI update

### Task 3: Create the route handler

**Files:**
- Create: `src/app/api/v1/opening-times/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
// src/app/api/v1/opening-times/route.ts
import { NextResponse } from "next/server";

import {
  checkApiRateLimit,
  jsonError,
  methodNotAllowed,
  requireWebsiteApiKey,
} from "@/lib/public-api/auth";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { resolveOpeningTimes } from "@/lib/opening-hours";
import type { ServiceTypeRow, OpeningHoursRow, OpeningOverrideRow } from "@/lib/opening-hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns today's date (YYYY-MM-DD) in the Europe/London timezone. */
function todayInLondon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

/** Adds `n` days to a YYYY-MM-DD string and returns the result. */
function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const rateLimitResponse = checkApiRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const authResponse = requireWebsiteApiKey(request);
  if (authResponse) return authResponse;

  // ── Parse query params ──────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get("days");
  const venueIdParam = searchParams.get("venueId");

  let days = DEFAULT_DAYS;
  if (daysParam !== null) {
    const parsed = Number(daysParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DAYS) {
      return jsonError(
        400,
        "invalid_params",
        `'days' must be an integer between 1 and ${MAX_DAYS}`
      );
    }
    days = parsed;
  }

  if (venueIdParam !== null && !UUID_RE.test(venueIdParam)) {
    return jsonError(400, "invalid_params", "'venueId' must be a valid UUID");
  }

  // ── DB client ───────────────────────────────────────────────────────────────
  let supabase;
  try {
    supabase = createSupabaseServiceRoleClient();
  } catch (error) {
    console.error("Public API: Supabase service role client is not configured", error);
    return jsonError(503, "not_configured", "Supabase service role is not configured");
  }

  const from = todayInLondon();
  const to = addDays(from, days - 1);

  // ── Fetch data in parallel ─────────────────────────────────────────────────
  const venuesQuery = supabase
    .from("venues")
    .select("id, name")
    .order("name", { ascending: true });

  const [venuesResult, serviceTypesResult, weeklyHoursResult, overridesResult] =
    await Promise.all([
      venueIdParam ? venuesQuery.eq("id", venueIdParam) : venuesQuery,
      supabase
        .from("venue_service_types")
        .select("id, name, display_order, created_at")
        .order("display_order")
        .order("name"),
      venueIdParam
        ? supabase
            .from("venue_opening_hours")
            .select("*")
            .eq("venue_id", venueIdParam)
        : supabase.from("venue_opening_hours").select("*"),
      supabase
        .from("venue_opening_overrides")
        .select("*, venue_opening_override_venues(venue_id)")
        .gte("override_date", from)
        .lte("override_date", to)
        .order("override_date"),
    ]);

  if (venuesResult.error) {
    console.error("Public API /opening-times: venues query failed", venuesResult.error);
    return jsonError(500, "internal_error", "Unable to load venues");
  }
  if (venueIdParam && venuesResult.data.length === 0) {
    return jsonError(404, "not_found", "Venue not found");
  }
  if (serviceTypesResult.error) {
    console.error("Public API /opening-times: service types query failed", serviceTypesResult.error);
    return jsonError(500, "internal_error", "Unable to load service types");
  }
  if (weeklyHoursResult.error) {
    console.error("Public API /opening-times: opening hours query failed", weeklyHoursResult.error);
    return jsonError(500, "internal_error", "Unable to load opening hours");
  }
  if (overridesResult.error) {
    console.error("Public API /opening-times: overrides query failed", overridesResult.error);
    return jsonError(500, "internal_error", "Unable to load opening overrides");
  }

  // Flatten override junction table rows into venue_ids[]
  const overrides: OpeningOverrideRow[] = (overridesResult.data ?? []).map((row: any) => ({
    id: row.id,
    override_date: row.override_date,
    service_type_id: row.service_type_id,
    open_time: row.open_time,
    close_time: row.close_time,
    is_closed: row.is_closed,
    note: row.note ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    venue_ids: (row.venue_opening_override_venues ?? []).map((v: any) => v.venue_id as string),
  }));

  // When filtering to one venue, restrict overrides to those that include it
  const filteredOverrides = venueIdParam
    ? overrides.filter((o) => o.venue_ids.includes(venueIdParam))
    : overrides;

  const result = resolveOpeningTimes({
    serviceTypes: serviceTypesResult.data as ServiceTypeRow[],
    weeklyHours: weeklyHoursResult.data as OpeningHoursRow[],
    overrides: filteredOverrides,
    venues: venuesResult.data,
    from,
    days,
  });

  return NextResponse.json(result, {
    headers: {
      "cache-control": "max-age=300, stale-while-revalidate=3600",
    },
  });
}

export function POST() { return methodNotAllowed(); }
export function PUT() { return methodNotAllowed(); }
export function PATCH() { return methodNotAllowed(); }
export function DELETE() { return methodNotAllowed(); }
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: no warnings

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: successful build

- [ ] **Step 5: Smoke test manually**

Start the dev server (`npm run dev`) and test with curl, substituting your actual API key:

```bash
# Default: 7 days, all venues
curl -H "Authorization: Bearer <BARONSHUB_WEBSITE_API_KEY>" \
  "http://localhost:3000/api/v1/opening-times"

# 14 days
curl -H "Authorization: Bearer <BARONSHUB_WEBSITE_API_KEY>" \
  "http://localhost:3000/api/v1/opening-times?days=14"

# Single venue
curl -H "Authorization: Bearer <BARONSHUB_WEBSITE_API_KEY>" \
  "http://localhost:3000/api/v1/opening-times?venueId=<a-real-uuid>"

# Invalid days → expect 400
curl -H "Authorization: Bearer <BARONSHUB_WEBSITE_API_KEY>" \
  "http://localhost:3000/api/v1/opening-times?days=999"

# Missing auth → expect 401
curl "http://localhost:3000/api/v1/opening-times"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/opening-times/route.ts
git commit -m "feat: add GET /api/v1/opening-times endpoint"
```

---

### Task 4: Update the OpenAPI spec

**Files:**
- Modify: `src/app/api/v1/openapi/route.ts`

Find the `paths` object in the OpenAPI spec response and add the new path. The exact location will be the object containing `/venues`, `/events`, etc. Add the following entry:

- [ ] **Step 1: Add the opening-times path to the OpenAPI spec**

Add this entry alongside the existing paths:

```typescript
"/opening-times": {
  get: {
    operationId: "getOpeningTimes",
    summary: "Get resolved opening times",
    description:
      "Returns day-by-day effective opening times for all venues (or one venue), with date-specific overrides already applied. The consumer receives the final hours for each day and never needs to merge templates with exceptions.",
    parameters: [
      {
        name: "days",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 90, default: 7 },
        description: "Number of days to return, starting from today (Europe/London). Defaults to 7, maximum 90.",
      },
      {
        name: "venueId",
        in: "query",
        required: false,
        schema: { type: "string", format: "uuid" },
        description: "Filter results to a single venue. Omit to receive all venues.",
      },
    ],
    responses: {
      "200": {
        description: "Resolved opening times",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                from: { type: "string", format: "date", example: "2026-03-10" },
                to: { type: "string", format: "date", example: "2026-03-16" },
                venues: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      venueId: { type: "string", format: "uuid" },
                      venueName: { type: "string" },
                      days: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            date: { type: "string", format: "date" },
                            dayOfWeek: {
                              type: "string",
                              enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
                            },
                            services: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  serviceTypeId: { type: "string", format: "uuid" },
                                  serviceType: { type: "string", example: "Bar" },
                                  isOpen: { type: "boolean" },
                                  openTime: { type: "string", nullable: true, example: "11:00" },
                                  closeTime: { type: "string", nullable: true, example: "23:00" },
                                  isOverride: {
                                    type: "boolean",
                                    description: "True when these hours come from a date-specific override rather than the weekly template.",
                                  },
                                  note: {
                                    type: "string",
                                    nullable: true,
                                    description: "Optional note from the override record explaining the change.",
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "400": { description: "Invalid query parameters" },
      "401": { description: "Missing or invalid API key" },
      "404": { description: "Venue not found (when venueId supplied)" },
      "429": { description: "Rate limit exceeded" },
      "500": { description: "Database error" },
      "503": { description: "Supabase service role not configured" },
    },
    security: [{ bearerAuth: [] }],
  },
},
```

- [ ] **Step 2: Verify the OpenAPI route still returns valid JSON**

```bash
curl -H "Authorization: Bearer <BARONSHUB_WEBSITE_API_KEY>" \
  "http://localhost:3000/api/v1/openapi" | python3 -m json.tool > /dev/null && echo "Valid JSON"
```

Expected: `Valid JSON`

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/openapi/route.ts
git commit -m "docs: add /api/v1/opening-times to OpenAPI spec"
```
