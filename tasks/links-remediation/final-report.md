# Final Report — /links Section Remediation (2026-06-11)

## Outcome
Two PRs merged and verified live in production:
- **PR #8** (`5183a88`) — the client-reported QR bug: `qrcode` lib rejects CSS `rgb()` colours; hex fix restored QR downloads for **all 10 print touchpoints** (Poster was merely the first menu item).
- **PR #9** (`f3dc785`) — full remediation of 18 further defects found by a four-agent review. Production deployment success; live smoke verified.

## Live verification evidence
- `https://l.baronspubs.com/bc317a32` (real Poster variant) → 302 to destination with `utm_source=poster&utm_medium=print&utm_campaign=…` intact.
- Bogus code → branded HTML 404 (Barons name + baronspubs.com link), correct content-type.
- Click counter incremented 0→1 via the new `after()` path; `updated_at` untouched (no longer bumped by clicks).
- Pipeline: lint 0 warnings, typecheck clean, **922 tests pass** (72 new), production build clean, Supabase security advisors show nothing new post-migration.
- Independent validation pass: 18/18 defects FIXED by code re-trace, 0 regressions (phase-3/validation/validation-report.md).

## What the system now does (rules as implemented)
- Variants are first-class: `parent_link_id` FK (cascade delete) + `touchpoint`, partial unique index — one variant per (parent, touchpoint), duplicate-creation race closed. 43/47 legacy variants backfilled; 4 legacy orphans (named with " — ") render standalone as before.
- Editing a parent propagates destination/name/expiry to its variants (printed QR codes follow the parent); partial failures reported honestly ("N of M variants failed"), never hidden.
- Deleting a parent removes its variants (DB cascade); deletes verify affected rows before claiming success.
- Redirects: 302 with UTM forwarding; expiry honours end-of-day **Europe/London**; clicks counted only when a redirect is actually issued, queued via `after()`; customer-facing error states are branded pages (404/410/502/503/500).
- Admin list paginates past 1,000 rows; UI resyncs to server state; expired links badged (icon + text); Safari-safe clipboard; past expiry dates rejected client + server; variant creation audit-logged.
- `SHORT_LINK_BASE_URL` derives from `SHORT_LINK_HOST` (single source of truth).

## Parked for product decisions (not implemented — P-items)
P-1 SMS UTM medium inconsistency + per-recipient link minting (outside section; analytics continuity). P-2 GA4 channel mapping for `social_stories`/`messaging`. P-3 mobile QR download. P-4 segregating system-generated links in admin UI. P-5 checkout fulfilment idempotency (adjacent; separate review). P-6 manager read-only UX (Copy hidden on desktop). P-7 four legacy orphan rows for manual tidy-up: "Google — Facebook", "Meade Quiz Booking 1 April — Facebook", "Meade Website — Flyer", "The Congakeyz — Free Live Music (04 Jun 2026) - Booking link".

## Pre-existing app-wide advisor notes (outside /links)
SECURITY DEFINER helper RPCs executable by authenticated/anon; `app_sessions`/`login_attempts` RLS-enabled-no-policy (INFO); public `event-images` bucket listing; leaked-password protection disabled. None introduced by this work.

## Monitoring recommendations
Watch Vercel function logs for `short_links lookup failed` / `increment_link_clicks failed`; periodic check that total short_links growth (SMS campaigns) stays sane; re-run `npm run advisors` before next migration.
