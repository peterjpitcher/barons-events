# Event Fields UI Audit

> Audit date: 2026-05-07
> Source: live database (project `shofawaztmdxytukhozo`) cross-referenced against UI components.
> Scope: all 44 columns on `public.events` table and their presence across the event form, event detail page, and booking settings card.

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Editable in event form | 29 | Verified end-to-end: form → Zod (`eventDraftSchema`) → `saveEventDraftAction` → `buildSaveEventDraftPayload` (camelCase→snake_case) → DB write. Verified 2026-05-07. |
| Editable in booking settings card | 4 + 1 admin-only¹ | Wired via separate `updateBookingSettingsAction` |
| Editable via assignment card | 1 | Admin-only dropdown, read-only display for others |
| System-managed (no UI input expected) | 9 | Correctly omitted from forms |
| **Total** | **44** | |

¹ `sms_promo_enabled` is editable only by administrators. Non-admin editors with `canEdit` see the other 4 booking fields but not the SMS toggle.

**Gaps found:** 1 — five booking operations fields are invisible to read-only users (executives, non-venue office_workers). See [Gap 1](#gap-1-booking-operations-fields-hidden-from-read-only-users).

---

## Scope

**In scope:** This audit covers field visibility and editability across three UI surfaces:

| Surface | Component | Coverage |
|---------|-----------|----------|
| Event form (edit mode) | `src/components/events/event-form.tsx` | All 29 editable fields across 3 tabs |
| Event detail page | `src/app/events/[eventId]/page.tsx` + `src/components/events/event-detail-summary.tsx` | Header card, detail summary, sidebar cards |
| Booking settings card | `src/components/events/booking-settings-card.tsx` | 5 booking operations fields |

**Out of scope:** The following surfaces are not covered by this audit. Fields may or may not appear on these surfaces — separate audits would be needed to confirm:

- Events list/board (`EventsBoard` component)
- Calendar view
- Public API responses (`/api/v1/events`)
- Public landing pages
- Email/notification templates
- Bookings subpage (except `total_capacity`, which is noted)

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
| 22 | `booking_enabled` | boolean NOT NULL | — | Yes ("Bookings") | Toggle | — | Yes | ~~Gap 1~~ resolved: read-only in summary |
| 23 | `total_capacity` | integer | — | Yes ("Capacity") | Input | — | Yes | ~~Gap 1~~ resolved: read-only in summary. Also on bookings subpage. |
| 24 | `max_tickets_per_booking` | integer NOT NULL | — | Yes ("Max per booking") | Input | — | Yes | ~~Gap 1~~ resolved: read-only in summary |
| 25 | `booking_url` | text | — | Yes ("Booking link") | Input | — | Yes | ~~Gap 1~~ resolved: read-only in summary |
| 26 | `sms_promo_enabled` | boolean NOT NULL | — | Yes ("SMS promo") | Toggle (admin only) | — | Yes | ~~Gap 1~~ resolved: read-only in summary |

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
| 37 | `id` | uuid NOT NULL | URL param, hidden form field | Primary key. Submitted as `name="eventId"` — used for identification only; server action must authorise independently. |
| 38 | `created_by` | uuid | Header card ("Created by") | Set on insert |
| 39 | `submitted_at` | timestamptz | Audit trail context | Set by submit action |
| 40 | `created_at` | timestamptz NOT NULL | — | Auto-set by DB default |
| 41 | `updated_at` | timestamptz NOT NULL | Hidden field `expected_updated_at` for OCC | Auto-set. Submitted as `name="expected_updated_at"` — used as optimistic concurrency token only; not written back to column. |
| 42 | `deleted_at` | timestamptz | — | Soft-delete flag, set by delete action |
| 43 | `deleted_by` | uuid | — | Set by delete action |
| 44 | `pending_image_attach` | text | — | Internal state machine for image reconciliation cron |

---

## Gap 1: Booking operations fields hidden from read-only users — RESOLVED

**Location:** `src/app/events/[eventId]/page.tsx` line 672

```tsx
{canEdit ? (
  <BookingSettingsCard ... />
) : null}
```

**Impact:** When `canEdit` is false (executives, office_workers at a different venue), these 5 fields were completely invisible on the event detail page:

| Field | What a reviewer/executive would want to see |
|-------|---------------------------------------------|
| `booking_enabled` | Whether bookings are currently live |
| `total_capacity` | How many people the event can hold |
| `max_tickets_per_booking` | Per-booking ticket limit |
| `booking_url` | External booking link (if set) |
| `sms_promo_enabled` | Whether SMS promos are active |

`total_capacity` partially mitigated — it appears on the bookings subpage (`/events/[eventId]/bookings/page.tsx:96`), but only for users with booking view permissions.

### Fix applied (2026-05-07)

All 5 fields added as read-only rows to `EventDetailSummary` in `src/components/events/event-detail-summary.tsx`. The editable `BookingSettingsCard` remains gated behind `canEdit` (correct — only editors should toggle these), while everyone with view access can now see the current state:

```
Bookings: Enabled / Disabled
Capacity: 150
Max per booking: 10
Booking link: https://...
SMS promo: Enabled / Disabled
```

---

## Non-gap observations

These are fields that appear in the form but NOT in the `EventDetailSummary` display. This is by design, not a gap:

| Fields | Reason not in summary |
|--------|-----------------------|
| `public_title`, `public_teaser`, `public_description`, `seo_title`, `seo_description`, `seo_slug` | Visible in the form's "Website" tab (including read-only mode). These are website publishing fields, not event planning context. |
| `manager_responsible_id` | Displayed in the header card at page level, not duplicated in the summary. |
| `assignee_id` | Displayed in the header card and has its own dedicated assignment card in the sidebar. |

---

## Adversarial review findings (2026-05-07)

Findings from Codex adversarial review (Assumption Breaker + Integration & Architecture reviewers). All blocking items resolved; remaining items documented here for reference.

### seo_slug dual ownership (ID-2) — verified, no defect

`seo_slug` is editable in the Website tab (`name="seoSlug"`) and auto-generated by `updateBookingSettingsAction` when bookings are first enabled. Verified behaviour:

- `updateBookingSettingsAction` calls `generateUniqueEventSlug()` only when `bookingEnabled && !seoSlug` — it will not overwrite a manually set slug.
- `saveEventDraftAction` writes `seo_slug` from the form but intentionally omits `booking_url` (comment at line 1042: "booking_url is owned by BookingSettingsCard").
- `generateUniqueEventSlug()` in `src/lib/bookings.ts:98` checks for uniqueness against the DB before returning.

**Conclusion:** No drift risk. The booking action defers to any existing slug, and the form save action defers `booking_url` to the booking action. Each field has a single canonical owner.

### Hidden form field validation (AI-2) — verified, no defect

`eventId` and `expected_updated_at` are submitted as hidden form fields but handled safely server-side:

- `eventId`: parsed via `z.string().uuid()` (line 783), then used in `loadEventEditContext()` which verifies the event exists and the user has permission via `canEditEvent()` (line 791). The authenticated user ID comes from `getCurrentUser()`, not from the form.
- `expected_updated_at`: read via `readExpectedUpdatedAt(formData)` and passed to `callSaveEventDraftRpc` as the OCC token. The RPC compares it against the current `updated_at` in the DB — it is never written back as the new value.

**Conclusion:** Both fields are correctly treated as untrusted client input with proper server-side validation.

### expected_headcount truthiness bug (ID-1) — fixed

`EventDetailSummary` previously used `event.expected_headcount ?` which hid valid zero values (the Zod schema allows 0 via `optionalInteger(0, 10000)`). Changed to `event.expected_headcount != null` to match the pattern used by `ticket_price` and `cancellation_window_hours`.

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
