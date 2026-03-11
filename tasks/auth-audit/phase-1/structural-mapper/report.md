# Auth Compliance Structural Audit — BARONS-EventHub

**Audit Date:** 2026-03-11  
**Baseline:** Auth Standard Section 1-13 (mandatory compliance)  
**Status:** MAJOR GAPS IDENTIFIED

---

## 1. Supabase Client Inventory

### Browser Client (`src/lib/supabase/client.ts`)
- **Status:** MISSING
- **Required by:** Auth Standard Section 1
- **Impact:** No authenticated browser client exists; any `'use client'` component cannot safely call Supabase methods

### Server Client (`src/lib/supabase/server.ts`)
- **Status:** EXISTS with deviations
- **File:** `src/lib/supabase/server.ts`
- **Found functions:**
  - `createSupabaseReadonlyClient()` — anon key, respects RLS
  - `createSupabaseActionClient()` — anon key with cookie write support
  - Both use `createServerClient` from `@supabase/ssr`
- **Issues:**
  - No `flowType: 'pkce'` configuration visible in either client factory
  - No `autoRefreshToken: true` or `detectSessionInUrl: true` explicitly set
  - No PKCE settings documented

### Admin/Service-Role Client (`src/lib/supabase/admin.ts`)
- **Status:** EXISTS
- **File:** `src/lib/supabase/server.ts` (function `createSupabaseServiceRoleClient()`)
- **Settings:**
  - Uses `SUPABASE_SERVICE_ROLE_KEY`
  - Sets `persistSession: false` ✓
  - Creates via `createClient()` (not `createServerClient()`)
  - NOT marked `'server-only'` — imports at module top-level but no `'server-only'` directive
- **Issue:** Missing `'server-only'` safeguard; not explicitly preventing browser import

---

## 2. Middleware Map

**File:** `middleware.ts` (project root)

### Execution Order & Steps:

1. **Short-link subdomain bypass** (lines 6-14)
   - Routes to `SHORT_LINK_HOST` (default `l.baronspubs.com`) skip all auth
   - Returns early with `NextResponse.next()`
   - No security headers applied to short-link responses

2. **Supabase configuration check** (lines 17-23)
   - Validates `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` exist
   - Returns 503 if missing ✓
   - Creates server client with anon key

3. **Session retrieval** (lines 25-41)
   - Calls `getSession()` (NOT `getUser()`)
   - **VIOLATION:** Standard Section 2, Step 1 requires `getUser()` for auth validation
   - `getSession()` trusts local cache without server re-validation

4. **Public asset allowlist** (lines 43-53)
   - Checks: `/_next`, `/public`, `/favicon.ico`, static file extensions
   - No explicit `/auth/*` or `/api/auth/*` allowlist
   - Auth routes hardcoded in array: `/login`, `/forgot-password`, `/reset-password`

5. **Authentication gate** (lines 55-61)
   - Unauthenticated users to non-auth routes redirect to `/login`
   - Redirect uses param `redirectedFrom` (NOT `from`)
   - **No validation of `redirectedFrom` param** — may be open redirect vulnerability

6. **Authenticated redirect** (lines 63-67)
   - Authenticated users accessing auth routes redirect to `/`
   - No validation of destination

7. **Security headers**
   - **MISSING:** No security headers applied
   - Standard Section 2, Step 3 requires CSP, HSTS, X-Content-Type-Options, etc.

### Missing Middleware Steps (Standard Section 2):
- ❌ Step 1 — uses `getSession()` not `getUser()`
- ❌ Step 3 — No security headers (CSP, HSTS, etc.)
- ❌ Step 5 — No custom session validation (no `app-session-id` cookie check)
- ❌ Step 6 — No CSRF token generation or validation

---

## 3. Auth Flow Map

### Sign-In Flow
**Entry:** `/login` page → `LoginForm` component  
**Form submission:** `signInAction` server action

| Step | File | Implementation |
|------|------|-----------------|
| Client render | `src/app/login/page.tsx` | Calls `getSession()`, redirects if authenticated |
| Redirect sanitization | `src/app/login/page.tsx` | `sanitizeRedirect()` function validates same-origin |
| Form validation | `src/app/login/login-form.tsx` | Uses React Hook Form via `useActionState()` |
| Credentials parse | `src/actions/auth.ts` line 77 | Zod schema: email + password (8+ chars) |
| Supabase sign-in | `src/actions/auth.ts` line 92 | `supabase.auth.signInWithPassword()` |
| Error handling | `src/actions/auth.ts` line 94 | Generic "Those details didn't match" (good — prevents enumeration) |
| Post-login redirect | `src/actions/auth.ts` line 98 | Validates `redirectTarget` as same-origin |

**Missing:**
- ❌ No CAPTCHA (required by Section 6)
- ❌ No account lockout (required by Section 5)
- ❌ No rate limiting on login endpoint (required by Section 5)
- ❌ No audit logging of login attempts (required by Section 9)
- ❌ No app-session-id creation (required by Section 3)

### Sign-Out Flow
**Entry:** `signOutAction` server action

| Step | File | Implementation |
|------|------|-----------------|
| Supabase sign-out | `src/actions/auth.ts` line 103 | `supabase.auth.signOut()` |
| Redirect | `src/actions/auth.ts` line 104 | Hard redirect to `/login` |

**Missing:**
- ❌ No explicit app-session-id destruction (required by Section 3)
- ❌ No CSRF protection (sign-out not CSRF-protected) (required by Section 4)
- ❌ No audit logging (required by Section 9)

### Password Reset (Forgot Password)
**Entry:** `/forgot-password` page → `ForgotPasswordForm` component  
**Form submission:** `requestPasswordResetAction` server action

| Step | File | Implementation |
|------|------|-----------------|
| Email parse | `src/actions/auth.ts` line 111 | Zod schema: valid email |
| URL resolution | `src/actions/auth.ts` line 62-67 | Multi-fallback: `NEXT_PUBLIC_SITE_URL` → `NEXT_PUBLIC_APP_URL` → Vercel URL → hardcoded default |
| Admin link generation | `src/actions/auth.ts` line 128 | `adminClient.auth.admin.generateLink()` with type `recovery` |
| Email dispatch | `src/actions/auth.ts` line 142 | `sendPasswordResetEmail()` → Resend API |
| Success response | `src/actions/auth.ts` line 159 | Always generic success (email existence not revealed) ✓ |

**Missing:**
- ❌ No CAPTCHA (required by Section 6)
- ❌ No rate limiting on forgot-password endpoint (required by Section 5)
- ❌ No audit logging (required by Section 9)

### Password Reset Completion
**Entry:** `/reset-password` page → `ResetPasswordCard` component  
**Form submission:** `completePasswordResetAction` server action

| Step | File | Implementation |
|------|------|-----------------|
| Token validation | `src/actions/auth.ts` line 167 | Zod schema: token OR (accessToken + refreshToken) required |
| Password matching | `src/actions/auth.ts` line 44-50 | Checks passwords match |
| Token exchange | `src/actions/auth.ts` line 204 | `supabase.auth.exchangeCodeForSession()` |
| Session restore | `src/actions/auth.ts` line 213 | `supabase.auth.setSession()` if accessToken/refreshToken provided |
| Password update | `src/actions/auth.ts` line 232 | `supabase.auth.updateUser({ password })` |
| Sign-out | `src/actions/auth.ts` line 244 | Force sign-out after password change |

**Missing:**
- ❌ No password policy validation (required by Section 10: 12+ chars, uppercase, lowercase, digit, special char, HIBP check)
- ❌ No CSRF protection (form should be POST with CSRF token)
- ❌ No `destroyAllSessionsForUser()` call (required by Section 3 after password change)
- ❌ No new session issued for current user after `destroyAllSessionsForUser()` (required by Section 3 for session fixation prevention)
- ❌ No audit logging (required by Section 9)

### Invite/User Management
**Status:** Not found in `src/actions/`

**Missing entirely:**
- ❌ No invite user flow (`supabaseAdmin.auth.admin.inviteUserByEmail()`)
- ❌ No two-step atomic invite process (create user, set app_metadata, rollback on failure)
- ❌ No invite acceptance handler
- ❌ No invite resend logic
- ❌ No role assignment via admin API
- ❌ No invite link expiry (7 days) enforcement

### Role Change Flow
**Status:** Not found in `src/actions/`

**Missing:**
- ❌ No role demotion handler
- ❌ No `destroyAllSessionsForUser()` call on demotion
- ❌ No new session issued to admin performing change
- ❌ No audit logging of role changes

---

## 4. Session Management Inventory

### Custom Session Layer
- **Status:** NOT IMPLEMENTED
- **Redis (Upstash):** No imports, no references found
- **app-session-id cookie:** Not used anywhere
- **Session store:** Missing entirely

### Current Session Model
- Only Supabase JWT via HTTP-only cookie
- No server-side session tracking
- No idle timeout implementation
- No absolute timeout beyond JWT expiry
- No session revocation mechanism

**Violations:**
- ❌ Section 3 — Requires dual-layer (Supabase JWT + app session record)
- ❌ Section 3 — No absolute timeout (24 hours)
- ❌ Section 3 — No idle timeout (30 minutes)
- ❌ Section 3 — No concurrent session limit (5 per user)
- ❌ Section 3 — No `createSession()` function
- ❌ Section 3 — No `validateSession()` function
- ❌ Section 3 — No `renewSession()` function
- ❌ Section 3 — No `destroySession()` function
- ❌ Section 3 — No `destroyAllSessionsForUser()` function
- ❌ Section 3 — No `cleanupExpiredSessions()` cron

---

## 5. CSRF Inventory

- **Status:** NOT IMPLEMENTED
- **CSRF token generation:** Missing
- **CSRF validation:** Missing
- **CSRF cookie:** Not found
- **Client utility:** Missing

**All mutation endpoints exposed without CSRF protection:**
- `POST /api/v1/*` endpoints lack CSRF checks
- Sign-out endpoint not CSRF-protected (violates Section 4)
- Form submissions (login, reset, forgot) sent without CSRF tokens

**Violations:**
- ❌ Section 4 — No CSRF token generation in middleware
- ❌ Section 4 — No CSRF validation on mutations
- ❌ Section 4 — No client utility for reading token from cookie
- ❌ Section 4 — Sign-out not CSRF-protected

---

## 6. Account Lockout Inventory

- **Status:** NOT IMPLEMENTED
- **No Redis backend:** Missing
- **No in-memory fallback:** Missing
- **No lockout logic:** Missing

**Sign-in endpoint exposed:**
- No failed-attempt counter
- No 5-attempt threshold
- No 15-minute attempt window
- No 30-minute lockout duration
- No per-IP + per-email tracking

**Password reset endpoint exposed:**
- No lockout clearing mechanism

**Violations:**
- ❌ Section 5 — No account lockout implementation
- ❌ Section 5 — No Redis lockout store
- ❌ Section 5 — No lockout:hash:ip key structure
- ❌ Section 5 — No lockout:ips:hash cross-IP index
- ❌ Section 5 — No audit logging of lockouts

---

## 7. Rate Limiting Inventory

### Public API Rate Limiting
**File:** `src/lib/public-api/rate-limit.ts`

| Setting | Value |
|---------|-------|
| Backend | In-process Map (per-instance) |
| Window | 60 seconds |
| Limit | 120 requests per IP per window |
| Cleanup | Periodic purge every 120 seconds |

**Implementation:**
- Per-IP sliding-window counter
- Returns 429 with `retry-after` header
- **Issue:** Per-instance only — scales with number of serverless instances

### Auth Endpoints Rate Limiting
- **Status:** NOT IMPLEMENTED
- No separate rate limit for login/forgot-password endpoints
- No stricter limits than general API

**Violations:**
- ❌ Section 5 — No auth endpoint-specific rate limiting
- ❌ Section 5 — No per-user rate limiting (only per-IP)
- ❌ Section 5 — Login endpoint not rate-limited separately

---

## 8. CAPTCHA Inventory

- **Status:** NOT IMPLEMENTED
- **Turnstile integration:** Missing entirely
- **Environment variables:** `TURNSTILE_SECRET_KEY` not declared
- **Environment variables:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` not declared

**Violations:**
- ❌ Section 6 — No CAPTCHA on sign-in
- ❌ Section 6 — No CAPTCHA on forgot-password
- ❌ Section 6 — No Turnstile widget integration
- ❌ Section 6 — No server-side token verification
- ❌ Section 6 — No fail-soft behavior on Turnstile API unreachable

---

## 9. RBAC Map

### Roles Defined
**File:** `src/lib/types.ts` line 3-7

```
type UserRole = "venue_manager" | "reviewer" | "central_planner" | "executive"
```

**NOT the standard 3-tier model (admin/editor/viewer):**
- Custom role hierarchy specific to EventHub
- Does NOT follow global role standard from Section 7

**Role storage:**
**File:** `src/lib/auth.ts` line 46  
- Reads from `users.role` table column
- **Issue:** Stored in database table, not in Supabase `app_metadata`
- **Violation:** Section 7 requires `user.app_metadata.role`, never in database

### Role Capability Functions
**File:** `src/lib/roles.ts`

Functions defined:
- `canManageEvents()` — venue_manager or central_planner
- `canReviewEvents()` — central_planner or reviewer
- `canSubmitDebriefs()` — central_planner or venue_manager
- `canManageArtists()` — central_planner or venue_manager
- `canManageVenues()` — central_planner only
- `canManageUsers()` — central_planner only
- `canManageSettings()` — central_planner only
- `canUsePlanning()` — central_planner only
- `canViewAllEvents()` — central_planner or reviewer or executive
- `canManageLinks()` — central_planner only

**Issues:**
- Not role-hierarchy aware (`role >= required_level` not used)
- Not using standard 3-tier model
- No `requireAuth()`, `getCurrentUser()`, `requireAdmin()` helpers (Section 7 required helpers)
- No API handler wrappers (`withAuth()`, `withAdminAuth()`, etc.)

### Required Server-Side Helpers (Section 7)
**Status:** PARTIALLY IMPLEMENTED

| Helper | Status | File |
|--------|--------|------|
| `requireAuth()` | ❌ MISSING | — |
| `getCurrentUser()` | ✓ EXISTS | `src/lib/auth.ts` line 34 |
| `requireAdmin()` | ❌ MISSING | — |
| `withAuth(handler)` | ❌ MISSING | — |
| `withAdminAuth(handler)` | ❌ MISSING | — |
| `withAuthAndCSRF(handler)` | ❌ MISSING | — |
| `withAdminAuthAndCSRF(handler)` | ❌ MISSING | — |

### Permission Checks in Pages
**Sample audit (20 pages found):**

| Page | Auth Check |
|------|-----------|
| `/` | `getCurrentUser()` in layout ✓ |
| `/events` | Only if authenticated (middleware gate) |
| `/planning` | Only if authenticated (middleware gate) |
| `/users` | Only if authenticated (middleware gate) |
| `/admin/*` | Only if authenticated (middleware gate) |

**Issue:** All permission checks happen at middleware level (session check only). No page-level RBAC verification. Users without `central_planner` role can access `/users` page and server actions.

**Violations:**
- ❌ Section 7 — Role stored in database, not app_metadata
- ❌ Section 7 — Using custom role model, not global 3-tier model
- ❌ Section 7 — Missing `requireAuth()`, `requireAdmin()` helpers
- ❌ Section 7 — Missing API handler wrappers
- ❌ Section 7 — No per-page RBAC checks (only middleware gate)
- ❌ Section 7 — Server actions don't re-verify permissions

---

## 10. Audit Log Schema

**File:** `src/lib/audit-log.ts`

### Recorded Entity
- **Entity types:** Only "event" (line 7)
- **Actions:** Generic string (line 9)
- **Fields:** `entity`, `entity_id`, `action`, `meta`, `actor_id` (line 6-12)

### Current logging:
- Event mutations (create, update, decision, debrief)
- No auth events logged

### Required Auth Events (Section 9)
All missing:

| Event | Status |
|-------|--------|
| `auth.login.success` | ❌ |
| `auth.login.failure` | ❌ |
| `auth.lockout` | ❌ |
| `auth.logout` | ❌ |
| `auth.password_reset.requested` | ❌ |
| `auth.password_updated` | ❌ |
| `auth.invite.sent` | ❌ |
| `auth.invite.accepted` | ❌ |
| `auth.role.changed` | ❌ |
| `auth.session.expired.idle` | ❌ |
| `auth.session.expired.absolute` | ❌ |

### PII Handling
- No email hashing in audit logs
- No IP address or user agent recording on login events

**Violations:**
- ❌ Section 9 — No auth events logged at all
- ❌ Section 9 — No email hashing (SHA-256) for audit records
- ❌ Section 9 — No IP address or user agent on login events

---

## 11. Password Policy Inventory

### Current Implementation
**File:** `src/actions/auth.ts` line 9-11

```typescript
const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, { message: "Password must be at least 8 characters" })
});
```

**Constraints enforced:**
- ✓ Minimum 8 characters (too low — standard requires 12)

**Constraints missing:**
- ❌ Maximum 128 characters
- ❌ At least 1 uppercase letter
- ❌ At least 1 lowercase letter
- ❌ At least 1 digit
- ❌ At least 1 special character
- ❌ Must not match current password
- ❌ HIBP Passwords API check (k-anonymity with SHA-1)

### Password Update
**File:** `src/actions/auth.ts` line 36-42

```typescript
const passwordResetSchema = z
  .object({
    password: z.string().min(8),
    confirmPassword: z.string().min(8)
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) { /* ... */ }
  });
```

**Same weak constraints as sign-in (8 chars minimum only).**

### Dedicated Policy File
- **Status:** MISSING
- Standard requires `src/lib/auth/password-policy.ts`
- No centralized policy definition

**Violations:**
- ❌ Section 10 — Minimum 8 chars instead of required 12
- ❌ Section 10 — No maximum 128 chars
- ❌ Section 10 — No uppercase/lowercase/digit/special char requirements
- ❌ Section 10 — No current password check
- ❌ Section 10 — No HIBP check
- ❌ Section 10 — No dedicated policy file
- ❌ Section 10 — Policy hardcoded in form schemas, not centralized

---

## 12. Email Template Inventory

### Email Infrastructure
**File:** `src/lib/notifications.ts`
- Email service: Resend
- From address: `RESEND_FROM_EMAIL` env var (default: `EventHub <no-reply@eventhub.orangejelly.co.uk>`)
- Branded email template function: `renderEmailTemplate()` (line 41)
- HTML output: Custom generated (line 58-186)

### Email Functions Found
1. `sendEventSubmittedEmail()` — Event submission notification (not auth)
2. `sendReviewDecisionEmail()` — Review decision notification (not auth)
3. `sendPasswordResetEmail()` — **Auth email** (line 379)
4. `sendDebriefReminderEmail()` — Event reminder (not auth)
5. `sendUpcomingEventReminderEmail()` — Event reminder (not auth)
6. `sendNeedsRevisionsFollowUpEmail()` — Event revision (not auth)
7. `sendAssigneeReassignmentEmail()` — Event assignment (not auth)
8. `sendPostEventDigestEmail()` — Event digest (not auth)
9. `sendWeeklyPipelineSummaryEmail()` — Pipeline summary (not auth)

### Password Reset Email
**Function:** `sendPasswordResetEmail()` (line 379)

Content:
- Headline: "Reset your EventHub password"
- Body: "we received a request to reset your EventHub password"
- Security notice: "If you didn't request this, you can safely ignore this message" ✓
- Reset link: Embedded in button
- Expires: Not stated in email body
- Support contact: `peter@orangejelly.co.uk` ✓

**Issue:** Link expiry (60 minutes required) not stated in email.

### Required Email Templates (Section 12)
All 4 must exist:

| Template | Status | Found | Location |
|----------|--------|-------|----------|
| `invite_user.html` | ❌ Missing | No function | Not implemented |
| `reset_password.html` | ❌ Missing | Has function but no template | `docs/emails/email-reset-password.html` exists but not used |
| `confirm_signup.html` | ❌ Missing | No function | Not implemented |
| `magic_link.html` | ❌ Missing | No function | Not implemented |

### Email Template Files Found
**Directory:** `docs/emails/` (6 files)

- `email-change-email.html` — Supabase default (not customized) ❌
- `email-confirm-signup.html` — Supabase default ❌
- `email-invite-user.html` — Supabase default ❌
- `email-magic-link.html` — Supabase default ❌
- `email-otp.html` — Supabase default ❌
- `email-reset-password.html` — Supabase default ❌

**Issue:** These are documentation/reference files in `docs/`, not active Supabase templates. No Supabase Auth email template configuration found in project.

### Violations (Section 12)
- ❌ No branded email templates configured in Supabase Auth
- ❌ Using Supabase default templates (prohibited in Section 12)
- ❌ No invite email function or template
- ❌ No signup confirmation email function or template
- ❌ No magic link email function or template
- ❌ Reset password email doesn't state expiry (60 minutes)
- ❌ Email templates not pointing to `/auth/confirm` route (standard requirement)

---

## 13. Missing Files Checklist

| File Path | Required By | Status |
|-----------|-------------|--------|
| `src/lib/supabase/client.ts` | Section 1 (browser client) | ❌ MISSING |
| `src/lib/supabase/admin.ts` | Section 1 (admin client) | ✓ Exists (in server.ts) |
| `src/lib/auth/password-policy.ts` | Section 10 | ❌ MISSING |
| `src/lib/session.ts` (or similar) | Section 3 | ❌ MISSING |
| `src/lib/csrf.ts` (or middleware) | Section 4 | ❌ MISSING |
| `src/lib/lockout.ts` (or similar) | Section 5 | ❌ MISSING |
| `src/app/api/auth/login` | Section 8 | ❌ MISSING (uses Supabase client-side) |
| `src/app/api/auth/logout` | Section 8 (CSRF-protected) | ❌ MISSING |
| `src/app/api/auth/heartbeat` | Section 11 | ❌ MISSING |
| `src/app/api/auth/confirm` | Section 8 | ❌ MISSING |
| `src/app/auth/update-password` | Section 8 | ❌ MISSING |
| `src/app/auth/invite` | Section 8 | ❌ MISSING |
| `src/lib/auth/__tests__/` | Section 13 | ❌ MISSING |
| Supabase email templates (configured) | Section 12 | ❌ NOT CONFIGURED |

---

## 14. External Dependencies

**File:** `package.json`

### Auth-Relevant Packages

| Package | Version | Purpose | Usage |
|---------|---------|---------|-------|
| `@supabase/ssr` | `^0.7.0` | Supabase server-side auth | Server/middleware clients |
| `@supabase/supabase-js` | `^2.75.0` | Supabase JavaScript client | Admin/service-role client |
| `resend` | `^6.1.3` | Email service (password reset, notifications) | Auth + notification emails |
| `zod` | `^4.1.12` | Schema validation | Form validation (weak password rules) |
| `server-only` | `^0.0.1` | Mark files as server-only | Declared but not imported |

### Missing Dependencies (Required)

| Package | Purpose | Standard Section |
|---------|---------|------------------|
| Redis/Upstash client | Session storage, rate limiting, lockout | 3, 5 |
| Cloudflare Turnstile SDK | CAPTCHA verification | 6 |
| HIBP client | Breached password check | 10 |
| crypto/timingSafeEqual | Constant-time comparison for tokens | 4 |

**Note:** `crypto.timingSafeEqual` used in `src/lib/public-api/auth.ts` (native Node.js, no package needed).

---

## Summary: Compliance Status

### Critical Failures (Mandatory, Section Violations)

| Requirement | Status | Gap |
|-------------|--------|-----|
| 3-tier RBAC (admin/editor/viewer) | Custom 4-tier model | Uses app-specific roles |
| Dual-layer sessions (JWT + Redis) | Only JWT | No session management |
| CSRF protection | None | No tokens, no validation |
| Account lockout | None | Exposed sign-in endpoint |
| CAPTCHA (Turnstile) | None | No protection on login/reset |
| Password policy (12+ chars, rules, HIBP) | 8 chars minimum only | Weak validation |
| Auth audit logging | None (no auth events logged) | 0/11 required events |
| Idle timeout (30 min) | None | Sessions don't expire |
| Absolute timeout (24 h) | JWT only (~3 months) | No app-level timeout |
| Email templates (branded, 4 required) | Supabase defaults only | 0/4 branded templates |
| Session helper functions | `getCurrentUser()` only | Missing `requireAuth()`, `requireAdmin()`, API wrappers |
| Middleware security headers | None | No CSP, HSTS, etc. |
| Role storage (app_metadata) | Database table | Violates standard requirement |
| Invite flow (atomic 2-step) | Not implemented | No user invitations |
| Role demotion session destruction | Not implemented | Demoted users keep elevated access |
| Heartbeat/session renewal endpoint | None | No client-side idle timeout UX |

### Severity Assessment

- **Critical (blocks production):** RBAC model mismatch, no CSRF, no session management, no CAPTCHA, weak password policy, no auth logging
- **High (security risk):** No idle timeout, no account lockout, default email templates, missing invite flow
- **Medium (compliance gap):** Missing helper functions, no security headers, password policy hardcoding

### Estimated Remediation Effort

- **Phase 1 (Security critical):** 40-60 hours
  - Implement dual-layer sessions with Redis
  - Add CSRF protection
  - Add CAPTCHA (Turnstile)
  - Implement account lockout
  - Align to 3-tier RBAC model with app_metadata storage

- **Phase 2 (Compliance):** 30-40 hours
  - Implement password policy (HIBP, constraints)
  - Add auth event audit logging
  - Create helper function suite
  - Add security headers to middleware
  - Implement heartbeat/idle timeout UX

- **Phase 3 (Polish):** 20-30 hours
  - Branded email templates
  - Invite/user management flows
  - Test coverage (90% auth, 80% API)
  - Documentation updates

---

**End of Structural Audit Report**
