# Review Pack: event-fields-ui-audit

**Generated:** 2026-05-07
**Mode:** A (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/worktrees/jolly-chaum-462a48`
**Base ref:** `main`
**HEAD:** `ba8023a`
**Diff range:** `main...HEAD`

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

_(none detected for this diff range)_

## User Concerns

Audit claims all 44 events DB columns are accounted for in the UI. Challenge: are there columns missed? Are there UI surfaces (list pages, calendar views, public API responses, email templates) not checked? Is the gap analysis (5 booking fields hidden from read-only users) the ONLY gap?

## Diff (`main...HEAD`)

_(no diff output)_

## Changed File Contents

_(no files to include)_
## Related Files (grep hints)

_(no related files found by basename grep)_

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — BaronsHub

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.1
- **Test runner**: Vitest
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: QR code generation, Email (Resend), public event API, event management
- **Size**: ~148 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check
npm run test             # Vitest run (single pass)
npm run test:watch       # Vitest watch mode
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run supabase:migrate # Apply pending migrations
npm run supabase:reset   # Reset database (linked, requires confirmation)
npm run advisors         # Supabase advisors (security + performance) — run before merging migrations / pre-deploy
```

## Architecture

**Route Structure**: App Router with event management focus. Key sections:
- `/events` — Event browsing, listing (public and authenticated)
- `/admin` — Event creation, management, setup
- `/api/v1/events` — Public event API with rate limiting and auth

**Auth**: Supabase Auth with JWT + HTTP-only cookies. User context available in server and client components. Permission checks via `src/lib/` helpers.

**Database**: Supabase PostgreSQL with RLS. `src/lib/` contains data access helpers. `supabase/seed.sql` provides test data setup.

**Key Integrations**:
- **QR Codes**: `qrcode` library for event ticket generation
- **Email**: Resend for event notifications and confirmations
- **Public API**: `src/lib/public-api/` — rate-limited REST API for events
- **Notifications**: `src/lib/notifications.ts` — event alerts and reminders

**Data Flow**: Server actions for mutations (create/update/delete events). Server components for data fetching. All API responses validated with Zod. RLS enforces permission at database level.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (event models, API) |
| `src/lib/public-api/` | Rate-limited public REST API endpoints |
| `src/lib/public-api/rate-limit.ts` | API rate limiting (per IP/API key) |
| `src/lib/public-api/auth.ts` | API key validation |
| `src/lib/validation.ts` | Zod schemas for events, bookings, etc. |
| `src/lib/datetime.ts` | Date/time utilities for event scheduling |
| `src/lib/artists.ts` | Artist/performer data helpers |
| `src/lib/reviewers.ts` | Event reviewer/moderator logic |
| `src/lib/notifications.ts` | Email and notification dispatch |
| `src/app/api/v1/events` | Public event REST API |
| `src/actions/` | Server actions for mutations |
| `supabase/migrations/` | Database schema migrations |
| `supabase/seed.sql` | Database seed for testing |
| `vitest.config.ts` | Vitest configuration |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `RESEND_API_KEY` | Resend email service key |
| `BARONSHUB_WEBSITE_API_KEY` | BaronsHub website integration API key |
| `EVENT_SAVE_USE_RPC` | Feature flag: `"true"` enables the atomic event save/submit/propose RPC path; absent or `"false"` keeps the legacy fallback. |

## Project-Specific Rules / Gotchas

### Public API
- Endpoints in `src/lib/public-api/events.ts` require rate limiting
- `src/lib/public-api/auth.ts` validates API keys (Bearer token or query param)
- All responses return `{ success: boolean; data?: T; error?: string }`
- Minimum 80% test coverage on API logic (see `src/lib/public-api/__tests__/`)

### Rate Limiting
- Per-IP limiting for anonymous requests
- Per-API-key limiting for authenticated requests
- Limits configurable in `src/lib/public-api/rate-limit.ts`
- Return 429 (Too Many Requests) when exceeded

### Event Model
- Events have status: `draft` → `published` → `completed`
- Optional artists/performers with bios
- Date/time handling via `src/lib/datetime.ts` (respects timezone)
- QR codes generated on demand (not pre-stored)

### Permissions
- Event creators can edit own events
- Administrators can moderate all events; office_workers can manage events at their venue
- Check permissions in both UI and server actions (defense in depth)
- RLS enforces at database level

### Auth Standard Deviation: Custom Role Model

**Deviation from workspace standard (auth-standard.md §7):** The workspace standard mandates three generic roles (`admin`, `editor`, `viewer`). This project uses three domain-specific roles approved for this application:

| Application Role | Maps to Standard Tier | Capabilities |
|---|---|---|
| `administrator` | `admin` | Full platform access, user management, all event operations |
| `office_worker` | `editor` | Venue-scoped write access (if venue_id set) or global read-only (if no venue_id); planning CRUD on own items; debrief create/edit (own) |
| `executive` | `viewer` | Read-only access to all events, planning, and reporting |

**Why:** Event management requires venue-scoped write access for some staff and global read-only for others, expressed through a single role with venue_id as the capability switch.

**Implementation notes:**
- Roles stored in `public.users.role` column (not Supabase `app_metadata`)
- Role helpers in `src/lib/roles.ts` use explicit capability functions with optional `venueId` parameter
- Permission checks use `role === "administrator"` for admin operations
- `venue_id` on the user record acts as a capability switch for office_worker
- All capability functions are in `src/lib/roles.ts`

### Email & Notifications
- `src/lib/notifications.ts` handles async dispatch
- Never await email sends in critical paths — queue for background jobs
- Use Resend templates for transactional emails

### Testing with Vitest
- Test API endpoints in `src/lib/public-api/__tests__/`
- Mock Resend and Supabase in tests
- Use `vitest.config.ts` for test setup (environment, ports, etc.)
- Run tests before pushing: `npm run test`

### QR Code Generation
- Use `qrcode` library (not `qrcode.react`)
- Generate QR codes server-side for ticket URLs
- Embed event ID and user ID in URL
- Cache generated QR images (optional, not required)

### Supabase Data Access
- Use service-role client only for system operations (migrations, seeding)
- Client operations use anon-key (respects RLS)
- Always wrap DB results with conversion helper (snake_case → camelCase)

### Database Seeding
- `supabase/seed.sql` creates test events and users
- Run seeding after `supabase db reset`
- Keep seed data minimal (fast test setup)

### Artist Logic
- `src/lib/artists.ts` — fetch artist info, bios, links
- `src/lib/reviewers.ts` — fetch reviewer assignments, approval status
- Always verify permissions via `src/lib/roles.ts` capability functions before allowing edits

### Datetime Handling
- Use `src/lib/datetime.ts` for all user-facing dates
- Store all times in UTC in database
- Convert to user's timezone on display
- See workspace CLAUDE.md for timezone conventions
```

---

_End of pack._

## Audit Spec Under Review

```markdown
# Event Fields UI Audit

> Audit date: 2026-05-07
> Source: live database (project `shofawaztmdxytukhozo`) cross-referenced against UI components.
> Scope: all 44 columns on `public.events` table and their presence across the event form, event detail page, and booking settings card.

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Editable in event form | 29 | All wired end-to-end (form → Zod → action → DB) |
| Editable in booking settings card | 5 | Wired via separate `updateBookingSettingsAction` |
| Editable via assignment card | 1 | Admin-only dropdown, read-only display for others |
| System-managed (no UI input expected) | 9 | Correctly omitted from forms |
| **Total** | **44** | |

**Gaps found:** 1 — five booking operations fields are invisible to read-only users (executives, non-venue office_workers). See [Gap 1](#gap-1-booking-operations-fields-hidden-from-read-only-users).

---

## Field-by-field matrix

Legend:
- **Form** = visible/editable in `src/components/events/event-form.tsx`
- **Detail summary** = displayed in `src/components/events/event-detail-summary.tsx`
- **Detail page** = displayed elsewhere on `src/app/events/[eventId]/page.tsx` (header card, sidebar cards)
- **Booking card** = editable in `src/components/events/booking-settings-card.tsx`
- **Save action** = handled by `saveEventDraftAction` in `src/actions/events.ts`
- **Booking action** = handled by `updateBookingSettingsAction` in `src/actions/events.ts`

### Core event fields

| # | DB Column | Type | Form | Detail Summary | Detail Page | Save Action | Notes |
|---|-----------|------|------|----------------|-------------|-------------|-------|
| 1 | `title` | text NOT NULL | `name="title"` | — | Header card title | Yes | — |
| 2 | `event_type` | text | `name="eventType"` | Yes ("Type") | — | Yes | Select from `event_types` lookup |
| 3 | `venue_id` | uuid NOT NULL | `name="venueId"` / `name="venueIds"` | Yes ("Venue/Venues") | Header card subtitle | Yes | Multi-venue via `VenueMultiSelect` |
| 4 | `start_at` | timestamptz NOT NULL | `name="startAt"` | Yes ("Start") | Header card subtitle | Yes | datetime-local input, London TZ display |
| 5 | `end_at` | timestamptz | `name="endAt"` | Yes ("End") | Header card subtitle | Yes | Auto-set +3h from start if empty |
| 6 | `venue_space` | text | `name="venueSpace"` | Yes ("Space/Spaces") | — | Yes | Comma-separated, parsed via `parseVenueSpaces` |
| 7 | `notes` | text | `name="notes"` | Yes ("Notes") | — | Yes | Textarea, labelled "Event details" |
| 8 | `manager_responsible_id` | uuid | `name="managerResponsibleId"` | — | Header card ("Manager responsible") | Yes | Select dropdown, auto-populated from venue default |

### Planning & commercial fields

| # | DB Column | Type | Form | Detail Summary | Detail Page | Save Action | Notes |
|---|-----------|------|------|----------------|-------------|-------------|-------|
| 9 | `expected_headcount` | integer | `name="expectedHeadcount"` | Yes ("Headcount") | — | Yes | — |
| 10 | `wet_promo` | text | `name="wetPromo"` | Yes ("Wet promo") | — | Yes | — |
| 11 | `food_promo` | text | `name="foodPromo"` | Yes ("Food promo") | — | Yes | — |
| 12 | `goal_focus` | text | `name="goalFocus"` (checkboxes) | Yes ("Goals") | — | Yes | Comma-separated, rendered from `EVENT_GOALS` config |
| 13 | `cost_total` | numeric | `name="costTotal"` | Yes ("Cost") | — | Yes | Formatted via `formatCurrency` |
| 14 | `cost_details` | text | `name="costDetails"` | Yes (inline under cost) | — | Yes | — |

### Booking & ticketing fields

| # | DB Column | Type | Form | Detail Summary | Booking Card | Save Action | Booking Action | Notes |
|---|-----------|------|------|----------------|--------------|-------------|----------------|-------|
| 15 | `booking_type` | text | `name="bookingType"` | Yes ("Booking format") | — | Yes | — | ticketed / table_booking / free_entry / mixed |
| 16 | `ticket_price` | numeric | `name="ticketPrice"` | Yes ("Ticket price") | — | Yes | — | Shown only when booking_type is ticketed |
| 17 | `check_in_cutoff_minutes` | integer | `name="checkInCutoffMinutes"` | Yes ("Last admission") | — | Yes | — | Computed cutoff time displayed |
| 18 | `cancellation_window_hours` | integer | `name="cancellationWindowHours"` | Yes ("Cancellation window") | — | Yes | — | — |
| 19 | `age_policy` | text | `name="agePolicy"` | Yes ("Age policy") | — | Yes | — | — |
| 20 | `accessibility_notes` | text | `name="accessibilityNotes"` | Yes ("Accessibility notes") | — | Yes | — | Textarea |
| 21 | `terms_and_conditions` | text | `name="termsAndConditions"` | Yes ("Terms & conditions") | — | Yes | — | AI generation via modal |
| 22 | `booking_enabled` | boolean NOT NULL | — | — | Toggle | — | Yes | **Gap 1**: hidden when !canEdit |
| 23 | `total_capacity` | integer | — | — | Input | — | Yes | **Gap 1**: hidden when !canEdit. Shown on bookings subpage. |
| 24 | `max_tickets_per_booking` | integer NOT NULL | — | — | Input | — | Yes | **Gap 1**: hidden when !canEdit |
| 25 | `booking_url` | text | — | — | Input | — | Yes | **Gap 1**: hidden when !canEdit |
| 26 | `sms_promo_enabled` | boolean NOT NULL | — | — | Toggle (admin only) | — | Yes | **Gap 1**: hidden when !canEdit |

### Website & SEO fields

| # | DB Column | Type | Form | Detail Summary | Save Action | Notes |
|---|-----------|------|------|----------------|-------------|-------|
| 27 | `public_title` | text | `name="publicTitle"` | — | Yes | In "Website" tab of event form |
| 28 | `public_teaser` | text | `name="publicTeaser"` | — | Yes | In "Website" tab |
| 29 | `public_description` | text | `name="publicDescription"` | — | Yes | In "Website" tab, textarea |
| 30 | `public_highlights` | text[] | `name="publicHighlights"` | Yes (bullet list) | Yes | Newline-separated in form, array in DB |
| 31 | `seo_title` | text | `name="seoTitle"` | — | Yes | In "Website" tab |
| 32 | `seo_description` | text | `name="seoDescription"` | — | Yes | In "Website" tab |
| 33 | `seo_slug` | text | `name="seoSlug"` | — | Yes | In "Website" tab. Also auto-generated by booking settings. |
| 34 | `event_image_path` | text | `name="eventImage"` (file) | Yes (rendered image) | Yes | Upload handled in save action, reconcile cron for failures |

### Assignment & workflow fields

| # | DB Column | Type | Form | Detail Page | Notes |
|---|-----------|------|------|-------------|-------|
| 35 | `assignee_id` | uuid | — | Assignment card (admin Select, read-only for others) | Updated via `updateAssigneeAction` |
| 36 | `status` | text NOT NULL | — | Header card Badge | Managed by workflow actions (submit, approve, reject, revert) |

### System-managed fields (no UI input expected)

| # | DB Column | Type | Where Displayed | Notes |
|---|-----------|------|-----------------|-------|
| 37 | `id` | uuid NOT NULL | URL param, hidden form field | Primary key |
| 38 | `created_by` | uuid | Header card ("Created by") | Set on insert |
| 39 | `submitted_at` | timestamptz | Audit trail context | Set by submit action |
| 40 | `created_at` | timestamptz NOT NULL | — | Auto-set by DB default |
| 41 | `updated_at` | timestamptz NOT NULL | Hidden field `expected_updated_at` for OCC | Auto-set; used for optimistic concurrency control |
| 42 | `deleted_at` | timestamptz | — | Soft-delete flag, set by delete action |
| 43 | `deleted_by` | uuid | — | Set by delete action |
| 44 | `pending_image_attach` | text | — | Internal state machine for image reconciliation cron |

---

## Gap 1: Booking operations fields hidden from read-only users

**Location:** `src/app/events/[eventId]/page.tsx` line 672

```tsx
{canEdit ? (
  <BookingSettingsCard ... />
) : null}
```

**Impact:** When `canEdit` is false (executives, office_workers at a different venue), these 5 fields are completely invisible on the event detail page:

| Field | What a reviewer/executive would want to see |
|-------|---------------------------------------------|
| `booking_enabled` | Whether bookings are currently live |
| `total_capacity` | How many people the event can hold |
| `max_tickets_per_booking` | Per-booking ticket limit |
| `booking_url` | External booking link (if set) |
| `sms_promo_enabled` | Whether SMS promos are active |

**The `EventDetailSummary` component does NOT include these fields.** It shows `booking_type` and `ticket_price` but not the operational booking settings.

`total_capacity` partially mitigated — it appears on the bookings subpage (`/events/[eventId]/bookings/page.tsx:96`), but only for users with booking view permissions.

**Why this matters:** An executive reviewing event performance, or an office_worker checking another venue's setup, cannot see whether bookings are enabled, what the capacity is, or whether SMS promos are running. These are key operational facts for event oversight.

### Recommended fix

Add these 5 fields as read-only rows to `EventDetailSummary`, conditionally rendered when values are set:

```
Bookings: Enabled / Disabled
Capacity: 150
Max per booking: 10
Booking link: https://...
SMS promo: Enabled / Disabled
```

This keeps the editable `BookingSettingsCard` gated behind `canEdit` (correct — only editors should toggle these) while ensuring everyone with view access can see the current state.

---

## Non-gap observations

These are fields that appear in the form but NOT in the `EventDetailSummary` display. This is by design, not a gap:

| Fields | Reason not in summary |
|--------|-----------------------|
| `public_title`, `public_teaser`, `public_description`, `seo_title`, `seo_description`, `seo_slug` | Visible in the form's "Website" tab (including read-only mode). These are website publishing fields, not event planning context. |
| `manager_responsible_id` | Displayed in the header card at page level, not duplicated in the summary. |
| `assignee_id` | Displayed in the header card and has its own dedicated assignment card in the sidebar. |

---

## Validation checklist

Use this to verify the audit. For each row, confirm the field appears where stated:

- [ ] Open an event in **edit mode** (as administrator). Confirm all 29 form fields render across the three tabs (Event Details, Booking & Ticketing, Website).
- [ ] Confirm the **BookingSettingsCard** appears in the sidebar with 5 editable fields.
- [ ] Confirm the **Assignment card** appears with a user Select dropdown.
- [ ] Confirm the **EventDetailSummary** card shows: image, notes, type, venue, spaces, start, end, headcount, wet promo, food promo, booking format, ticket price, check-in cutoff, cancellation window, age policy, artists, cost + details, accessibility notes, T&Cs, highlights, goals.
- [ ] Open the same event as an **executive** (read-only). Confirm:
  - [ ] The form renders in disabled/read-only mode with all fields visible.
  - [ ] The BookingSettingsCard is **NOT** shown. ← This is the gap.
  - [ ] The EventDetailSummary does NOT display booking_enabled, total_capacity, max_tickets_per_booking, booking_url, or sms_promo_enabled.
- [ ] Confirm the **header card** shows: title, status badge, venue, dates, assignee, created by, manager responsible.
- [ ] Confirm the **bookings subpage** (`/events/[eventId]/bookings`) shows `total_capacity`.
```

## Key File: event-detail-summary.tsx (read-only display component)

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseVenueSpaces } from "@/lib/venue-spaces";
import { EVENT_GOALS_BY_VALUE, humanizeGoalValue, parseGoalFocus } from "@/lib/event-goals";
import type { EventDetail } from "@/lib/events";
import { formatCurrency } from "@/lib/utils/format";

const formatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London"
});

const cutoffTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London"
});

const bookingTypeLabel: Record<string, string> = {
  ticketed: "Ticketed event",
  table_booking: "Table booking event",
  free_entry: "Free entry",
  mixed: "Mixed booking model"
};

function buildEventImageUrl(path: string | null | undefined): string | null {
  if (!path || !path.trim().length) return null;
  const base =
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string"
      ? process.env.NEXT_PUBLIC_SUPABASE_URL.trim().replace(/\/+$/g, "")
      : "";
  if (!base.length) return null;
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/storage/v1/object/public/event-images/${encodedPath}`;
}

function formatCheckInCutoffLabel(startAt: string, cutoffMinutes: number | null): string | null {
  if (cutoffMinutes === null || cutoffMinutes === undefined || cutoffMinutes < 0) return null;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) {
    return `${cutoffMinutes} minute${cutoffMinutes === 1 ? "" : "s"} before start`;
  }
  const cutoff = new Date(start.getTime() - cutoffMinutes * 60 * 1000);
  return `${cutoffMinutes} minute${cutoffMinutes === 1 ? "" : "s"} before start (${cutoffTimeFormatter.format(cutoff)})`;
}

type EventDetailSummaryProps = {
  event: EventDetail;
};

export function EventDetailSummary({ event }: EventDetailSummaryProps) {
  const venueSpaces = parseVenueSpaces(event.venue_space);
  const venueNames = Array.isArray(event.venues) && event.venues.length > 0
    ? event.venues.map((v) => v.name)
    : event.venue?.name
      ? [event.venue.name]
      : [];
  const goalValues = parseGoalFocus(event.goal_focus);
  const goalDetails = Array.from(new Set(goalValues)).map((value) => {
    const config = EVENT_GOALS_BY_VALUE[value];
    return {
      value,
      label: config?.label ?? humanizeGoalValue(value),
      helper: config?.helper ?? null
    };
  });
  const hasGoalDetails = goalDetails.length > 0;
  const publicHighlights = Array.isArray(event.public_highlights)
    ? event.public_highlights
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/^\s*[-*•]\s*/, "").trim())
        .filter(Boolean)
    : [];
  const artistNames = (Array.isArray(event.artists) ? event.artists : [])
    .map((entry) => entry.artist?.name?.trim())
    .filter((name): name is string => Boolean(name && name.length));
  const eventImageUrl = buildEventImageUrl(event.event_image_path);
  const checkInCutoffLabel = formatCheckInCutoffLabel(event.start_at, event.check_in_cutoff_minutes);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event details</CardTitle>
        <CardDescription>Core context for planners, reviewers, and venue teams.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted">
        {eventImageUrl ? (
          <div className="space-y-2">
            <p className="font-semibold text-[var(--color-text)]">Event image</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- external event image URL, not suitable for next/image optimisation */}
            <img
              src={eventImageUrl}
              alt={`${event.title} event image`}
              className="max-h-80 w-full rounded-[var(--radius)] border border-[var(--color-border)] object-cover"
            />
          </div>
        ) : null}
        {event.notes ? (
          <div className="space-y-1 text-[var(--color-text)]">
            <p className="font-semibold">Notes</p>
            <p className="whitespace-pre-wrap text-sm text-subtle">{event.notes}</p>
          </div>
        ) : null}
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <p>
            <span className="font-semibold text-[var(--color-text)]">Type:</span>{" "}
            {event.event_type ? event.event_type : <span className="italic text-subtle">TBC</span>}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">
              {venueNames.length > 1 ? "Venues" : "Venue"}:
            </span>{" "}
            {venueNames.length ? venueNames.join(", ") : <span className="italic text-subtle">Not specified</span>}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">
              {venueSpaces.length > 1 ? "Spaces" : "Space"}:
            </span>{" "}
            {venueSpaces.length ? venueSpaces.join(", ") : "Not specified"}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">Start:</span>{" "}
            {formatter.format(new Date(event.start_at))}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">End:</span>{" "}
            {event.end_at ? formatter.format(new Date(event.end_at)) : <span className="italic text-subtle">TBC</span>}
          </p>
          {event.expected_headcount ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Headcount:</span>{" "}
              {event.expected_headcount}
            </p>
          ) : null}
          {event.wet_promo ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Wet promo:</span>{" "}
              {event.wet_promo}
            </p>
          ) : null}
          {event.food_promo ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Food promo:</span>{" "}
              {event.food_promo}
            </p>
          ) : null}
          {event.booking_type ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Booking format:</span>{" "}
              {bookingTypeLabel[event.booking_type] ?? event.booking_type}
            </p>
          ) : null}
          {event.ticket_price != null ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Ticket price:</span> £
              {event.ticket_price.toFixed(2)}
            </p>
          ) : null}
          {checkInCutoffLabel ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Last admission/check-in:</span>{" "}
              {checkInCutoffLabel}
            </p>
          ) : null}
          {event.cancellation_window_hours != null ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Cancellation/refund window:</span>{" "}
              {event.cancellation_window_hours} hour{event.cancellation_window_hours === 1 ? "" : "s"}
            </p>
          ) : null}
          {event.age_policy ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Age policy:</span>{" "}
              {event.age_policy}
            </p>
          ) : null}
          {artistNames.length ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">
                {artistNames.length > 1 ? "Artists / hosts" : "Artist / host"}:
              </span>{" "}
              {artistNames.join(", ")}
            </p>
          ) : null}
          {event.cost_total != null ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Cost:</span>{" "}
              {formatCurrency(event.cost_total)}
              {event.cost_details ? (
                <span className="block text-xs text-subtle mt-1">{event.cost_details}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        {event.accessibility_notes ? (
          <div className="space-y-1 text-[var(--color-text)]">
            <p className="font-semibold">Accessibility notes</p>
            <p className="whitespace-pre-wrap text-sm text-subtle">{event.accessibility_notes}</p>
          </div>
        ) : null}
        {event.terms_and_conditions ? (
          <div className="space-y-1 text-[var(--color-text)]">
            <p className="font-semibold">Terms & conditions</p>
            <p className="whitespace-pre-wrap text-sm text-subtle">{event.terms_and_conditions}</p>
          </div>
        ) : null}
        {publicHighlights.length ? (
          <div className="space-y-2 text-[var(--color-text)]">
            <p className="font-semibold">Event highlights</p>
            <ul className="space-y-1 text-sm text-subtle">
              {publicHighlights.map((highlight, index) => (
                <li key={`${event.id}-highlight-${index}`} className="flex items-start gap-2">
                  <span
                    className="mt-[0.35rem] h-1.5 w-1.5 flex-none rounded-full bg-[var(--color-primary-400)]"
                    aria-hidden="true"
                  />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {hasGoalDetails ? (
          <div className="space-y-2">
            <p className="font-semibold text-[var(--color-text)]">Goals</p>
            <div className="space-y-2">
              {goalDetails.map((goal) => (
                <div key={goal.value}>
                  <p className="font-medium text-[var(--color-text)]">{goal.label}</p>
                  {goal.helper ? <p className="text-xs text-subtle">{goal.helper}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

## Key File: booking-settings-card.tsx (booking operations card)

```tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { updateBookingSettingsAction } from "@/actions/events";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

const LANDING_BASE = "l.baronspubs.com";

type BookingSettingsCardProps = {
  eventId: string;
  bookingEnabled: boolean;
  totalCapacity: number | null;
  maxTicketsPerBooking: number;
  seoSlug: string | null;
  smsPromoEnabled?: boolean;
  bookingUrl: string | null;
  userRole?: string;
};

export function BookingSettingsCard({
  eventId,
  bookingEnabled: initialBookingEnabled,
  totalCapacity: initialTotalCapacity,
  maxTicketsPerBooking: initialMaxTickets,
  seoSlug: initialSeoSlug,
  smsPromoEnabled: initialSmsPromoEnabled = false,
  bookingUrl: initialBookingUrl,
  userRole,
}: BookingSettingsCardProps) {
  const [bookingEnabled, setBookingEnabled] = useState(initialBookingEnabled);
  const [totalCapacity, setTotalCapacity] = useState(
    initialTotalCapacity != null ? String(initialTotalCapacity) : ""
  );
  const [maxTickets, setMaxTickets] = useState(String(initialMaxTickets));
  const [currentSlug, setCurrentSlug] = useState<string | null>(initialSeoSlug);
  const [smsPromoEnabled, setSmsPromoEnabled] = useState(initialSmsPromoEnabled);
  const [bookingUrl, setBookingUrl] = useState(initialBookingUrl ?? "");
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // Keep local slug in sync when the prop changes (e.g. after save)
  useEffect(() => {
    setCurrentSlug(initialSeoSlug);
  }, [initialSeoSlug]);

  const landingUrl = currentSlug ? `https://${LANDING_BASE}/${currentSlug}` : null;

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedCapacity = totalCapacity.trim() ? parseInt(totalCapacity, 10) : null;
    const parsedMax = parseInt(maxTickets, 10) || 10;
    const trimmedBookingUrl = bookingUrl.trim();

    if (parsedCapacity !== null && (isNaN(parsedCapacity) || parsedCapacity < 1)) {
      toast.error("Capacity must be a positive number or left blank for unlimited.");
      return;
    }

    if (trimmedBookingUrl && !/^https?:\/\//i.test(trimmedBookingUrl)) {
      toast.error("Booking link must be a full URL starting with https://");
      return;
    }

    startTransition(async () => {
      const result = await updateBookingSettingsAction({
        eventId,
        bookingEnabled,
        totalCapacity: parsedCapacity,
        maxTicketsPerBooking: parsedMax,
        bookingUrl: trimmedBookingUrl ? trimmedBookingUrl : undefined,
        ...(userRole === "administrator" ? { smsPromoEnabled } : {}),
      });

      if (result.success) {
        toast.success(result.message ?? "Booking settings saved.");
        if (result.seoSlug && !currentSlug) {
          setCurrentSlug(result.seoSlug);
        }
      } else {
        toast.error(result.message ?? "Could not save booking settings.");
      }
    });
  }

  async function handleCopyUrl() {
    if (!landingUrl) return;
    try {
      await navigator.clipboard.writeText(landingUrl);
      toast.success("Landing page URL copied.");
    } catch {
      toast.error("Could not copy URL.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Booking settings</CardTitle>
        <CardDescription>
          Enable online bookings to get a public landing page at{" "}
          <span className="font-mono text-xs">{LANDING_BASE}/…</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} onSubmit={handleSave} className="space-y-5" noValidate>
          {/* Booking enabled toggle */}
          <div className="flex items-center gap-3">
            <button
              id="bookingEnabled"
              type="button"
              role="switch"
              aria-checked={bookingEnabled}
              onClick={() => setBookingEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 flex-none cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(39,54,64,0.45)] ${
                bookingEnabled
                  ? "bg-[var(--color-primary-700)]"
                  : "bg-[rgba(39,54,64,0.2)]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  bookingEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <Label htmlFor="bookingEnabled" className="cursor-pointer select-none">
              {bookingEnabled ? "Bookings enabled" : "Bookings disabled"}
            </Label>
          </div>

          {/* Landing page URL — read-only, shown once slug exists and booking is enabled */}
          {bookingEnabled && landingUrl ? (
            <div className="space-y-2">
              <Label>Landing page URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-xs font-mono text-[var(--color-primary-700)] truncate">
                  {landingUrl}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Copy landing page URL"
                  onClick={handleCopyUrl}
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Open landing page"
                  asChild
                >
                  <a href={landingUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
              <p className="text-xs text-subtle">
                Share this link so guests can book tickets.
              </p>
            </div>
          ) : bookingEnabled && !landingUrl ? (
            <p className="rounded-[var(--radius)] bg-[var(--color-muted-surface)] px-3 py-2 text-xs text-subtle">
              A booking URL will be generated automatically when you save.
            </p>
          ) : null}

          {/* External booking link — short-circuits the local landing page when set */}
          <div className="space-y-2">
            <Label htmlFor="bookingUrl">Booking link (optional)</Label>
            <Input
              id="bookingUrl"
              type="url"
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              placeholder="https://example.com/buy-tickets"
            />
            <p className="text-xs text-subtle">
              {bookingUrl.trim()
                ? "Guests are redirected here instead of the local booking page."
                : "Leave blank to use the local booking page."}
            </p>
          </div>

          {/* Total capacity */}
          <div className="space-y-2">
            <Label htmlFor="totalCapacity">Total capacity</Label>
            <Input
              id="totalCapacity"
              type="number"
              min={1}
              step={1}
              value={totalCapacity}
              onChange={(e) => setTotalCapacity(e.target.value)}
              placeholder="Unlimited"
            />
            <p className="text-xs text-subtle">Leave blank for unlimited tickets.</p>
          </div>

          {/* Max tickets per booking */}
          <div className="space-y-2">
            <Label htmlFor="maxTicketsPerBooking">Max tickets per booking</Label>
            <Input
              id="maxTicketsPerBooking"
              type="number"
              min={1}
              max={50}
              step={1}
              value={maxTickets}
              onChange={(e) => setMaxTickets(e.target.value)}
              required
            />
            <p className="text-xs text-subtle">Maximum number of tickets a single booking can include.</p>
          </div>

          {/* Promotional SMS toggle — administrators only */}
          {userRole === "administrator" && (
            <div className="space-y-2">
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
                <Label htmlFor="smsPromoEnabled" className="cursor-pointer select-none">
                  {smsPromoEnabled ? "Promotional SMS enabled" : "Promotional SMS disabled"}
                </Label>
              </div>
              <p className="text-xs text-subtle">
                Automatically send booking reminder SMS to past customers.
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <SubmitButton
              label="Save booking settings"
              pendingLabel="Saving…"
              variant="secondary"
              disabled={isPending}
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
```

## Key File: event-form.tsx — form field names only

```
1001:          name="foodPromo"
1015:        name="expectedHeadcount"
1031:          name="bookingType"
1056:          name="ticketPrice"
1087:          name="checkInCutoffMinutes"
1112:          name="cancellationWindowHours"
1144:          name="agePolicy"
1164:          name="accessibilityNotes"
1201:        name="termsAndConditions"
1229:            name="costTotal"
1241:            name="costDetails"
1260:              name="goalFocus"
1283:          name="publicTitle"
1302:          name="publicTeaser"
1321:          name="publicHighlights"
1344:          name="publicDescription"
1368:              name="seoTitle"
1386:              name="seoSlug"
1405:            name="seoDescription"
1553:                    name="name"
1572:                    name="artistType"
1586:                    name="email"
1601:                    name="phone"
1615:                    name="description"
1670:          <input type="hidden" name="bookingType" value={bookingType} />
1671:          <input type="hidden" name="ticketPrice" value={ticketPrice} />
1672:          <input type="hidden" name="checkInCutoffMinutes" value={checkInCutoffMinutes} />
1673:          <input type="hidden" name="cancellationWindowHours" value={cancellationWindowHours} />
1674:          <input type="hidden" name="agePolicy" value={agePolicy} />
1675:          <input type="hidden" name="accessibilityNotes" value={accessibilityNotes} />
1682:                name="allowsWalkIns"
1695:                name="refundAllowed"
1708:                name="rescheduleAllowed"
1723:              name="extraNotes"
1750:              <input type="hidden" name="eventId" defaultValue={defaultValues?.id} />
1751:              <input type="hidden" name="operation_id" value={operationIdRef.current} readOnly />
1752:              <input type="hidden" name="idempotency_key" value={idempotencyKeyRef.current} readOnly />
1754:                <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt} readOnly />
711:          name="title"
746:            name="venueId"
776:            <input type="hidden" name="venueId" value={selectedVenueId} />
795:          name="eventType"
829:        name="notes"
854:        name="managerResponsibleId"
876:      <input type="hidden" name="artistIds" value={selectedArtistIds.join(",")} />
877:      <input type="hidden" name="artistNames" value={selectedArtistNames.join(", ")} />
907:          name="startAt"
927:          name="endAt"
951:        name="venueSpace"
973:        <Input id="eventImage" name="eventImage" type="file" accept="image/*" />
991:          name="wetPromo"
```

## Key File: event detail page — component assembly (lines 584-710)

```tsx
  return (
    <div className="space-y-6">
      <Link
        href="/events"
        className="inline-flex items-center gap-1 text-sm text-subtle transition-colors hover:text-[var(--color-text)]"
      >
        ← Events
      </Link>

      {/* Header card — always visible */}
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-2xl text-[var(--color-primary-700)]">
              <Link href={`/events/${event.id}`} className="transition-colors hover:text-[var(--color-primary-500)]">
                {event.title}
              </Link>
            </CardTitle>
            <Badge variant={status.tone}>{status.label}</Badge>
            <CardDescription>
              {event.venues.length > 0
                ? event.venues.map((v) => v.name).join(", ")
                : event.venue?.name ?? ""}
              {" · "}
              {formatter.format(new Date(event.start_at))}
              {event.end_at ? <> → {formatter.format(new Date(event.end_at))}</> : <> → <span className="italic">end time TBC</span></>}
            </CardDescription>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <div className="flex flex-col gap-1 text-xs text-subtle lg:items-end">
              <span>
                <span className="font-semibold text-[var(--color-text)]">Assignee:</span> {currentAssigneeName}
              </span>
              <span>
                <span className="font-semibold text-[var(--color-text)]">Created by:</span>{" "}
                {event.created_by === user.id ? "You" : resolveUserName(event.created_by)}
              </span>
              {event.manager_responsible_id ? (
                <span>
                  <span className="font-semibold text-[var(--color-text)]">Manager responsible:</span>{" "}
                  {resolveUserName(event.manager_responsible_id)}
                </span>
              ) : null}
            </div>
            {canViewEventBookings ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/events/${event.id}/bookings`}>Bookings</Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {/* EventForm for all users — editors get full sidebar, readers get read-only form */}
      <EventForm
        key={event.id}
        mode="edit"
        defaultValues={event}
        venues={venues}
        artists={artists}
        eventTypes={eventTypes.map((type) => type.label)}
        role={user.role}
        userVenueId={user.venueId}
        users={assignableUsers.map((u) => ({ id: u.id, name: u.name }))}
        canDelete={canDelete}
        readOnly={!canEdit}
        debrief={event.debrief}
        sidebar={
          <div className="space-y-6">
            {canEdit ? (
              <Card>
                <CardHeader>
                  <CardTitle>Save & submit</CardTitle>
                  <CardDescription>Save a draft first, then submit for review when ready.</CardDescription>
                </CardHeader>
                <CardContent>
                  <EventFormActions eventId={event.id} canDelete={canDelete} />
                  {canRevertToDraft ? (
                    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                      <RevertToDraftButton eventId={event.id} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <EventDetailSummary event={event} />

            {canEdit ? (
              <BookingSettingsCard
                eventId={event.id}
                bookingEnabled={Boolean(event.booking_enabled)}
                totalCapacity={event.total_capacity ?? null}
                maxTicketsPerBooking={event.max_tickets_per_booking ?? 10}
                seoSlug={event.seo_slug ?? null}
                smsPromoEnabled={Boolean(event.sms_promo_enabled)}
                bookingUrl={event.booking_url ?? null}
                userRole={user.role}
              />
            ) : null}

            {sopChecklistCard}
            <AttachmentsPanel
              parentType="event"
              parentId={event.id}
              attachments={attachments}
              canUpload={canUploadAttachments}
              viewerId={user.id}
              isAdmin={user.role === "administrator"}
              description="Files attached to this event or any of its planning tasks."
            />
            {canPreReview ? (
              <ProposalDecisionCard eventId={event.id} eventTitle={event.title} />
            ) : null}
            {reviewDecisionCard}
            {assignmentCard}
            {reviewerTimelineCard}
            {auditTrailCard}
            {debriefSubmitCard}
            {debriefSnapshotCard}
          </div>
        }
      />
    </div>
  );
}
```

## Key File: events list page (for checking list-level field display)

```tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canViewEvents } from "@/lib/roles";
import { listEventsForUser } from "@/lib/events";
import { listVenues } from "@/lib/venues";
import { EventsBoard } from "@/components/events/events-board";

export default async function EventsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canViewEvents(user.role)) {
    redirect("/unauthorized");
  }

  const [events, venues] = await Promise.all([listEventsForUser(user), listVenues()]);

  return <EventsBoard user={user} events={events} venues={venues} />;
}
```

## Key File: public API events endpoint

```
/Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/worktrees/jolly-chaum-462a48/src/app/api/v1/events/route.ts
/Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/worktrees/jolly-chaum-462a48/src/app/api/v1/events/[eventId]/route.ts
/Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/worktrees/jolly-chaum-462a48/src/app/api/v1/events/by-slug/[slug]/route.ts
```

## DB Schema (live query result)

```json
[{"column_name":"id","data_type":"uuid"},{"column_name":"venue_id","data_type":"uuid"},{"column_name":"created_by","data_type":"uuid"},{"column_name":"title","data_type":"text"},{"column_name":"event_type","data_type":"text"},{"column_name":"status","data_type":"text"},{"column_name":"start_at","data_type":"timestamp with time zone"},{"column_name":"end_at","data_type":"timestamp with time zone"},{"column_name":"venue_space","data_type":"text"},{"column_name":"expected_headcount","data_type":"integer"},{"column_name":"wet_promo","data_type":"text"},{"column_name":"food_promo","data_type":"text"},{"column_name":"goal_focus","data_type":"text"},{"column_name":"notes","data_type":"text"},{"column_name":"submitted_at","data_type":"timestamp with time zone"},{"column_name":"created_at","data_type":"timestamp with time zone"},{"column_name":"updated_at","data_type":"timestamp with time zone"},{"column_name":"assignee_id","data_type":"uuid"},{"column_name":"cost_total","data_type":"numeric"},{"column_name":"cost_details","data_type":"text"},{"column_name":"public_title","data_type":"text"},{"column_name":"public_description","data_type":"text"},{"column_name":"public_teaser","data_type":"text"},{"column_name":"booking_url","data_type":"text"},{"column_name":"seo_title","data_type":"text"},{"column_name":"seo_description","data_type":"text"},{"column_name":"seo_slug","data_type":"text"},{"column_name":"booking_type","data_type":"text"},{"column_name":"ticket_price","data_type":"numeric"},{"column_name":"terms_and_conditions","data_type":"text"},{"column_name":"public_highlights","data_type":"ARRAY"},{"column_name":"check_in_cutoff_minutes","data_type":"integer"},{"column_name":"age_policy","data_type":"text"},{"column_name":"accessibility_notes","data_type":"text"},{"column_name":"cancellation_window_hours","data_type":"integer"},{"column_name":"event_image_path","data_type":"text"},{"column_name":"deleted_at","data_type":"timestamp with time zone"},{"column_name":"deleted_by","data_type":"uuid"},{"column_name":"booking_enabled","data_type":"boolean"},{"column_name":"total_capacity","data_type":"integer"},{"column_name":"max_tickets_per_booking","data_type":"integer"},{"column_name":"manager_responsible_id","data_type":"uuid"},{"column_name":"sms_promo_enabled","data_type":"boolean"},{"column_name":"pending_image_attach","data_type":"text"}]
```
