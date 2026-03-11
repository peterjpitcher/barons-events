# Planning Inspiration Items Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface UK hospitality-relevant occasions up to 180 days ahead as inline inspiration cards on the planning board, with one-click convert to planning item and permanent organisation-wide hide.

**Architecture:** A monthly Vercel cron (+ admin manual trigger) generates inspiration items from three sources — UK gov.uk bank holidays API, algorithmically computed seasonal/floating dates, and OpenAI for sporting fixtures — stored in two new DB tables. The planning board queries these items and renders them as visually distinct amber dashed-border cards inline in the existing time buckets.

**Tech Stack:** Next.js 15 App Router, Supabase PostgreSQL, Vitest, OpenAI API (`gpt-4o-mini`), UK gov.uk bank holidays JSON API, Vercel Cron, Tailwind CSS.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260311120000_add_planning_inspiration.sql` | Create | DB schema for 2 new tables + RLS |
| `src/lib/planning/types.ts` | Modify | Add `PlanningInspirationItem` type; extend `PlanningBoardData` |
| `src/lib/roles.ts` | Modify | Add `canViewPlanning()` helper |
| `src/lib/planning/inspiration-dates.ts` | Create | Pure functions: Easter algo, fixed dates, floating dates |
| `src/lib/__tests__/inspiration-dates.test.ts` | Create | Unit tests for date functions |
| `src/lib/planning/inspiration.ts` | Create | Full generation pipeline: gov.uk fetch, OpenAI call, merge, upsert |
| `src/lib/__tests__/inspiration.test.ts` | Create | Unit tests for pipeline (mocked external calls) |
| `src/lib/planning/index.ts` | Modify | Extend `listPlanningBoardData()` to include inspiration items |
| `src/actions/planning.ts` | Modify | Add 3 new server actions |
| `src/lib/__tests__/inspiration-actions.test.ts` | Create | Unit tests for new server actions |
| `src/components/planning/planning-item-card.tsx` | Modify | Add inspiration item card variant |
| `src/components/planning/planning-board.tsx` | Modify | Render inspiration items in buckets; add refresh button |
| `src/app/api/cron/refresh-inspiration/route.ts` | Create | GET handler for Vercel cron + POST for manual use |
| `src/lib/__tests__/cron-inspiration.test.ts` | Create | Unit tests for cron route |
| `vercel.json` | Create | Vercel cron schedule config |
| `.env.example` | Modify | Add `CRON_SECRET` |

---

## Chunk 1: Foundation — DB Migration, Types, Roles, Date Utilities

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260311120000_add_planning_inspiration.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260311120000_add_planning_inspiration.sql

-- ─── planning_inspiration_items ─────────────────────────────────────────────

create table if not exists public.planning_inspiration_items (
  id             uuid primary key default gen_random_uuid(),
  event_name     text not null,
  event_date     date not null,
  category       text not null check (category in ('bank_holiday','seasonal','floating','sporting')),
  description    text,
  source         text not null check (source in ('gov_uk_api','computed','openai')),
  generated_at   timestamptz not null,
  created_at     timestamptz not null default now()
);

create index if not exists planning_inspiration_items_event_date_idx
  on public.planning_inspiration_items (event_date);

create index if not exists planning_inspiration_items_generated_at_idx
  on public.planning_inspiration_items (generated_at);

-- RLS (defence-in-depth: board queries use admin client, but allow anon reads)
alter table public.planning_inspiration_items enable row level security;

create policy "Authenticated users can read inspiration items"
  on public.planning_inspiration_items for select
  using (auth.role() = 'authenticated');

-- Only service role may insert / update / delete (cron + admin actions)
create policy "Service role can manage inspiration items"
  on public.planning_inspiration_items for all
  using (auth.role() = 'service_role');

-- ─── planning_inspiration_dismissals ────────────────────────────────────────
-- No FK on inspiration_item_id (plain uuid) because the monthly cron deletes
-- all rows from planning_inspiration_items. Orphaned rows are cleaned up in
-- generateInspirationItems() before inserting the new batch.

create table if not exists public.planning_inspiration_dismissals (
  id                    uuid primary key default gen_random_uuid(),
  inspiration_item_id   uuid not null,           -- plain uuid, no FK constraint
  dismissed_by          uuid not null references auth.users(id) on delete cascade,
  dismissed_at          timestamptz not null default now(),
  reason                text not null check (reason in ('dismissed','converted'))
);

create index if not exists planning_inspiration_dismissals_item_id_idx
  on public.planning_inspiration_dismissals (inspiration_item_id);

create index if not exists planning_inspiration_dismissals_dismissed_by_idx
  on public.planning_inspiration_dismissals (dismissed_by);

-- RLS: any authenticated user can read and insert (immutable audit log — no update/delete)
alter table public.planning_inspiration_dismissals enable row level security;

create policy "Authenticated users can read dismissals"
  on public.planning_inspiration_dismissals for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can insert dismissals"
  on public.planning_inspiration_dismissals for insert
  with check (auth.role() = 'authenticated');

create policy "Service role can manage dismissals"
  on public.planning_inspiration_dismissals for all
  using (auth.role() = 'service_role');
```

- [ ] **Step 2: Apply the migration**

```bash
npm run supabase:migrate
```

Expected: migration runs without errors. Verify the two new tables exist in the Supabase dashboard.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260311120000_add_planning_inspiration.sql
git commit -m "feat: add planning_inspiration_items and planning_inspiration_dismissals tables"
```

---

### Task 2: Add Types

**Files:**
- Modify: `src/lib/planning/types.ts`

- [ ] **Step 1: Read the existing types file to understand its structure**

Open `src/lib/planning/types.ts` and locate the `PlanningBoardData` type.

- [ ] **Step 2: Add `PlanningInspirationItem` type and extend `PlanningBoardData`**

In `src/lib/planning/types.ts`, add the following type (after the existing `PlanningEventOverlay` type):

```typescript
export type InspirationCategory = 'bank_holiday' | 'seasonal' | 'floating' | 'sporting';
export type InspirationSource = 'gov_uk_api' | 'computed' | 'openai';

export type PlanningInspirationItem = {
  id: string;
  eventName: string;
  eventDate: string;        // YYYY-MM-DD
  category: InspirationCategory;
  description: string | null;
  source: InspirationSource;
};
```

Then find the `PlanningBoardData` type and add `inspirationItems: PlanningInspirationItem[]` to it:

```typescript
// Before (existing shape — add the new field):
export type PlanningBoardData = {
  today: string;
  alerts: PlanningAlertCounts;
  planningItems: PlanningItem[];
  events: PlanningEventOverlay[];
  users: PlanningPerson[];
  inspirationItems: PlanningInspirationItem[];  // ← add this line
};
```

- [ ] **Step 3: Verify types compile**

```bash
npm run typecheck
```

Expected: zero errors. If `PlanningBoardData` is constructed in `index.ts`, the compiler will report a missing field — that is expected and will be fixed in Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/lib/planning/types.ts
git commit -m "feat: add PlanningInspirationItem type and extend PlanningBoardData"
```

---

### Task 3: Add `canViewPlanning` to roles

**Files:**
- Modify: `src/lib/roles.ts`

- [ ] **Step 1: Read `src/lib/roles.ts` to understand the existing pattern**

Find `canUsePlanning` — it currently returns `true` only for `central_planner`.

- [ ] **Step 2: Add `canViewPlanning` below `canUsePlanning`**

```typescript
// Add after canUsePlanning:
export function canViewPlanning(role: UserRole): boolean {
  // central_planner has full planning access; executive is a read-only observer
  return role === 'central_planner' || role === 'executive';
}
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat: add canViewPlanning role helper"
```

---

### Task 4: Date utilities — TDD

**Files:**
- Create: `src/lib/planning/inspiration-dates.ts`
- Create: `src/lib/__tests__/inspiration-dates.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `src/lib/__tests__/inspiration-dates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

// inspiration-dates.ts uses `import "server-only"` — mock it so Vitest can import the module
vi.mock('server-only', () => ({}));

import {
  computeEasterSunday,
  computeMothersDayUK,
  computeFathersDay,
  getFixedSeasonalDates,
  getComputedDates,
} from '@/lib/planning/inspiration-dates';

describe('computeEasterSunday', () => {
  it('returns Easter Sunday 2024 (31 March)', () => {
    const easter = computeEasterSunday(2024);
    expect(easter.getFullYear()).toBe(2024);
    expect(easter.getMonth()).toBe(2); // 0-indexed March
    expect(easter.getDate()).toBe(31);
  });

  it('returns Easter Sunday 2025 (20 April)', () => {
    const easter = computeEasterSunday(2025);
    expect(easter.getFullYear()).toBe(2025);
    expect(easter.getMonth()).toBe(3); // 0-indexed April
    expect(easter.getDate()).toBe(20);
  });

  it('returns Easter Sunday 2026 (5 April)', () => {
    const easter = computeEasterSunday(2026);
    expect(easter.getFullYear()).toBe(2026);
    expect(easter.getMonth()).toBe(3); // 0-indexed April
    expect(easter.getDate()).toBe(5);
  });

  it('always returns a Sunday', () => {
    for (const year of [2024, 2025, 2026, 2027, 2028]) {
      expect(computeEasterSunday(year).getDay()).toBe(0); // 0 = Sunday
    }
  });
});

describe('computeMothersDayUK', () => {
  it('returns Mothering Sunday 2024 (10 March — 21 days before Easter 31 Mar)', () => {
    const md = computeMothersDayUK(2024);
    expect(md.getFullYear()).toBe(2024);
    expect(md.getMonth()).toBe(2); // March
    expect(md.getDate()).toBe(10);
  });

  it('returns Mothering Sunday 2025 (30 March — 21 days before Easter 20 Apr)', () => {
    const md = computeMothersDayUK(2025);
    expect(md.getFullYear()).toBe(2025);
    expect(md.getMonth()).toBe(2); // March
    expect(md.getDate()).toBe(30);
  });

  it('always returns a Sunday', () => {
    for (const year of [2024, 2025, 2026]) {
      expect(computeMothersDayUK(year).getDay()).toBe(0);
    }
  });
});

describe('computeFathersDay', () => {
  it('returns Father\'s Day 2024 (16 June — 3rd Sunday of June)', () => {
    const fd = computeFathersDay(2024);
    expect(fd.getFullYear()).toBe(2024);
    expect(fd.getMonth()).toBe(5); // June (0-indexed)
    expect(fd.getDate()).toBe(16);
  });

  it('returns Father\'s Day 2025 (15 June)', () => {
    const fd = computeFathersDay(2025);
    expect(fd.getFullYear()).toBe(2025);
    expect(fd.getMonth()).toBe(5);
    expect(fd.getDate()).toBe(15);
  });

  it('always returns a Sunday', () => {
    for (const year of [2024, 2025, 2026]) {
      expect(computeFathersDay(year).getDay()).toBe(0);
    }
  });
});

describe('getFixedSeasonalDates', () => {
  it('returns Valentine\'s Day for a year in the window', () => {
    const items = getFixedSeasonalDates(
      new Date('2026-01-01'),
      new Date('2026-12-31')
    );
    const valentines = items.find(i => i.eventName === "Valentine's Day");
    expect(valentines).toBeDefined();
    expect(valentines!.eventDate).toBe('2026-02-14');
    expect(valentines!.category).toBe('seasonal');
    expect(valentines!.source).toBe('computed');
  });

  it('returns Bonfire Night', () => {
    const items = getFixedSeasonalDates(
      new Date('2026-01-01'),
      new Date('2026-12-31')
    );
    const bonfire = items.find(i => i.eventName === 'Bonfire Night');
    expect(bonfire).toBeDefined();
    expect(bonfire!.eventDate).toBe('2026-11-05');
  });

  it('does not return dates outside the window', () => {
    const items = getFixedSeasonalDates(
      new Date('2026-03-01'),
      new Date('2026-06-30')
    );
    expect(items.every(i => i.eventDate >= '2026-03-01' && i.eventDate <= '2026-06-30')).toBe(true);
  });
});

describe('getComputedDates', () => {
  it('includes Mother\'s Day and Father\'s Day in a full year window', () => {
    const items = getComputedDates(
      new Date('2026-01-01'),
      new Date('2026-12-31')
    );
    expect(items.some(i => i.eventName === "Mother's Day")).toBe(true);
    expect(items.some(i => i.eventName === "Father's Day")).toBe(true);
  });

  it('all items have source = computed', () => {
    const items = getComputedDates(new Date('2026-01-01'), new Date('2026-12-31'));
    expect(items.every(i => i.source === 'computed')).toBe(true);
  });

  it('does not return items outside the window', () => {
    const items = getComputedDates(new Date('2026-04-01'), new Date('2026-06-30'));
    expect(items.every(i => i.eventDate >= '2026-04-01' && i.eventDate <= '2026-06-30')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/__tests__/inspiration-dates.test.ts
```

Expected: all tests FAIL with "Cannot find module" errors.

- [ ] **Step 3: Create `src/lib/planning/inspiration-dates.ts`**

```typescript
import "server-only";
import type { PlanningInspirationItem } from "@/lib/planning/types";

/** Anonymous Gregorian algorithm for Easter Sunday. Returns a UTC midnight Date. */
export function computeEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 1-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Mothering Sunday (UK Mother's Day): 21 days before Easter Sunday. */
export function computeMothersDayUK(year: number): Date {
  const easter = computeEasterSunday(year);
  return new Date(Date.UTC(easter.getUTCFullYear(), easter.getUTCMonth(), easter.getUTCDate() - 21));
}

/** Father's Day: 3rd Sunday of June. */
export function computeFathersDay(year: number): Date {
  const june1 = new Date(Date.UTC(year, 5, 1));
  const dayOfWeek = june1.getUTCDay(); // 0 = Sunday
  const daysToFirstSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const firstSunday = 1 + daysToFirstSunday;
  return new Date(Date.UTC(year, 5, firstSunday + 14));
}

function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function inWindow(dateStr: string, windowStart: Date, windowEnd: Date): boolean {
  const d = dateStr;
  const start = toIsoDate(windowStart);
  const end = toIsoDate(windowEnd);
  return d >= start && d <= end;
}

type FixedOccasion = { name: string; month: number; day: number }; // month: 1-indexed

const FIXED_OCCASIONS: FixedOccasion[] = [
  { name: "Valentine's Day",   month: 2,  day: 14 },
  { name: "St Patrick's Day",  month: 3,  day: 17 },
  { name: 'Halloween',         month: 10, day: 31 },
  { name: 'Bonfire Night',     month: 11, day: 5  },
  { name: 'Christmas Eve',     month: 12, day: 24 },
  { name: 'Christmas Day',     month: 12, day: 25 },
  { name: 'Boxing Day',        month: 12, day: 26 },
  { name: "New Year's Eve",    month: 12, day: 31 },
];

/**
 * Returns fixed-date seasonal occasions that fall within the window.
 * Iterates across all years spanned by the window.
 */
export function getFixedSeasonalDates(
  windowStart: Date,
  windowEnd: Date
): Omit<PlanningInspirationItem, 'id'>[] {
  const results: Omit<PlanningInspirationItem, 'id'>[] = [];
  const startYear = windowStart.getUTCFullYear();
  const endYear = windowEnd.getUTCFullYear();

  for (let year = startYear; year <= endYear; year++) {
    for (const occasion of FIXED_OCCASIONS) {
      const dateStr = `${year}-${String(occasion.month).padStart(2, '0')}-${String(occasion.day).padStart(2, '0')}`;
      if (!inWindow(dateStr, windowStart, windowEnd)) continue;
      results.push({
        eventName: occasion.name,
        eventDate: dateStr,
        category: 'seasonal',
        description: null,
        source: 'computed',
      });
    }
  }
  return results;
}

/**
 * Returns algorithmically computed floating occasions (Mother's Day, Father's Day)
 * that fall within the window.
 */
export function getComputedDates(
  windowStart: Date,
  windowEnd: Date
): Omit<PlanningInspirationItem, 'id'>[] {
  const results: Omit<PlanningInspirationItem, 'id'>[] = [];
  const startYear = windowStart.getUTCFullYear();
  const endYear = windowEnd.getUTCFullYear();

  for (let year = startYear; year <= endYear; year++) {
    const mothersDay = computeMothersDayUK(year);
    const mothersDayStr = toIsoDate(mothersDay);
    if (inWindow(mothersDayStr, windowStart, windowEnd)) {
      results.push({
        eventName: "Mother's Day",
        eventDate: mothersDayStr,
        category: 'floating',
        description: 'Mothering Sunday — 4th Sunday of Lent',
        source: 'computed',
      });
    }

    const fathersDay = computeFathersDay(year);
    const fathersDayStr = toIsoDate(fathersDay);
    if (inWindow(fathersDayStr, windowStart, windowEnd)) {
      results.push({
        eventName: "Father's Day",
        eventDate: fathersDayStr,
        category: 'floating',
        description: '3rd Sunday of June',
        source: 'computed',
      });
    }
  }
  return results;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/lib/__tests__/inspiration-dates.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/planning/inspiration-dates.ts src/lib/__tests__/inspiration-dates.test.ts
git commit -m "feat: add inspiration date utilities (Easter algo, fixed/floating dates)"
```

---

## Chunk 2: Generation Pipeline & Board Data

### Task 5: Generation pipeline — TDD

**Files:**
- Create: `src/lib/planning/inspiration.ts`
- Create: `src/lib/__tests__/inspiration.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/inspiration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Mock server-only
vi.mock('server-only', () => ({}));

// Mock Supabase admin client
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { fetchBankHolidays, generateInspirationItems } from '@/lib/planning/inspiration';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// ─── fetchBankHolidays ───────────────────────────────────────────────────────

describe('fetchBankHolidays', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it('returns filtered bank holidays within the window', async () => {
    (global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'england-and-wales': {
          events: [
            { title: 'Good Friday', date: '2026-04-03' },
            { title: 'Easter Monday', date: '2026-04-06' },
            { title: 'Spring Bank Holiday', date: '2027-05-31' }, // outside window
          ],
        },
      }),
    });

    const result = await fetchBankHolidays(
      new Date('2026-03-11'),
      new Date('2026-09-07')
    );

    expect(result).toHaveLength(2);
    expect(result[0].eventName).toBe('Good Friday');
    expect(result[0].category).toBe('bank_holiday');
    expect(result[0].source).toBe('gov_uk_api');
    expect(result[0].eventDate).toBe('2026-04-03');
  });

  it('returns empty array and logs warning if API is unreachable', async () => {
    (global.fetch as Mock).mockRejectedValueOnce(new Error('Network error'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchBankHolidays(new Date('2026-03-11'), new Date('2026-09-07'));

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('bank holidays'));
    consoleSpy.mockRestore();
  });

  it('returns empty array if API returns non-ok response', async () => {
    (global.fetch as Mock).mockResolvedValueOnce({ ok: false, status: 503 });
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchBankHolidays(new Date('2026-03-11'), new Date('2026-09-07'));

    expect(result).toEqual([]);
    consoleSpy.mockRestore();
  });
});

// ─── generateInspirationItems ────────────────────────────────────────────────

describe('generateInspirationItems', () => {
  let mockDb: {
    from: Mock;
    delete: Mock;
    neq: Mock;
    not: Mock;
    in: Mock;
    insert: Mock;
    select: Mock;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();

    // Build a chainable Supabase mock
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    const mockSelect = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockNot = vi.fn().mockResolvedValue({ error: null });
    const mockIn = vi.fn().mockResolvedValue({ error: null });
    const mockDelete = vi.fn().mockReturnValue({ not: mockNot, in: mockIn });
    const mockFrom = vi.fn().mockReturnValue({
      delete: mockDelete,
      insert: mockInsert,
      select: mockSelect,
    });

    mockDb = { from: mockFrom, delete: mockDelete, neq: vi.fn(), not: mockNot, in: mockIn, insert: mockInsert, select: mockSelect };
    (createSupabaseAdminClient as Mock).mockReturnValue({ from: mockFrom });
  });

  it('calls gov.uk API and OpenAI, merges results, and inserts to DB', async () => {
    // gov.uk returns one bank holiday
    (global.fetch as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'england-and-wales': {
            events: [{ title: 'Good Friday', date: '2026-04-03' }],
          },
        }),
      })
      // OpenAI returns one sporting event
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                events: [
                  { event_name: 'Six Nations Final', event_date: '2026-03-21', description: 'England vs France' },
                ],
              }),
            },
          }],
        }),
      });

    const count = await generateInspirationItems(
      new Date('2026-03-11'),
      new Date('2026-09-07')
    );

    expect(count).toBeGreaterThan(0);
    expect(mockDb.from).toHaveBeenCalledWith('planning_inspiration_items');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('continues gracefully if OpenAI fails', async () => {
    (global.fetch as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 'england-and-wales': { events: [] } }),
      })
      .mockRejectedValueOnce(new Error('OpenAI down'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const count = await generateInspirationItems(
      new Date('2026-03-11'),
      new Date('2026-09-07')
    );

    // Still returns computed dates even with no bank holidays or sporting events
    expect(count).toBeGreaterThanOrEqual(0);
    consoleSpy.mockRestore();
  });

  it('deduplicates items with same date and event name', async () => {
    // gov.uk returns "Christmas Day", computed dates also generate "Christmas Day"
    // Only one should survive deduplication
    (global.fetch as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'england-and-wales': {
            events: [{ title: 'Christmas Day', date: '2026-12-25' }],
          },
        }),
      })
      .mockRejectedValueOnce(new Error('OpenAI skipped'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await generateInspirationItems(new Date('2026-03-11'), new Date('2026-12-31'));

    // Check insert was called with no duplicate christmas day entries
    const insertCall = mockDb.insert.mock.calls[0][0] as Array<{ event_name: string; event_date: string }>;
    const christmasDays = insertCall.filter(
      item => item.event_date === '2026-12-25' && item.event_name.toLowerCase().includes('christmas')
    );
    // At most one Christmas Day row (bank holiday deduplicates with seasonal)
    expect(christmasDays.length).toBeLessThanOrEqual(1);
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/__tests__/inspiration.test.ts
```

Expected: all FAIL with "Cannot find module" errors.

- [ ] **Step 3: Create `src/lib/planning/inspiration.ts`**

```typescript
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getFixedSeasonalDates, getComputedDates } from "@/lib/planning/inspiration-dates";
import type { PlanningInspirationItem, InspirationCategory, InspirationSource } from "@/lib/planning/types";

type InspirationItemInput = Omit<PlanningInspirationItem, 'id'>;

// ─── Source 1: gov.uk bank holidays ─────────────────────────────────────────

export async function fetchBankHolidays(
  windowStart: Date,
  windowEnd: Date
): Promise<InspirationItemInput[]> {
  try {
    const res = await fetch('https://www.gov.uk/bank-holidays.json', {
      next: { revalidate: 86400 }, // cache for 24h
    });
    if (!res.ok) {
      console.warn(`fetchBankHolidays: gov.uk API returned ${res.status} — skipping bank holidays`);
      return [];
    }
    const data = (await res.json()) as {
      'england-and-wales': { events: Array<{ title: string; date: string }> };
    };
    const events = data['england-and-wales']?.events ?? [];
    const startStr = toIsoDate(windowStart);
    const endStr = toIsoDate(windowEnd);

    return events
      .filter(e => e.date >= startStr && e.date <= endStr)
      .map(e => ({
        eventName: e.title,
        eventDate: e.date,
        category: 'bank_holiday' as InspirationCategory,
        description: null,
        source: 'gov_uk_api' as InspirationSource,
      }));
  } catch (err) {
    console.warn('fetchBankHolidays: failed to fetch bank holidays — continuing without them', err);
    return [];
  }
}

// ─── Source 3: OpenAI sporting events ───────────────────────────────────────

type OpenAiEvent = { event_name: string; event_date: string; description: string };

async function fetchSportingEvents(
  windowStart: Date,
  windowEnd: Date,
  bankHolidayContext: InspirationItemInput[]
): Promise<InspirationItemInput[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('fetchSportingEvents: OPENAI_API_KEY not set — skipping sporting events');
    return [];
  }

  const startStr = toIsoDate(windowStart);
  const endStr = toIsoDate(windowEnd);
  const bankHolidayLines = bankHolidayContext
    .map(h => `- ${h.eventDate}: ${h.eventName}`)
    .join('\n');

  const body = {
    model: process.env.OPENAI_WEBSITE_COPY_MODEL ?? 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: [
          'You are a UK sports and events calendar assistant.',
          'Return only major UK sporting fixtures.',
          'UK events only — no US events (no Thanksgiving, Super Bowl, etc.).',
          'Return valid ISO 8601 dates (YYYY-MM-DD) only.',
          'If you are not certain of an exact date, omit the event.',
          'Always return valid JSON matching the schema.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Today's date: ${toIsoDate(new Date())}`,
          `Window: ${startStr} to ${endStr}`,
          '',
          'Known bank holidays in this window (use as date anchors):',
          bankHolidayLines || '(none)',
          '',
          'List major UK sporting events in this window.',
          'Include: Six Nations, FA Cup rounds, Wimbledon, British GP, The Ashes, Cheltenham Festival, Grand National, Rugby World Cup (if applicable).',
          'Only include events with known or highly likely exact dates.',
          'Exclude events whose exact dates you are uncertain about.',
        ].join('\n'),
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'uk_sporting_events',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['events'],
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['event_name', 'event_date', 'description'],
                properties: {
                  event_name: { type: 'string' },
                  event_date: { type: 'string', description: 'YYYY-MM-DD' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error('fetchSportingEvents: OpenAI request failed', res.status);
      return [];
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content) as { events?: OpenAiEvent[] };
    const events = parsed.events ?? [];

    // Validate: ISO date format, within window
    return events
      .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
      .filter(e => e.event_date >= startStr && e.event_date <= endStr)
      .map(e => ({
        eventName: e.event_name.trim(),
        eventDate: e.event_date,
        category: 'sporting' as InspirationCategory,
        description: e.description?.trim() || null,
        source: 'openai' as InspirationSource,
      }));
  } catch (err) {
    console.error('fetchSportingEvents: unexpected error', err);
    return [];
  }
}

// ─── Merge & upsert ──────────────────────────────────────────────────────────

function deduplicateItems(items: InspirationItemInput[]): InspirationItemInput[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.eventDate}|${item.eventName.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Generates inspiration items from all three sources, deduplicates, and upserts
 * to the DB. Returns the count of items inserted.
 */
export async function generateInspirationItems(
  windowStart: Date,
  windowEnd: Date
): Promise<number> {
  const generatedAt = new Date().toISOString();

  // Fetch from all sources (partial failures are tolerated)
  const [bankHolidays, fixedSeasonal, computedDates] = await Promise.all([
    fetchBankHolidays(windowStart, windowEnd),
    Promise.resolve(getFixedSeasonalDates(windowStart, windowEnd)),
    Promise.resolve(getComputedDates(windowStart, windowEnd)),
  ]);

  // Sporting events get bank holidays as context — run after
  const sportingEvents = await fetchSportingEvents(windowStart, windowEnd, bankHolidays);

  const all = deduplicateItems([
    ...bankHolidays,
    ...fixedSeasonal,
    ...computedDates,
    ...sportingEvents,
  ]).sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  console.log(
    `generateInspirationItems: bank_holiday=${bankHolidays.length} ` +
    `seasonal=${fixedSeasonal.length} floating=${computedDates.length} ` +
    `sporting=${sportingEvents.length} total_after_dedup=${all.length}`
  );

  const db = createSupabaseAdminClient();

  // Step 1: Fetch current inspiration item IDs before deleting them
  const { data: currentItems } = await db
    .from('planning_inspiration_items')
    .select('id');
  const currentIds = (currentItems ?? []).map((r: { id: string }) => r.id);

  // Step 2: Delete orphaned dismissals — rows pointing at items that are about to be replaced
  // Only run if there are existing items (otherwise skip to avoid Supabase filter issues)
  if (currentIds.length > 0) {
    await db
      .from('planning_inspiration_dismissals')
      .delete()
      .not('inspiration_item_id', 'in', `(${currentIds.join(',')})`);
  }

  // Step 3: Delete all existing inspiration items (replaced with fresh batch)
  await db.from('planning_inspiration_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  if (all.length === 0) return 0;

  // Insert fresh batch
  const rows = all.map(item => ({
    event_name: item.eventName,
    event_date: item.eventDate,
    category: item.category,
    description: item.description,
    source: item.source,
    generated_at: generatedAt,
  }));

  const { error } = await db.from('planning_inspiration_items').insert(rows);
  if (error) {
    console.error('generateInspirationItems: insert failed', error);
    throw new Error(`Failed to insert inspiration items: ${error.message}`);
  }

  return all.length;
}
```

**Note:** The orphaned dismissals cleanup above has a known complexity with the Supabase-js `delete().not(...in...)` pattern. The implementer should verify the exact Supabase-js v2 syntax for "delete where id not in array" against the existing codebase patterns and adjust accordingly. The intent is: delete all rows in `planning_inspiration_dismissals` whose `inspiration_item_id` is not in the current set of `planning_inspiration_items.id` values — i.e. delete rows pointing at items that are about to be deleted.

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/lib/__tests__/inspiration.test.ts
```

Expected: all tests PASS. Fix any import or mock issues until they do.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm run test
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/planning/inspiration.ts src/lib/__tests__/inspiration.test.ts
git commit -m "feat: add inspiration generation pipeline (bank holidays, computed dates, OpenAI sporting events)"
```

---

### Task 6: Extend `listPlanningBoardData`

**Files:**
- Modify: `src/lib/planning/index.ts`

- [ ] **Step 1: Read `src/lib/planning/index.ts` in full**

Find `listPlanningBoardData`. Note:
- What arguments it accepts
- How it creates the Supabase client (look for `createSupabaseAdminClient()`)
- Whether it uses a single `Promise.all` for parallel fetches or sequential awaits
- What object shape it returns — you need to add `inspirationItems` to it
- The `addDays` utility signature (used in Step 3)

- [ ] **Step 2: Add a helper to fetch undismissed inspiration items**

Inside `src/lib/planning/index.ts`, add a private helper function before `listPlanningBoardData`:

```typescript
async function fetchInspirationItems(
  db: ReturnType<typeof createSupabaseAdminClient>,
  today: string,
  windowEndDate: string
): Promise<PlanningInspirationItem[]> {
  // Fetch all active dismissal IDs first
  const { data: dismissals } = await db
    .from('planning_inspiration_dismissals')
    .select('inspiration_item_id');

  const dismissedIds = (dismissals ?? []).map((d: { inspiration_item_id: string }) => d.inspiration_item_id);

  let query = db
    .from('planning_inspiration_items')
    .select('*')
    .gte('event_date', today)
    .lte('event_date', windowEndDate)
    .order('event_date', { ascending: true });

  if (dismissedIds.length > 0) {
    query = query.not('id', 'in', `(${dismissedIds.join(',')})`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('fetchInspirationItems: query failed', error);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    eventName: row.event_name as string,
    eventDate: row.event_date as string,
    category: row.category as PlanningInspirationItem['category'],
    description: (row.description as string | null) ?? null,
    source: row.source as PlanningInspirationItem['source'],
  }));
}
```

- [ ] **Step 3: Call the helper inside `listPlanningBoardData` and add to the returned object**

In `listPlanningBoardData`, add the inspiration items fetch alongside the existing parallel queries. Add `inspirationItems` to the returned `PlanningBoardData` object:

```typescript
// In listPlanningBoardData, add to the parallel fetch block:
const [
  // ... existing queries ...
  inspirationItems,
] = await Promise.all([
  // ... existing promises ...
  fetchInspirationItems(db, today, addDays(today, 180)),
]);

// In the return object:
return {
  today,
  alerts,
  planningItems,
  events,
  users,
  inspirationItems,  // ← add this
};
```

- [ ] **Step 4: Verify types**

```bash
npm run typecheck
```

Expected: zero errors. The `PlanningBoardData` type now requires `inspirationItems` and this satisfies it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/planning/index.ts
git commit -m "feat: include inspiration items in listPlanningBoardData"
```

---

## Chunk 3: Server Actions, UI & Infrastructure

### Task 7: Server actions

**Files:**
- Modify: `src/actions/planning.ts`
- Create: `src/lib/__tests__/inspiration-actions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/inspiration-actions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/action', () => ({ createSupabaseActionClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/planning/inspiration', () => ({ generateInspirationItems: vi.fn() }));
// Mock the auth module using the same path as used in src/actions/planning.ts
// Open src/actions/planning.ts and confirm the exact import path for getCurrentUser before running
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));

import { convertInspirationItemAction, dismissInspirationItemAction, refreshInspirationItemsAction } from '@/actions/planning';
import { createSupabaseActionClient } from '@/lib/supabase/action';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { generateInspirationItems } from '@/lib/planning/inspiration';
import { getCurrentUser } from '@/lib/auth';

function makeUser(role: string) {
  return { id: 'user-123', role };
}

function makeChainableDb(overrides: Record<string, unknown> = {}) {
  const mockInsert = vi.fn().mockResolvedValue({ error: null });
  const mockEq = vi.fn().mockResolvedValue({ data: { id: 'item-1', event_name: 'Good Friday', event_date: '2026-04-03', category: 'bank_holiday', description: null, source: 'gov_uk_api' }, error: null });
  const mockSingle = vi.fn().mockReturnValue({ data: { id: 'item-1', event_name: 'Good Friday', event_date: '2026-04-03', category: 'bank_holiday', description: null, source: 'gov_uk_api' }, error: null });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq, single: mockSingle });
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    ...overrides,
  });
  return { from: mockFrom, insert: mockInsert, select: mockSelect };
}

describe('convertInspirationItemAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error if user is not authenticated', async () => {
    (getCurrentUser as Mock).mockResolvedValue(null);

    const result = await convertInspirationItemAction('item-1');

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/sign in/i);
  });

  it('returns error if user role cannot view planning', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('reviewer'));

    const result = await convertInspirationItemAction('item-1');

    expect(result.success).toBe(false);
  });

  it('creates planning item and dismissal row for central_planner', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('central_planner'));
    const db = makeChainableDb();
    (createSupabaseActionClient as Mock).mockReturnValue(db);

    const result = await convertInspirationItemAction('item-1');

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/added to your plan/i);
    // Two inserts: one for planning_items, one for planning_inspiration_dismissals
    expect(db.insert).toHaveBeenCalledTimes(2);
  });
});

describe('dismissInspirationItemAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error if not authenticated', async () => {
    (getCurrentUser as Mock).mockResolvedValue(null);
    const result = await dismissInspirationItemAction('item-1');
    expect(result.success).toBe(false);
  });

  it('inserts dismissal row for authenticated viewer', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('central_planner'));
    const db = makeChainableDb();
    (createSupabaseActionClient as Mock).mockReturnValue(db);

    const result = await dismissInspirationItemAction('item-1');

    expect(result.success).toBe(true);
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({ inspiration_item_id: 'item-1', reason: 'dismissed' })
    );
  });
});

describe('refreshInspirationItemsAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns unauthorised error for non-central_planner', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('executive'));
    const result = await refreshInspirationItemsAction();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/unauthorised/i);
  });

  it('calls generateInspirationItems for central_planner', async () => {
    (getCurrentUser as Mock).mockResolvedValue(makeUser('central_planner'));
    (generateInspirationItems as Mock).mockResolvedValue(12);

    const result = await refreshInspirationItemsAction();

    expect(result.success).toBe(true);
    expect(result.message).toContain('12');
    expect(generateInspirationItems).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/__tests__/inspiration-actions.test.ts
```

Expected: FAIL — actions don't exist yet.

- [ ] **Step 3: Add the three server actions to `src/actions/planning.ts`**

Open `src/actions/planning.ts`. At the bottom of the file, add:

```typescript
// ─── Inspiration item actions ────────────────────────────────────────────────

import { canViewPlanning } from "@/lib/roles";
import { generateInspirationItems } from "@/lib/planning/inspiration";

export async function convertInspirationItemAction(
  id: string
): Promise<PlanningActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { success: false, message: "You must be signed in." };
    if (!canViewPlanning(user.role)) {
      return { success: false, message: "You do not have permission to perform this action." };
    }

    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return { success: false, message: "Invalid item ID." };

    const db = createSupabaseActionClient();

    // Fetch the inspiration item
    const { data: item, error: fetchError } = await db
      .from("planning_inspiration_items")
      .select("*")
      .eq("id", parsed.data)
      .single();

    if (fetchError || !item) {
      return { success: false, message: "Inspiration item not found." };
    }

    // Create the planning item
    const { error: insertItemError } = await db
      .from("planning_items")
      .insert({
        title: item.event_name,
        target_date: item.event_date,
        type_label: "Occasion",
        status: "planned",
        created_by: user.id,
      });

    if (insertItemError) {
      console.error("convertInspirationItemAction: insert planning_item failed", insertItemError);
      return { success: false, message: "Failed to add to plan." };
    }

    // Record the dismissal
    await db.from("planning_inspiration_dismissals").insert({
      inspiration_item_id: parsed.data,
      dismissed_by: user.id,
      reason: "converted",
    });

    revalidatePath("/planning");
    return { success: true, message: "Added to your plan." };
  } catch (error) {
    console.error("convertInspirationItemAction:", error);
    return { success: false, message: "Something went wrong." };
  }
}

export async function dismissInspirationItemAction(
  id: string
): Promise<PlanningActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { success: false, message: "You must be signed in." };
    if (!canViewPlanning(user.role)) {
      return { success: false, message: "You do not have permission to perform this action." };
    }

    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return { success: false, message: "Invalid item ID." };

    const db = createSupabaseActionClient();
    await db.from("planning_inspiration_dismissals").insert({
      inspiration_item_id: parsed.data,
      dismissed_by: user.id,
      reason: "dismissed",
    });

    revalidatePath("/planning");
    return { success: true };
  } catch (error) {
    console.error("dismissInspirationItemAction:", error);
    return { success: false, message: "Something went wrong." };
  }
}

export async function refreshInspirationItemsAction(): Promise<PlanningActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "central_planner") {
      return { success: false, message: "Unauthorised." };
    }

    const today = new Date();
    const windowEnd = new Date(today);
    windowEnd.setUTCDate(today.getUTCDate() + 180);

    const count = await generateInspirationItems(today, windowEnd);

    revalidatePath("/planning");
    return { success: true, message: `Inspiration items refreshed — ${count} occasions found.` };
  } catch (error) {
    console.error("refreshInspirationItemsAction:", error);
    return { success: false, message: "Refresh failed. Check server logs." };
  }
}
```

**Note:** Check the exact import paths in `planning.ts` for `createSupabaseActionClient`, `getCurrentUser`, `revalidatePath` and `uuidSchema` — use the same imports already present in the file. Do not add duplicate imports.

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/lib/__tests__/inspiration-actions.test.ts
```

Expected: all PASS. Adjust mocks if import paths differ from expectations.

- [ ] **Step 5: Run full test suite**

```bash
npm run test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/actions/planning.ts src/lib/__tests__/inspiration-actions.test.ts
git commit -m "feat: add convertInspirationItemAction, dismissInspirationItemAction, refreshInspirationItemsAction"
```

---

### Task 8: Inspiration card variant in `planning-item-card.tsx`

**Files:**
- Modify: `src/components/planning/planning-item-card.tsx`

- [ ] **Step 1: Read `src/components/planning/planning-item-card.tsx` in full**

Understand the existing prop interface and how different card variants are rendered.

- [ ] **Step 2: Add imports for the new actions and types**

At the top of the file, ensure these are imported:

```typescript
import type { PlanningInspirationItem } from "@/lib/planning/types";
import { convertInspirationItemAction, dismissInspirationItemAction } from "@/actions/planning";
```

- [ ] **Step 3: Create the `InspirationItemCard` component**

Add as a named export at the bottom of `planning-item-card.tsx`:

```typescript
const CATEGORY_LABELS: Record<PlanningInspirationItem['category'], string> = {
  bank_holiday: 'Bank Holiday',
  seasonal: 'Seasonal',
  floating: 'Occasion',
  sporting: 'Sporting',
};

export function InspirationItemCard({ item }: { item: PlanningInspirationItem }) {
  const [converting, setConverting] = React.useState(false);
  const [dismissing, setDismissing] = React.useState(false);

  async function handleConvert() {
    setConverting(true);
    const result = await convertInspirationItemAction(item.id);
    if (!result.success) {
      // surface error
      console.error(result.message);
    }
    setConverting(false);
  }

  async function handleDismiss() {
    setDismissing(true);
    await dismissInspirationItemAction(item.id);
    setDismissing(false);
  }

  // Format the date as "Fri 14 Feb" using London timezone
  const formattedDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${item.eventDate}T12:00:00Z`));

  return (
    <div className="rounded-md border-2 border-dashed border-amber-400 bg-amber-50 px-3 py-2 flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm">✨</span>
          <span className="text-sm font-medium text-amber-900 truncate">{item.eventName}</span>
          <span className="text-xs text-amber-600 bg-amber-100 rounded px-1.5 py-0.5 shrink-0">
            {CATEGORY_LABELS[item.category]}
          </span>
        </div>
        <p className="text-xs text-amber-700 mt-0.5">{formattedDate}</p>
        {item.description && (
          <p className="text-xs text-amber-600 mt-0.5 truncate">{item.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          disabled={converting || dismissing}
          onClick={handleConvert}
          className="text-xs bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded px-2 py-1 font-medium transition-colors"
        >
          {converting ? '…' : 'Add to plan'}
        </button>
        <button
          type="button"
          disabled={converting || dismissing}
          onClick={handleDismiss}
          className="text-xs text-amber-700 hover:text-amber-900 disabled:opacity-50 rounded px-2 py-1 transition-colors"
        >
          {dismissing ? '…' : 'Hide'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/planning/planning-item-card.tsx
git commit -m "feat: add InspirationItemCard component"
```

---

### Task 9: Integrate inspiration items into `planning-board.tsx` + refresh button

**Files:**
- Modify: `src/components/planning/planning-board.tsx`

- [ ] **Step 1: Read `src/components/planning/planning-board.tsx` in full**

Find:
- The `PlanningBoardProps` type
- The `planningByBucket` and `eventsByBucket` memoised computations
- Where each bucket is rendered in the board view (the map over `BUCKETS`)
- The board header area where controls sit

- [ ] **Step 2: Add inspiration item imports**

```typescript
import { InspirationItemCard } from "@/components/planning/planning-item-card";
import { refreshInspirationItemsAction } from "@/actions/planning";
```

- [ ] **Step 3: Add `inspirationByBucket` memoised computation**

After the existing `eventsByBucket` useMemo, add:

```typescript
const inspirationByBucket = useMemo(() => {
  const map: Record<PlanningBucketKey, PlanningInspirationItem[]> = {
    '0_30': [], '31_60': [], '61_90': [], later: [],
  };
  for (const item of data.inspirationItems) {
    const offset = daysBetween(data.today, item.eventDate);
    const bucket = bucketForDayOffset(offset);
    map[bucket].push(item);
  }
  return map;
}, [data.inspirationItems, data.today]);
```

- [ ] **Step 4: Render inspiration cards in each bucket**

Inside the board view's bucket rendering loop, after the event overlay cards and before the planning item cards (or after — whatever integrates cleanly), add:

```tsx
{/* Inspiration items */}
{inspirationByBucket[bucket.key].map(item => (
  <InspirationItemCard key={item.id} item={item} />
))}
```

- [ ] **Step 5: Add the refresh button to the board header**

Find the board header area (where the view mode tabs and filter controls sit). Add a refresh button, visible only to `central_planner`:

```tsx
{currentUser?.role === 'central_planner' && (
  <RefreshInspirationButton />
)}
```

Then add the `RefreshInspirationButton` component (can be defined at the bottom of the file or in the same section):

```tsx
function RefreshInspirationButton() {
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  async function handleRefresh() {
    setLoading(true);
    setMessage(null);
    const result = await refreshInspirationItemsAction();
    setMessage(result.message ?? (result.success ? 'Done.' : 'Failed.'));
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={loading}
        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center gap-1 transition-colors"
        title="Refresh inspiration items"
      >
        <span>{loading ? '⏳' : '✨'}</span>
        <span>{loading ? 'Refreshing…' : 'Refresh inspiration'}</span>
      </button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
```

**Note:** The `currentUser` prop may need to be passed down to the board component if it isn't already available. Check the existing `PlanningBoardProps` and the page that renders it — `src/app/planning/page.tsx` — to see how user context is provided and follow the same pattern.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. Fix any type mismatches.

- [ ] **Step 7: Run tests**

```bash
npm run test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/planning/planning-board.tsx
git commit -m "feat: render inspiration items in planning board buckets with refresh button"
```

---

### Task 10: Cron route

**Files:**
- Create: `src/app/api/cron/refresh-inspiration/route.ts`
- Create: `src/lib/__tests__/cron-inspiration.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/cron-inspiration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/planning/inspiration', () => ({
  generateInspirationItems: vi.fn(),
}));

import { GET } from '@/app/api/cron/refresh-inspiration/route';
import { generateInspirationItems } from '@/lib/planning/inspiration';

function makeRequest(authHeader?: string): Request {
  return new Request('http://localhost/api/cron/refresh-inspiration', {
    method: 'GET',
    headers: authHeader ? { Authorization: authHeader } : {},
  });
}

describe('GET /api/cron/refresh-inspiration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: 'test-secret-123' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header has wrong secret', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 200 and calls generateInspirationItems with valid secret', async () => {
    (generateInspirationItems as Mock).mockResolvedValue(15);

    const res = await GET(makeRequest('Bearer test-secret-123'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.count).toBe(15);
    expect(generateInspirationItems).toHaveBeenCalledOnce();
  });

  it('returns 500 if generateInspirationItems throws', async () => {
    (generateInspirationItems as Mock).mockRejectedValue(new Error('DB error'));

    const res = await GET(makeRequest('Bearer test-secret-123'));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/__tests__/cron-inspiration.test.ts
```

Expected: FAIL — route doesn't exist yet.

- [ ] **Step 3: Create the route handler**

Create `src/app/api/cron/refresh-inspiration/route.ts`:

```typescript
import "server-only";
import { NextResponse } from "next/server";
import { generateInspirationItems } from "@/lib/planning/inspiration";

export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const today = new Date();
    const windowEnd = new Date(today);
    windowEnd.setUTCDate(today.getUTCDate() + 180);

    const count = await generateInspirationItems(today, windowEnd);

    return NextResponse.json({ success: true, count });
  } catch (error) {
    console.error("cron/refresh-inspiration: failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Also export POST for manual curl invocations during development
export const POST = GET;
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/lib/__tests__/cron-inspiration.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/refresh-inspiration/route.ts src/lib/__tests__/cron-inspiration.test.ts
git commit -m "feat: add cron route GET /api/cron/refresh-inspiration"
```

---

### Task 11: Vercel config and environment variables

**Files:**
- Create: `vercel.json`
- Modify: `.env.example`

- [ ] **Step 1: Create `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-inspiration",
      "schedule": "0 6 1 * *"
    }
  ]
}
```

This schedules the cron to run at 06:00 UTC on the 1st of every month.

- [ ] **Step 2: Add `CRON_SECRET` to `.env.example`**

Open `.env.example` and append:

```bash
# Secures the Vercel cron endpoint — set a long random string in production
# Generate with: openssl rand -hex 32
CRON_SECRET=
```

- [ ] **Step 3: Run the full verification pipeline**

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

Expected: all pass with zero errors and zero warnings. Fix anything that fails before proceeding.

- [ ] **Step 4: Final commit**

```bash
git add vercel.json .env.example
git commit -m "feat: add Vercel cron schedule and CRON_SECRET env var"
```

- [ ] **Step 5: Push**

```bash
git push
```

---

## Post-Implementation Checklist

- [ ] Manually trigger the cron route in dev to verify inspiration items appear on the board: `curl -H "Authorization: Bearer <your-CRON_SECRET>" http://localhost:3000/api/cron/refresh-inspiration`
- [ ] Confirm inspiration cards appear inline in the correct time buckets
- [ ] Test "Add to plan" — verify a new planning item is created and the card disappears
- [ ] Test "Hide" — verify the card disappears and does not reappear on refresh
- [ ] Test refresh button is visible for `central_planner` and triggers a fresh generation
- [ ] Verify `CRON_SECRET` is set in Vercel environment variables before deploying
