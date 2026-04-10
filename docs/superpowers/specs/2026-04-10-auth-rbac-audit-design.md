# Auth & RBAC End-to-End Audit — Remediation Spec (v2)

**Date:** 2026-04-10
**Scope:** Comprehensive review of authentication, authorisation, RBAC, RLS, and session management in BaronsHub
**Approach:** Risk-prioritised fix list (Approach A)
**Revision:** v2 — incorporates Codex adversarial review findings (5 Codex reviewers + 1 Claude architecture reviewer)

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

**Key architectural note:** Several code paths use the admin (service-role) Supabase client, which bypasses RLS entirely. For these paths, app-layer auth checks are the primary control — RLS is defence-in-depth only. This affects: booking cancel/read helpers, planning board loader, event version/artist operations, and customer data functions.

### Role Access Matrix

| Capability | venue_manager | reviewer | central_planner | executive |
|------------|:---:|:---:|:---:|:---:|
| Create/edit own events | ✓ | — | ✓ (all) | — |
| View all events at own venue | ✓ | — | ✓ (all) | — |
| Review/approve events | — | ✓ | ✓ | — |
| Submit debriefs | ✓ | — | ✓ | — |
| Manage artists | ✓ | — | ✓ | — |
| Restore archived artists | — | — | ✓ | — |
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

#### C1 — SECURITY DEFINER RPCs without execute restrictions

**Finding:** Multiple `SECURITY DEFINER` database functions bypass RLS but have no `REVOKE EXECUTE` in the migrations, meaning they can be called directly by any user (including anonymous) via the Supabase REST API, bypassing all app-layer auth.

**Affected functions:**
- `create_booking()` — anon users can create bookings directly, bypassing rate limits, validation, and capacity checks
- `get_reminder_bookings()` / `get_post_event_bookings()` — expose customer PII (names, mobile numbers)
- `list_customers_with_stats()` — dumps all customer data when called with null venue_id
- `generate_sop_checklist()` / `recalculate_sop_dates()` — allow non-planners to mutate SOP data
- `cleanup_auth_records()` — missing `search_path` pinning

**Properly hardened examples for reference:** `sync_event_artists()`, `next_event_version()`, `increment_link_clicks()` in `20260225000002_atomic_artist_sync_and_event_version.sql` all have explicit `REVOKE/GRANT` and pinned `search_path`.

**Risk:** Direct database-level exploitation without any authentication. Customer PII exposure.

**Fix:** Create migration to:
1. `REVOKE EXECUTE ON FUNCTION <name> FROM PUBLIC, anon, authenticated`
2. `GRANT EXECUTE ON FUNCTION <name> TO service_role`
3. Add `SET search_path = public` where missing

**File:** New migration in `supabase/migrations/`

---

#### C2 — Audit log system silently broken

**Finding:** The audit log system is failing to record critical security events:
- `audit_log.entity_id` is `uuid` type, but `logAuthEvent()` writes `entity_id: "system"` (not a valid UUID)
- SOP actions write `entity_id: "global"` / `"backfill"` (not valid UUIDs)
- `entity_type` CHECK constraint only allows `event`, `sop_template`, `planning_task` — excludes `auth`, `customer`, `booking`
- `logAuthEvent()` never checks the Supabase response for insert errors
- `recordAuditLogEntry()` logs and swallows insert failures

**Risk:** Login failures, lockouts, role changes, password resets, booking cancellations, and customer erasures are NOT being recorded. Security incident review is blind for these events.

**Fix:**
1. Migration: extend `entity_type` CHECK to include `auth`, `customer`, `booking`
2. Migration: change `entity_id` from `uuid` to `text` (or use a proper UUID for system entries)
3. Code: fix `logAuthEvent()` to check for insert errors and log warnings on failure

**Files:** New migration in `supabase/migrations/`, `src/lib/audit-log.ts`

---

#### C3 — `cancelBookingAction()` missing ownership check

**Finding:** Any authenticated user can cancel any booking. The action checks `getCurrentUser()` but performs no role or ownership verification. The `cancelBooking()` helper uses the admin client (service-role), bypassing RLS entirely — making app-layer auth the only control.

**Risk:** A reviewer or executive could cancel bookings they have no authority over. Since the helper bypasses RLS, tightening RLS alone does not fix this.

**Fix:** Add ownership verification before calling `cancelBooking()`:
- `central_planner` → can cancel any booking
- `venue_manager` → can cancel bookings for events at their venue (fetch event, check `venue_id` matches `user.venue_id`)
- All other roles → reject

**File:** `src/actions/bookings.ts`

---

#### C4 — Public booking endpoint lacks CAPTCHA

**Finding:** `createBookingAction()` accepts anonymous submissions with only IP-based rate limiting (10 per 10 min). No bot protection. The `BookingForm.tsx` client component renders no Turnstile widget.

**Risk:** Automated spam bookings. IP rate limiting is trivially bypassed with rotating proxies.

**Fix:**
1. Extract `verifyTurnstile()` from `src/actions/auth.ts` into a shared helper (currently private)
2. Add `turnstileToken` to the booking action's Zod schema
3. Call `verifyTurnstile()` before processing the booking
4. Add Turnstile widget to `src/app/l/[slug]/BookingForm.tsx`

**Files:** `src/actions/bookings.ts`, `src/app/l/[slug]/BookingForm.tsx`, new shared Turnstile helper

---

### High Severity

#### H1 — Planning page missing role check + loader exposes data and performs writes

**Finding:** `/app/planning/page.tsx` checks authentication but not role. Any authenticated user can load the planning page. The planning loader (`listPlanningBoardData()` in `src/lib/planning/index.ts`) uses the admin client and:
- Reads all planning users (including emails and roles), items, tasks, events, and inspiration data
- **Writes during page load**: `ensurePlanningOccurrencesThrough()` creates new `planning_items`, `planning_tasks`, and SOP checklists via the admin client

Additionally, the event detail page (`src/app/events/[eventId]/page.tsx:116`) fetches planning/SOP data via admin client after only event-level auth checks, leaking planning information to reviewers and venue managers.

**Risk:** Unauthorised users see planning information and trigger database writes by simply loading a page.

**Fix (three parts):**
1. Add `if (!canViewPlanning(user.role)) redirect("/unauthorized")` to `src/app/planning/page.tsx` — **before** calling the loader
2. Gate planning/SOP data on event detail page behind `canViewPlanning()` check
3. Document the loader's write-on-read as tech debt (future: move occurrence generation to a scheduled job or explicit action)

**Files:** `src/app/planning/page.tsx`, `src/app/events/[eventId]/page.tsx`

---

#### H2 — Password reset clears lockout before mailbox ownership proved

**Finding:** `requestPasswordResetAction()` (`src/actions/auth.ts:280`) calls `clearLockoutForAllIps()` immediately when a password reset is requested — before the user has clicked the reset link and proved they own the mailbox. Turnstile on the reset form is fail-open.

**Risk:** An attacker can alternate failed logins with password-reset requests for the same email, indefinitely resetting the lockout counter. The 5-attempt lockout becomes bypassable on demand.

**Fix:** Move `clearLockoutForAllIps()` from `requestPasswordResetAction()` to `completePasswordResetAction()`, so lockout is only cleared after the user proves mailbox ownership by completing the reset.

**File:** `src/actions/auth.ts`

---

#### H3 — Event submit ordering bug — side effects before validation

**Finding:** `submitEventForReviewAction()` (`src/actions/events.ts:1144`) syncs artists via a service-role RPC and may update images BEFORE checking whether the event is in a submittable status (line 1192). The artist sync uses `sync_event_artists()` which is atomic but still mutates data.

**Risk:** A failed submit (event already approved/rejected/completed) leaves changed artist links and potentially updated images on an event whose status never moved.

**Fix:** Move the status validation check (`status in ['draft', 'needs_revisions']`) to before the artist sync and image operations.

**File:** `src/actions/events.ts`

---

#### H4 — Sign-in session creation failure creates redirect loop

**Finding:** `signInAction()` (`src/actions/auth.ts:183`) treats `createSession()` failure as non-fatal and still redirects to the app. But middleware hard-requires `app-session-id` (`middleware.ts:216`). This creates a redirect loop: the user has a valid JWT (so `/login` thinks they're authenticated and redirects to `/`), but every protected route bounces them back to `/login` because `app-session-id` is missing.

**Risk:** Users see an infinite redirect loop instead of a clear error message when session creation fails.

**Fix:** Make `createSession()` failure a login failure — return an error to the user instead of redirecting. Sign out the Supabase session to clean up the JWT.

**File:** `src/actions/auth.ts`

---

#### H5 — Role normalisation silent failure

**Finding:** `getCurrentUser()` in `src/lib/auth.ts` calls `normalizeRole()` which returns null for unrecognised roles. When null, `getCurrentUser()` returns null — treating the user as unauthenticated with no logging.

**Risk:** If a user's role is corrupted in the database, they silently lose access with no error trail.

**Fix:** Add `console.warn()` when `normalizeRole()` returns null, including the user ID and the invalid role value.

**File:** `src/lib/auth.ts`

---

### Medium Severity

#### M1 — Event bookings RLS overly broad for authenticated users

**Finding:** The `event_bookings` table has SELECT and UPDATE policies using `to authenticated using (true)`. Any authenticated user can read and modify all bookings regardless of role or venue. **Note:** The cancel helper uses the admin client, so RLS tightening is defence-in-depth — the app-layer fix in C3 is the primary control.

**Fix:** Create a new migration that replaces the overly permissive policies:
- **SELECT:** `central_planner` sees all; `venue_manager` sees bookings for events at their venue; `reviewer` sees bookings for events they're assigned to
- **UPDATE:** Same scoping as SELECT

**File:** New migration in `supabase/migrations/`

---

#### M2 — Executive can dismiss planning inspiration items for all users

**Finding:** `dismissInspirationItemAction()` (`src/actions/planning.ts:610`) allows any `canViewPlanning()` user, including executives. Dismissals are organisation-wide in the board loader — an executive can hide inspiration items for every planner. This contradicts the role model's "read-only observer" description of the executive role.

**Fix:** Change `dismissInspirationItemAction()` to require `canUsePlanning()` instead of `canViewPlanning()`, restricting dismissal to central planners only.

**File:** `src/actions/planning.ts`

---

#### M3 — Lockout window mismatch and cleanup gap

**Finding:** Two issues:
1. Failed login attempts are recorded with a 15-minute window (`session.ts:214`) but `isLockedOut()` checks a 30-minute window (`session.ts:243`). The actual lockout behaviour doesn't match the documented "5 failures in 15 minutes = 30 minute lockout" rule.
2. `cleanupExpiredSessions()` only deletes `app_sessions` but never cleans up stale `login_attempts` records, despite the cron route comment implying it does. The SQL `cleanup_auth_records()` RPC handles both, but the TypeScript function doesn't call it.

**Fix:**
1. Align the windows — use the same interval for both recording and checking
2. Add `login_attempts` cleanup to `cleanupExpiredSessions()` or call the `cleanup_auth_records()` RPC instead

**File:** `src/lib/auth/session.ts`

---

#### M4 — Public API leaks internal notes

**Finding:** `toPublicEvent()` (`src/lib/public-api/events.ts:186`) falls back to the `notes` field when `public_description` is missing. Internal staff notes could be exposed via the website API for events without completed web copy.

**Risk:** Anyone with the API bearer key can see internal event notes for events that haven't had their public description written.

**Fix:** Never expose `notes` in the public API. Return null/empty for `description` when `public_description` is missing.

**File:** `src/lib/public-api/events.ts`

---

#### M5 — Booking double-submit creates duplicate bookings

**Finding:** `createBookingAction()` has no idempotency key. The `create_booking` RPC locks the event row for capacity checking but always inserts a new booking row. Two quick form submits create duplicate bookings, duplicate SMS sends, and double capacity consumption.

**Risk:** Users get double-charged capacity; duplicate SMS notifications sent.

**Fix:** Add an idempotency mechanism — either:
- A unique constraint on (event_id, customer phone/email, booking window) to prevent duplicates, or
- A client-side idempotency key passed through and stored as a unique column

**File:** `src/actions/bookings.ts` and/or new migration in `supabase/migrations/`

---

#### M6 — Cron endpoints lack request logging

**Finding:** The 4 cron routes authenticate via `CRON_SECRET` bearer token but produce no audit trail of invocation.

**Risk:** If the cron secret is compromised, there's no log of when cron endpoints were called.

**Fix:** Add a structured log entry at the start of each cron handler: timestamp, endpoint name, IP (from headers), and outcome (success/error). Use `console.log()` with JSON structure (captured by Vercel logs).

**Files:** `src/app/api/cron/cleanup-auth/route.ts`, `src/app/api/cron/refresh-inspiration/route.ts`, `src/app/api/cron/sms-post-event/route.ts`, `src/app/api/cron/sms-reminders/route.ts`

---

#### M7 — Venue manager event visibility not venue-scoped in RLS

**Finding:** The events SELECT policy allows venue managers to see only events they created (`created_by`) or are assigned to (`assignee_id`). They cannot see events at their venue created by a central planner.

**Decision:** Venue managers should see all events at their venue, regardless of who created them.

**Fix:** Add to the events SELECT policy: `OR (current_user_role() = 'venue_manager' AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid()))`.

**File:** New migration in `supabase/migrations/`

---

#### M8 — `deleteCustomerAction()` documentation (no code change)

**Finding:** Only checks `central_planner` role. No ownership verification beyond that. Uses admin client.

**Assessment:** Correct behaviour — GDPR erasure is a privileged administrative action that should only be performed by central planners.

**Fix:** No code change. Add a comment documenting the intent: "GDPR erasure — intentionally restricted to central_planner only, no venue scoping needed."

**File:** `src/actions/customers.ts`

---

### Low Severity

#### L1 — Artist restore intentionally planner-only (no change)

**Finding:** `restoreArtistAction()` hardcodes `central_planner` while `archiveArtistAction()` uses `canManageArtists()`. The restore UI lives on the planner-only `/settings` page.

**Assessment:** Intentionally planner-only per product decision. Venue managers can archive but must escalate to a planner to restore — this is the desired workflow.

**Fix:** No code change. Add a comment documenting the intent.

**File:** `src/actions/artists.ts`

---

#### L2 — Reference data SELECT policies (no change)

**Finding:** `venues`, `venue_areas`, `event_types`, `artists` have `using (true)` SELECT policies without `TO authenticated` — readable by anon role too. `venue_service_types`, `venue_opening_hours`, `venue_opening_overrides`, `short_links` scope to authenticated users.

**Assessment:** Reference/lookup tables. The mixed auth/anon scoping reflects that some data (venues, event types) is needed by public-facing pages. Intentional.

**Fix:** No change needed.

---

#### L3 — Public API single shared key (future work)

**Finding:** `BARONSHUB_WEBSITE_API_KEY` is a single static key with no rotation or expiry.

**Fix:** No code change. Document as future work.

---

## Removed Findings (from v1)

These findings from the original spec were removed after adversarial review found them to be already fixed or inaccurate:

| Original ID | Reason for removal |
|-------------|-------------------|
| H3 (email casing) | Already centralised in `hashEmail()` — all lockout paths lowercase before SHA-256 |
| L1 (HIBP logging) | Already implemented at `password-policy.ts:83,100` |
| L2 (Turnstile logging) | Already implemented in `auth.ts:70-102` |
| M5 (rate limiter comment) | Already documented at `rate-limit.ts:4` |

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
| Move planning occurrence generation to scheduled job | Medium | Remove write-on-read from planning board loader |
| Heartbeat endpoint session ownership verification | Low | Currently renews any session ID without ownership check |

---

## Implementation Order

1. **C1** — SECURITY DEFINER RPC hardening migration (Critical — exploitable without auth)
2. **C2** — Audit log constraint + error handling fix (Critical — blind audit trail)
3. **C3 + C4** — Booking action fixes: ownership check + Turnstile (Critical — same file)
4. **H1** — Planning page role gate + event detail planning leak (High — three-part fix)
5. **H2** — Password reset lockout clearing fix (High)
6. **H3** — Event submit ordering fix (High)
7. **H4** — Sign-in session creation must be fatal on failure (High)
8. **H5** — Role normalisation logging (High)
9. **M1** — Event bookings RLS migration (Medium — defence in depth)
10. **M2** — Executive inspiration dismissal fix (Medium)
11. **M3** — Lockout window alignment + cleanup (Medium)
12. **M4** — Public API notes leak fix (Medium)
13. **M5** — Booking idempotency (Medium)
14. **M6** — Cron endpoint logging (Medium)
15. **M7** — Venue manager event visibility RLS (Medium)
16. **L1 + M8** — Documentation comments

---

## Files Modified

| File | Changes |
|------|---------|
| `supabase/migrations/` (new) | C1: REVOKE/GRANT on SECURITY DEFINER RPCs |
| `supabase/migrations/` (new) | C2: audit log entity_type + entity_id fix |
| `src/lib/audit-log.ts` | C2: error handling in logAuthEvent |
| `src/actions/bookings.ts` | C3: ownership check, C4: Turnstile |
| `src/app/l/[slug]/BookingForm.tsx` | C4: Turnstile widget |
| `src/actions/auth.ts` | C4: extract verifyTurnstile to shared helper; H2: move lockout clear; H4: fatal session creation |
| `src/app/planning/page.tsx` | H1: role gate |
| `src/app/events/[eventId]/page.tsx` | H1: gate planning/SOP data |
| `src/actions/events.ts` | H3: status check before artist sync |
| `src/lib/auth.ts` | H5: role warning log |
| `supabase/migrations/` (new) | M1: bookings RLS, M7: venue event visibility |
| `src/actions/planning.ts` | M2: canUsePlanning() for dismissal |
| `src/lib/auth/session.ts` | M3: window alignment + cleanup |
| `src/lib/public-api/events.ts` | M4: remove notes fallback |
| `src/actions/bookings.ts` or migration | M5: idempotency |
| `src/app/api/cron/*/route.ts` | M6: structured logging (4 files) |
| `src/actions/customers.ts` | M8: documentation comment |
| `src/actions/artists.ts` | L1: documentation comment |

---

## Adversarial Review Provenance

This spec was validated by a 6-reviewer adversarial review system:
- **Codex Repo Reality Mapper** — ground-truth codebase mapping
- **Codex Assumption Breaker** — challenged every finding, identified 7 new issues
- **Codex Spec Trace Auditor** — traced requirements to code, found 4 spec defects
- **Codex Security & Data Risk Reviewer** — found 10 exploitable vulnerabilities
- **Codex Workflow & Failure-Path Reviewer** — found 8 failure-path issues
- **Claude Integration & Architecture Reviewer** — found 9 architectural concerns

Reports: `tasks/codex-qa-review/2026-04-10-auth-rbac-audit-*.md`
