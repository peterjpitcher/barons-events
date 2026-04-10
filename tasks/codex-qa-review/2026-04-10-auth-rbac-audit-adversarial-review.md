# Adversarial Review: Auth & RBAC End-to-End Audit Spec

**Date:** 2026-04-10
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex (5 Codex reviewers + 1 Claude subagent)
**Scope:** Auth, RBAC, RLS, session management — all server actions, API routes, middleware, RLS policies
**Spec:** `docs/superpowers/specs/2026-04-10-auth-rbac-audit-design.md`

## Inspection Inventory

### Inspected
- `src/lib/auth.ts`, `src/lib/auth/session.ts`, `src/lib/auth/password-policy.ts`
- `src/lib/roles.ts`
- `src/actions/auth.ts`, `src/actions/bookings.ts`, `src/actions/artists.ts`, `src/actions/customers.ts`, `src/actions/events.ts`, `src/actions/planning.ts`, `src/actions/sop.ts`, `src/actions/users.ts`
- `middleware.ts`
- `src/app/planning/page.tsx`, `src/app/users/page.tsx`, `src/app/events/[eventId]/bookings/page.tsx`, `src/app/events/[eventId]/page.tsx`
- `src/lib/public-api/auth.ts`, `src/lib/public-api/rate-limit.ts`, `src/lib/public-api/events.ts`
- `src/lib/bookings.ts`, `src/lib/events.ts`, `src/lib/artists.ts`, `src/lib/audit-log.ts`, `src/lib/planning/index.ts`, `src/lib/customers.ts`
- `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`
- `src/app/l/[slug]/BookingForm.tsx`
- All `src/app/api/cron/*/route.ts`, all `src/app/api/v1/*/route.ts`
- 46 Supabase migration files in `supabase/migrations/`
- `supabase/seed.sql`

### Not Inspected
- Whether `REVOKE/GRANT` on SECURITY DEFINER functions was applied outside this repo (e.g., via Supabase dashboard or separate tooling)
- Vercel deployment configuration for cron IP restrictions
- Client-side form validation components (except BookingForm.tsx)

### Limited Visibility Warnings
- SEC-001/002/003/004/006 findings about SECURITY DEFINER RPCs assume default PostgreSQL execute privileges. If privileges were revoked outside the migrations directory, those findings are mitigated.

---

## Executive Summary

The spec correctly identifies the top-line auth gaps (booking cancel, public booking bot protection, planning page access) but **underestimates several findings and misses 8 material issues**. The most significant miss is that multiple `SECURITY DEFINER` database functions lack execute restrictions, making RLS and app-layer auth bypassable at the database layer. The audit log system is also silently broken for auth events, booking cancellations, and SOP operations.

**Overall risk assessment: High** — the spec needs revision before implementation.

---

## What Appears Solid

- **C1 (cancelBookingAction):** Correctly identified as missing ownership check. Verified.
- **C2 (public booking CAPTCHA):** Correctly identified. Verified.
- **H1 (planning page):** Correctly identified, though underscoped (see below).
- **H4 (role normalisation logging):** Valid diagnosability improvement. Verified.
- **M2 (cron logging):** Valid operational improvement. Verified.
- **L2 (Turnstile observability):** Already implemented — correctly marked as no change needed.
- **L4 (async cleanup):** Correct assessment — no change needed.
- The overall role model, capability functions, middleware auth flow, session management, and CSRF protection are well-designed.

---

## Critical Risks

### NEW-001: SECURITY DEFINER RPCs callable without execute restrictions
**Severity:** Critical | **Confidence:** High (unless revoked outside repo) | **Engines:** Codex (all reviewers)

Multiple `SECURITY DEFINER` functions bypass RLS but have no visible `REVOKE EXECUTE` in the migrations:
- `create_booking()` — anon users can call directly, bypassing rate limits and validation
- `get_reminder_bookings()` / `get_post_event_bookings()` — expose customer PII (names, mobiles)
- `list_customers_with_stats()` — dumps all customer data when called with null venue_id
- `generate_sop_checklist()` / `recalculate_sop_dates()` — allow non-planners to mutate SOP data
- `cleanup_auth_records()` — missing search_path pinning

Compare with properly hardened functions: `sync_event_artists()`, `next_event_version()`, `increment_link_clicks()` which all have explicit revoke/grant.

**Action:** Create migration to add `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role` for all unhardened SECURITY DEFINER functions. Also pin `search_path` where missing.

### NEW-002: Audit log system silently broken
**Severity:** Critical | **Confidence:** High | **Engines:** Codex (all reviewers)

`audit_log.entity_id` is `uuid` type, but:
- `logAuthEvent()` writes `entity_id: "system"` (not a valid UUID)
- SOP actions write `entity_id: "global"` / `"backfill"` (not valid UUIDs)
- `entity_type` CHECK constraint only allows `event`, `sop_template`, `planning_task` — excludes `auth`, `customer`, `booking`
- Both audit helpers swallow insert errors silently

**Impact:** Login failures, lockouts, role changes, password resets, booking cancellations, and customer erasures are NOT being recorded in the audit trail.

**Action:** Migration to extend entity_type constraint + fix entity_id to accept text or use a proper UUID. Fix logAuthEvent to check for errors.

---

## Spec Defects (findings where the spec itself is wrong)

### H3 — Email case sensitivity: ALREADY FIXED
**Spec says:** "Verify all lockout functions normalise email to lowercase"
**Reality:** All lockout paths already hash through a shared `hashEmail()` helper that lowercases before SHA-256. Every caller uses it (`session.ts:203`).

**Replace with:** The real lockout bug is that `requestPasswordResetAction()` clears all lockout records for an email before the user proves mailbox ownership (`auth.ts:280`). An attacker can alternate failed logins with password-reset requests to indefinitely reset the lockout counter.

### L1 — HIBP fail-open logging: ALREADY DONE
**Spec says:** Add `console.warn` when HIBP returns unavailable.
**Reality:** Already implemented at `password-policy.ts:83` and `password-policy.ts:100`.

### M5 — Rate limiter documentation: ALREADY DONE
**Spec says:** Add limitation comment to rate-limit.ts.
**Reality:** The file already has a comment at line 4 warning about in-process limitations.

### L5 — Reference data policies: INACCURATE
**Spec says:** "authenticated users" for reference tables.
**Reality:** Some tables (`venues`, `event_types`, `venue_areas`, `artists`) use `using (true)` WITHOUT `TO authenticated`, meaning they're readable by the `anon` role too. This is likely fine for public-facing data but the spec's characterisation is wrong.

### H2 — Artist restore: NEEDS PRODUCT DECISION
**Spec says:** Use `canManageArtists()` for restore to match archive.
**Assumption Breaker flags:** The restore UI lives on the planner-only `/settings` page. Broadening to venue_managers without also exposing the UI would create an inconsistency. This needs a product decision, not just a code change.

---

## Implementation Defects (code needs to change)

### H1 — Planning page: UNDERSCOPED
**Spec says:** Add role check redirect.
**Reality:** The fix needs three changes:
1. Add `canViewPlanning()` check to `/planning/page.tsx` (as spec says)
2. The planning loader (`planning/index.ts`) uses admin client AND performs writes during page load (recurring occurrences, SOP tasks). Even with the page gate, the loader function itself should verify the caller.
3. Event detail page (`events/[eventId]/page.tsx:116`) also fetches planning/SOP data via admin client, leaking planning data to reviewers/executives outside the planning permission model.

### C1 — cancelBookingAction: UNDERSTATED
**Spec says:** Add ownership verification.
**Reality:** The cancel helper (`bookings.ts:83`) uses the admin client (service-role), so RLS doesn't apply at all. The fix must be app-layer ownership checks AND the admin client usage should be verified as necessary.

### M1 — Event bookings RLS: INSUFFICIENT ALONE
**Spec says:** Create migration to tighten RLS policies.
**Reality:** The booking read/cancel helpers already use the admin client, bypassing RLS entirely. RLS changes are still valuable as defence-in-depth, but the primary fix must be app-layer auth checks in the server actions and page components.

---

## Architecture & Integration Defects

### NEW-003: Event submit ordering bug
**Severity:** High | **Confidence:** High

`submitEventForReviewAction()` syncs artists via service-role RPC and may update images BEFORE checking whether the event is in a submittable status (`events.ts:1144-1192`). A failed submit leaves changed artists/images on an event whose status never moved.

**Fix:** Move status validation before artist sync and image operations.

### NEW-004: Executive planning write access
**Severity:** Medium | **Confidence:** High

`dismissInspirationItemAction()` (`planning.ts:610`) allows any `canViewPlanning` user, including executives. Dismissals are organisation-wide in the board loader (`planning/index.ts:425`). An executive can hide inspiration items for all planners.

**Fix:** Change to `canUsePlanning()` or add executive exclusion.

### NEW-005: Sign-in session creation treated as non-fatal
**Severity:** Medium | **Confidence:** High

`signInAction()` treats `createSession()` failure as non-fatal (`auth.ts:183`) and still redirects. But middleware hard-requires `app-session-id` (`middleware.ts:216`). This creates a redirect loop where the user appears logged in to `/login` (JWT valid) but gets bounced from every protected route.

**Fix:** Make session creation failure a login failure — return error to user instead of redirecting.

### NEW-006: Lockout window mismatch
**Severity:** Medium | **Confidence:** High

Failed attempts are recorded with a 15-minute window (`session.ts:214`) but `isLockedOut()` checks a 30-minute window (`session.ts:243`). The "5 failures in 15 minutes = 30 minute lockout" rule described in the spec doesn't match what the code does. Additionally, `cleanupExpiredSessions()` never deletes stale `login_attempts` records despite the cron route comment saying it does.

### NEW-007: Public API leaks internal notes
**Severity:** Medium | **Confidence:** High

`toPublicEvent()` (`public-api/events.ts:186`) falls back to `notes` when `public_description` is missing. Internal staff notes could be exposed via the website API for events without completed web copy.

### NEW-008: Booking double-submit creates duplicates
**Severity:** Medium | **Confidence:** High

`createBookingAction()` has no idempotency key. The `create_booking` RPC locks the event row for capacity but always inserts a new booking. Two quick form submits create duplicate bookings, duplicate SMS sends, and double capacity consumption.

---

## Unproven Assumptions

1. **SECURITY DEFINER execute privileges:** Were they revoked outside the migrations directory? If yes, SEC-001/002/003/006 are mitigated. **Must confirm with infrastructure/DBA.**
2. **M4 venue manager visibility:** The user decided "all venue events," but current role docs say "own events." Is this a policy change or was the doc wrong?
3. **H2 artist restore:** Is the current planner-only behaviour intentional or an oversight?

---

## Recommended Fix Order

1. **NEW-001** — SECURITY DEFINER RPC hardening (Critical — exploitable without auth)
2. **NEW-002** — Audit log constraint + error handling fix (Critical — blind audit trail)
3. **C1** — cancelBookingAction ownership check (Critical — with admin client awareness)
4. **C2** — Public booking Turnstile (Critical — must also touch BookingForm.tsx)
5. **H1** — Planning page gate + loader auth + event detail planning leak (High — three-part fix)
6. **NEW-003** — Event submit ordering fix (High)
7. **H3 replacement** — Password reset lockout clearing (High — replaces wrong finding)
8. **NEW-005** — Sign-in session creation must be fatal on failure (Medium)
9. **NEW-004** — Executive inspiration dismissal (Medium)
10. **NEW-006** — Lockout window alignment (Medium)
11. **NEW-007** — Public API notes leak (Medium)
12. **NEW-008** — Booking idempotency (Medium)
13. **M1** — Event bookings RLS tightening (Medium — defence in depth)
14. **M2** — Cron endpoint logging (Medium)
15. **M4** — Venue manager event visibility RLS (Medium)
16. **H4** — Role normalisation logging (Low)

---

## Follow-Up Review Required

- After NEW-001 fix: re-verify all SECURITY DEFINER functions have correct execute grants
- After H1 fix: verify event detail page no longer leaks planning data to unauthorised roles
- After NEW-002 fix: verify audit log entries are being written successfully for all entity types
- After C2 fix: verify BookingForm.tsx correctly submits Turnstile token
