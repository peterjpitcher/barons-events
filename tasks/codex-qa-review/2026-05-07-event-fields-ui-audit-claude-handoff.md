# Claude Hand-Off Brief: Event Fields UI Audit

**Generated:** 2026-05-07
**Review mode:** A (Adversarial Challenge)
**Overall risk:** Medium
**Reviewers:** Assumption Breaker, Integration & Architecture

## DO NOT REWRITE

These elements of the audit are confirmed correct — preserve them:

- The 44-row field matrix — every `public.events` column is accounted for
- Gap 1 identification — `BookingSettingsCard` gated behind `canEdit`, and `EventDetailSummary` missing the 5 booking fields
- The recommended fix for Gap 1 (add read-only rows to `EventDetailSummary`)
- Non-gap explanations (Website/SEO fields form-only, manager_responsible_id in header, assignee_id in sidebar card)
- System-managed field classification for the 7 truly system-managed fields (created_at, created_by, submitted_at, deleted_at, deleted_by, pending_image_attach, updated_at as auto-set)
- Mutation path separation (saveEventDraftAction vs updateBookingSettingsAction)

## SPEC REVISION REQUIRED

- [ ] **Add explicit scope section** (CR-2): Insert an "In Scope / Out of Scope" section after the Summary table. In scope: event form, event detail page, booking settings card. Out of scope: events list/board, calendar view, public API responses, public landing pages, email/notification templates. This prevents the "only gap" claim being read as product-wide.

- [ ] **Qualify the end-to-end wiring claim** (CR-1): Change "All wired end-to-end (form → Zod → action → DB)" to "All present as named form fields — server action and Zod schema verification pending" until someone inspects `saveEventDraftAction` (line 766) and `eventDraftSchema` in `src/actions/events.ts`.

- [ ] **Clarify sms_promo_enabled edit coverage** (AI-1): In the Booking & Ticketing table, row 26 already notes "Toggle (admin only)". Add a footnote to the Summary table changing "Editable in booking settings card: 5" to "Editable in booking settings card: 4 (all editors) + 1 (administrator only)".

- [ ] **Reclassify id and updated_at** (AI-2): Move `id` and `updated_at` from "System-managed (no UI input expected)" to a new category "System-managed (submitted as hidden form fields for identification/OCC)" or add a note that these are client-supplied tokens validated server-side.

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **Fix expected_headcount truthiness check** (ID-1): `src/components/events/event-detail-summary.tsx:130` — change the condition from `event.expected_headcount ? (...)` to `event.expected_headcount != null ? (...)` so that a valid zero value displays "0" instead of being hidden. Check whether other numeric fields in the same component use the same truthiness pattern and fix consistently.

## ASSUMPTIONS TO RESOLVE

- [ ] **End-to-end wiring verification** (CR-1): Read `src/actions/events.ts` — trace every `name="..."` from event-form.tsx through `eventDraftSchema` (Zod) and `saveEventDraftAction` to the `.update()` or `.insert()` call. Confirm each camelCase form field maps to the correct snake_case DB column. Do the same for the 5 booking fields through `bookingSettingsSchema` and `updateBookingSettingsAction`.

- [ ] **sms_promo_enabled permission decision** (AI-1): Ask the product owner: is SMS promo state intentionally hidden from non-admin editors? If yes, document in the audit. If no, add read-only display for office_workers with canEdit, and add to the Gap 1 read-only display for all other users.

- [ ] **seo_slug dual ownership** (ID-2): Check whether `saveEventDraftAction` and `updateBookingSettingsAction` share a single slug generation helper, and what happens when the form changes `seo_slug` after bookings are enabled with an auto-generated slug. If there is no coordination, decide which path is canonical.

- [ ] **expected_headcount zero validity** (ID-1): Before applying the fix, confirm whether the Zod schema or database allows `expected_headcount = 0`. If zero is invalid by design, add a `.min(1)` constraint to the schema instead of changing the display.

## REPO CONVENTIONS TO PRESERVE

- `EventDetailSummary` uses `SummaryItem` components with label/value pairs — any new read-only booking fields should follow the same pattern
- Null-check pattern for numeric display: use `!= null` (not truthiness) — see `ticket_price` and `cancellation_window_hours` as examples
- `BookingSettingsCard` is a `'use client'` component — the edit boundary must stay gated behind `canEdit`
- Hidden form fields for `eventId` and `expected_updated_at` are standard patterns for identification and OCC — do not remove them

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CR-1: Re-review after end-to-end wiring is verified — the audit's confidence level should be upgraded
- [ ] CR-2: Re-review after scope section is added — confirm the language is unambiguous
- [ ] ID-1: Re-review after expected_headcount fix — verify no regression in the display for null vs zero vs positive values

## REVISION PROMPT

After resolving the assumptions above, apply the spec and code changes with this prompt:

```
Update docs/event-fields-ui-audit.md with these changes:

1. After the Summary table, add a new "## Scope" section:
   - In scope: event form (event-form.tsx), event detail page ([eventId]/page.tsx + event-detail-summary.tsx), booking settings card (booking-settings-card.tsx)
   - Out of scope: events list/board (EventsBoard), calendar view, public API responses, public landing pages, email/notification templates

2. In the Summary table, change row 2 from "Editable in booking settings card | 5" to "Editable in booking settings card | 4 + 1 admin-only" and add a footnote explaining sms_promo_enabled is administrator-only.

3. If end-to-end wiring has been verified, update row 1 status to "Verified end-to-end (form → Zod → action → DB) on [date]". If not yet verified, change to "Form fields present — action/schema verification pending".

4. In the System-managed fields section, add a note to rows 37 (id) and 41 (updated_at) that these are submitted as hidden form fields for identification and optimistic concurrency control.

5. In src/components/events/event-detail-summary.tsx, find the expected_headcount conditional render and change the truthiness check to a null check (event.expected_headcount != null).
```
