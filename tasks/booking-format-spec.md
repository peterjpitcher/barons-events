# Booking Format Overhaul Spec

## Summary

Replace the legacy `events.booking_type` values with explicit formats that combine payment model and attendance style. Keep the database/API field names as `booking_type` and `bookingType`.

The public API enum change is breaking. After migration, only the new values are valid and documented.

Until Stripe is added, paid public bookings require an external `booking_url`. Paid events without a `booking_url` must not use the local free-style booking form.

## Booking Formats

| DB/API value | Form/admin label | Customer CTA |
|---|---|---|
| `free_seated` | Free Tickets - Seated | Book your seats |
| `free_standing` | Free Tickets - Standing | Book your tickets |
| `free_standing_unreserved` | Free Tickets - Standing / Unreserved Seating | Book your tickets |
| `paid_seated` | Paid Tickets - Seated | Buy your seats |
| `paid_standing` | Paid Tickets - Standing | Buy your tickets |
| `paid_standing_unreserved` | Paid Tickets - Standing / Unreserved Seating | Buy your tickets |
| `pay_on_arrival_seated` | Pay on Arrival Tickets - Seated | Reserve your seats |
| `pay_on_arrival_standing` | Pay on Arrival Tickets - Standing | Reserve your tickets |
| `pay_on_arrival_standing_unreserved` | Pay on Arrival Tickets - Standing / Unreserved Seating | Reserve your tickets |

## Data Migration

Create a migration that drops the old check constraint, migrates existing rows, then adds the nine-value check constraint.

Before applying the migration to production, audit legacy paid-like rows that have public booking enabled but no external booking URL:

```sql
select id, title, booking_type, booking_enabled, booking_url
from events
where deleted_at is null
  and booking_enabled is true
  and booking_url is null
  and booking_type in ('ticketed', 'table_booking', 'mixed');
```

Those rows will become paid formats. Add a `booking_url`, disable public bookings, or manually reclassify them before release.

Legacy mapping:

| Old value | New value |
|---|---|
| `ticketed` | `paid_seated` |
| `table_booking` | `paid_seated` |
| `free_entry` | `free_standing` |
| `mixed` | `paid_standing` |

No existing rows are migrated to `*_standing_unreserved`; staff can manually choose those after the migration.

The migration clears `ticket_price` for `free_entry -> free_standing` rows and enforces a database check that all `free_*` rows have `ticket_price IS NULL`.

## Implementation Requirements

- Add `src/lib/booking-format.ts` as the single source of truth for values, labels, CTA labels, type guards, and payment/style helpers.
- Update validation, server actions, event forms, detail displays, public API serialization, OpenAPI documentation, AI copy, and SMS campaign logic to use the shared helper.
- Require `ticketPrice` for `paid_*` formats.
- Clear and disable `ticketPrice` for `free_*` formats in the UI, and strip it to `NULL` server-side for crafted submissions.
- Require `cancellationWindowHours` for non-free formats.
- Allow optional `ticketPrice` for `pay_on_arrival_*`, but render it as "pay on arrival" price.
- In AI copy and public UI, refer to `*_standing_unreserved` as "standing / unreserved seating" where seating context matters.
- SMS campaigns use link CTAs for free and paid formats, and reply CTAs for pay-on-arrival formats.
- SMS campaigns skip paid events without `booking_url` and log `cron.skip_paid_missing_booking_url` before claiming send rows.
- The public landing page must pass `booking_type` into the booking form so the heading and submit button match the format.
- Paid formats with an external `booking_url` continue to redirect to that URL.
- Paid formats without `booking_url` do not show the local booking form and instead show a contact/availability message.

## Test Requirements

- Update validation tests for paid price, free cancellation-window optionality, and non-free cancellation-window requirement.
- Update SMS routing tests for all payment groups, including unreserved values.
- Update public API tests for the new enum and legacy-value normalization.
- Update event form tests for the nine options and paid helper copy.
- Add public landing coverage for paid-without-URL guard and format-specific CTA copy.
- Run `npm run test`, `npm run typecheck`, and `npm run lint`.
