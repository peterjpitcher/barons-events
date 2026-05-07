# Adversarial Review: Event Fields UI Audit

**Date:** 2026-05-07
**Mode:** A (Adversarial Challenge)
**Scope:** `docs/event-fields-ui-audit.md` — field-by-field audit of all 44 `public.events` columns against UI components
**Pack:** `tasks/codex-qa-review/2026-05-07-event-fields-ui-audit-review-pack.md`

## Executive Summary

The audit correctly identifies that all 44 `public.events` columns are accounted for in a matrix and that the 5 booking operations fields are invisible to read-only users. However, the claim that 29 form fields are "wired end-to-end (form → Zod → action → DB)" is unproven — the evidence only shows form field names, not the action or validation layer. The audit's scope is narrower than its headline suggests, covering only the event form, detail page, and booking card while the concern logically extends to list/board, calendar, public API, and notification surfaces.

**Overall assessment:** The audit is directionally correct and useful, but carries two material confidence gaps (end-to-end wiring and surface coverage) that should be resolved before treating it as a complete specification.

## What Appears Solid

- **Column enumeration is complete.** The 44-row matrix matches the live database schema exactly — no `public.events` column is missing from the matrix.
- **Gap 1 is real and well-described.** `BookingSettingsCard` is rendered only when `canEdit` is true (`src/app/events/[eventId]/page.tsx:672`), and `EventDetailSummary` does not include the 5 booking operations fields. The visibility gap for read-only users is confirmed.
- **Mutation path separation is clean.** The audit correctly assigns main event form fields to `saveEventDraftAction` and booking operations to `updateBookingSettingsAction`, with clear edit boundaries.
- **Non-gap explanations are sound.** Website/SEO fields being form-only, `manager_responsible_id` appearing in the header card, and `assignee_id` having its own card are all correct architectural decisions, not gaps.
- **System-managed field classification is appropriate.** The 9 fields marked as system-managed (`id`, `created_by`, `submitted_at`, `created_at`, `updated_at`, `deleted_at`, `deleted_by`, `pending_image_attach`) correctly have no user-facing input.

## Critical Risks

### CR-1: End-to-end wiring claim is unproven (AB-001 / ARCH-002)

**Severity:** High | **Confidence:** High | **Blocking:** Yes

The audit's summary table states "All wired end-to-end (form → Zod → action → DB)" for 29 fields, but the evidence only shows `name="..."` attributes in `event-form.tsx`. The review pack did not include `saveEventDraftAction`, `updateBookingSettingsAction`, or the Zod schemas (`eventDraftSchema`, `bookingSettingsSchema`) from `src/actions/events.ts`.

This means:
- camelCase → snake_case mapping could silently drop fields
- Zod `.optional()` vs `.nullable()` handling could reject valid inputs
- The action could omit fields from the database write
- Default/null handling for omitted fields is unknown

**What would confirm:** Inspect `src/actions/events.ts` lines 766+ (`saveEventDraftAction`) and 2398+ (`updateBookingSettingsAction`) plus their Zod schemas to trace every submitted field to its persisted column.

### CR-2: Audit scope is narrower than the headline claim (AB-003 / ARCH-001)

**Severity:** Medium | **Confidence:** High | **Blocking:** Yes

The audit title says "all 44 columns on `public.events` table and their presence across the event form, event detail page, and booking settings card." This is accurate for those three surfaces. But the implicit question — "are any fields missing from the UI?" — extends to:

| Surface | In scope? | Evidence in pack? |
|---------|-----------|-------------------|
| Event form (edit mode) | Yes | Yes |
| Event detail page | Yes | Yes |
| Booking settings card | Yes | Yes |
| Events list/board (`EventsBoard`) | No | No — `src/app/events/page.tsx` delegates to `EventsBoard` but that component was not reviewed |
| Calendar view | No | No |
| Public API responses | No | No — API serializer code not reviewed |
| Public landing pages | No | No |
| Email/notification templates | No | No |

**Impact:** The "only gap" conclusion is safe within the stated scope but cannot be extended to the full product surface.

**What would confirm:** Either (a) add an explicit "In Scope / Out of Scope" section to the audit, or (b) extend the matrix to cover `EventsBoard`, public API serializers, and notification templates.

## Implementation Defects

### ID-1: `expected_headcount` truthiness check hides valid zero (AB-004)

**Severity:** Medium | **Confidence:** Medium | **Blocking:** No

`EventDetailSummary` uses a truthiness check for `expected_headcount`:

```tsx
{event.expected_headcount ? (<SummaryItem ... />) : null}
```

This hides the field when `expected_headcount === 0`, which is a valid stored value (the column is `integer` with no NOT NULL or CHECK constraint). Compare with `ticket_price` and `cancellation_window_hours` which use `!= null` checks and correctly display zero values.

**What would confirm:** Check whether the validation layer or database constraints disallow zero for `expected_headcount`. If zero is valid, change the truthiness check to `event.expected_headcount != null`.

**File:** `src/components/events/event-detail-summary.tsx:130`

### ID-2: `seo_slug` dual ownership creates drift risk (ARCH-004)

**Severity:** Medium | **Confidence:** Medium | **Blocking:** No

`seo_slug` is editable in the Website tab (`name="seoSlug"`) and auto-generated by booking settings. `BookingSettingsCard` derives the short link from local slug state (`https://l.baronspubs.com/${currentSlug}`).

If a user manually sets a slug in the Website tab and then enables bookings (which auto-generates a slug), the two paths could conflict. The audit notes this dual source but does not trace whether a single canonical slug helper prevents drift.

**What would confirm:** Review `saveEventDraftAction` and `updateBookingSettingsAction` for a shared slug generation/uniqueness helper and determine which path wins when both have been used.

## Architecture & Integration Defects

### AI-1: `sms_promo_enabled` permission model incomplete (AB-002 / ARCH-003)

**Severity:** Medium | **Confidence:** High | **Blocking:** No (needs human decision)

The audit lists `sms_promo_enabled` alongside the other 4 booking fields in Gap 1. But it has an additional constraint: even within `BookingSettingsCard`, the SMS toggle renders only when `userRole === "administrator"`. This means:

| User role | Can see SMS promo state? |
|-----------|--------------------------|
| Administrator with canEdit | Yes (toggle) |
| Office worker with canEdit | No (toggle hidden) |
| Executive (read-only) | No (entire card hidden) |
| Office worker (other venue, read-only) | No (entire card hidden) |

The audit's summary count of "5 fields editable in booking settings card" overstates general edit coverage — it's 4 for non-admin editors, 5 for administrators.

**Decision needed:** Is SMS promo state intentionally hidden from non-administrators for compliance/commercial reasons? If yes, document that decision. If no, add a read-only display for office_workers who can edit the event.

### AI-2: Hidden form fields classified as system-managed (ARCH-005)

**Severity:** Low | **Confidence:** Medium | **Blocking:** No

The audit groups `id` and `updated_at` as "system-managed (no UI input expected)" but `event-form.tsx` submits both as hidden fields:
- `name="eventId"` at line 1750
- `name="expected_updated_at"` at line 1754

These are client-supplied values, not truly system-managed. The server action should (and likely does) treat `eventId` as an identifier for authorisation scoping and `expected_updated_at` as an optimistic concurrency token — but the audit's classification could mislead someone into thinking these values cannot be tampered with.

**What would confirm:** Verify the server action independently authorises the user for the given `eventId` and uses `expected_updated_at` only in the OCC predicate (not written back to the column).

## Unproven Assumptions

| # | Assumption | What would confirm | What would deny |
|---|------------|-------------------|-----------------|
| 1 | All 29 form fields persist correctly through camelCase→snake_case mapping | Read `saveEventDraftAction` and trace each field | A field name mismatch in the Zod schema or DB write |
| 2 | The 5 booking fields are the only gap across the entire product | Review `EventsBoard`, public API, calendar, email templates | A field absent from the events list or public API response |
| 3 | Zero is not a valid value for `expected_headcount` | DB constraint or Zod schema rejecting 0 | No constraint, meaning the truthiness check is a bug |
| 4 | `seo_slug` has a single canonical generation path | Shared slug helper in both actions | Two independent slug generators with no coordination |
| 5 | `eventId` and `expected_updated_at` are safely validated server-side | Action code shows auth check + OCC predicate | Action trusts client-supplied values without verification |

## Recommended Fix Order

1. **Add scope disclaimer to audit** (CR-2) — low effort, removes false confidence immediately
2. **Verify end-to-end wiring** (CR-1) — read the two server actions and Zod schemas; update the audit with evidence
3. **Fix `expected_headcount` truthiness check** (ID-1) — one-line change: `?` → `!= null`
4. **Decide `sms_promo_enabled` permission model** (AI-1) — human decision, then encode in code
5. **Trace `seo_slug` ownership** (ID-2) — verify single canonical path or add coordination
6. **Verify hidden field handling** (AI-2) — confirm server action validates independently

## Minor Observations

- **AB-005:** The form field grep includes artist subform fields (`name`, `artistType`, `email`, `phone`, `description`) that are not `events` columns. The audit matrix correctly excludes them, but the evidence source mixes related-model fields with event fields, which could mask a mapping error if not carefully separated.
- Both reviewers independently confirmed that the 44-column count matches the live schema, providing high confidence in the enumeration completeness.
- No security exposure was identified from the proposed read-only display of booking operations fields in Gap 1.
