# Event form & RLS fixes — design

**Date:** 2026-05-07
**Author:** Claude (discovery)
**Scope:** 5 changes — 3 UI moves, 2 bug fixes
**Complexity:** L (touches 1 component file, 1 page, 1 server action, 1 RLS migration, 2 callers)

## Summary

| # | Change | Type | Risk |
|---|---|---|---|
| 1 | Move "Booking link" field from Website Listings tab → Booking Settings Card; when set, the public landing page no longer serves the local booking flow | UI move + behaviour | M |
| 2 | New event page renders the same tabbed layout as edit (currently uses legacy collapsible cards) | UI parity | S |
| 3 | Fix `42P17 infinite recursion detected in policy for relation "events"` on Submit-for-review | RLS bug | M |
| 4 | Event type Select silently clears its value when saving | Form bug | S |
| 5 | Move "Booking format" + "Ticket price (£)" from Accelerate Growth tab → Event Details tab | UI move | XS |

## Open question (one only)

**Q1 — Task 1 behaviour when `booking_url` is set:** the user wants to "disable the local booking page and only serve the booking link". Three possible interpretations of [src/app/l/[slug]/page.tsx](src/app/l/[slug]/page.tsx) behaviour:

- **A.** Public landing page returns a 308 redirect straight to `booking_url` (slug still works for sharing/SEO; the `BookingForm` is never rendered).
- **B.** Public landing page renders event details as today, but replaces the `BookingForm` with a "Book on [partner site]" button linking to `booking_url`.
- **C.** Setting `booking_url` automatically forces `booking_enabled = false`, so `/l/{slug}` 404s and only the external link is shared.

**Default if no answer: B** — keeps the marketing landing page working (image, copy, highlights) and replaces only the form. It's the least destructive — admins can still toggle `bookingEnabled` independently and the landing page keeps working as a marketing surface even if `booking_url` is later cleared.

---

## Discovery findings

### Files in scope

| Concern | File |
|---|---|
| Shared form component (new + edit) | [src/components/events/event-form.tsx](src/components/events/event-form.tsx) |
| Booking Settings Card | [src/components/events/booking-settings-card.tsx](src/components/events/booking-settings-card.tsx) |
| Edit page wrapper | [src/app/events/[eventId]/page.tsx](src/app/events/[eventId]/page.tsx) |
| New page wrapper | [src/app/events/new/page.tsx](src/app/events/new/page.tsx) |
| Public landing page | [src/app/l/[slug]/page.tsx](src/app/l/[slug]/page.tsx) |
| Server actions | [src/actions/events.ts](src/actions/events.ts) |
| Validation | [src/lib/validation.ts](src/lib/validation.ts) |
| RLS migrations (recursion source) | [supabase/migrations/20260504203000_scope_office_worker_visibility.sql](supabase/migrations/20260504203000_scope_office_worker_visibility.sql) |
| Event types listing | [src/lib/event-types.ts](src/lib/event-types.ts) |

### Form structure today

`EventForm` is a single component used in both create and edit. It branches on whether the parent passed a `sidebar` prop:

- `sidebar` truthy → tabbed layout (used by edit page). Tabs: Event Details · Accelerate Growth · Website Listings · Debrief.
- `sidebar` falsy → legacy collapsible Cards layout (used by new page): "1. Core details" / "2. Timing & spaces" / etc.

Tab content uses `<div role="tabpanel" hidden={activeTab !== value}>` (see [src/components/ui/tabs.tsx:93](src/components/ui/tabs.tsx:93)) — so all inputs from all tabs stay in the DOM and are submitted regardless of active tab.

### Current field placement (edit, tabbed)

| Tab | Fields |
|---|---|
| Event Details | title, venue, eventType, notes, manager responsible, artists, start/end, spaces, image |
| Accelerate Growth | wet/food promo, headcount, **bookingType**, **ticketPrice**, check-in cutoff, cancellation window, age policy, accessibility, terms, financials, goals |
| Website Listings | publicTitle, publicTeaser, publicDescription, publicHighlights, **bookingUrl**, seoTitle, seoDescription, seoSlug |

---

## Change 1 — Booking link moves to Booking Settings Card

### Move the field

Remove `bookingUrl` Label/Input from the `websiteFields` block (around [event-form.tsx:1339](src/components/events/event-form.tsx:1339)) and add an equivalent input to [booking-settings-card.tsx](src/components/events/booking-settings-card.tsx).

`booking_url` storage stays as today (column on `events`). The card already calls `updateBookingSettingsAction`; extend the action signature with `bookingUrl: string | null` and persist it on `events.booking_url`.

### Card UX

Add a new field under "Bookings enabled" toggle and above "Total capacity":

```
[Booking link (optional)]
[ https://example.com/buy-tickets                                ]
If set, guests are sent straight to this link instead of the local booking page.
```

When `bookingUrl` is non-empty, also visually de-emphasise the local-booking fields ("Total capacity" and "Max tickets per booking") with a small hint: "These only apply if no booking link is set." Don't disable the inputs — the office_worker can still configure both for fallback.

### Public landing behaviour (depends on Q1)

In [src/app/l/[slug]/page.tsx](src/app/l/[slug]/page.tsx), `getEventBySlug` already selects all needed columns. Add `booking_url` to the SELECT and:

- **If Q1 = A:** when `event.booking_url`, return `redirect(event.booking_url, RedirectType.replace)` (or 308 via `redirect()` server-side).
- **If Q1 = B (default):** render the page; replace `<BookingForm>` with `<a href={event.booking_url} className="...">Book at {hostname}</a>`. Show host name extracted via `new URL(booking_url).hostname` for trust.
- **If Q1 = C:** add a server-side guard in `updateBookingSettingsAction` that forces `booking_enabled = false` when `bookingUrl` is non-null.

### Existing references to keep working

`booking_url` is also read by:

- [src/app/api/v1/events/route.ts](src/app/api/v1/events/route.ts), [.../by-slug/[slug]/route.ts](src/app/api/v1/events/by-slug/[slug]/route.ts), [.../[eventId]/route.ts](src/app/api/v1/events/[eventId]/route.ts) — public API, no change needed
- [src/app/api/cron/sms-booking-driver/route.ts](src/app/api/cron/sms-booking-driver/route.ts) — uses `booking_url` for SMS link, no change
- [src/lib/sms-campaign.ts](src/lib/sms-campaign.ts) — uses `booking_url` as the SMS link, no change
- [src/lib/ai.ts](src/lib/ai.ts) — gates AI copy generation on whether a booking_url exists, no change

### Validation

`bookingUrlSchema` ([src/lib/validation.ts:77](src/lib/validation.ts:77)) keeps current preprocess; reuse it inside `updateBookingSettingsAction`.

---

## Change 2 — New form matches edit form

The page at [src/app/events/new/page.tsx:80](src/app/events/new/page.tsx:80) renders `<EventForm mode="create" />` without a `sidebar`. The form falls through to the legacy collapsible-cards branch ([event-form.tsx:2046](src/components/events/event-form.tsx:2046)).

**Approach:** route the create-mode render through the same tabbed layout as edit. Two sub-options:

- **a.** Pass a minimal `sidebar` (e.g. just the "Save & submit" card) from `new/page.tsx`. The existing branch is keyed on truthy `sidebar`, so this lights up the tabbed layout for free.
- **b.** Refactor the branch to be keyed on `mode` instead of `sidebar`, and put a default sidebar inside the component for create mode.

Recommend **(a)** — smaller diff, no component-API changes. The new sidebar contains a single "Create event" card with the existing primary submit button (the legacy form's submit handler already lives in the create branch around [event-form.tsx:2053](src/components/events/event-form.tsx:2053); reuse it).

After this change, delete the legacy collapsible-card render path entirely. It's no longer reachable, and removing it cuts ~600 lines from the file.

### What's identical between modes

- Field set: identical (both modes already render every field at component level — the difference is purely layout).
- Validation: identical (both call `saveEventDraftAction` / `submitEventForReviewAction`).
- State management: identical (same `useActionState`, same controlled inputs).

So the migration is purely visual.

### What differs (intentional)

- `mode="create"`: no Debrief tab, no "Booking Settings" card in sidebar (no event id yet).
- `mode="edit"`: Debrief tab appears once a debrief exists.

These already gate correctly via `{debrief ? ... : null}` and `canEdit ? <BookingSettingsCard /> : null` — no change needed.

### Risk

- One existing test file [src/components/events/__tests__/event-form.create.test.tsx](src/components/events/__tests__/event-form.create.test.tsx) — review test selectors (`getByLabelText` style queries should keep working since field labels are unchanged).

---

## Change 3 — RLS recursion fix

### Reproduction

User `office_worker` clicks "Submit for review" on a draft event they created → server action UPDATEs `events.status` from `draft` to `submitted` → Postgres returns:

```
42P17 infinite recursion detected in policy for relation "events"
```

### Root cause

The cycle was introduced in [supabase/migrations/20260504203000_scope_office_worker_visibility.sql](supabase/migrations/20260504203000_scope_office_worker_visibility.sql):

```
events UPDATE policy
  └─ calls event_visible_to_current_user(id, venue_id)   -- SECURITY DEFINER
       └─ SELECT FROM event_venues                        -- triggers event_venues_read
            └─ event_venues_read.USING:
               EXISTS (SELECT FROM events e WHERE event_visible_to_current_user(e.id, e.venue_id))
                 └─ events_select_policy.USING:
                    event_visible_to_current_user(id, venue_id)
                       └─ SELECT FROM event_venues  ← cycle
```

`SECURITY DEFINER` does not break the cycle because Postgres' policy-recursion detector trips at runtime when an `events` policy is already on the evaluation stack while being asked to evaluate another `events` policy. The function body's queries trigger the inner table's RLS unless the function owner has `BYPASSRLS`.

### Fix (preferred — break the cycle at `event_venues_read`)

Rewrite `event_venues_read` so it does **not** call back into `events`. An `event_venues` row is a venue-link; access can be expressed purely in terms of the user's role and their `venue_id`:

```sql
DROP POLICY IF EXISTS event_venues_read ON public.event_venues;
CREATE POLICY event_venues_read ON public.event_venues
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN ('administrator', 'executive')
    OR (
      public.current_user_role() = 'office_worker'
      AND (
        public.current_user_venue_id() IS NULL                -- unscoped OW: see all
        OR venue_id = public.current_user_venue_id()          -- scoped OW: see own venue's links
      )
    )
  );
```

This keeps the existing access intent for office workers (their own venue's links visible) and breaks the events↔event_venues cycle at the policy level.

**Trade-off accepted:** a venue-scoped office_worker at venue A can no longer see the `event_venues` rows linking an event to venues B and C. They still see the parent `events` row (via `events_select_policy` which uses the SECURITY DEFINER helper). If we need the multi-venue badge in the UI for scoped OWs, surface that via the parent event's joined `venues` array (already done in [getEventDetail](src/lib/events.ts)) rather than requiring all event_venues rows.

### Alternative fix (consider only if cycle persists)

Add `SET LOCAL row_security = off` inside `event_visible_to_current_user`. Requires the function owner to have `BYPASSRLS`; in Supabase this is normally `postgres` and works. Less robust than fixing the cycle structurally.

### Migration plan

New migration `20260507100000_fix_event_venues_recursion.sql`:

1. `DROP POLICY IF EXISTS event_venues_read ON public.event_venues;`
2. Recreate with the simplified rule above.
3. `NOTIFY pgrst, 'reload schema';`

No data migration. No behaviour change for administrators/executives. Minor visibility narrowing for venue-scoped office workers on multi-venue event_venues join rows (compensated by joins through events).

### Tests

- Unit test on `submitEventForReviewAction` for an office_worker draft: assert no `42P17`, status moves draft → submitted. Mock Supabase per existing pattern in [src/actions/__tests__/events-edit-rbac.test.ts](src/actions/__tests__/events-edit-rbac.test.ts).
- Integration test (if Supabase-local available) — run the full SQL: insert event as OW, call submit, assert success.

---

## Change 4 — Event type silently clearing on save

### Reproduction (hypothesised — needs confirmation in QA)

1. Event has `event_type = "Bingo"` saved historically.
2. Admin renames or deletes "Bingo" in `/admin/event-types` (no FK constraint — see [src/lib/event-types.ts:30](src/lib/event-types.ts:30) calling DELETE/UPDATE on `event_types.label` directly).
3. User opens the event. `EventForm` initialises `eventTypeValue = "Bingo"` from `defaultValues.event_type` ([event-form.tsx:362](src/components/events/event-form.tsx:362)).
4. The Select renders with `value="Bingo"`, but no `<option value="Bingo">` exists in `typeOptions`. The browser falls back to the first option (the placeholder `value=""`).
5. User makes an unrelated change and clicks Save. The form submits `eventType=""` because that's the option the DOM has selected.
6. `saveEventDraftAction` writes `event_type = null`.
7. Symptom: "event type seems to get cleared while I'm saving".

### Root cause

`typeOptions` is built from `eventTypes` prop alone ([event-form.tsx:499](src/components/events/event-form.tsx:499)) and doesn't include the currently-saved value if it's been removed/renamed. `event_types` is a free-text catalogue with **no foreign key** from `events.event_type`, so renames/deletes silently orphan event rows.

There's also no hidden input fallback. Other selects (`bookingType`, `agePolicy`, etc.) get hidden mirrors at [event-form.tsx:1732](src/components/events/event-form.tsx:1732) — but those are scoped inside the **terms-modal form**, not the main form.

### Fix

Inject the current value into the options list when it's missing:

```ts
const typeOptions = useMemo(() => {
  const base = eventTypes.length ? eventTypes : ["General"];
  if (eventTypeValue && !base.includes(eventTypeValue)) {
    return [...base, eventTypeValue];
  }
  return base;
}, [eventTypes, eventTypeValue]);
```

Render the legacy value as a normal option (so the user can keep it on save) but visually mark it: `{type}{!base.includes(type) ? " (legacy)" : ""}` to nudge them to pick a current type.

### Defence in depth (optional)

Server-side: if `formData.get("eventType")` is empty AND `record.event_type` is non-empty, treat it as "no change" rather than nulling. Looks like [src/actions/events.ts:322](src/actions/events.ts:322) already does this — `?? record.event_type ?? ""` — but this fallback is in the **read-back** path; the **write** path at line 762 (`event_type: values.eventType`) does not preserve the prior value. Add the same `?? record.event_type` fallback to the write path so a missed-option submit can't null out the existing value.

### Tests

- Vitest: render `EventForm` with `defaultValues.event_type = "Bingo"`, `eventTypes = ["Quiz", "Concert"]`. Assert the rendered Select has an option with `value="Bingo"` and that it is selected.
- Vitest on action: `saveEventDraftAction` called with `eventType=""` and existing `record.event_type = "Bingo"` keeps `event_type = "Bingo"` in the upsert payload.

---

## Change 5 — Booking format + Ticket price → Event Details tab

Move both fields from the **Accelerate Growth** tab to **Event Details**. Keep them as a single grid under `eventTypeField` so the Event Details tab reads:

- Title + Venue
- Event type
- **Booking format + Ticket price (new position)**
- Notes
- Manager responsible
- Artists
- Start/end
- Spaces
- Image

Mechanically: in [event-form.tsx:1897-1906](src/components/events/event-form.tsx:1897), insert `{bookingFields}` between `{eventTypeField}` and `{notesField}`. Remove the same `{bookingFields}` reference from the Accelerate Growth tab around [event-form.tsx:1912](src/components/events/event-form.tsx:1912).

The `bookingFields` `const` at [event-form.tsx:1065](src/components/events/event-form.tsx:1065) is unchanged — only its placement moves. No state changes, no validation changes.

After Change 1 lands, the Website Listings tab still has `bookingUrl` if not yet moved; this change is independent.

---

## Sequencing

Recommended order — each lands as its own PR for reviewability:

1. **Change 3 (RLS fix)** — unblocks office workers in production. No UI dependencies.
2. **Change 4 (event type clearing)** — small, self-contained bug fix.
3. **Change 5 (move booking format + ticket price)** — pure layout change, very low risk.
4. **Change 1 (booking link → card)** — needs Q1 answered. Touches public landing page.
5. **Change 2 (new form matches edit)** — touches the most code; do last so all field locations are settled.

## Test matrix

| Surface | What to verify |
|---|---|
| `/events/new` (after Change 2) | Tabs render; create flow still saves; create-mode-only fields (no debrief tab, no booking settings) hidden |
| `/events/{id}` (after all) | Booking format + ticket price on Event Details; bookingUrl on Booking Settings Card; Submit-for-review works without 42P17 |
| `/l/{slug}` (after Change 1) | When `booking_url` set: see Q1 answer. When not set: unchanged |
| Office_worker submit-for-review | No `42P17`, audit row written |
| Event with legacy event_type | Dropdown preserves the legacy label, save doesn't null it |

## Risk summary

- **Highest risk:** Change 1 public landing page behaviour (depends on Q1).
- **Database risk:** Change 3 narrows `event_venues` visibility for venue-scoped OWs on multi-venue links — confirmed acceptable since the parent event row already exposes `venues[]`.
- **Backwards compatibility:** `booking_url` storage and API responses are unchanged. Other consumers (SMS driver, public API, AI copy) keep working.
