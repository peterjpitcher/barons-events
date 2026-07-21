# Venue Calendar Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight, date-marked venue calendar notes (e.g. an externally-handled wedding) that appear on the calendars and warn, without blocking, when an event is scheduled onto a clashing date at the same venue.

**Architecture:** A new `venue_calendar_notes` table with scoped RLS mirroring the current planning-items role model. A pure, fully-tested clash engine (`src/lib/calendar-notes/clash.ts`) consumed identically by the dashboard, the four event forms and the tests. Notes render as a fourth `PlanningViewEntry` source on the planning calendar, as rows on the desktop events calendar and mobile agenda, and are managed through one shared `Sheet`-based editor. Delivered as three independently mergeable slices.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase (Postgres + RLS), Zod, Vitest, Tailwind v4 design tokens.

---

## Source spec

`docs/superpowers/specs/2026-07-20-venue-calendar-notes-design.md` (v2). Read it before starting.

## Deviations from spec (intentional, decided during planning recon)

1. **Concurrency mechanism.** The spec says "reuse the event form pattern". The event form enforces concurrency inside a Postgres RPC (`save_event_draft`), which is disproportionate for this lightweight table. This plan implements the same guarantee (optimistic concurrency via `expectedUpdatedAt`) with a predicate on the update/delete query (`.eq("updated_at", expectedUpdatedAt)`) plus a follow-up read to distinguish "not found / deleted" from "changed since you opened it". Same user-facing behaviour, right-sized implementation.
2. **Audit entity name.** Confirmed the DB already has a `note` entity (internal booking notes). This plan adds a distinct `calendar_note` entity and `calendar_note.created|updated|deleted` actions, per review finding F04, so the two features never share an audit namespace.

## Shared reference (read once, used by many tasks)

**Roles** (`src/lib/types.ts`): `type UserRole = "administrator" | "manager"`. `AppUser` has `{ id, email, fullName, role, venueId, deactivatedAt }`. `getCurrentUser()` from `@/lib/auth` returns `Promise<AppUser | null>`.

**Event statuses** (`src/lib/types.ts`): `pending_approval, approved_pending_details, draft, submitted, needs_revisions, approved, rejected, cancelled, completed`. Notes clash with all EXCEPT `cancelled`, `rejected`, `completed`.

**Date helpers** (`src/lib/planning/utils.ts`, all pure, `YYYY-MM-DD` strings): `parseDateOnly(v)` (throws on impossible dates like Feb 31), `londonDateString(date)` (Intl, Europe/London), `addDays(v, n)`, `daysBetween(from, to)` (signed int), `formatDateOnly(date)`. `DISPLAY_TIMEZONE` is exported from `@/lib/datetime` and equals `"Europe/London"`.

**Audit** (`src/lib/audit-log.ts`): `recordAuditLogEntry({ entity, entityId, action, meta?, actorId? })` returns `Promise<void>`, swallows all errors, never throws. Call it fire-and-forget: `recordAuditLogEntry({...}).catch((e) => console.error(...))`. `entity` is a fixed TS union that must be widened to include `"calendar_note"` (Task 3).

**Supabase clients:** `createSupabaseActionClient()` (anon key + cookie session, RLS-respecting) for user writes; `createSupabaseAdminClient()` (service-role, bypasses RLS) for system reads. Import from `@/lib/supabase/server` and `@/lib/supabase/admin`.

**Planning view gotcha:** `PlanningViewEntry` (`src/components/planning/view-types.ts`) is a discriminated union on `source`. Both `planning-list-view.tsx` and `planning-calendar-view.tsx` end their per-entry render with an `else` fallback that ASSUMES `source === "event"` and reads `entry.eventId`. Adding a `note` source REQUIRES an explicit `if (entry.source === "note")` branch BEFORE that fallback in both files, plus adding `note` to every `SOURCE_RANK` / `sourceOrder` map (list view, calendar view, and the two builders in `planning-board.tsx`).

**Modal primitive:** No Radix/shadcn `Dialog` exists. Use `Sheet` from `src/components/ui/sheet.tsx` (portal, backdrop, focus trap, Escape, `role="dialog"`, `aria-modal`, `aria-labelledby`). Compound API: `<Sheet open onOpenChange>`, `<SheetContent side>`, `<SheetHeader>`, `<SheetTitle>`, `<SheetClose>`.

**Test commands:** `npm test` (Vitest, unit + component, `supabase/migrations/__tests__/*.test.ts` self-skip unless env flag set). `npm run typecheck`, `npm run lint`, `npm run build`. RLS integration test placed at `supabase/migrations/__tests__/*.test.ts` gates on `RUN_SUPABASE_MIGRATION_TESTS=1` and needs seeded users + minted JWTs in env.

---

# SLICE 1 - Foundation (schema, RLS, audit, capabilities, clash engine, actions)

No user-visible change. End state: table live with correct RLS, actions callable, clash engine and permissions fully unit-tested.

## Task 1: Migration - table, trigger, index

**Files:**
- Create: `supabase/migrations/20260720120000_add_venue_calendar_notes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Venue calendar notes: lightweight date-marked venue occupancy (weddings,
-- private hires) handled outside BaronsHub. No planning, no publishing.
begin;

create table if not exists public.venue_calendar_notes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  start_date date not null,
  end_date date null,
  title text not null,
  detail text null,
  created_by uuid null references public.users(id) on delete set null,
  deleted_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz null,
  constraint venue_calendar_notes_end_after_start
    check (end_date is null or (end_date >= start_date and end_date <= start_date + 31)),
  constraint venue_calendar_notes_title_length
    check (char_length(btrim(title)) between 1 and 200),
  constraint venue_calendar_notes_detail_length
    check (detail is null or char_length(detail) <= 2000)
);

create index if not exists idx_venue_calendar_notes_venue_dates
  on public.venue_calendar_notes (venue_id, start_date, end_date)
  where deleted_at is null;

drop trigger if exists trg_venue_calendar_notes_updated on public.venue_calendar_notes;
create trigger trg_venue_calendar_notes_updated
  before update on public.venue_calendar_notes
  for each row execute procedure public.set_updated_at();

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Dry-run the migration**

Run: `npx supabase db push --dry-run`
Expected: the new migration is listed, no destructive-operation warnings.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260720120000_add_venue_calendar_notes.sql
git commit -m "feat: add venue_calendar_notes table, trigger, index"
```

## Task 2: Migration - RLS policies

**Files:**
- Modify: `supabase/migrations/20260720120000_add_venue_calendar_notes.sql`

- [ ] **Step 1: Add RLS block before the final `commit;`**

Reuses the existing `public.current_user_role()` and `public.current_user_venue_id()` SECURITY DEFINER helpers (defined in `20260605143000_retire_executive_rename_manager_role.sql`). Read = any app role; INSERT/UPDATE = admin anywhere, manager only for own venue; no client DELETE (deletion is a soft-delete UPDATE).

```sql
alter table public.venue_calendar_notes enable row level security;

drop policy if exists "venue calendar notes read scoped" on public.venue_calendar_notes;
create policy "venue calendar notes read scoped"
  on public.venue_calendar_notes
  for select to authenticated
  using (
    public.current_user_role() in ('administrator', 'manager')
    and deleted_at is null
  );

drop policy if exists "venue calendar notes insert scoped" on public.venue_calendar_notes;
create policy "venue calendar notes insert scoped"
  on public.venue_calendar_notes
  for insert to authenticated
  with check (
    public.current_user_role() = 'administrator'
    or (
      public.current_user_role() = 'manager'
      and public.current_user_venue_id() is not null
      and venue_id = public.current_user_venue_id()
      and created_by = auth.uid()
    )
  );

drop policy if exists "venue calendar notes update scoped" on public.venue_calendar_notes;
create policy "venue calendar notes update scoped"
  on public.venue_calendar_notes
  for update to authenticated
  using (
    public.current_user_role() = 'administrator'
    or (
      public.current_user_role() = 'manager'
      and public.current_user_venue_id() is not null
      and venue_id = public.current_user_venue_id()
    )
  )
  with check (
    public.current_user_role() = 'administrator'
    or (
      public.current_user_role() = 'manager'
      and public.current_user_venue_id() is not null
      and venue_id = public.current_user_venue_id()
    )
  );
```

Note: no `for delete` policy is created, so RLS denies all client deletes. Deletion is done as a soft-delete UPDATE setting `deleted_at`. The SELECT policy's `deleted_at is null` makes soft-deleted rows invisible to clients (administrators recover via SQL if ever needed).

- [ ] **Step 2: Dry-run**

Run: `npx supabase db push --dry-run`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260720120000_add_venue_calendar_notes.sql
git commit -m "feat: RLS policies for venue_calendar_notes"
```

## Task 3: Migration - extend audit allow-lists + widen TS union

**Files:**
- Modify: `supabase/migrations/20260720120000_add_venue_calendar_notes.sql`
- Modify: `src/lib/audit-log.ts`

- [ ] **Step 1: Add audit constraint updates before the final `commit;`**

The `audit_log_entity_check` and `audit_log_action_check` constraints are exact enumerated allow-lists (newest definition in `20260604120000_baronshub_functional_fixes_foundation.sql`). Drop and recreate each with the full existing list plus the new `calendar_note` values. Copy the full lists verbatim from that migration; the additions are shown with `-- NEW` comments.

```sql
alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log
  add constraint audit_log_entity_check
  check (entity in (
    'event', 'sop_template', 'planning_task', 'auth',
    'customer', 'booking', 'user',
    'venue', 'artist', 'event_type', 'link', 'opening_hours', 'planning',
    'slt_member', 'business_settings', 'attachment', 'digest', 'payment',
    'sales_report', 'note',
    'calendar_note'  -- NEW
  )) not valid;

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check
  check (action in (
    'event.created', 'event.updated', 'event.artists_updated',
    'event.submitted', 'event.approved', 'event.needs_revisions',
    'event.rejected', 'event.cancelled', 'event.completed', 'event.assignee_changed',
    'event.deleted', 'event.status_changed', 'event.website_copy_generated',
    'event.debrief_updated', 'event.terms_generated',
    'event.draft_saved', 'event.booking_settings_updated',
    'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
    'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
    'sop_dependency.created', 'sop_dependency.deleted',
    'sop_checklist.generated', 'sop_checklist.dates_recalculated', 'sop_backfill_completed',
    'planning.item_created', 'planning.item_updated', 'planning.item_deleted',
    'planning.series_created', 'planning.series_updated', 'planning.series_paused',
    'planning.task_created', 'planning.task_updated', 'planning.task_deleted',
    'planning_task.status_changed', 'planning_task.reassigned',
    'planning_task.dependency_added', 'planning_task.dependency_removed',
    'planning_task.notes_updated',
    'planning_task.cascade_spawn',
    'planning_task.cascade_autocompleted',
    'planning_task.cascade_reopened',
    'planning_task.debrief_created',
    'planning_task.debrief_autocompleted',
    'planning_task.auto_not_required',
    'auth.login.success', 'auth.login.failure', 'auth.login.service_error',
    'auth.lockout', 'auth.logout',
    'auth.password_reset.requested', 'auth.password_updated',
    'auth.invite.sent', 'auth.invite.accepted', 'auth.invite.resent',
    'auth.role.changed',
    'auth.session.expired.idle', 'auth.session.expired.absolute',
    'customer.erased', 'booking.created', 'booking.updated', 'booking.cancelled',
    'user.deactivated', 'user.reactivated', 'user.deleted',
    'user.sensitive_column_changed', 'user.updated', 'user.central_lead_set',
    'user.preference_updated',
    'venue.created', 'venue.updated', 'venue.deleted',
    'artist.created', 'artist.updated', 'artist.archived', 'artist.restored',
    'event_type.created', 'event_type.updated', 'event_type.deleted',
    'link.created', 'link.updated', 'link.deleted',
    'opening_hours.service_type_created', 'opening_hours.service_type_updated',
    'opening_hours.service_type_deleted', 'opening_hours.hours_saved',
    'opening_hours.multi_venue_hours_saved',
    'opening_hours.override_created', 'opening_hours.override_updated',
    'opening_hours.override_deleted',
    'slt_member.added', 'slt_member.removed', 'slt_email.delivery_failed',
    'business_settings.updated',
    'attachment.uploaded', 'attachment.upload_failed', 'attachment.deleted',
    'attachment.version_added', 'attachment.renamed',
    'event.proposed', 'event.pre_approved', 'event.pre_rejected', 'event.pre_expired',
    'venue.category_changed',
    'sop_task_template.expansion_changed',
    'planning.inspiration_dismissed',
    'planning.inspiration_refreshed',
    'digest.batch_sent',
    'payment.order_created',
    'payment.order_creation_failed',
    'payment.captured',
    'payment.capture_failed',
    'payment.capture_local_update_failed',
    'payment.refund_requested',
    'payment.refund_completed',
    'payment.webhook_received',
    'payment.webhook_processed',
    'sales_report.sent',
    'note.created',
    'note.deleted',
    'calendar_note.created',  -- NEW
    'calendar_note.updated',  -- NEW
    'calendar_note.deleted'   -- NEW
  )) not valid;
```

> Before writing this step's final SQL, re-open `20260604120000_baronshub_functional_fixes_foundation.sql` and confirm no newer migration has further changed these two constraint lists; if so, start from the newest list. The lists above are correct as of migration `20260604120000`.

- [ ] **Step 2: Widen the audit TS union**

In `src/lib/audit-log.ts`, add `| "calendar_note"` to the `RecordAuditParams.entity` union (after `| "sales_report"`).

```ts
    | "payment"
    | "sales_report"
    | "calendar_note";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (the new union member is valid; no callers yet).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260720120000_add_venue_calendar_notes.sql src/lib/audit-log.ts
git commit -m "feat: allow calendar_note audit entity and actions"
```

## Task 4: Capability functions

**Files:**
- Modify: `src/lib/roles.ts`
- Test: `src/lib/__tests__/roles-calendar-notes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { canCreateCalendarNote, canManageCalendarNote } from "@/lib/roles";

describe("calendar note capabilities", () => {
  it("lets an administrator create for any venue", () => {
    expect(canCreateCalendarNote("administrator", null, "venue-x")).toBe(true);
  });
  it("lets a manager create only for their own venue", () => {
    expect(canCreateCalendarNote("manager", "venue-a", "venue-a")).toBe(true);
    expect(canCreateCalendarNote("manager", "venue-a", "venue-b")).toBe(false);
  });
  it("denies a manager with no venue", () => {
    expect(canCreateCalendarNote("manager", null, "venue-a")).toBe(false);
    expect(canManageCalendarNote("manager", null, "venue-a")).toBe(false);
  });
  it("lets an administrator manage any note", () => {
    expect(canManageCalendarNote("administrator", null, "venue-x")).toBe(true);
  });
  it("lets a manager manage only their own venue's note", () => {
    expect(canManageCalendarNote("manager", "venue-a", "venue-a")).toBe(true);
    expect(canManageCalendarNote("manager", "venue-a", "venue-b")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/roles-calendar-notes.test.ts`
Expected: FAIL, `canCreateCalendarNote is not a function`.

- [ ] **Step 3: Add the functions to `src/lib/roles.ts`** (place after the planning capability block)

```ts
/** Can create a calendar note for the target venue (admin anywhere; manager for own venue) */
export function canCreateCalendarNote(
  role: UserRole,
  userVenueId: string | null,
  targetVenueId: string
): boolean {
  if (role === "administrator") return true;
  return role === "manager" && Boolean(userVenueId) && userVenueId === targetVenueId;
}

/** Can edit/delete the calendar note at noteVenueId (admin anywhere; manager for own venue) */
export function canManageCalendarNote(
  role: UserRole,
  userVenueId: string | null,
  noteVenueId: string
): boolean {
  if (role === "administrator") return true;
  return role === "manager" && Boolean(userVenueId) && userVenueId === noteVenueId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/roles-calendar-notes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts src/lib/__tests__/roles-calendar-notes.test.ts
git commit -m "feat: calendar note capability functions"
```

## Task 5: Pure clash engine

**Files:**
- Create: `src/lib/calendar-notes/clash.ts`
- Test: `src/lib/calendar-notes/__tests__/clash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  CLASHING_EVENT_STATUSES,
  detectNoteClashes,
  eventOccupiedLondonDates,
  noteOccupiedDates,
  type ClashEventInput,
  type ClashNoteInput,
} from "@/lib/calendar-notes/clash";

const note = (over: Partial<ClashNoteInput> = {}): ClashNoteInput => ({
  id: "n1", venueId: "v-a", title: "Wedding", startDate: "2026-08-01", endDate: null, ...over,
});
const ev = (over: Partial<ClashEventInput> = {}): ClashEventInput => ({
  id: "e1", title: "Quiz", status: "draft",
  startAt: "2026-08-01T18:00:00.000Z", endAt: "2026-08-01T21:00:00.000Z",
  venueIds: ["v-a"], ...over,
});

describe("noteOccupiedDates", () => {
  it("returns the single day when end is null", () => {
    expect(noteOccupiedDates(note())).toEqual(["2026-08-01"]);
  });
  it("returns an inclusive range", () => {
    expect(noteOccupiedDates(note({ startDate: "2026-08-01", endDate: "2026-08-03" }))).toEqual([
      "2026-08-01", "2026-08-02", "2026-08-03",
    ]);
  });
});

describe("eventOccupiedLondonDates", () => {
  it("uses London calendar dates", () => {
    // 23:30 UTC on 1 Aug is 00:30 London on 2 Aug (BST +1)
    expect(eventOccupiedLondonDates("2026-08-01T23:30:00.000Z", "2026-08-01T23:45:00.000Z")).toEqual([
      "2026-08-02",
    ]);
  });
  it("treats an event ending by 05:00 next day as the start day only (early hours)", () => {
    // 20:00 to 02:00 London
    expect(eventOccupiedLondonDates("2026-08-01T19:00:00.000Z", "2026-08-02T01:00:00.000Z")).toEqual([
      "2026-08-01",
    ]);
  });
  it("occupies both days when the event ends after 05:00 next day", () => {
    // 20:00 London to 06:00 next day London
    expect(eventOccupiedLondonDates("2026-08-01T19:00:00.000Z", "2026-08-02T05:00:00.000Z")).toEqual([
      "2026-08-01", "2026-08-02",
    ]);
  });
  it("occupies the start day only when end is null", () => {
    expect(eventOccupiedLondonDates("2026-08-01T18:00:00.000Z", null)).toEqual(["2026-08-01"]);
  });
});

describe("detectNoteClashes", () => {
  it("flags an event overlapping a note at the same venue", () => {
    expect(detectNoteClashes([ev()], [note()])).toHaveLength(1);
  });
  it("ignores a different venue", () => {
    expect(detectNoteClashes([ev({ venueIds: ["v-b"] })], [note()])).toHaveLength(0);
  });
  it("matches via a secondary venue in the event's venue set", () => {
    expect(detectNoteClashes([ev({ venueIds: ["v-b", "v-a"] })], [note()])).toHaveLength(1);
  });
  it("ignores cancelled, rejected and completed events", () => {
    for (const status of ["cancelled", "rejected", "completed"]) {
      expect(detectNoteClashes([ev({ status })], [note()])).toHaveLength(0);
    }
  });
  it("ignores a note on a different date", () => {
    expect(detectNoteClashes([ev()], [note({ startDate: "2026-08-05" })])).toHaveLength(0);
  });
  it("matches a multi-day note that starts before the event day", () => {
    expect(
      detectNoteClashes([ev()], [note({ startDate: "2026-07-30", endDate: "2026-08-02" })])
    ).toHaveLength(1);
  });
  it("emits one row per event-note pair, ordered by clash date then title", () => {
    const result = detectNoteClashes(
      [ev({ id: "e2", title: "Alpha" }), ev({ id: "e1", title: "Beta" })],
      [note()]
    );
    expect(result.map((r) => r.event.id)).toEqual(["e2", "e1"]); // Alpha before Beta on same date
  });
  it("excludes exactly the three terminal statuses", () => {
    expect([...CLASHING_EVENT_STATUSES].sort()).toEqual(
      ["approved", "approved_pending_details", "draft", "needs_revisions", "pending_approval", "submitted"].sort()
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/calendar-notes/__tests__/clash.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/lib/calendar-notes/clash.ts`**

```ts
import { DISPLAY_TIMEZONE } from "@/lib/datetime";
import { addDays, londonDateString } from "@/lib/planning/utils";

/** Event statuses that occupy a venue for clash purposes (excludes terminal states). */
export const CLASHING_EVENT_STATUSES: readonly string[] = [
  "pending_approval",
  "approved_pending_details",
  "draft",
  "submitted",
  "needs_revisions",
  "approved",
];

/** Events ending at or before this many minutes past midnight count for the previous day. */
const EARLY_HOURS_THRESHOLD_MINUTES = 300;

export type ClashEventInput = {
  id: string;
  title: string;
  status: string;
  /** ISO UTC start timestamp. */
  startAt: string;
  /** ISO UTC end timestamp, or null (some proposals have no end). */
  endAt: string | null;
  /** Resolved venue set: event_venues venue ids, falling back to events.venue_id. */
  venueIds: string[];
};

export type ClashNoteInput = {
  id: string;
  venueId: string;
  title: string;
  /** London calendar date, YYYY-MM-DD. */
  startDate: string;
  /** Inclusive end date, YYYY-MM-DD, or null for a single day. */
  endDate: string | null;
};

export type NoteClash = { event: ClashEventInput; note: ClashNoteInput };

const londonTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIMEZONE,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

/** London wall-clock minutes-after-midnight for an ISO UTC timestamp. */
function londonMinutesAfterMidnight(iso: string): number {
  const parts = londonTimeFormatter.formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** All London calendar dates a note occupies, inclusive. */
export function noteOccupiedDates(note: ClashNoteInput): string[] {
  const end = note.endDate ?? note.startDate;
  const dates: string[] = [];
  let cursor = note.startDate;
  // Range length is validated to <= 31 days at write time; guard anyway.
  for (let i = 0; i <= 366 && cursor <= end; i++) {
    dates.push(cursor);
    if (cursor === end) break;
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/** All London calendar dates an event occupies, applying the early-hours rule. */
export function eventOccupiedLondonDates(startAt: string, endAt: string | null): string[] {
  const startDate = londonDateString(new Date(startAt));
  if (!endAt) return [startDate];

  const endDate = londonDateString(new Date(endAt));
  if (endDate <= startDate) return [startDate];

  // Ends in the early hours of the very next day, so counts for the start day only.
  if (endDate === addDays(startDate, 1) && londonMinutesAfterMidnight(endAt) <= EARLY_HOURS_THRESHOLD_MINUTES) {
    return [startDate];
  }

  const dates: string[] = [];
  let cursor = startDate;
  for (let i = 0; i <= 366 && cursor <= endDate; i++) {
    dates.push(cursor);
    if (cursor === endDate) break;
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/** Detect event-vs-note clashes. Pure: no I/O. One row per pair, ordered by clash date then event title. */
export function detectNoteClashes(events: ClashEventInput[], notes: ClashNoteInput[]): NoteClash[] {
  const clashes: Array<NoteClash & { clashDate: string }> = [];
  for (const event of events) {
    if (!CLASHING_EVENT_STATUSES.includes(event.status)) continue;
    const occupied = new Set(eventOccupiedLondonDates(event.startAt, event.endAt));
    for (const note of notes) {
      if (!event.venueIds.includes(note.venueId)) continue;
      const overlap = noteOccupiedDates(note).filter((d) => occupied.has(d));
      if (overlap.length > 0) {
        clashes.push({ event, note, clashDate: overlap[0] });
      }
    }
  }
  clashes.sort((a, b) => {
    if (a.clashDate !== b.clashDate) return a.clashDate.localeCompare(b.clashDate);
    return a.event.title.localeCompare(b.event.title);
  });
  return clashes.map(({ event, note }) => ({ event, note }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/calendar-notes/__tests__/clash.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-notes/clash.ts src/lib/calendar-notes/__tests__/clash.test.ts
git commit -m "feat: pure event-vs-note clash engine"
```

## Task 6: Data layer - types, mapping, listCalendarNotes, findNoteClashes

**Files:**
- Create: `src/lib/calendar-notes/index.ts`
- Test: `src/lib/calendar-notes/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing test** (mocks the supabase admin client; asserts snake to camel mapping, truncation flag, and manager scoping)

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from }),
}));

import { listCalendarNotes, findNoteClashes } from "@/lib/calendar-notes";

function noteRow(over: Record<string, unknown> = {}) {
  return {
    id: "n1", venue_id: "v-a", start_date: "2026-08-01", end_date: null,
    title: "Wedding", detail: "Marquee", created_by: "u1",
    created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
    venue: { id: "v-a", name: "The Star" }, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCalendarNotes", () => {
  it("maps rows to camelCase with venue name", async () => {
    const order = vi.fn().mockResolvedValue({ data: [noteRow()], error: null });
    from.mockReturnValue({ select: () => ({ is: () => ({ order }) }) });
    const result = await listCalendarNotes();
    expect(result.truncated).toBe(false);
    expect(result.notes[0]).toMatchObject({
      id: "n1", venueId: "v-a", venueName: "The Star", startDate: "2026-08-01",
      endDate: null, title: "Wedding", detail: "Marquee",
    });
  });

  it("flags truncation at the cap", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => noteRow({ id: `n${i}` }));
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    from.mockReturnValue({ select: () => ({ is: () => ({ order }) }) });
    const result = await listCalendarNotes();
    expect(result.truncated).toBe(true);
  });
});

describe("findNoteClashes", () => {
  it("returns admin-scoped clashes shaped for the card", async () => {
    // events query then notes query, two from() calls
    const eventsResult = {
      data: [{
        id: "e1", title: "Quiz", status: "draft",
        start_at: "2026-08-01T18:00:00Z", end_at: "2026-08-01T21:00:00Z",
        venue_id: "v-a", event_venues: [{ venue_id: "v-a" }],
      }],
      error: null,
    };
    from
      .mockReturnValueOnce({ select: () => ({ is: () => ({ gte: () => ({ lte: () => ({ order: () => eventsResult }) }) }) }) })
      .mockReturnValueOnce({ select: () => ({ is: () => ({ order: () => ({ data: [noteRow()], error: null }) }) }) });
    const clashes = await findNoteClashes({ all: true });
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({
      event: { id: "e1", title: "Quiz" },
      note: { id: "n1", title: "Wedding", venueName: "The Star" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/calendar-notes/__tests__/index.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/lib/calendar-notes/index.ts`**

```ts
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  detectNoteClashes,
  type ClashEventInput,
  type ClashNoteInput,
} from "@/lib/calendar-notes/clash";

const LIST_CAP = 2000;
const CLASH_WINDOW_DAYS = 90;

export type CalendarNote = {
  id: string;
  venueId: string;
  venueName: string;
  startDate: string;
  endDate: string | null;
  title: string;
  detail: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CalendarNoteClash = {
  event: { id: string; title: string };
  note: { id: string; title: string; venueName: string; startDate: string; endDate: string | null };
};

type NoteRow = {
  id: string;
  venue_id: string;
  start_date: string;
  end_date: string | null;
  title: string;
  detail: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  venue: { id: string; name: string } | { id: string; name: string }[] | null;
};

function mapNote(row: NoteRow): CalendarNote {
  const venue = Array.isArray(row.venue) ? row.venue[0] : row.venue;
  return {
    id: row.id,
    venueId: row.venue_id,
    venueName: venue?.name ?? "Unknown venue",
    startDate: row.start_date,
    endDate: row.end_date,
    title: row.title,
    detail: row.detail,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** All active notes, ordered by start date, hard-capped with a truncation flag. */
export async function listCalendarNotes(
  scope?: { venueId?: string }
): Promise<{ notes: CalendarNote[]; truncated: boolean }> {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("venue_calendar_notes")
    .select("id,venue_id,start_date,end_date,title,detail,created_by,created_at,updated_at,venue:venues(id,name)")
    .is("deleted_at", null);
  if (scope?.venueId) {
    query = query.eq("venue_id", scope.venueId);
  }
  const { data, error } = await query.order("start_date", { ascending: true });
  if (error) {
    throw new Error(`Could not load calendar notes: ${error.message}`);
  }
  const rows = (data ?? []) as NoteRow[];
  const truncated = rows.length >= LIST_CAP;
  if (truncated) {
    console.error(`[calendar-notes] list truncated at ${LIST_CAP} rows`);
  }
  return { notes: rows.slice(0, LIST_CAP).map(mapNote), truncated };
}

type ClashScope = { all: true } | { venueId: string };

/** Event-vs-note clashes over the next 90 days for the dashboard. */
export async function findNoteClashes(scope: ClashScope): Promise<CalendarNoteClash[]> {
  const supabase = createSupabaseAdminClient();
  const now = new Date();
  const ceiling = new Date(now.getTime() + CLASH_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data: eventData, error: eventError } = await supabase
    .from("events")
    .select("id,title,status,start_at,end_at,venue_id,event_venues(venue_id)")
    .is("deleted_at", null)
    .gte("start_at", now.toISOString())
    .lte("start_at", ceiling.toISOString())
    .order("start_at", { ascending: true });
  if (eventError) {
    throw new Error(`Could not load events for note clash check: ${eventError.message}`);
  }

  const events: ClashEventInput[] = (eventData ?? []).map((row: {
    id: string; title: string; status: string; start_at: string; end_at: string | null;
    venue_id: string; event_venues?: Array<{ venue_id: string }> | null;
  }) => {
    const linked = (row.event_venues ?? []).map((v) => v.venue_id).filter(Boolean);
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      startAt: row.start_at,
      endAt: row.end_at,
      venueIds: linked.length > 0 ? linked : [row.venue_id],
    };
  });

  const { notes } = await listCalendarNotes(scope.all ? undefined : { venueId: scope.venueId });
  const noteInputs: ClashNoteInput[] = notes.map((n) => ({
    id: n.id, venueId: n.venueId, title: n.title, startDate: n.startDate, endDate: n.endDate,
  }));
  const noteById = new Map(notes.map((n) => [n.id, n]));

  return detectNoteClashes(events, noteInputs).map(({ event, note }) => {
    const full = noteById.get(note.id)!;
    return {
      event: { id: event.id, title: event.title },
      note: { id: full.id, title: full.title, venueName: full.venueName, startDate: full.startDate, endDate: full.endDate },
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/calendar-notes/__tests__/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-notes/index.ts src/lib/calendar-notes/__tests__/index.test.ts
git commit -m "feat: calendar notes data layer and dashboard clash query"
```

## Task 7: Validation schemas

**Files:**
- Modify: `src/lib/validation.ts`
- Test: `src/lib/__tests__/validation-calendar-notes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  createCalendarNoteSchema,
  updateCalendarNoteSchema,
  deleteCalendarNoteSchema,
} from "@/lib/validation";

const base = { venueId: "11111111-1111-1111-1111-111111111111", title: "Wedding", startDate: "2026-08-01" };

describe("createCalendarNoteSchema", () => {
  it("accepts a minimal valid note", () => {
    expect(createCalendarNoteSchema.safeParse(base).success).toBe(true);
  });
  it("trims and requires a title", () => {
    expect(createCalendarNoteSchema.safeParse({ ...base, title: "   " }).success).toBe(false);
  });
  it("rejects an impossible date", () => {
    expect(createCalendarNoteSchema.safeParse({ ...base, startDate: "2026-02-31" }).success).toBe(false);
  });
  it("rejects an end date before the start", () => {
    const r = createCalendarNoteSchema.safeParse({ ...base, endDate: "2026-07-31" });
    expect(r.success).toBe(false);
  });
  it("rejects a range longer than 31 days", () => {
    const r = createCalendarNoteSchema.safeParse({ ...base, endDate: "2026-09-10" });
    expect(r.success).toBe(false);
  });
  it("normalises blank detail to undefined", () => {
    const r = createCalendarNoteSchema.safeParse({ ...base, detail: "   " });
    expect(r.success && r.data.detail).toBeUndefined();
  });
});

describe("updateCalendarNoteSchema", () => {
  it("requires id and expectedUpdatedAt", () => {
    expect(updateCalendarNoteSchema.safeParse(base).success).toBe(false);
    expect(updateCalendarNoteSchema.safeParse({
      ...base, id: "22222222-2222-2222-2222-222222222222", expectedUpdatedAt: "2026-07-01T00:00:00Z",
    }).success).toBe(true);
  });
});

describe("deleteCalendarNoteSchema", () => {
  it("requires id and expectedUpdatedAt", () => {
    expect(deleteCalendarNoteSchema.safeParse({
      id: "22222222-2222-2222-2222-222222222222", expectedUpdatedAt: "2026-07-01T00:00:00Z",
    }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/validation-calendar-notes.test.ts`
Expected: FAIL, schemas undefined.

- [ ] **Step 3: Add schemas to `src/lib/validation.ts`**

Add the import at the top (if `parseDateOnly`/`daysBetween` are not already imported) and the schemas at the end of the file. The `requiredText`/`optionalText` helpers already exist in this file.

```ts
import { daysBetween, parseDateOnly } from "@/lib/planning/utils";

const calendarDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    try {
      parseDateOnly(value);
      return true;
    } catch {
      return false;
    }
  }, "Use a real calendar date");

const calendarNoteBase = z.object({
  venueId: z.string().uuid(),
  title: requiredText(1, 200, "Add a short title"),
  detail: optionalText(2000),
  startDate: calendarDateString,
  endDate: calendarDateString.nullable().optional(),
});

function refineNoteDates(
  values: { startDate: string; endDate?: string | null },
  ctx: z.RefinementCtx
): void {
  if (!values.endDate) return;
  if (values.endDate < values.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End date is before the start date", path: ["endDate"] });
  } else if (daysBetween(values.startDate, values.endDate) > 31) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Notes can span at most 31 days", path: ["endDate"] });
  }
}

export const createCalendarNoteSchema = calendarNoteBase.superRefine(refineNoteDates);

export const updateCalendarNoteSchema = calendarNoteBase
  .extend({ id: z.string().uuid(), expectedUpdatedAt: z.string().min(1) })
  .superRefine(refineNoteDates);

export const deleteCalendarNoteSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1),
});
```

If `requiredText`/`optionalText` are not exported at the append point, they are module-level consts already defined earlier in the file; reference them directly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/validation-calendar-notes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts src/lib/__tests__/validation-calendar-notes.test.ts
git commit -m "feat: calendar note validation schemas"
```

## Task 8: Server actions

**Files:**
- Create: `src/actions/calendar-notes.ts`
- Test: `src/actions/__tests__/calendar-notes.test.ts`

The actions load the row first (read), check capability against its venue, then write with a concurrency predicate. Writes use `createSupabaseActionClient()` (RLS-respecting). Reads for capability use the same client (read policy allows both roles).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const actionFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn(async () => ({ from: actionFrom })),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ recordAuditLogEntry: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getCurrentUser } from "@/lib/auth";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { createCalendarNote, updateCalendarNote, deleteCalendarNote } from "@/actions/calendar-notes";

const mockUser = vi.mocked(getCurrentUser);
const mockAudit = vi.mocked(recordAuditLogEntry);

const admin = { id: "u1", email: "a@b.c", fullName: "A", role: "administrator" as const, venueId: null, deactivatedAt: null };
const mgrA = { ...admin, id: "u2", role: "manager" as const, venueId: "v-a" };
const VENUE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VENUE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const valid = { venueId: VENUE_A, title: "Wedding", startDate: "2026-08-01" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockUser.mockResolvedValue(admin);
});

describe("createCalendarNote", () => {
  it("creates and audits", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "n1", venue_id: VENUE_A, updated_at: "t" }, error: null });
    actionFrom.mockReturnValue({ insert: () => ({ select: () => ({ single }) }) });
    const result = await createCalendarNote(valid);
    expect(result.success).toBe(true);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ entity: "calendar_note", action: "calendar_note.created" }));
  });

  it("denies a manager creating for another venue", async () => {
    mockUser.mockResolvedValue(mgrA);
    const result = await createCalendarNote({ ...valid, venueId: VENUE_B });
    expect(result.success).toBe(false);
    expect(actionFrom).not.toHaveBeenCalled();
  });

  it("rejects invalid input with field errors", async () => {
    const result = await createCalendarNote({ ...valid, title: "  " });
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.title).toBeTruthy();
  });
});

describe("updateCalendarNote", () => {
  const patch = { id: "n1", venueId: VENUE_A, title: "New", startDate: "2026-08-01", expectedUpdatedAt: "t0" };

  function mockLoad(row: unknown) {
    // first from(): load existing row
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    actionFrom.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle }) }) });
  }

  it("updates when the concurrency token matches", async () => {
    mockLoad({ id: "n1", venue_id: VENUE_A, deleted_at: null, updated_at: "t0" });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "n1", venue_id: VENUE_A, updated_at: "t1" }, error: null });
    actionFrom.mockReturnValueOnce({ update: () => ({ eq: () => ({ is: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }) }) }) });
    const result = await updateCalendarNote(patch);
    expect(result.success).toBe(true);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "calendar_note.updated" }));
  });

  it("returns a conflict when the token is stale", async () => {
    mockLoad({ id: "n1", venue_id: VENUE_A, deleted_at: null, updated_at: "t0" });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null }); // predicate matched nothing
    actionFrom.mockReturnValueOnce({ update: () => ({ eq: () => ({ is: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }) }) }) });
    // re-read shows the row still exists
    const reread = vi.fn().mockResolvedValue({ data: { id: "n1", deleted_at: null }, error: null });
    actionFrom.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: reread }) }) });
    const result = await updateCalendarNote(patch);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/changed/i);
  });

  it("denies a manager updating another venue's note", async () => {
    mockUser.mockResolvedValue(mgrA);
    mockLoad({ id: "n1", venue_id: VENUE_B, deleted_at: null, updated_at: "t0" });
    const result = await updateCalendarNote({ ...patch, venueId: VENUE_B });
    expect(result.success).toBe(false);
  });

  it("reports not found when the row is missing", async () => {
    mockLoad(null);
    const result = await updateCalendarNote(patch);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });
});

describe("deleteCalendarNote", () => {
  it("soft-deletes and audits", async () => {
    const maybeSingleLoad = vi.fn().mockResolvedValue({ data: { id: "n1", venue_id: VENUE_A, deleted_at: null, updated_at: "t0" }, error: null });
    actionFrom.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: maybeSingleLoad }) }) });
    const maybeSingleDel = vi.fn().mockResolvedValue({ data: { id: "n1" }, error: null });
    actionFrom.mockReturnValueOnce({ update: () => ({ eq: () => ({ is: () => ({ eq: () => ({ select: () => ({ maybeSingle: maybeSingleDel }) }) }) }) }) });
    const result = await deleteCalendarNote({ id: "n1", expectedUpdatedAt: "t0" });
    expect(result.success).toBe(true);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "calendar_note.deleted" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/actions/__tests__/calendar-notes.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/actions/calendar-notes.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { canCreateCalendarNote, canManageCalendarNote } from "@/lib/roles";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { normaliseOptionalText } from "@/lib/normalise";
import {
  createCalendarNoteSchema,
  updateCalendarNoteSchema,
  deleteCalendarNoteSchema,
} from "@/lib/validation";

export type CalendarNoteActionResult = {
  success: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  noteId?: string;
  updatedAt?: string;
};

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  error.issues.forEach((issue) => {
    const key = issue.path.join(".") || "form";
    if (!result[key]) result[key] = issue.message;
  });
  return result;
}

const NOTE_PATHS = ["/", "/planning", "/events", "/events/new"];
function revalidateNotePaths(): void {
  NOTE_PATHS.forEach((path) => revalidatePath(path));
}

export async function createCalendarNote(input: unknown): Promise<CalendarNoteActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "Not authenticated." };

  const parsed = createCalendarNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  }

  if (!canCreateCalendarNote(user.role, user.venueId, parsed.data.venueId)) {
    return { success: false, message: "You do not have permission to add a note for this venue." };
  }

  try {
    const supabase = await createSupabaseActionClient();
    const { data, error } = await supabase
      .from("venue_calendar_notes")
      .insert({
        venue_id: parsed.data.venueId,
        title: parsed.data.title,
        detail: normaliseOptionalText(parsed.data.detail ?? null),
        start_date: parsed.data.startDate,
        end_date: parsed.data.endDate ?? null,
        created_by: user.id,
      })
      .select("id,venue_id,updated_at")
      .single();

    if (error || !data) {
      console.error("createCalendarNote insert failed:", error);
      return { success: false, message: "Could not add the note. Please try again." };
    }

    recordAuditLogEntry({
      entity: "calendar_note",
      entityId: data.id,
      action: "calendar_note.created",
      actorId: user.id,
      meta: { venueId: parsed.data.venueId, startDate: parsed.data.startDate, endDate: parsed.data.endDate ?? null },
    }).catch((e) => console.error("calendar_note.created audit failed:", e));

    revalidateNotePaths();
    return { success: true, message: "Note added.", noteId: data.id, updatedAt: data.updated_at };
  } catch (error) {
    console.error("createCalendarNote error:", error);
    return { success: false, message: "Could not add the note. Please try again." };
  }
}

export async function updateCalendarNote(input: unknown): Promise<CalendarNoteActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "Not authenticated." };

  const parsed = updateCalendarNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  }

  try {
    const supabase = await createSupabaseActionClient();

    const { data: existing, error: loadError } = await supabase
      .from("venue_calendar_notes")
      .select("id,venue_id,deleted_at,updated_at")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (loadError) {
      console.error("updateCalendarNote load failed:", loadError);
      return { success: false, message: "Could not load the note. Please try again." };
    }
    if (!existing || existing.deleted_at) {
      return { success: false, message: "Note not found. It may already have been deleted." };
    }
    // Permission is checked against BOTH the current venue and any requested new venue.
    if (
      !canManageCalendarNote(user.role, user.venueId, existing.venue_id) ||
      !canCreateCalendarNote(user.role, user.venueId, parsed.data.venueId)
    ) {
      return { success: false, message: "You do not have permission to edit this note." };
    }

    const { data, error } = await supabase
      .from("venue_calendar_notes")
      .update({
        venue_id: parsed.data.venueId,
        title: parsed.data.title,
        detail: normaliseOptionalText(parsed.data.detail ?? null),
        start_date: parsed.data.startDate,
        end_date: parsed.data.endDate ?? null,
      })
      .eq("id", parsed.data.id)
      .is("deleted_at", null)
      .eq("updated_at", parsed.data.expectedUpdatedAt)
      .select("id,updated_at")
      .maybeSingle();

    if (error) {
      console.error("updateCalendarNote update failed:", error);
      return { success: false, message: "Could not update the note. Please try again." };
    }
    if (!data) {
      const { data: still } = await supabase
        .from("venue_calendar_notes")
        .select("id,deleted_at")
        .eq("id", parsed.data.id)
        .maybeSingle();
      if (!still || still.deleted_at) {
        return { success: false, message: "Note not found. It may already have been deleted." };
      }
      return { success: false, message: "This note changed since you opened it. Reopen it and try again." };
    }

    recordAuditLogEntry({
      entity: "calendar_note",
      entityId: parsed.data.id,
      action: "calendar_note.updated",
      actorId: user.id,
      meta: { venueId: parsed.data.venueId, startDate: parsed.data.startDate, endDate: parsed.data.endDate ?? null },
    }).catch((e) => console.error("calendar_note.updated audit failed:", e));

    revalidateNotePaths();
    return { success: true, message: "Note updated.", noteId: parsed.data.id, updatedAt: data.updated_at };
  } catch (error) {
    console.error("updateCalendarNote error:", error);
    return { success: false, message: "Could not update the note. Please try again." };
  }
}

export async function deleteCalendarNote(input: unknown): Promise<CalendarNoteActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "Not authenticated." };

  const parsed = deleteCalendarNoteSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Invalid request." };

  try {
    const supabase = await createSupabaseActionClient();

    const { data: existing, error: loadError } = await supabase
      .from("venue_calendar_notes")
      .select("id,venue_id,deleted_at,updated_at")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (loadError) {
      console.error("deleteCalendarNote load failed:", loadError);
      return { success: false, message: "Could not load the note. Please try again." };
    }
    if (!existing || existing.deleted_at) {
      return { success: false, message: "Note not found. It may already have been deleted." };
    }
    if (!canManageCalendarNote(user.role, user.venueId, existing.venue_id)) {
      return { success: false, message: "You do not have permission to delete this note." };
    }

    const { data, error } = await supabase
      .from("venue_calendar_notes")
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq("id", parsed.data.id)
      .is("deleted_at", null)
      .eq("updated_at", parsed.data.expectedUpdatedAt)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("deleteCalendarNote update failed:", error);
      return { success: false, message: "Could not delete the note. Please try again." };
    }
    if (!data) {
      return { success: false, message: "This note changed since you opened it. Reopen it and try again." };
    }

    recordAuditLogEntry({
      entity: "calendar_note",
      entityId: parsed.data.id,
      action: "calendar_note.deleted",
      actorId: user.id,
      meta: { venueId: existing.venue_id },
    }).catch((e) => console.error("calendar_note.deleted audit failed:", e));

    revalidateNotePaths();
    return { success: true, message: "Note deleted." };
  } catch (error) {
    console.error("deleteCalendarNote error:", error);
    return { success: false, message: "Could not delete the note. Please try again." };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/actions/__tests__/calendar-notes.test.ts`
Expected: PASS. If a chained-mock shape mismatches, align the test's mock return shape to the exact query chain in the action (`.update().eq().is().eq().select().maybeSingle()`), not the other way around.

- [ ] **Step 5: Commit**

```bash
git add src/actions/calendar-notes.ts src/actions/__tests__/calendar-notes.test.ts
git commit -m "feat: calendar note server actions with permission and concurrency"
```

## Task 9: RLS integration test

**Files:**
- Create: `supabase/migrations/__tests__/venue_calendar_notes_rls.test.ts`

Copies the harness from `office_worker_event_scope.test.ts`: JWT-per-role clients, service-role seeding, self-skips unless `RUN_SUPABASE_MIGRATION_TESTS=1` and the JWT env vars are present. Reuses the existing manager JWTs (`SUPABASE_OW_JWT` = manager with venue, `SUPABASE_OTHER_OW_JWT` = manager other venue, `SUPABASE_OW_NO_VENUE_JWT` = manager without venue) and adds `SUPABASE_ADMIN_JWT`.

- [ ] **Step 1: Write the integration test**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const MGR_A_JWT = process.env.SUPABASE_OW_JWT ?? "";           // manager, venue A
const MGR_B_JWT = process.env.SUPABASE_OTHER_OW_JWT ?? "";      // manager, venue B
const MGR_NONE_JWT = process.env.SUPABASE_OW_NO_VENUE_JWT ?? ""; // manager, no venue
const ADMIN_JWT = process.env.SUPABASE_ADMIN_JWT ?? "";

const RUN = process.env.RUN_SUPABASE_MIGRATION_TESTS === "1";
const shouldRun = RUN && [SUPABASE_URL, SERVICE_ROLE, ANON, MGR_A_JWT, MGR_B_JWT, MGR_NONE_JWT, ADMIN_JWT].every(Boolean);
const describeFn = shouldRun ? describe : describe.skip;

function service(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
}
function asJwt(jwt: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describeFn("migration: venue_calendar_notes RLS", () => {
  const admin = service();
  let venueA = "";
  let venueB = "";
  let managerAId = "";
  const created: string[] = [];

  beforeAll(async () => {
    const { data: mgrA } = await admin.auth.getUser(MGR_A_JWT);
    managerAId = mgrA.user?.id ?? "";
    const { data: prof } = await admin.from("users").select("venue_id").eq("id", managerAId).single();
    venueA = prof?.venue_id ?? "";
    const { data: mgrB } = await admin.auth.getUser(MGR_B_JWT);
    const { data: profB } = await admin.from("users").select("venue_id").eq("id", mgrB.user?.id ?? "").single();
    venueB = profB?.venue_id ?? "";
  });

  afterAll(async () => {
    if (!shouldRun) return;
    for (const id of created) {
      await admin.from("venue_calendar_notes").delete().eq("id", id);
    }
  });

  it("lets a venue-A manager insert a note for venue A", async () => {
    const { data, error } = await asJwt(MGR_A_JWT)
      .from("venue_calendar_notes")
      .insert({ venue_id: venueA, start_date: "2026-08-01", title: "Wedding", created_by: managerAId })
      .select("id")
      .single();
    expect(error).toBeNull();
    if (data?.id) created.push(data.id);
    expect(data?.id).toBeTruthy();
  });

  it("stops a venue-A manager inserting a note for venue B", async () => {
    const { error } = await asJwt(MGR_A_JWT)
      .from("venue_calendar_notes")
      .insert({ venue_id: venueB, start_date: "2026-08-01", title: "Nope", created_by: managerAId })
      .select("id")
      .single();
    expect(error).toBeTruthy();
  });

  it("stops a manager without a venue inserting any note", async () => {
    const { error } = await asJwt(MGR_NONE_JWT)
      .from("venue_calendar_notes")
      .insert({ venue_id: venueA, start_date: "2026-08-01", title: "Nope" })
      .select("id")
      .single();
    expect(error).toBeTruthy();
  });

  it("lets an administrator insert a note for any venue", async () => {
    const { data, error } = await asJwt(ADMIN_JWT)
      .from("venue_calendar_notes")
      .insert({ venue_id: venueB, start_date: "2026-08-02", title: "Admin note" })
      .select("id")
      .single();
    expect(error).toBeNull();
    if (data?.id) created.push(data.id);
  });

  it("hides soft-deleted notes from reads", async () => {
    const { data } = await admin
      .from("venue_calendar_notes")
      .insert({ venue_id: venueA, start_date: "2026-08-03", title: "To hide" })
      .select("id")
      .single();
    if (data?.id) {
      created.push(data.id);
      await admin.from("venue_calendar_notes").update({ deleted_at: new Date().toISOString() }).eq("id", data.id);
      const { data: visible } = await asJwt(MGR_A_JWT).from("venue_calendar_notes").select("id").eq("id", data.id);
      expect(visible ?? []).toHaveLength(0);
    }
  });
});
```

- [ ] **Step 2: Verify it self-skips locally**

Run: `npx vitest run supabase/migrations/__tests__/venue_calendar_notes_rls.test.ts`
Expected: the suite is skipped (env flag unset), reported as skipped, not failed.

- [ ] **Step 3: Document the required env for CI**

Add a one-line note to `docs/testing/integration.md` (or create it) listing the new `SUPABASE_ADMIN_JWT` requirement alongside the existing manager JWTs.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/__tests__/venue_calendar_notes_rls.test.ts docs/testing/integration.md
git commit -m "test: RLS integration coverage for venue_calendar_notes"
```

## Task 10: Slice 1 verification + apply migration

**Files:** none (verification only)

- [ ] **Step 1: Regenerate Supabase types**

The generated `src/lib/supabase/database.types.ts` and hand-maintained `src/lib/supabase/types.ts` must include the new table. Apply the migration to the linked project first (`npm run supabase:migrate`), then regenerate types with the project's generation command (check `package.json`; typically `npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts`). Manually add the `venue_calendar_notes` Row/Insert/Update shape to `src/lib/supabase/types.ts` mirroring an existing table entry.

- [ ] **Step 2: Full pipeline**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 3: Advisors**

Run: `npm run advisors`
Expected: no new security/performance advisories for `venue_calendar_notes` (RLS enabled, index present).

- [ ] **Step 4: Commit any type regeneration**

```bash
git add src/lib/supabase/database.types.ts src/lib/supabase/types.ts
git commit -m "chore: regenerate supabase types for venue_calendar_notes"
```

**Slice 1 is now independently mergeable.** Open a PR titled `feat: venue calendar notes foundation (1/3)`.

---

# SLICE 2 - Calendar management (shared editor, planning + events rendering)

End state: staff can add/edit/delete notes from the planning and events calendars (desktop and mobile); notes are visible on all calendar surfaces.

## Task 11: Extend `PlanningViewEntry` with a `note` source

**Files:**
- Modify: `src/components/planning/view-types.ts`

- [ ] **Step 1: Add the `note` union member**

```ts
  | {
      id: string;
      source: "note";
      targetDate: string;
      title: string;
      venueLabel: string;
      noteId: string;
      startDate: string;
      endDate: string | null;
      detail: string | null;
      venueId: string;
    };
```

- [ ] **Step 2: Typecheck (expected to reveal the fallback gotcha)**

Run: `npm run typecheck`
Expected: errors in `planning-list-view.tsx` and `planning-calendar-view.tsx` where the `event`-assuming fallback now receives `note`. These are fixed in Task 13. Do not commit yet.

## Task 12: Shared note editor dialog

**Files:**
- Create: `src/components/calendar-notes/calendar-note-dialog.tsx`
- Create: `src/components/calendar-notes/calendar-note-entry-styles.ts`
- Test: `src/components/calendar-notes/__tests__/calendar-note-dialog.test.tsx`

- [ ] **Step 1: Write the shared entry style constant** (`calendar-note-entry-styles.ts`), used by every note render so the look is identical and never colour-only (pin icon + "Note" label):

```ts
/** Shared class for a note pill/row on any calendar surface. Uses the --plum token. */
export const NOTE_ENTRY_CLASS =
  "block rounded-[var(--radius-sm)] border-l-4 border-[var(--plum,#6b4e9e)] bg-[var(--plum-tint,#f3eefb)] px-2 py-1 text-[0.72rem] leading-tight text-[var(--ink)]";

export const NOTE_LABEL = "Note";
```

> Check `src/app/globals.css` for an existing distinct token (e.g. `--plum`, `--purple`, `--info`) not already used by planning (navy), events (mustard) or inspiration (amber). If none exists, add one `@theme inline` token rather than hardcoding the hex fallback shown above.

- [ ] **Step 2: Write the failing dialog test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CalendarNoteDialog } from "@/components/calendar-notes/calendar-note-dialog";

vi.mock("@/actions/calendar-notes", () => ({
  createCalendarNote: vi.fn().mockResolvedValue({ success: true }),
  updateCalendarNote: vi.fn().mockResolvedValue({ success: true }),
  deleteCalendarNote: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { createCalendarNote } from "@/actions/calendar-notes";

const venues = [{ id: "v-a", name: "The Star" }];

beforeEach(() => vi.clearAllMocks());

describe("CalendarNoteDialog", () => {
  it("creates a note with title and date", async () => {
    render(<CalendarNoteDialog open mode="create" venues={venues} canManage onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Wedding" } });
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));
    await waitFor(() => expect(createCalendarNote).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Wedding", startDate: "2026-08-01", venueId: "v-a" })
    ));
  });

  it("shows a read-only view when the user cannot manage", () => {
    render(<CalendarNoteDialog open mode="edit" venues={venues} canManage={false}
      note={{ id: "n1", venueId: "v-a", title: "Wedding", startDate: "2026-08-01", endDate: null, detail: null, updatedAt: "t0" }}
      onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /save note/i })).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/calendar-notes/__tests__/calendar-note-dialog.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `calendar-note-dialog.tsx`**

A `Sheet`-based client component. Props and body:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createCalendarNote, updateCalendarNote, deleteCalendarNote } from "@/actions/calendar-notes";

export type CalendarNoteDialogNote = {
  id: string; venueId: string; title: string; startDate: string;
  endDate: string | null; detail: string | null; updatedAt: string;
};

type CalendarNoteDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  venues: Array<{ id: string; name: string }>;
  canManage: boolean;
  note?: CalendarNoteDialogNote;
  defaultDate?: string;
  fixedVenueId?: string; // set for venue-scoped managers; disables the venue select
  onClose: () => void;
};

export function CalendarNoteDialog(props: CalendarNoteDialogProps): React.ReactNode {
  const router = useRouter();
  const [venueId, setVenueId] = useState(props.note?.venueId ?? props.fixedVenueId ?? props.venues[0]?.id ?? "");
  const [title, setTitle] = useState(props.note?.title ?? "");
  const [startDate, setStartDate] = useState(props.note?.startDate ?? props.defaultDate ?? "");
  const [endDate, setEndDate] = useState(props.note?.endDate ?? "");
  const [detail, setDetail] = useState(props.note?.detail ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const readOnly = !props.canManage;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setPending(true);
    setError(null);
    const payload = { venueId, title, startDate, endDate: endDate || null, detail: detail || undefined };
    const result = props.mode === "create"
      ? await createCalendarNote(payload)
      : await updateCalendarNote({ ...payload, id: props.note!.id, expectedUpdatedAt: props.note!.updatedAt });
    setPending(false);
    if (!result.success) {
      setError(result.message ?? "Could not save the note.");
      return;
    }
    router.refresh();
    props.onClose();
  }

  async function handleDelete() {
    if (!props.note) return;
    setPending(true);
    const result = await deleteCalendarNote({ id: props.note.id, expectedUpdatedAt: props.note.updatedAt });
    setPending(false);
    if (!result.success) {
      setError(result.message ?? "Could not delete the note.");
      return;
    }
    router.refresh();
    props.onClose();
  }

  return (
    <Sheet open={props.open} onOpenChange={(next) => { if (!next) props.onClose(); }}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle className="font-brand-serif text-[19px] font-medium text-[var(--navy)]">
            {props.mode === "create" ? "Add calendar note" : readOnly ? "Calendar note" : "Edit calendar note"}
          </SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto px-5 py-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Venue</span>
            <select
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
              disabled={readOnly || Boolean(props.fixedVenueId)}
              className="min-h-11 w-full rounded-[11px] border border-[var(--hair)] px-3"
            >
              {props.venues.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Title</span>
            <input
              value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} required maxLength={200}
              className="min-h-11 w-full rounded-[11px] border border-[var(--hair)] px-3"
            />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1 text-sm">
              <span className="mb-1 block font-medium">Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={readOnly} required
                className="min-h-11 w-full rounded-[11px] border border-[var(--hair)] px-3" />
            </label>
            <label className="block flex-1 text-sm">
              <span className="mb-1 block font-medium">End date (optional)</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={readOnly}
                className="min-h-11 w-full rounded-[11px] border border-[var(--hair)] px-3" />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Detail (optional)</span>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} disabled={readOnly} maxLength={2000} rows={3}
              className="w-full rounded-[11px] border border-[var(--hair)] px-3 py-2" />
            <span className="mt-1 block text-xs text-subtle">Do not include contact, payment or other personal details.</span>
          </label>

          {error ? <p role="status" className="text-sm text-[var(--burgundy)]">{error}</p> : null}

          {!readOnly ? (
            <div className="flex items-center justify-between gap-3">
              {props.mode === "edit" ? (
                <button type="button" onClick={() => setConfirmDelete(true)} disabled={pending}
                  className="text-sm font-semibold text-[var(--burgundy)]">Delete</button>
              ) : <span />}
              <button type="submit" disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-[11px] bg-[var(--navy)] px-4 text-sm font-semibold text-white disabled:opacity-60">
                {pending ? "Saving" : "Save note"}
              </button>
            </div>
          ) : null}
        </form>
      </SheetContent>

      {confirmDelete ? (
        <ConfirmDialog
          open
          title="Delete this note?"
          description="This removes the note from the calendars. It can be recovered by an administrator if needed."
          confirmLabel="Delete note"
          cancelLabel="Keep note"
          variant="danger"
          onConfirm={() => { setConfirmDelete(false); void handleDelete(); }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </Sheet>
  );
}
```

> Confirm `ConfirmDialog`'s exact prop names against `src/components/ui/confirm-dialog.tsx` before finalising (recon reported `open, title, description, confirmLabel, cancelLabel, variant, onConfirm, onCancel`). Adjust if the `variant` enum differs.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/calendar-notes/__tests__/calendar-note-dialog.test.tsx`
Expected: PASS. (If `@testing-library/react` is not configured, follow the existing component-test setup used elsewhere in the repo; check `vitest.config.ts` for a jsdom env. If component tests use a separate config, mirror it.)

- [ ] **Step 6: Commit**

```bash
git add src/components/calendar-notes/
git commit -m "feat: shared calendar note editor dialog"
```

## Task 13: Render notes on the planning calendar

**Files:**
- Modify: `src/components/planning/planning-list-view.tsx`
- Modify: `src/components/planning/planning-calendar-view.tsx`
- Modify: `src/components/planning/planning-board.tsx`
- Modify: `src/app/planning/page.tsx`

- [ ] **Step 1: Add explicit `note` branches BEFORE the event fallback**

In `planning-calendar-view.tsx`, inside the day-cell render, add before the final `return (<Link ...>)`:

```tsx
    if (entry.source === "note") {
      return (
        <button
          key={entry.id}
          type="button"
          onClick={() => onOpenNote?.(entry)}
          className={NOTE_ENTRY_CLASS + " w-full text-left"}
          title={entry.title}
        >
          {"📌 "}{entry.title}
        </button>
      );
    }
```

Import `NOTE_ENTRY_CLASS` from `@/components/calendar-notes/calendar-note-entry-styles`. Add `onOpenNote?: (entry: Extract<PlanningViewEntry, { source: "note" }>) => void` to `PlanningCalendarViewProps`. Notes render FIRST in the cell and are NOT subject to the `slice(0, 3)` overflow: split the day's rows into `noteRows = rows.filter((r) => r.source === "note")` and `otherRows = rows.filter((r) => r.source !== "note")`, render all `noteRows`, then `otherRows.slice(0, 3)`, and compute the `+N more` label from `otherRows.length`.

In `planning-list-view.tsx`, add the same explicit `if (entry.source === "note")` branch before the event fallback, rendering a full-width row with the pin + "Note" label:

```tsx
  if (entry.source === "note") {
    return (
      <button key={entry.id} type="button" onClick={() => onOpenNote?.(entry)}
        className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--hair)] border-l-4 border-l-[var(--plum,#6b4e9e)] bg-[var(--paper)] px-3 py-2 text-left hover:bg-[var(--paper-tint)]">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-[var(--ink)]">{"📌 "}{entry.title}</span>
          <span className="block text-xs text-subtle">Note {"·"} {entry.venueLabel}</span>
        </span>
      </button>
    );
  }
```

- [ ] **Step 2: Add `note` to every SOURCE_RANK / sourceOrder map**

- `planning-list-view.tsx` (around line 39): `{ note: 0, planning: 1, event: 2, inspiration: 3 }`
- `planning-calendar-view.tsx` (around line 59): `{ note: 0, planning: 1, event: 2, inspiration: 3 }`
- `planning-board.tsx` `combinedEntries` builder (around line 580) and `calendarCombinedEntries` builder (around line 628): `{ note: 0, planning: 1, event: 2, inspiration: 3 }`

- [ ] **Step 3: Build note entries in `planning-board.tsx`**

Add a `notes` prop to `PlanningBoardProps` (`notes: CalendarNote[]` from `@/lib/calendar-notes`). In the `calendarCombinedEntries` builder, map notes into `PlanningViewEntry[]` and include them in the returned array (calendar view only; do NOT add to `combinedEntries` for the list, per spec: notes appear on the calendar and the continuous list filters them out). Expand a multi-day note into one entry per occupied day:

```tsx
const noteEntries: PlanningViewEntry[] = notes.flatMap((note) => {
  const days: string[] = [];
  let cursor = note.startDate;
  const end = note.endDate ?? note.startDate;
  for (let i = 0; i <= 366 && cursor <= end; i++) {
    days.push(cursor);
    if (cursor === end) break;
    cursor = addDays(cursor, 1);
  }
  return days.map((day) => ({
    id: `note-${note.id}-${day}`,
    source: "note" as const,
    targetDate: day,
    title: note.title,
    venueLabel: note.venueName,
    noteId: note.id,
    startDate: note.startDate,
    endDate: note.endDate,
    detail: note.detail,
    venueId: note.venueId,
  }));
});
```

Import `addDays` from `@/lib/planning/utils`. Include `...noteEntries` in the `calendarCombinedEntries` return array before the sort. Respect the existing venue filter: filter `notes` by the active venue filter the same way events are filtered. Wire an `onOpenNote` handler through `PlanningBoard` that opens `CalendarNoteDialog` in edit mode with `canManage = canManageCalendarNote(userRole, currentUserVenueId, entry.venueId)`. Add an "Add note" button to the calendar tab header opening the dialog in create mode (`fixedVenueId` set for venue-scoped managers).

- [ ] **Step 4: Fetch notes in `src/app/planning/page.tsx`**

Add `listCalendarNotes()` to the `Promise.all`, wrapped so a failure does not fail the page:

```ts
listCalendarNotes().catch(() => ({ notes: [], truncated: false, failed: true as const })),
```

Pass `notes={notesResult.notes}`, `notesTruncated={notesResult.truncated}`, and `notesFailed={"failed" in notesResult}` to `<PlanningBoard>`. When `notesTruncated`, render a visible banner in the calendar tab: "Some venue notes are not shown." When `notesFailed`, render "Venue notes could not be loaded" (the calendar still renders its other data).

- [ ] **Step 5: Typecheck + tests**

Run: `npm run typecheck && npx vitest run src/components/planning`
Expected: clean; the `note` fallback errors from Task 11 Step 2 are resolved.

- [ ] **Step 6: Commit**

```bash
git add src/components/planning/ src/app/planning/page.tsx
git commit -m "feat: render and manage calendar notes on the planning calendar"
```

## Task 14: Render notes on the events calendar (desktop + mobile)

**Files:**
- Modify: `src/components/events/event-calendar.tsx`
- Modify: `src/components/events/events-board.tsx`
- Modify: the events page server component that renders `EventsBoard` (find via `rg "<EventsBoard"`)

- [ ] **Step 1: Add a `notes` prop to `EventCalendar`**

Add `notes: CalendarNote[]` to `EventCalendarProps`. Group notes by occupied `YYYY-MM-DD` (expand multi-day). In each day cell (where `dayEvents.slice(0, 3)` renders), render the day's note pills FIRST, above events, using `NOTE_ENTRY_CLASS` with the pin and title, each a button calling a new `onOpenNote?: (note: CalendarNote) => void` prop. Notes are not counted in the events `slice(0, 3)` / overflow.

- [ ] **Step 2: Thread `notes` from `EventsBoard`**

Add `notes: CalendarNote[]` to `EventsBoard` props. Pass `notes` into `<EventCalendar>` in the desktop `hidden md:block` block. For mobile, inject note rows into `MobileEventAgenda` (recon: mobile has no calendar grid; it is an agenda list fed by `mobileVisibleEvents`). Add `notes` to `MobileEventAgenda` props and render note rows interleaved by date. Add an "Add note" control: on desktop next to the calendar header, on mobile a secondary action near the "New event" FAB. Both open `CalendarNoteDialog`.

- [ ] **Step 3: Fetch notes in the events page server component**

Add `listCalendarNotes()` (with the same `.catch` fallback) to the page's data loading and pass `notes` into `<EventsBoard>`.

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/events/ src/app/events/
git commit -m "feat: show and manage calendar notes on the events calendar and mobile agenda"
```

## Task 15: Slice 2 verification (browser)

**Files:** none

- [ ] **Step 1: Run the dev server and verify** using the preview tools: create a note at a venue on the planning calendar, confirm it appears on that day and on every day of a multi-day range, confirm it also appears on the events calendar and mobile agenda (resize to mobile), edit it, delete it. Confirm managers only see their venue in the dialog's venue select. Capture a screenshot.

- [ ] **Step 2: Full pipeline**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: green.

**Slice 2 is now independently mergeable.** PR title: `feat: venue calendar notes management (2/3)`.

---

# SLICE 3 - Clash surfaces (form warnings, dashboard, public API guard, E2E)

## Task 16: Client clash helper for forms

**Files:**
- Create: `src/lib/calendar-notes/form-clash.ts`
- Test: `src/lib/calendar-notes/__tests__/form-clash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { notesClashingWithSelection } from "@/lib/calendar-notes/form-clash";

const notes = [
  { id: "n1", venueId: "v-a", title: "Wedding", startDate: "2026-08-01", endDate: null },
  { id: "n2", venueId: "v-b", title: "Fair", startDate: "2026-08-01", endDate: null },
];

describe("notesClashingWithSelection", () => {
  it("returns notes at any selected venue on the chosen date", () => {
    const r = notesClashingWithSelection(
      { venueIds: ["v-a"], startAt: "2026-08-01T18:00:00Z", endAt: "2026-08-01T21:00:00Z" },
      notes
    );
    expect(r.map((n) => n.id)).toEqual(["n1"]);
  });
  it("returns empty when no venue matches", () => {
    const r = notesClashingWithSelection(
      { venueIds: ["v-c"], startAt: "2026-08-01T18:00:00Z", endAt: "2026-08-01T21:00:00Z" },
      notes
    );
    expect(r).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/calendar-notes/__tests__/form-clash.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `form-clash.ts`** (reuses the pure engine; treats the in-progress event as always-clashing status)

```ts
import { detectNoteClashes, type ClashNoteInput } from "@/lib/calendar-notes/clash";

export type FormNote = ClashNoteInput;

export function notesClashingWithSelection(
  selection: { venueIds: string[]; startAt: string; endAt: string | null },
  notes: FormNote[]
): FormNote[] {
  if (!selection.startAt || selection.venueIds.length === 0) return [];
  const clashes = detectNoteClashes(
    [{ id: "__form__", title: "", status: "draft", startAt: selection.startAt, endAt: selection.endAt, venueIds: selection.venueIds }],
    notes
  );
  const seen = new Set(clashes.map((c) => c.note.id));
  return notes.filter((n) => seen.has(n.id));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/calendar-notes/__tests__/form-clash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-notes/form-clash.ts src/lib/calendar-notes/__tests__/form-clash.test.ts
git commit -m "feat: client-side note clash helper for event forms"
```

## Task 17: Warning on the create/edit event form

**Files:**
- Modify: `src/components/events/event-form.tsx`
- Modify: the server parent that renders `event-form.tsx` (find via `rg "<EventForm"`)

- [ ] **Step 1: Pass notes into the form**

The server parent fetches `listCalendarNotes()` (with `.catch` fallback returning `{ notes: [], failed: true }`) and passes `notes` and `notesUnavailable` (true on the catch path) into `EventForm`.

- [ ] **Step 2: Compute and render the warning**

In `event-form.tsx`, derive the selected venue id(s) and the start/end timestamps from existing form state (recon: `eventVenueId` at line 470, `venueIds` hidden field, `expectedUpdatedAt` at 321; reuse the same date/time state the form already builds for `start_at`/`end_at`). Compute `const clashingNotes = useMemo(() => notesClashingWithSelection({ venueIds, startAt, endAt }, notes), [venueIds, startAt, endAt, notes])`. Render near the date field:

```tsx
{notesUnavailable ? (
  <p className="mt-2 text-xs text-subtle">Clash check unavailable. Venue notes could not be loaded.</p>
) : clashingNotes.length > 0 ? (
  <p role="status" className="mt-2 rounded-[8px] border border-[var(--plum,#6b4e9e)] bg-[var(--plum-tint,#f3eefb)] px-3 py-2 text-xs text-[var(--ink)]">
    {"⚠️"} Heads up: {clashingNotes.map((n) => `"${n.title}"`).join(", ")} noted at this venue on this date. You can still save.
  </p>
) : null}
```

Saving is unaffected (advisory only).

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/events/event-form.tsx src/app/events/
git commit -m "feat: warn on the event form when a venue note clashes"
```

## Task 18: Warning on the propose and reschedule flows

**Files:**
- Modify: `src/components/events/propose-event-form.tsx`
- Modify: `src/components/events/reschedule-wizard.tsx`
- Modify: their server parents

- [ ] **Step 1: Thread notes into both**

Same pattern as Task 17: server parent fetches notes, passes `notes` + `notesUnavailable`. In `propose-event-form.tsx` and `reschedule-wizard.tsx`, compute `notesClashingWithSelection` from each form's venue+date state and render the same warning block near the date field. For the reschedule wizard, use the NEW proposed date/venue (the whole point is warning about the target date).

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/events/propose-event-form.tsx src/components/events/reschedule-wizard.tsx src/app/
git commit -m "feat: warn on propose and reschedule flows when a venue note clashes"
```

## Task 19: Dashboard note clashes

**Files:**
- Modify: `src/components/dashboard/context-cards/conflicts-card.tsx`
- Modify: `src/app/page.tsx`
- Test: `src/components/dashboard/context-cards/__tests__/conflicts-card.test.tsx`

- [ ] **Step 1: Write the failing card test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConflictsCard } from "@/components/dashboard/context-cards/conflicts-card";

describe("ConflictsCard note clashes", () => {
  it("renders note clashes distinctly", () => {
    render(<ConflictsCard conflicts={[]} noteClashes={[
      { event: { id: "e1", title: "Quiz" }, note: { id: "n1", title: "Wedding", venueName: "The Star", startDate: "2026-08-01", endDate: null } },
    ]} />);
    expect(screen.getByText(/Wedding/)).toBeTruthy();
    expect(screen.getByText(/clashes with note/i)).toBeTruthy();
  });
  it("shows the empty state when both are empty", () => {
    render(<ConflictsCard conflicts={[]} noteClashes={[]} />);
    expect(screen.getByText(/No conflicts spotted/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/dashboard/context-cards/__tests__/conflicts-card.test.tsx`
Expected: FAIL, `noteClashes` prop unknown.

- [ ] **Step 3: Extend `ConflictsCard`**

Add to the props and type:

```ts
export type NoteClash = {
  event: { id: string; title: string };
  note: { id: string; title: string; venueName: string; startDate: string; endDate: string | null };
};

type ConflictsCardProps = {
  conflicts: ConflictPair[] | null;
  noteClashes?: NoteClash[] | null;
};
```

Inside `CardContent`, after the existing conflicts block, render note clashes with a distinct plum row (never colour-only; include the pin and the words "clashes with note"):

```tsx
{noteClashes && noteClashes.length > 0 ? (
  <div className="space-y-2">
    {noteClashes.map((c) => (
      <div key={`${c.event.id}-${c.note.id}`}
        className="rounded-[8px] border border-[var(--plum,#6b4e9e)] bg-[var(--plum-tint,#f3eefb)] px-3 py-2 text-xs text-[var(--ink)]">
        <Link href={`/events/${c.event.id}`} className="font-semibold hover:underline">{c.event.title}</Link>{" "}
        {"📌"} clashes with note:{" "}
        <Link href={`/events?month=${c.note.startDate.slice(0, 7)}`} className="font-medium hover:underline">{c.note.title}</Link>
        {" · "}{c.note.venueName}
      </div>
    ))}
  </div>
) : null}
```

Update the empty-state so "No conflicts spotted." shows only when BOTH `conflicts` is empty AND (`noteClashes` is null or empty).

- [ ] **Step 4: Wire the dashboard (`src/app/page.tsx`)**

- In the `user.role === "administrator"` branch, add `safeFetch(findNoteClashes({ all: true }))` to the `Promise.all` and pass the result as `noteClashes` to both `<ConflictsCard>` renders.
- For managers with a venue: add a manager branch that fetches `safeFetch(findNoteClashes({ venueId: user.venueId }))` and renders `<ConflictsCard conflicts={[]} noteClashes={managerNoteClashes} />` (note-only card). Managers without a venue: no card.

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run src/components/dashboard && npm run typecheck && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/context-cards/conflicts-card.tsx src/app/page.tsx
git commit -m "feat: surface venue note clashes on the dashboard for admins and managers"
```

## Task 20: Events calendar deep-link month + public API guard test

**Files:**
- Modify: `src/components/events/events-board.tsx`
- Create: `src/lib/public-api/__tests__/no-calendar-notes.test.ts`

- [ ] **Step 1: Honour a `month` query param on the events board**

The dashboard note-clash links go to `/events?month=YYYY-MM`. In `events-board.tsx`, initialise `monthCursor` from a `month` search param when present (parse with `dayjs(monthParam + "-01").startOf("month")`, falling back to the current default `dayjs().startOf("month")` when absent or invalid). Read the param via the existing router/searchParams mechanism the board already uses, or accept an `initialMonth?: string` prop set by the server parent from `searchParams`.

- [ ] **Step 2: Write the public API regression test**

Assert that the serialised public event shape contains no note fields. Model it on the existing public-api tests in `src/lib/public-api/__tests__/`. Assert the `toPublicEvent` serializer output does not include any note-related field:

```ts
import { describe, expect, it } from "vitest";
import { toPublicEvent } from "@/lib/public-api/events";

describe("public API excludes calendar notes", () => {
  it("serialised public event has no note fields", () => {
    const raw = { /* minimal RawEventRow fixture, copy from an existing public-api test */ } as any;
    const result = toPublicEvent(raw);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toMatch(/calendar_note|venue_calendar_notes|noteClash/i);
  });
});
```

- [ ] **Step 3: Run + build**

Run: `npx vitest run src/lib/public-api && npm run build`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/components/events/events-board.tsx src/lib/public-api/__tests__/no-calendar-notes.test.ts
git commit -m "feat: deep-link events month from dashboard; guard public API from notes"
```

## Task 21: E2E journey

**Files:**
- Create: `tests/e2e/venue-calendar-notes.spec.ts` (match the repo's existing Playwright layout under `tests/e2e`)

- [ ] **Step 1: Write the Playwright journey**

Model on an existing spec in `tests/e2e`. Journey: sign in as an administrator, open the planning calendar, add a note at a venue for a future date, assert it appears on that day, open the events calendar for the same month, assert the note pill is present, start creating an event at that venue/date, assert the clash warning appears, save the event anyway (succeeds), open the dashboard, assert the note clash row is present, edit the note's title, assert the update, delete the note, assert it is gone from the calendar. Use the repo's existing auth/setup fixtures.

- [ ] **Step 2: Run E2E locally (if the harness is available)**

Run: the repo's e2e command (check `package.json` for a `test:e2e` script).
Expected: the journey passes, or is documented as requiring the CI browser env (`BROWSERLESS_URL`).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/venue-calendar-notes.spec.ts
git commit -m "test: e2e journey for venue calendar notes"
```

## Task 22: Slice 3 verification + release checklist

**Files:** none

- [ ] **Step 1: Full pipeline**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 2: Browser smoke** using the preview tools: repeat the E2E journey manually, capture screenshots of the form warning and the dashboard clash card in both light and dark, and at mobile width.

- [ ] **Step 3: Post-deploy checklist (record in the PR)**

- Migration already applied in Slice 1; confirm it is present in production.
- Run `npm run advisors` against production after deploy.
- Role smoke: one write attempt per role class (admin, manager-own, manager-other, manager-none).
- Audit spot-check: create + delete a note, confirm `calendar_note.*` rows with no title/detail in meta.
- Confirm `/api/v1/events` responses contain no note data.

**Slice 3 is now independently mergeable.** PR title: `feat: venue calendar notes clash surfaces (3/3)`.

---

## Self-review notes (completed by plan author)

- **Spec coverage:** goals 1 to 4 map to Tasks 1-2 (storage), 13-14 (calendars), 16-18 (warnings incl. reschedule), 19 (dashboard both audiences). Non-goals honoured (no recurrence/notifications; public API guarded in Task 20). Decisions 1-12 each map to a task (RLS to Task 2, audit to 3, capabilities to 4, clash truth table to 5, data load + truncation to 6, validation to 7, concurrency to 8, RLS test to 9, mobile + reschedule to 14/18, privacy text to 12).
- **Type consistency:** `ClashEventInput`/`ClashNoteInput`/`NoteClash` defined in Task 5 and reused in Tasks 6/16; `CalendarNote` defined in Task 6 and consumed in 13/14/17; `canCreateCalendarNote`/`canManageCalendarNote` signatures identical across Tasks 4/8. Audit `entity: "calendar_note"` and actions `calendar_note.created|updated|deleted` consistent between Tasks 3 and 8.
- **Placeholder scan:** the only deferred specifics are exact prop wiring in existing large components (event-form venue/date state, events page server parent), which reference concrete line numbers from recon and existing patterns; every new file has complete code.
