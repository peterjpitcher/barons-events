# Security & Data Risk Review: Booking Hardening Spec

Date: 2026-04-14

Scope: `docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md`, `src/actions/bookings.ts`, `src/app/l/[slug]/BookingForm.tsx`, `src/app/l/[slug]/page.tsx`, `src/lib/bookings.ts`, `src/lib/turnstile.ts`, and relevant Supabase migrations.

## Findings

1. High: Change 5 hardens page rendering, not the booking write path.

The spec only adds a status gate to the public page query and `notFound()` branch (`docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:154-171`). The public form still calls `createBookingAction()` directly from a client component (`src/app/l/[slug]/BookingForm.tsx:5-6`, `src/app/l/[slug]/BookingForm.tsx:50-70`). The current action does not load or validate event status before calling the RPC (`src/actions/bookings.ts:36-83`), and the RPC only checks `booking_enabled` and `deleted_at` before inserting (`supabase/migrations/20260313000000_event_bookings.sql:95-121`).

Impact: this fixes discoverability-by-slug, but not enforceability at the actual write boundary. A caller that can invoke the public booking action with a known `eventId` can still attempt to book draft/submitted events unless status is enforced in the action or, preferably, inside `create_booking`.

2. High: Change 3's per-mobile cap is raceable and depends on already-clean booking data.

The spec counts existing bookings in the action, then calls the insert RPC afterward (`docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:87-120`). The RPC is the only atomic section, and it does not know about the 3-booking cap (`src/lib/bookings.ts:36-60`, `supabase/migrations/20260313000000_event_bookings.sql:79-123`).

Impact: parallel requests can all observe `count < 3` and then insert, so the cap is bypassable under concurrency. The spec snippet also ignores query errors and only blocks when `count >= 3`; on a failed count query, `count` will be `null` and the booking falls through. The data assumption is also weak: `event_bookings.mobile` is plain `text` with no E.164 constraint (`supabase/migrations/20260313000000_event_bookings.sql:22-35`), and historical anon inserts bypassed the action's normalization entirely. If legacy rows contain raw formats, `.eq("mobile", normalisedMobile)` will miss them.

3. Medium: Change 4 introduces a TOCTOU window for `max_tickets_per_booking`.

The spec fetches `max_tickets_per_booking` in the action before the insert RPC (`docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:122-152`). The RPC later locks the event row, but it does not re-check `max_tickets_per_booking` (`supabase/migrations/20260313000000_event_bookings.sql:95-121`).

Impact: if event settings change between the action read and the insert, the booking can be accepted or rejected against stale configuration. The spec snippet also ignores `error` and only blocks when `eventConfig` exists; a failed config read therefore fails open. This is low-frequency admin/event-config concurrency, but it is still a real integrity race. The clean fix is to move the max-tickets check into `create_booking` under the same row lock already used for capacity.

4. Medium: The spec does not include a remediation plan for data already created through the anon insert bypass.

Before this hardening work, the database allowed direct anon inserts into `event_bookings` (`supabase/migrations/20260313000000_event_bookings.sql:54-65`). The later customer backfill copied raw booking mobiles into `customers` as-is and linked on exact string equality (`supabase/migrations/20260313000001_add_customers_and_consent.sql:124-145`).

Impact: existing bypassed rows can survive with malformed mobiles/emails, inflated `ticket_count`, bookings on non-public events, or duplicate real-world customers represented by different mobile string formats. The new per-mobile cap and any downstream customer analytics depend on cleaning or at least auditing that data first.

## Requested Analysis

### 1. After Change 1, can an attacker still read bookings via the anon key?

I did not find an anon table-read path.

In `supabase/migrations/20260313000000_event_bookings.sql`, the only `SELECT` policy on `event_bookings` is:

- `staff_read_bookings` with `using (auth.uid() is not null)` (`supabase/migrations/20260313000000_event_bookings.sql:67-73`)

That excludes pure `anon` access because `auth.uid()` is `null` for anon requests. The later hardening migration tightens this further to three `FOR SELECT TO authenticated` policies only (`supabase/migrations/20260410120002_tighten_event_bookings_rls.sql:9-38`).

So:

- Read all bookings via anon key: no, not from the table RLS shown here.
- Read booking PII (`first_name`, `last_name`, `mobile`, `email`) via anon client: no table path found.

Additional note: the PII-returning helper RPCs were also later restricted to `service_role` only, not anon/authenticated (`supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:32-50`).

### 2. Does the Zod message `"Security check required"` leak implementation details?

Not materially.

`"Security check required"` does not disclose a vendor name, secret, token format, or validation rule. The public page already renders a visible CAPTCHA widget (`src/app/l/[slug]/BookingForm.tsx:225-230`), so the existence of a verification step is not secret.

This is more of a UX/contract concern than a security concern:

- the action currently returns the first Zod issue verbatim (`src/actions/bookings.ts:57-63`);
- that means schema wording becomes user-visible API text;
- if you want less coupling, map missing/invalid Turnstile input to the same generic `"Security check failed"` branch instead of exposing raw schema copy.

Also, with the current action order, Turnstile verification runs before Zod parsing (`src/actions/bookings.ts:51-62`), so this exact Zod message may not be reached unless the implementation order changes.

### 3. Can different phone formats bypass the per-mobile cap?

Not through the current action path, as long as the stored rows are already normalized.

The action currently:

- validates with `isValidPhoneNumber(data.mobile, "GB")` (`src/actions/bookings.ts:67-69`);
- then normalizes with `parsePhoneNumber(data.mobile, "GB").format("E.164")` (`src/actions/bookings.ts:71`);
- and existing tests confirm `07911123456` is normalized to `+447911123456` before the DB write (`src/actions/__tests__/bookings.test.ts:108-119`).

So `07911123456`, `+447911123456`, and similar equivalent GB formats collapse to the same E.164 string. Format variation alone should not bypass the cap.

The caveats are:

- legacy rows inserted through the old anon bypass were not forced through this normalization path and the table itself does not enforce E.164, so those rows will not necessarily match the new normalized equality check;
- the spec snippet fails open on count-query error because it only blocks when `count >= 3`.

### 4. Is there a TOCTOU race between checking `max_tickets_per_booking` and inserting?

Yes.

The spec reads `events.max_tickets_per_booking` in the action (`docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:127-139`) and only later calls `create_booking`. The RPC takes the row lock and enforces capacity, but not the per-booking max (`supabase/migrations/20260313000000_event_bookings.sql:95-121`).

That means:

- if an admin lowers the max after the action check but before the insert, an oversized booking can still be accepted;
- if the max is raised in that gap, a booking can be rejected based on stale config.

This is not a catastrophic exploit, but it is a real integrity race. The spec snippet also fails open if the event-config query errors and returns no `eventConfig`. The strongest fix is to enforce `max_tickets_per_booking` inside the RPC under the existing `FOR UPDATE` lock.

### 5. Should the spec include a data audit / cleanup plan for existing bypassed bookings?

Yes.

The new controls assume the existing booking data is trustworthy, but the old schema allowed direct anon inserts with no phone normalization, no email validation, no event-status gate, and no per-booking max enforcement (`supabase/migrations/20260313000000_event_bookings.sql:22-35`, `supabase/migrations/20260313000000_event_bookings.sql:54-65`).

Minimum audit targets:

- bookings whose `mobile` is not valid E.164;
- bookings with malformed or obviously junk email addresses;
- bookings where `ticket_count > events.max_tickets_per_booking`;
- bookings attached to events that are draft/submitted, deleted, or `booking_enabled = false`;
- duplicate clusters that collapse to the same normalized mobile;
- `customers` rows that represent the same real number in multiple string formats because the backfill copied raw `mobile` values verbatim (`supabase/migrations/20260313000001_add_customers_and_consent.sql:124-145`).

The spec should at least call for an audit report and an operator decision on cancel/anonymize/merge rules before treating the new cap as authoritative.

### 6. Does the RPC validate the same things as the action, or is there a direct-call gap?

There is a validation gap in the RPC itself, but not an active public exploit path in the current repo state.

Current protection:

- `create_booking` execution was later revoked from `public`, `anon`, and `authenticated`, and granted only to `service_role` (`supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:23-27`).

So a browser/anon caller should not be able to call the RPC directly today.

But the RPC does not enforce the same invariants as the action:

- no phone-format validation;
- no email-format validation;
- no Turnstile check;
- no per-mobile cap;
- no `max_tickets_per_booking` check;
- no event-status check beyond `booking_enabled` and `deleted_at`;
- only aggregate capacity is enforced (`supabase/migrations/20260313000000_event_bookings.sql:95-121`).

Conclusion: the write path is currently safe only because RPC execution is locked to `service_role`. The spec should either:

1. state explicitly that the TypeScript action is the validation boundary and must remain the only public entrypoint, or
2. move the DB-owned invariants (`status`, `max_tickets_per_booking`, duplicate-cap enforcement if possible) into the RPC so the database becomes the authoritative boundary.

## Bottom Line

The anon read concern in question 1 does not appear to be real. The bigger remaining risks in the proposed design are:

- page-only status gating instead of write-path enforcement;
- a non-atomic duplicate cap;
- a TOCTOU max-ticket check outside the locked RPC;
- no cleanup plan for legacy bypassed data.

No code changes were made in this review.
