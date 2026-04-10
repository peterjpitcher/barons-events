# Auth & RBAC End-to-End Audit — Remediation Spec

**Date:** 2026-04-10
**Scope:** Comprehensive review of authentication, authorisation, RBAC, RLS, and session management in BaronsHub
**Approach:** Risk-prioritised fix list (Approach A)

---

## Current State Summary

BaronsHub has a mature, multi-layered auth system:

- **Authentication:** Supabase JWT + custom app session layer (30-min idle, 24-hr absolute timeout, max 5 sessions per user)
- **Middleware:** Validates JWT server-side via `getUser()` (not cached `getSession()`), validates custom session, sets `x-user-id` header, generates CSRF tokens, injects CSP nonce
- **RBAC:** 4 domain-specific roles (`central_planner`, `venue_manager`, `reviewer`, `executive`) with 13 capability functions in `src/lib/roles.ts`
- **RLS:** 100+ policies across 26 tables, all tables have RLS enabled, `current_user_role()` helper is `SECURITY DEFINER` with pinned `search_path`
- **Public API:** Bearer token auth with constant-time comparison, in-process rate limiting
- **Session hardening:** Lockout protection (5 failures / 15 min = 30 min lockout), session destruction on role change and password reset, Turnstile CAPTCHA on login
- **Password policy:** 12-72 chars, HIBP k-anonymity check, no composition rules (NIST SP 800-63B)

### Role Access Matrix

| Capability | venue_manager | reviewer | central_planner | executive |
|------------|:---:|:---:|:---:|:---:|
| Create/edit own events | ✓ | — | ✓ (all) | — |
| Review/approve events | — | ✓ | ✓ | — |
| Submit debriefs | ✓ | — | ✓ | — |
| Manage artists | ✓ | — | ✓ | — |
| Manage venues | — | — | ✓ | — |
| Manage users | — | — | ✓ | — |
| Manage settings/event types | — | — | ✓ | — |
| Use planning workspace | — | — | ✓ | — |
| View planning (read-only) | — | — | ✓ | ✓ |
| View all events | — | ✓ | ✓ | ✓ |
| Manage links | — | — | ✓ | — |
| View SOP templates | — | — | ✓ | ✓ |
| Edit SOP templates | — | — | ✓ | — |

---

## Findings & Remediation Plan

### Critical Severity

#### C1 — `cancelBookingAction()` missing ownership check

**Finding:** Any authenticated user can cancel any booking. The action checks `getCurrentUser()` but performs no role or ownership verification before cancelling.

**Risk:** A reviewer or executive could cancel bookings they have no authority over. RLS allows any authenticated user to UPDATE bookings (see M1).

**Fix:** Add ownership verification — caller must be `central_planner`, or the booking's event must belong to a venue matching the caller's `venue_id` (for `venue_manager`).

**File:** `src/actions/bookings.ts`

---

#### C2 — Public booking endpoint lacks CAPTCHA

**Finding:** `createBookingAction()` accepts anonymous submissions with only IP-based rate limiting (10 per 10 min). No bot protection.

**Risk:** Automated spam bookings. IP rate limiting is trivially bypassed with rotating proxies.

**Fix:** Add Turnstile verification using the same pattern as `signInAction()`. Accept `turnstileToken` parameter and call `verifyTurnstile()` before processing.

**File:** `src/actions/bookings.ts`

---

### High Severity

#### H1 — Planning page missing server-side role check

**Finding:** `/app/planning/page.tsx` calls `getCurrentUser()` and redirects if null, but does not check the user's role. Any authenticated user (including `venue_manager` and `reviewer`) can load the planning page. Data writes are blocked by RLS, but the page itself exposes planning data.

**Risk:** Unauthorised users see planning information. While RLS prevents mutations, read access to planning_items and planning_series is granted to all authenticated users via `using (true)` SELECT policies.

**Fix:** Add `if (!canViewPlanning(user.role)) redirect("/unauthorized")` after the auth check. This restricts the page to `central_planner` and `executive` roles.

**File:** `src/app/planning/page.tsx`

---

#### H2 — Artist restore inconsistent with archive permissions

**Finding:** `archiveArtistAction()` uses `canManageArtists()` (allows `venue_manager` + `central_planner`), but `restoreArtistAction()` hardcodes `user.role !== "central_planner"`. A venue manager can archive an artist but cannot restore one.

**Risk:** Operational inconsistency. A venue manager who accidentally archives an artist must escalate to a central planner to undo it.

**Fix:** Replace `user.role !== "central_planner"` with `!canManageArtists(user.role)` in `restoreArtistAction()`.

**File:** `src/actions/artists.ts`

---

#### H3 — Email case sensitivity in lockout tracking

**Finding:** Lockout tracking hashes emails with SHA-256. The `recordFailedLoginAttempt()` function lowercases email before hashing, but `isLockedOut()` and `clearLockoutForIp()` must also lowercase to ensure consistent matching. If any function skips normalisation, `User@Example.com` and `user@example.com` create separate lockout counters.

**Risk:** Lockout bypass by varying email casing.

**Fix:** Verify all lockout functions in `src/lib/auth/session.ts` normalise email to lowercase before hashing. Add `.toLowerCase()` to any function missing it.

**File:** `src/lib/auth/session.ts`

---

#### H4 — Role normalisation silent failure

**Finding:** `getCurrentUser()` in `src/lib/auth.ts` calls `normalizeRole()` which returns null for unrecognised roles. When null, `getCurrentUser()` returns null — treating the user as unauthenticated with no logging.

**Risk:** If a user's role is corrupted in the database, they silently lose access with no error trail. Debugging is difficult.

**Fix:** Add `console.warn()` when `normalizeRole()` returns null, including the user ID and the invalid role value.

**File:** `src/lib/auth.ts`

---

### Medium Severity

#### M1 — Event bookings RLS overly broad for authenticated users

**Finding:** The `event_bookings` table has SELECT and UPDATE policies using `to authenticated using (true)`. Any authenticated user can read and modify all bookings regardless of role or venue.

**Risk:** A reviewer or executive can see and modify bookings they shouldn't have access to. The application layer scopes queries correctly, but RLS should be the enforcement backstop.

**Fix:** Create a new migration that replaces the overly permissive policies:
- **SELECT:** `central_planner` sees all; `venue_manager` sees bookings for events at their venue; `reviewer` sees bookings for events they're assigned to
- **UPDATE:** Same scoping as SELECT (cancellation requires access to the booking)

**File:** New migration in `supabase/migrations/`

---

#### M2 — Cron endpoints lack request logging

**Finding:** The 4 cron routes authenticate via `CRON_SECRET` bearer token but produce no audit trail of invocation.

**Risk:** If the cron secret is compromised, there's no log of when cron endpoints were called or by whom.

**Fix:** Add a structured log entry at the start of each cron handler: timestamp, endpoint name, IP (from headers), and outcome (success/error). Use `console.log()` with JSON structure (captured by Vercel logs).

**Files:** `src/app/api/cron/cleanup-auth/route.ts`, `src/app/api/cron/refresh-inspiration/route.ts`, `src/app/api/cron/sms-post-event/route.ts`, `src/app/api/cron/sms-reminders/route.ts`

---

#### M3 — `deleteCustomerAction()` ownership scoping (documentation only)

**Finding:** Only checks `central_planner` role. No ownership verification beyond that.

**Assessment:** This is correct behaviour — GDPR erasure is a privileged administrative action that should only be performed by central planners. The RLS policy already scopes customer visibility.

**Fix:** No code change. Add a comment in the function documenting the intent: "GDPR erasure — intentionally restricted to central_planner only, no venue scoping needed."

**File:** `src/actions/customers.ts`

---

#### M4 — Venue manager event visibility not venue-scoped in RLS

**Finding:** The events SELECT policy allows access via `created_by` or `assignee_id`, but a venue manager cannot see events at their venue created by another user (e.g. a central planner creating an event for their venue).

**Decision needed:** Is this intentional? If venue managers should see all events at their venue regardless of creator, the RLS policy needs an additional condition.

**Fix (if venue-scoped access desired):** Add to the events SELECT policy: `OR (current_user_role() = 'venue_manager' AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid()))`.

**File:** New migration in `supabase/migrations/`

---

#### M5 — In-process rate limiter resets on cold start (documentation only)

**Finding:** The public API rate limiter uses an in-memory `Map`. Each serverless cold start resets counters.

**Assessment:** The API key requirement is the primary defence. Rate limiting is a secondary measure. Acceptable for current traffic levels.

**Fix:** No code change. Document as known limitation in code comments. Add to future work: migrate to Upstash Redis for persistent rate limiting.

**File:** `src/lib/public-api/rate-limit.ts` (comment only)

---

### Low Severity

#### L1 — HIBP fail-open behaviour (observability)

**Finding:** `validatePassword()` accepts passwords when HIBP API is unreachable (3-second timeout). Intentional per NIST SP 800-63B.

**Fix:** Add `console.warn("HIBP check unavailable — password accepted without breach check")` when the API returns "unavailable".

**File:** `src/lib/auth/password-policy.ts`

---

#### L2 — Turnstile fail-open behaviour (observability) — ALREADY FIXED

**Finding:** `verifyTurnstile()` returns true when token is missing or Cloudflare is unreachable. Intentional per auth standard §6.

**Status:** Already implemented. The private `verifyTurnstile()` function in `src/actions/auth.ts` (lines 70-102) already has `console.warn` on all three fail-open paths: no token (line 74), no secret key (line 80), and API unavailable (lines 90, 99).

**Fix:** No change needed.

---

#### L3 — Public API single shared key (documentation only)

**Finding:** `BARONSHUB_WEBSITE_API_KEY` is a single static key with no rotation or expiry.

**Fix:** No code change. Document as future work: multi-key support with versioned keys and expiry dates.

---

#### L4 — Async session cleanup (no change)

**Finding:** Expired sessions cleaned up asynchronously with swallowed errors.

**Assessment:** Acceptable — the session is already invalidated in the response. Cleanup is housekeeping.

**Fix:** No change needed.

---

#### L5 — Reference data SELECT policies use `true` (no change)

**Finding:** `venues`, `venue_areas`, `event_types`, `artists`, `venue_service_types`, `venue_opening_hours`, `venue_opening_overrides`, `short_links` have `using (true)` SELECT policies for authenticated users.

**Assessment:** These are reference/lookup tables. All authenticated staff need read access to display dropdowns, event details, and scheduling information. This is intentional.

**Fix:** No change needed.

---

## Out of Scope (Future Work)

| Item | Priority | Notes |
|------|----------|-------|
| Persistent rate limiting (Upstash Redis) | Medium | Replace in-process Map with distributed store |
| API key rotation mechanism | Medium | Multi-key support with versioned keys and expiry |
| Cron endpoint IP allowlisting | Low | Restrict to Vercel cron IPs |
| Shared `ensurePermission()` wrapper | Low | Standardise auth pattern across all server actions |
| Automated auth boundary tests | Medium | Integration tests verifying each role's access to each action |
| HIBP fail-closed mode with user notification | Low | Block password on HIBP failure, notify user to retry |

---

## Implementation Order

1. **C1 + C2** — Booking action fixes (highest risk, same file)
2. **H1** — Planning page role gate (quick fix, high impact)
3. **H2** — Artist restore permission fix (one-liner)
4. **H3** — Lockout email normalisation verification
5. **H4** — Role normalisation logging
6. **M1** — Event bookings RLS migration
7. **M2** — Cron endpoint logging
8. **M4** — Venue manager event visibility RLS (pending decision)
9. **L1 + L2** — Observability warnings
10. **M3 + M5** — Documentation comments

---

## Files Modified

| File | Changes |
|------|---------|
| `src/actions/bookings.ts` | C1: ownership check, C2: Turnstile |
| `src/app/planning/page.tsx` | H1: role gate |
| `src/actions/artists.ts` | H2: `canManageArtists()` for restore |
| `src/lib/auth/session.ts` | H3: email normalisation |
| `src/lib/auth.ts` | H4: role warning log |
| `supabase/migrations/` (new) | M1: bookings RLS, M4: venue event visibility |
| `src/app/api/cron/*/route.ts` | M2: audit logging (4 files) |
| `src/actions/customers.ts` | M3: documentation comment |
| `src/lib/auth/password-policy.ts` | L1: HIBP warning |
| `src/actions/auth.ts` | L2: already has warnings — no change |
| `src/lib/public-api/rate-limit.ts` | M5: limitation comment |
