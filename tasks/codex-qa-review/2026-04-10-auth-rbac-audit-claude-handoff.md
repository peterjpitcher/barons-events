# Claude Hand-Off Brief: Auth & RBAC Audit

**Generated:** 2026-04-10
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** High — spec needs revision before implementation

## DO NOT REWRITE
- Role model (4 roles, 13 capability functions in `src/lib/roles.ts`) — well-designed
- Middleware auth flow (JWT + app session + CSRF + CSP nonce) — sound
- Session management (idle/absolute timeouts, max sessions, destruction on role change) — sound
- Password policy (NIST SP 800-63B, HIBP k-anonymity) — sound
- Turnstile integration with fail-soft logging — already implemented correctly
- Public API bearer auth with constant-time comparison — sound
- CSRF token implementation — sound
- Auth server actions (signIn, signOut, passwordReset) — well-structured aside from specific issues below
- L4 (async cleanup) — correct assessment, no change needed

## SPEC REVISION REQUIRED

- [ ] **SPEC-REV-1:** Remove H3 (email case sensitivity) — already fixed. Replace with: "Password reset clears lockout before mailbox ownership proved. Fix: move `clearLockoutForAllIps()` call from `requestPasswordResetAction()` to `completePasswordResetAction()`, after the user proves mailbox control."
- [ ] **SPEC-REV-2:** Remove L1 (HIBP logging) — already implemented at `password-policy.ts:83,100`
- [ ] **SPEC-REV-3:** Remove M5 (rate limiter comment) — already documented at `rate-limit.ts:4`
- [ ] **SPEC-REV-4:** Add NEW-001 as Critical: "SECURITY DEFINER RPC hardening — create migration to `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role` for: `create_booking`, `get_reminder_bookings`, `get_post_event_bookings`, `list_customers_with_stats`, `cleanup_auth_records`, `generate_sop_checklist`, `recalculate_sop_dates`. Also pin `search_path = public` on all."
- [ ] **SPEC-REV-5:** Add NEW-002 as Critical: "Audit log system silently broken — extend entity_type CHECK to include `auth`, `customer`, `booking`. Change `entity_id` to text type or use proper UUIDs. Fix `logAuthEvent()` to check for insert errors."
- [ ] **SPEC-REV-6:** Expand H1: "Planning page fix is three parts: (1) role gate on page.tsx, (2) verify planning loader caller auth, (3) close planning/SOP data leak on event detail page (`events/[eventId]/page.tsx:116`)."
- [ ] **SPEC-REV-7:** Update C1: "Note that `cancelBooking()` helper uses admin client (service-role), bypassing RLS entirely. App-layer ownership check is the primary control, not RLS."
- [ ] **SPEC-REV-8:** Update M1: "Note that booking read/cancel helpers use admin client. RLS tightening is defence-in-depth only — app-layer auth is the primary fix."
- [ ] **SPEC-REV-9:** Add NEW-003 as High: "Event submit ordering bug — `submitEventForReviewAction()` syncs artists and may update images before checking submittable status. Fix: move status check before side effects."
- [ ] **SPEC-REV-10:** Add NEW-004 as Medium: "Executive inspiration dismissal — `dismissInspirationItemAction()` allows `canViewPlanning` users. Change to `canUsePlanning()` to enforce executive read-only."
- [ ] **SPEC-REV-11:** Add NEW-005 as Medium: "Sign-in session creation must be fatal — if `createSession()` fails, return error to user instead of redirecting (creates redirect loop with middleware)."
- [ ] **SPEC-REV-12:** Add NEW-006 as Medium: "Lockout window mismatch — record window (15 min) vs check window (30 min). Also `cleanupExpiredSessions()` never deletes stale `login_attempts`."
- [ ] **SPEC-REV-13:** Add NEW-007 as Medium: "Public API notes leak — `toPublicEvent()` falls back to internal `notes` when `public_description` missing. Fix: never expose `notes` in public API."
- [ ] **SPEC-REV-14:** Add NEW-008 as Medium: "Booking double-submit — add idempotency key or unique constraint to prevent duplicate bookings from rapid form submission."
- [ ] **SPEC-REV-15:** Change H2 to "Needs product decision" — restore UI is on planner-only settings page; broadening server action without exposing UI creates inconsistency.
- [ ] **SPEC-REV-16:** Fix L5 description — some reference tables use `using (true)` without `TO authenticated`, making them readable by anon role too.
- [ ] **SPEC-REV-17:** Update C2: "Fix must touch both `src/actions/bookings.ts` (accept token) AND `src/app/l/[slug]/BookingForm.tsx` (render Turnstile widget, submit token). Also consider extracting `verifyTurnstile()` from `src/actions/auth.ts` into a shared helper."

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1:** `supabase/migrations/` — New migration: REVOKE/GRANT execute on unhardened SECURITY DEFINER functions + pin search_path
- [ ] **IMPL-2:** `supabase/migrations/` — New migration: extend audit_log entity_type CHECK, change entity_id to text
- [ ] **IMPL-3:** `src/lib/audit-log.ts` — Fix `logAuthEvent()` to check for insert errors
- [ ] **IMPL-4:** `src/actions/bookings.ts` — Add ownership check to `cancelBookingAction()` (central_planner or event venue matches user venue)
- [ ] **IMPL-5:** `src/actions/bookings.ts` + `src/app/l/[slug]/BookingForm.tsx` — Add Turnstile to public booking flow
- [ ] **IMPL-6:** `src/app/planning/page.tsx` — Add `canViewPlanning()` role gate
- [ ] **IMPL-7:** `src/app/events/[eventId]/page.tsx` — Gate planning/SOP data behind `canViewPlanning()` check
- [ ] **IMPL-8:** `src/actions/events.ts` — Move status check before artist sync in `submitEventForReviewAction()`
- [ ] **IMPL-9:** `src/actions/auth.ts` — Move `clearLockoutForAllIps()` from `requestPasswordResetAction()` to `completePasswordResetAction()`
- [ ] **IMPL-10:** `src/actions/auth.ts` — Make `createSession()` failure fatal in `signInAction()`
- [ ] **IMPL-11:** `src/actions/planning.ts` — Change `dismissInspirationItemAction()` to require `canUsePlanning()` instead of `canViewPlanning()`
- [ ] **IMPL-12:** `src/lib/auth/session.ts` — Align lockout record/check windows; add login_attempts cleanup to `cleanupExpiredSessions()`
- [ ] **IMPL-13:** `src/lib/public-api/events.ts` — Remove `notes` fallback in `toPublicEvent()`
- [ ] **IMPL-14:** `src/actions/bookings.ts` or `supabase/migrations/` — Add idempotency key to booking creation
- [ ] **IMPL-15:** `supabase/migrations/` — Tighten event_bookings RLS (defence in depth)
- [ ] **IMPL-16:** `supabase/migrations/` — Add venue-scoped SELECT for venue_managers on events
- [ ] **IMPL-17:** `src/app/api/cron/*/route.ts` — Add structured logging (4 files)
- [ ] **IMPL-18:** `src/lib/auth.ts` — Add console.warn on role normalisation null
- [ ] **IMPL-19:** `src/actions/customers.ts` — Add intent comment for GDPR-only scoping

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1:** Were REVOKE EXECUTE statements applied outside the migrations directory for SECURITY DEFINER functions? → Ask: infrastructure/DBA owner. If yes, NEW-001 severity drops to documentation-only.
- [ ] **ASM-2:** Should venue_managers see all events at their venue, or only their own? → User decided "all venue events" but current role docs say "own events." Confirm this is a deliberate policy change.
- [ ] **ASM-3:** Should artist restore be available to venue_managers? → The restore UI is on the planner-only settings page. Decide: broaden the action + expose the UI, or document as intentionally planner-only.
- [ ] **ASM-4:** Is executive inspiration dismissal intentional? → The planning inspiration spec says yes, but the role model says executives are read-only. Resolve the contradiction.

## REPO CONVENTIONS TO PRESERVE

- Use `getCurrentUser()` + role helpers from `src/lib/roles.ts` for all auth checks (not inline role string comparisons)
- Server actions use `'use server'` + return `{ success?: boolean; error?: string }`
- Admin client (`getDb()`) only for system/cron operations — prefer anon client for user-scoped operations
- Migrations follow timestamp naming: `YYYYMMDDHHMMSS_description.sql`
- Audit logging via `logAuditEvent()` / `logAuthEvent()` for all mutations

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **NEW-001:** Verify all SECURITY DEFINER functions have correct execute grants after migration
- [ ] **NEW-002:** Verify audit log entries are writing successfully for all entity types
- [ ] **H1:** Verify event detail page no longer leaks planning data
- [ ] **C2:** Verify BookingForm.tsx correctly submits Turnstile token
- [ ] **NEW-005:** Verify sign-in error is shown to user when session creation fails
- [ ] **NEW-008:** Verify duplicate booking submissions are rejected

## REVISION PROMPT

You are revising the auth/RBAC audit spec based on an adversarial review.

Apply these changes in order:

1. **Remove findings that are already fixed:** H3 (email casing — already centralised), L1 (HIBP logging — already present), M5 (rate limiter comment — already exists)
2. **Replace H3 with:** Password reset lockout clearing vulnerability (move clearLockoutForAllIps to completePasswordResetAction)
3. **Add Critical findings:** NEW-001 (SECURITY DEFINER RPC hardening), NEW-002 (audit log system broken)
4. **Expand H1:** Three-part fix (page gate + loader auth + event detail leak)
5. **Update C1/M1:** Note admin client usage — RLS is defence in depth, not primary control
6. **Add High findings:** NEW-003 (event submit ordering), NEW-005 (session creation must be fatal)
7. **Add Medium findings:** NEW-004 (executive dismissal), NEW-006 (lockout windows), NEW-007 (API notes leak), NEW-008 (booking idempotency)
8. **Update C2:** Must touch BookingForm.tsx client component too
9. **Change H2 to needs-product-decision**
10. **Fix L5 description accuracy**
11. **Update implementation order to reflect new priorities**

Preserve these decisions:
- Role model is sound — do not change
- Middleware auth flow is sound — do not change
- Session management design is sound — do not change
- Turnstile fail-soft is intentional — do not change

Verify these assumptions before proceeding:
- ASM-1: SECURITY DEFINER execute privileges
- ASM-2: Venue manager event visibility policy
- ASM-3: Artist restore access level
- ASM-4: Executive inspiration dismissal intent
