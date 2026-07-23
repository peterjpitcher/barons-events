# Universal Event Landing Page: Discovery and Specification

Date: 2026-07-23
Revision: 3
Status: Built and merged to the feature branch. See the change log for what adversarial review corrected.
Complexity: 3 (M). Touches 8 files. No migration, no backfill (see change log).

## Change log for revision 3

Adversarial review of the implemented branch found three defects in revision 2's design. All are
fixed in code and corrected above:

1. **The paid checkout path bypassed the finished-event guard.** Revision 2 said "enforce the same
   rules server-side" and named only `getPublicBookingEligibility`. Paid bookings use a different
   entry point that duplicates the eligibility checks. Two live events could have taken money months
   after they ended. Neither had. See Part E.
2. **`external` outranked `finished`.** 33 live public events have both a booking URL and a past end
   date, and would have been 308ed to a live third-party booking page. See Part D.
3. **The canonical tag used the internal title** while the API builds `eventPageUrl` from
   `public_title`, so 20 events would have advertised a canonical the brand site never links to.

A fourth, pre-existing, was fixed because this change widened its blast radius:
`generateUniqueEventSlug` trimmed hyphens before truncating, so roughly one in nine long titles
produced a slug that the event form's own validation then rejects, blocking every later save.

## Change log for revision 2

Revision 1 proposed backfilling `seo_slug` for every event missing one. Verification against
production showed that would have **changed `PublicEvent.slug` for 31 live events**, because
`buildEventSlug` (`src/lib/public-api/events.ts:129-133`) prefers `seoSlug` over `title`. If the
brand site builds its own URLs from `slug`, those URLs would have broken.

The backfill is removed. The ID-suffixed route in Part B already guarantees a working URL without
it, so the backfill was solving a problem that was already solved. Result: **zero change to any
existing API field value.** All API work is now purely additive.

## Summary

Today 43% of live public events have no customer-facing link of any kind. This spec makes
`l.baronspubs.com` resolve for every public event, using the same landing page that bookable events
already use, with the booking area driven by the event's own rules. Events that cannot be booked
show the event detail and no booking controls. The URL becomes the catch-all so there is always a
link to hand a customer.

Nothing new appears in the BaronsHub admin UI. The link is derived, not entered.

**Hard constraint: the public API stays backward compatible.** No existing field is removed,
renamed, retyped, or changed in value for any existing event. See Part G.

## Decisions (agreed 2026-07-23)

1. Non-bookable landing pages are hidden from search (`noindex, follow`). They duplicate the main
   Barons website and would otherwise compete with it.
2. Copy when booking is not possible: "No booking needed, just come along" for closed events,
   "This event has finished" for past events.
3. API changes are additive only. `bookingPageUrl` keeps its current meaning.
4. Past events stay reachable and are marked as finished, so old links and QR codes do not
   dead-end.
5. Booking against a finished event is blocked.

## Evidence

### Code as it stands

- The public landing page is `src/app/l/[slug]/page.tsx`, served on `l.baronspubs.com`.
  `middleware.ts:110-146` rewrites `l.baronspubs.com/<path>` to `/l/<path>`, except 8-hex short
  link codes and static assets.
- The page hard-404s when booking is off: `src/app/l/[slug]/page.tsx:136-138`
  (`if (!event || !event.booking_enabled) notFound()`).
- When `booking_url` is set, the page issues a 308 to it: `src/app/l/[slug]/page.tsx:144-146`.
- The public API computes `bookingPageUrl` only when booking is enabled and a slug exists:
  `src/lib/public-api/events.ts:113-116` (`buildBookingPageUrl`). Otherwise it is `null`.
- `PublicEvent.slug` is computed as `<slugBase>--<id>`, where `slugBase` is `seoSlug` if present,
  else the title: `src/lib/public-api/events.ts:129-133`.
- `seo_slug` is generated in only two places: on reschedule (`src/lib/events.ts:1081`) and when
  booking is first switched on (`src/actions/events.ts:3501-3509`). Ordinary event creation stores
  whatever the user typed, or `null` (`src/lib/events.ts:523`, `src/actions/events.ts:1120`).
- `seo_slug` carries a unique index (`events_seo_slug_unique`) and is user-editable in the event
  form (`src/components/events/event-form.tsx:544`).
- The fallback pattern already exists, inlined and incomplete, in the SMS campaign driver:
  `src/lib/sms-campaign.ts:189-190` does `bookingUrl ?? (seoSlug ? l.baronspubs.com/<seoSlug> : null)`
  and abandons the send when both are missing (`:193-196`).

### Production data (queried 2026-07-23)

Scope: `events` where `deleted_at is null`, `status in ('approved','completed')`, venue not internal.

| Measure | Count |
|---|---|
| Public events | 95 |
| Have `booking_url` | 36 |
| Have `booking_enabled` | 34 |
| In-app booking (enabled, no external URL) | 18 |
| **No link of any kind** | **41 (43%)** |
| Of those, upcoming | 25 |
| Of those, past | 16 |
| Public events with no `seo_slug` | 31 |
| Of those, with booking enabled | 0 |
| Public events with no `booking_type` | 25 |
| Events in the no-link group missing public copy | 0 |
| Events in the no-link group missing an image | 18 |

Two things follow. First, the gap is large and mostly upcoming events, so this is worth doing.
Second, all 31 slugless events have booking disabled, which is why `bookingPageUrl` is unaffected by
anything in this spec: it was null for all of them before and stays null.

## Problems this fixes

1. **P1. No link exists for 41 public events.** The website, SMS campaigns, QR codes and emails
   have nothing to point at.
2. **P2. 31 public events have no slug**, so no slug-based URL can be constructed for them.
3. **P3. The landing page 404s on booking-disabled events**, which is the exact case we now want it
   to serve.
4. **P4. Past events with booking still enabled can be booked.** `getPublicBookingEligibility`
   (`src/actions/bookings.ts:104-158`) checks `booking_enabled`, `deleted_at`, `status`,
   `booking_type`, `booking_url` and internal venue. It never checks `start_at` or `end_at`, and
   `completed` is an allowed status. A customer can book a finished event. Opening the page up to
   more events makes this reachable far more often.
5. **P5. A null `booking_type` with booking enabled renders a live form.** The page passes
   `bookingFormat: null` straight into `BookingForm` (`src/app/l/[slug]/page.tsx:148, 286`). The
   server action rejects it, but the customer only finds out after filling the form in. 25 public
   events have no `booking_type`.
6. **P6. Editing a slug silently breaks every link already in the wild.** `seo_slug` is free text
   in the event form and is the only lookup key the page has.

## Design

### Principle

Every public event resolves at `l.baronspubs.com`, always. What the customer sees there is decided
by the event's own rules, not by whether somebody remembered to fill in a field.

An external `booking_url` stays a redirect *from* that URL rather than a replacement *for* it. That
keeps the URL stable when a venue changes ticketing provider.

### Part A: slugs on new events only

Generate `seo_slug` at insert time when the user has not supplied one. Apply in `src/lib/events.ts`
(`createEvent` path, near `:523`) and the RPC save path (`src/lib/events/save-rpc.ts` /
`src/actions/events.ts:1120`, `:1600`), reusing `generateUniqueEventSlug` from
`src/lib/bookings.ts:165`.

**No backfill of existing events.** The brand site has already seen `slug` values for those 31
events, derived from their titles. Writing a `seo_slug` would change `slug` underneath it. New
events carry no such history: the slug exists before the event is ever approved and published, so
the brand site never sees a "before" value. Safe.

Leave the existing auto-generate in `updateBookingSettingsAction` in place as belt and braces.

### Part B: an ID-suffixed URL that always works (fixes P2 and P6)

This is the mechanism that makes the guarantee hold without touching existing data.

Accept an ID-suffixed form at the same route: `/l/<anything>--<uuid>`. This is already the shape the
public API emits as `PublicEvent.slug`, so we are honouring a URL shape we publish rather than
inventing one.

Resolution order in `getEventBySlug`:

1. Exact `seo_slug` match. Serve.
2. Else, if the path ends `--<uuid>`, look up by ID. If found and the event has a current
   `seo_slug` that differs, 308 to the canonical slug URL. Otherwise serve.
3. Else 404.

This means an event does not need a `seo_slug` to have a working, permanent URL, and a slug that is
later edited or added upgrades the URL through a redirect rather than breaking it.

### Part C: open the page up (fixes P3)

Replace the `!event.booking_enabled` 404 with a visibility check only. The page 404s when, and only
when, the event is deleted, its status is not `approved` or `completed`, or its venue is internal.
Those three are already enforced in `getEventBySlug` (`:69-70`, `:87`).

### Part D: one booking state, computed once server-side (fixes P5)

Compute a single discriminated `bookingState` in the page and pass it down. Order matters: the
first matching row wins.

| State | Condition | What the customer sees |
|---|---|---|
| `finished` | event end time has passed | Detail, plus "This event has finished" |
| `external` | `booking_url` set | 308 redirect, unchanged |
| `closed` | `booking_enabled` false | Detail, plus "No booking needed, just come along" |
| `misconfigured` | `booking_enabled` true, `booking_type` null | Detail, plus the `closed` message |
| `sold_out` | capacity reached | Detail, plus "Sorry, this event is fully booked" (existing copy) |
| `open_paid` | paid format | Checkout, unchanged |
| `open` | free or pay-on-arrival format | Booking form, unchanged |

`finished` sits at the top, above `external`. Revision 2 had `external` first, on the reasoning that
links already in the wild should keep redirecting. That was wrong: 33 live public events have both
a booking URL and a past end date, so it would have sent customers to a live third-party booking
page for an event that was over, and contradicted the server-side guard that refuses bookings on
finished events. An upcoming event with a booking URL still redirects exactly as before.

Everything above the booking block (image, title, date, time, venue, teaser, description,
highlights) renders identically in every state. That is the "same standard event detail page" the
request asks for. The only variable region is the block currently occupied by `BookingForm`.

`misconfigured` must not surface an error to the customer. It reads exactly like `closed`. It is a
distinct state only so we can alert on it internally.

### Part E: enforce the same rules server-side (fixes P4)

The page hiding the form is presentation, not enforcement. Add to
`getPublicBookingEligibility` (`src/actions/bookings.ts:104`):

- select `end_at`
- reject when the event has finished

**There are two public booking entry points, not one.** Free and pay-on-arrival bookings go through
`getPublicBookingEligibility`. Paid bookings go through `createPaidCheckoutSession` and
`fetchPaidEvent` in `src/lib/payments/service.ts`, which duplicates the same eligibility checks and
never sees the eligibility function. Guarding only the first leaves the money path open: two live
events, at 42.00 and 3.00 a ticket, could open a genuine Stripe session months after they ended.
Both paths must share one `hasEventFinished` definition, exported from `event-booking-state.ts`.

This is the defence-in-depth rule from the project CLAUDE.md: check in both UI and server action.

This is a behaviour change independent of the landing page work, and it closes a live hole. It
ships first, on its own.

### Part F: one shared resolver

Add `resolvePublicEventUrl(event)` to a shared server module (suggest
`src/lib/event-public-url.ts`). Returns a non-null string:

1. `booking_url` if set
2. else `https://l.baronspubs.com/<seo_slug>` if set
3. else `https://l.baronspubs.com/<slugified-title>--<id>`

Branch 3 is what Part B resolves. Use `SHORT_LINK_HOST` from `src/lib/short-link-config.ts` rather
than the hardcoded host currently in `sms-campaign.ts`. To keep branch 3 identical to
`PublicEvent.slug`, reuse `buildEventSlug` rather than reimplementing the slug rules.

Then replace the inline fallback at `src/lib/sms-campaign.ts:189-190` with a call to it, and delete
the `linkDestination` null bail-out at `:193-196`.

### Part G: public API, additive only

**Compatibility contract.** For every event that exists today, every field of `PublicEvent` must
serialise to the byte-identical value it does now. Specifically:

| Field | Guarantee |
|---|---|
| `slug` | Unchanged. Protected by dropping the backfill (Part A) |
| `seoSlug` | Unchanged. Stays null for the 31 slugless events |
| `bookingUrl` | Unchanged |
| `bookingEnabled` | Unchanged |
| `bookingPageUrl` | Unchanged. Still null unless `booking_enabled` and a slug exist |
| everything else | Untouched |

Two new fields are added:

```ts
eventPageUrl: string;            // always present, the catch-all, from resolvePublicEventUrl
bookingAvailability: "external" | "in_app" | "none";
```

`bookingAvailability` lets the brand site label the CTA honestly ("Book now" versus "More info")
without reimplementing the rules. Both are additive, so the brand site adopts on its own schedule
and nothing breaks in the meantime.

Update `docs/WebsitePublishingAPI.md` and `src/app/api/v1/openapi/route.ts` in the same change, and
give the brand site developer a short note covering the two new fields and the explicit promise
that nothing else moved.

### Part H: search indexing

This publishes 41 pages that largely duplicate the main Barons website's own event pages. Emit
`robots: { index: false, follow: true }` from `generateMetadata` for the `finished`, `closed` and
`misconfigured` states, and keep bookable pages indexable exactly as they are today. Add a
self-referencing canonical in all states so the ID-suffixed form never competes with the slug form.

## Non-goals

- No new field, toggle or link display in the BaronsHub admin UI.
- No change to the external booking redirect behaviour.
- No redesign of the landing page layout.
- No backfill of `seo_slug` or `booking_type` on existing events.
- No change to how the main Barons website renders events. This spec only changes what the API
  offers it.

## Risks

| Risk | Mitigation |
|---|---|
| An API field value drifts for an existing event | Contract-lock test (see test plan) asserting the full serialised payload for fixtures covering all three booking cases. Run in CI |
| Brand site starts showing Book buttons on unbookable events | Additive fields only; `bookingPageUrl` semantics preserved; `bookingAvailability` gives them the correct signal |
| 41 thin pages harm SEO for the main site | `noindex, follow` on non-bookable states, self-canonical everywhere |
| Past-event guard breaks a legitimate flow | Agreed decision 5. No venue flow books against finished events |
| A customer lands on an event with no image and thin copy | 18 of the 41 have no image; the existing "No image" placeholder covers it. Check the real thing on preview |
| Slugless events get an ugly `title--uuid` URL | Acceptable: it is a catch-all, not shown in the UI. Adding a slug later upgrades it via the Part B redirect |

## Test plan

Unit and integration, Vitest:

1. **Contract lock.** Snapshot the full `toPublicEvent` output for fixtures covering: external
   booking URL, in-app booking enabled, and no booking at all with a null `seo_slug`. Assert every
   pre-existing field is unchanged and only the two new keys are added. Extend
   `src/lib/public-api/__tests__/events.test.ts`.
2. `getEventBySlug` resolves by slug, resolves by `--<uuid>` suffix, 308s when the slug is stale,
   404s on unknown, deleted, non-approved and internal-venue events.
3. Booking state resolution: one case per row of the Part D table, including the ordering assertion
   that a past bookable event returns `finished` and not `sold_out` or `closed`.
4. `getPublicBookingEligibility` rejects a finished event, including a `completed` one with
   `booking_enabled` true.
5. `resolvePublicEventUrl` returns the external URL, the slug URL and the ID-suffixed URL in the
   right precedence, never returns null, and branch 3 matches `PublicEvent.slug` exactly.
6. SMS campaign no longer bails out when an event has no `booking_url` and no `seo_slug`.

Manual, against a preview deploy: one event per state, checked on mobile and desktop widths, with
and without an image, and with and without highlights.

## Suggested delivery order

Each part below is independently deployable.

1. **PR 1 (S).** Part E, the past-event booking guard. Closes a live hole, no dependencies.
2. **PR 2 (S).** Part A, slug generation for new events.
3. **PR 3 (M).** Parts B, C, D, H. The landing page itself.
4. **PR 4 (S).** Parts F and G. Shared resolver, SMS call site, additive API fields, docs, and the
   note to the brand site developer.
