**Findings**
- `5.1` is materially wrong. Mutation audit logging already exists in `events`, `sop`, `debriefs`, `cancelBooking`, `customers`, and `users`, so the real gap is partial coverage, not total absence.
- `2.3` and `4.3` are stale. Venue-scoped RLS already exists for event reads, bookings, and customers; the remaining issue is narrower and mostly on write-side scoping.
- Layer 1 overstates what is “verified”: there is no separate 30-minute lockout, idle timeout is not enforced in middleware, the cron route does not run idle-session cleanup, and password reset does not leave the user with a usable fresh session.
- Layer 3 has multiple false verified rows: cron auth is not constant-time, the CSRF token description is wrong, and API response bodies are not standardized.
- Layer 4 counts are stale: current schema ends at 31 RLS-enabled public tables, not 27, and 11 distinct `SECURITY DEFINER` functions, not 8.
- Several proposed fixes are not codebase-native: the spec repeatedly proposes `logAuditEvent()`, but the repo uses `logAuthEvent()` and `recordAuditLogEntry()` with a different schema.

**Trace Matrix**
**Layer 1**
| Spec Claim | File:Line | Status | Evidence |
|---|---|---|---|
| Login: email/password only, Zod, Turnstile before auth | `src/actions/auth.ts:24`, `src/actions/auth.ts:86`, `src/app/login/login-form.tsx:26` | CONFIRMED | `signInWithPassword()` is the only sign-in path; Zod parse and Turnstile check happen before auth. |
| Brute-force: 5 failed / 15 min / email+IP, 30-min lockout, SHA-256 email hash | `src/lib/auth/session.ts:157`, `src/lib/auth/session.ts:204`, `src/actions/auth.ts:101` | INACCURATE | `5-in-15` and SHA-256 hashing are real; there is no distinct 30-minute enforced lockout window. |
| Email enumeration prevention: generic “Those details didn't match” on all failure paths | `src/actions/auth.ts:103`, `src/actions/auth.ts:119`, `src/actions/auth.ts:244` | INCOMPLETE | Credential failures are generic and reset is always generic, but not every auth failure path uses that exact message. |
| Session creation: Supabase JWT cookie + `app_sessions` row | `src/lib/supabase/server.ts:25`, `src/actions/auth.ts:145`, `src/lib/auth/session.ts:36` | CONFIRMED | Login sets Supabase cookies and a separate `app-session-id` tied to `app_sessions`. |
| Session validation: middleware uses `getUser()` + `app-session-id` against DB | `middleware.ts:172`, `middleware.ts:235`, `src/lib/auth/session.ts:79` | CONFIRMED | Middleware validates JWT server-side, then validates the custom session record. |
| Session fixation protection: JWT user must match `app_sessions.user_id` | `middleware.ts:259` | CONFIRMED | Mismatch clears cookies and redirects to login. |
| Session cookies: `httpOnly`, strict same-site, secure in prod, 24h | `src/lib/auth/session.ts:22` | CONFIRMED | Cookie options match the row. |
| Session limits: max 5 concurrent sessions, evict oldest | `src/lib/auth/session.ts:8`, `src/lib/auth/session.ts:45` | CONFIRMED | `MAX_SESSIONS_PER_USER = 5`; oldest rows are deleted first. |
| Password policy: 12-char min, HIBP, no-reuse via bcrypt compare | `src/lib/auth/password-policy.ts:9`, `src/lib/auth/password-policy.ts:31`, `src/actions/auth.ts:287` | INCOMPLETE | Helper supports all three, but live reset flow never passes a current hash, so no-reuse is not enforced there. |
| Password reset: Turnstile, recovery link, all sessions destroyed + fresh session issued, lockout cleared | `src/actions/auth.ts:223`, `src/actions/auth.ts:311`, `src/actions/auth.ts:348` | INACCURATE | Recovery link, session destruction, and lockout clearing exist; the “fresh session” is not usable because the action signs Supabase out immediately after creating a new app-session row. |
| Logout: destroys DB session, clears cookie, signs out, audit logged | `src/actions/auth.ts:181` | CONFIRMED | Logout does all four. |
| Session cleanup: cron deletes absolute-expired + idle-expired sessions and stale attempts | `src/app/api/cron/cleanup-auth/route.ts:27`, `src/lib/auth/session.ts:144`, `supabase/migrations/20260311100000_auth_session_tables.sql:38` | INACCURATE | The live cron route calls TS cleanup that deletes absolute expiries and stale attempts only; idle cleanup exists only in an unused SQL function. |
| Gap 1.1: no session refresh/extension | `src/lib/auth/session.ts:43`, `middleware.ts:235` | CONFIRMED | `expires_at` is set once and never extended. |
| Gap 1.2: password reset not separately rate-limited | `src/actions/auth.ts:223`, `src/lib/auth/session.ts:175`, `supabase/migrations/20260311100000_auth_session_tables.sql:25` | CONFIRMED | Reset relies on Turnstile only; there is no reset-attempt table/column or per-email throttle. |
| Gap 1.3: idle timeout not enforced in middleware | `src/lib/auth/session.ts:79`, `middleware.ts:235` | CONFIRMED | `last_activity_at` is neither checked nor updated on valid requests. |

**Layer 2**
| Spec Claim | File:Line | Status | Evidence |
|---|---|---|---|
| Role model: 4 roles | `src/lib/types.ts:3`, `src/lib/roles.ts:4` | CONFIRMED | Four roles are the live union and capability model. |
| Role storage: `public.users.role` with CHECK | `supabase/migrations/20250218000000_initial_mvp.sql:33` | CONFIRMED | `role` is `text` with a CHECK constraint. |
| Capability functions: 13 explicit flat helpers | `src/lib/roles.ts:16` | CONFIRMED | Thirteen boolean helpers exist; no inheritance model is implemented. |
| Auth resolution: role from DB, fallback from middleware header | `src/lib/auth.ts:51`, `src/lib/auth.ts:76`, `middleware.ts:282` | CONFIRMED | `x-user-id` is used when present; role is read from `public.users`, not JWT. |
| Server action enforcement: all 16 action files call `getCurrentUser()` and capability-check before writes | `src/actions/events.ts:592`, `src/actions/bookings.ts:36`, `src/actions/users.ts:32`, `src/actions/venues.ts:37` | INACCURATE | Repo has 13 top-level action files, not 16; public/pre-auth mutations exist, and many write paths use inline role checks instead of capability helpers. |
| Venue isolation: `venue_manager` constrained to `venue_id` in app code | `src/actions/events.ts:604`, `src/actions/bookings.ts:194`, `src/actions/debriefs.ts:91` | INCOMPLETE | Some paths use `venue_id`; others still key off `created_by`, so app-layer isolation is mixed. |
| Layout-level gating: `requireAuth()` / `requireAdmin()` redirect | `src/lib/auth.ts:105`, `src/lib/auth.ts:117` | CONFIRMED | Helpers exist and redirect correctly. |
| RLS policies: users self-access + planner CRUD; all 27 tables have RLS | `supabase/migrations/20250218000000_initial_mvp.sql:162`, `supabase/migrations/20260311100000_auth_session_tables.sql:19`, `supabase/migrations/20260408120000_add_sop_tables.sql:40` | INCOMPLETE | Users-table policies are correct, but the table count is stale. Current schema lands at 31 RLS-enabled public tables. |
| `current_user_role()`: SECURITY DEFINER with pinned `search_path` | `supabase/migrations/20250301000000_secure_current_user_role.sql:1` | CONFIRMED | Function is `SECURITY DEFINER` and pins `search_path = public`. |
| Invite role assignment: only planner can invite; role set at invite time | `src/actions/users.ts:95`, `src/actions/users.ts:148` | CONFIRMED | Invite action is planner-only and writes the invited role into `users`. |
| Gap 2.1: no audit trail for role changes | `src/actions/users.ts:67`, `src/lib/audit-log.ts:63` | INACCURATE | Role changes are already audit-logged; the real gap is missing old-role/old-venue metadata. |
| Gap 2.2: `current_user_role()` callable by `anon` | `supabase/migrations/20250301000000_secure_current_user_role.sql:15` | CONFIRMED | `anon` still has execute permission. |
| Gap 2.3: venue isolation is app-code only, no RLS | `supabase/migrations/20260410120003_venue_manager_event_visibility.sql:9`, `supabase/migrations/20260410120002_tighten_event_bookings_rls.sql:17` | INACCURATE | Venue-scoped RLS already exists for event reads and bookings; the row is stale as written. |

**Layer 3**
| Spec Claim | File:Line | Status | Evidence |
|---|---|---|---|
| Public API auth: Bearer token + constant-time compare | `src/lib/public-api/auth.ts:81`, `src/app/api/v1/events/route.ts:30` | CONFIRMED | `requireWebsiteApiKey()` uses `timingSafeEqual()`. |
| API rate limiting: 120 req / 60s sliding window / IP | `src/lib/public-api/rate-limit.ts:21`, `src/app/api/v1/events/route.ts:27` | INCOMPLETE | 120/IP/60s is real, but the implementation is process-local and not a true sliding window. |
| Cron route auth: Bearer `CRON_SECRET`, constant-time compare, logs IP + timestamp | `src/app/api/cron/cleanup-auth/route.ts:16`, `src/app/api/cron/cleanup-auth/route.ts:20` | INACCURATE | Cron routes do log IP/timestamp, but auth uses direct string equality, not constant-time comparison. |
| CSRF token generation: 16 bytes, base64, per-request | `middleware.ts:86`, `middleware.ts:92`, `middleware.ts:161` | INACCURATE | The 16-byte base64 value is the CSP nonce; CSRF token is 32 random bytes hex-encoded and only set when absent. |
| CSRF validation: cookie/header constant-time compare in wrappers | `src/lib/auth.ts:174`, `src/lib/auth.ts:207` | CONFIRMED | Wrappers do perform constant-time compare. |
| Server action CSRF: implicitly protected by Next.js | `src/actions/auth.ts:1` | AMBIGUOUS | This depends on framework behavior outside the repo; no repo code proves it. |
| API response format: consistent `{ success, data?, error? }` | `src/app/api/v1/events/route.ts:145`, `src/app/api/v1/health/route.ts:15`, `src/app/api/auth/session-check/route.ts:45` | INACCURATE | Live responses vary: `{data,meta}`, `{ok}`, `{valid}`, `{success}`, and structured `error`. |
| Gap 3.1: public API uses service-role client and bypasses RLS | `src/app/api/v1/events/route.ts:49`, `src/app/api/v1/event-types/route.ts:18`, `src/app/api/v1/venues/route.ts:18` | CONFIRMED | Real gap, and broader than stated: all DB-backed public API routes use service-role. |
| Gap 3.2: in-memory limiter resets on cold start | `src/lib/public-api/rate-limit.ts:3`, `src/lib/public-api/rate-limit.ts:22` | CONFIRMED | File explicitly documents the limitation. |
| Gap 3.3: CSRF token not `httpOnly` | `middleware.ts:163`, `middleware.ts:291` | CONFIRMED | Cookie is deliberately JS-readable. |

**Layer 4**
| Spec Claim | File:Line | Status | Evidence |
|---|---|---|---|
| RLS enabled: all 27 tables | `supabase/migrations/20260408120000_add_sop_tables.sql:40`, `supabase/migrations/20260408120001_add_planning_task_columns.sql:117`, `supabase/migrations/20260210122000_retire_venue_areas_and_event_image_storage.sql:4` | INACCURATE | Current schema has 31 RLS-enabled public tables, not 27. |
| Auth table isolation: `app_sessions` and `login_attempts` have zero RLS policies, service-role only | `supabase/migrations/20260311100000_auth_session_tables.sql:19`, `supabase/migrations/20260311100000_auth_session_tables.sql:35` | CONFIRMED | Both tables enable RLS and define no end-user policies. |
| Users table policies: self SELECT + planner CRUD | `supabase/migrations/20250218000000_initial_mvp.sql:162`, `supabase/migrations/20250218000000_initial_mvp.sql:166` | CONFIRMED | Matches the spec. |
| SECURITY DEFINER hardening: all 8 functions, revoked broadly, service-role only | `supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:4`, `supabase/migrations/20250301000000_secure_current_user_role.sql:14`, `supabase/migrations/20260414130001_harden_create_booking_rpc.sql:8` | INACCURATE | There are 11 distinct `SECURITY DEFINER` functions in current migrations, not 8, and `current_user_role()` is not service-role-only. |
| Role constraint: CHECK on allowed roles | `supabase/migrations/20250218000000_initial_mvp.sql:37` | CONFIRMED | Matches the spec. |
| Cascade deletes: `users.id` references `auth.users(id)` ON DELETE CASCADE | `supabase/migrations/20250218000000_initial_mvp.sql:34` | CONFIRMED | Matches the spec. |
| Login-attempt indexing: `(email_hash, ip_address, attempted_at)` | `supabase/migrations/20260311100000_auth_session_tables.sql:32` | CONFIRMED | Matches the spec. |
| Session dual timeout columns present | `supabase/migrations/20260311100000_auth_session_tables.sql:9`, `supabase/migrations/20260311100000_auth_session_tables.sql:10` | CONFIRMED | Columns exist. |
| Gap 4.1: role is text + CHECK, not ENUM | `supabase/migrations/20250218000000_initial_mvp.sql:37` | CONFIRMED | True. |
| Gap 4.2: `audit_log` not immutable | `supabase/migrations/20250315000001_audit_log_insert_policy.sql:2` | CONFIRMED | No immutability trigger exists; service-role can still update/delete. |
| Gap 4.3: events RLS doesn't enforce venue isolation | `supabase/migrations/20260410120003_venue_manager_event_visibility.sql:9` | INACCURATE | Read-side venue isolation already exists. |
| Gap 4.4: `current_user_role()` granted to `anon` | `supabase/migrations/20250301000000_secure_current_user_role.sql:15` | CONFIRMED | True. |
| Gap 4.5: no DB-level audit on `users.role` / `users.venue_id` changes | `supabase/migrations/20250218000000_initial_mvp.sql:132` | CONFIRMED | Only `updated_at` trigger exists on `users`. |

**Layer 5**
| Spec Claim | File:Line | Status | Evidence |
|---|---|---|---|
| Auth event logging: comprehensive coverage incl. role change and session expiry | `src/lib/audit-log.ts:53`, `src/lib/auth/session.ts:99`, `src/actions/users.ts:67` | INCOMPLETE | Absolute expiry is logged; idle expiry is never emitted; role change log lacks old values. |
| PII handling: email hashed, no plaintext PII in audit records | `src/lib/audit-log.ts:19`, `src/lib/audit-log.ts:80` | INCOMPLETE | Auth emails are hashed, but generic audit metadata is not redacted by the helper. |
| Security headers: CSP/HSTS/XFO/etc. | `middleware.ts:46`, `middleware.ts:304` | INCOMPLETE | Headers are set in middleware, but `/api/*` routes are excluded from the matcher. |
| PKCE flow: browser uses `flowType: "pkce"` | `src/lib/supabase/client.ts:19`, `src/app/auth/confirm/route.ts:28` | CONFIRMED | Live browser client is PKCE; confirm route handles PKCE/token exchanges. |
| Open redirect prevention: `/auth/confirm` validates `next` as same-origin | `src/app/auth/confirm/route.ts:19`, `src/app/login/page.tsx:21`, `src/actions/auth.ts:67` | CONFIRMED | `next` is constrained to relative paths; login flow sanitizes more strictly. |
| Admin client isolation: `server-only` prevents client bundling | `src/lib/supabase/admin.ts:1`, `src/app/api/v1/events/route.ts:49` | INCOMPLETE | True as a bundling guard, but public server handlers still use the admin client at runtime. |
| Invite rollback: failed email send deletes auth user, no orphans | `src/actions/users.ts:165`, `src/actions/users.ts:168` | INCOMPLETE | Rollback exists, but delete failure is logged and swallowed, so “no orphans” is too absolute. |
| Error message safety: generic errors across all auth paths | `src/actions/auth.ts:113`, `src/actions/auth.ts:130`, `src/app/auth/confirm/route.ts:33` | INCOMPLETE | Enumeration-sensitive paths are generic, but not every auth failure path uses generic wording. |
| Turnstile integration: login, reset, booking | `src/app/login/login-form.tsx:61`, `src/app/forgot-password/forgot-password-form.tsx:39`, `src/app/l/[slug]/BookingForm.tsx:229`, `src/lib/turnstile.ts:13` | INCOMPLETE | Integration exists, but auth flows use lenient/fail-open Turnstile while booking uses strict mode. |
| Gap 5.1: no mutation audit logging anywhere | `src/actions/events.ts:431`, `src/actions/sop.ts:116`, `src/actions/debriefs.ts:174`, `src/actions/bookings.ts:213`, `src/actions/customers.ts:65`, `src/actions/users.ts:67` | INACCURATE | Logging already exists in several mutation-heavy areas; the remaining gap is partial coverage. |
| Gap 5.2: no security runbook | `docs/security-decisions.md` | CONFIRMED | File is absent. |
| Gap 5.3: `style-src 'unsafe-inline'` for Turnstile | `middleware.ts:67` | CONFIRMED | Present and undocumented. |
| Gap 5.4: no automated auth regression tests | `src/lib/auth/__tests__/session.test.ts:156`, `src/lib/auth/__tests__/rbac.test.ts:381`, `src/lib/auth/__tests__/invite.test.ts:141`, `src/lib/auth/__tests__/audit.test.ts:38`, `src/app/api/auth/session-check/__tests__/route.test.ts:36` | INACCURATE | There is already substantial auth/security test coverage; what’s missing is broader integration/e2e coverage. |

**Success Criteria**
| Success Criterion | File:Line | Status | Evidence |
|---|---|---|---|
| 1. All 16 mutation paths log audit events | `src/actions/events.ts:431`, `src/actions/sop.ts:116`, `src/actions/venues.ts:55` | INACCURATE | Wrong file count and wrong current state; audit exists already, but coverage is partial. |
| 2. `/api/v1/events` stops using service-role and RLS enforces boundaries | `src/app/api/v1/events/route.ts:49`, `src/app/api/v1/events/[eventId]/route.ts:31`, `src/app/api/v1/events/by-slug/[slug]/route.ts:40` | INCOMPLETE | Needed, but the same pattern also exists in other public routes. |
| 3. Password reset gets 3/hour per-email rate limit | `src/actions/auth.ts:207`, `supabase/migrations/20260311100000_auth_session_tables.sql:25` | CONFIRMED | Achievable and still missing. |
| 4. Role changes logged with old/new values | `src/actions/users.ts:67` | CONFIRMED | Achievable by enriching the existing `auth.role.changed` log. |
| 5. `events` gets venue-scoped RLS for `venue_manager` | `supabase/migrations/20260410120003_venue_manager_event_visibility.sql:9` | INACCURATE | Read-side criterion is already satisfied; remaining concern is narrower write-side scoping. |
| 6. Rate limiter uses persistent storage | `src/lib/public-api/rate-limit.ts:21`, `src/actions/bookings.ts:17` | INCOMPLETE | Good for public API, but booking limiter is also in-memory and omitted. |
| 7. `audit_log` gets immutability trigger | `supabase/migrations/20250315000001_audit_log_insert_policy.sql:2` | CONFIRMED | Still needed and technically straightforward. |
| 8. `users` sensitive-column changes trigger DB audit | `supabase/migrations/20250218000000_initial_mvp.sql:132` | CONFIRMED | Still needed and achievable. |
| 9. Auth regression suite covers login/lockout/session/RBAC/reset/invite | `src/lib/auth/__tests__/session.test.ts:156`, `src/lib/auth/__tests__/invite.test.ts:141` | INCOMPLETE | Existing unit/security tests mean the real missing piece is integration/e2e depth. |
| 10. Security runbook documents all trade-offs | `middleware.ts:67`, `src/lib/turnstile.ts:13`, `src/app/l/[slug]/page.tsx:50` | INCOMPLETE | Good direction, but current list misses Turnstile fail-open and public landing-page service-role reads. |

**Spec Defects Found**
- The spec proposes `logAuditEvent()` and `operation_type/resource_type/operation_status`, but the repo uses `logAuthEvent()` and `recordAuditLogEntry()` with `entity/action/meta`. The proposed audit fixes do not match the actual code or schema.
- It confuses the 16-byte base64 CSP nonce with the CSRF token.
- It uses stale counts: `16` action files, `27` RLS-enabled public tables, `8` security-definer functions.
- It duplicates the same issue twice (`2.2` = `4.4`, `2.3` = `4.3`) and still leaves the stale versions in “verified working”.
- It marks partially solved issues as absent (`2.1`, `5.1`, `5.4`).
- It marks a resolved issue as open (`2.3` / `4.3` read-side venue RLS).
- It overstates guarantees: “fresh session issued” after reset, “no orphaned accounts” on invite rollback, “generic errors across all auth paths”, “all API responses use one shape”.
- It treats middleware security headers as if they covered API routes, but `matcher` excludes `/api/*`.

**Missed Coverage Areas**
- `src/app/api/auth/session-check/route.ts` and `src/components/shell/session-monitor.tsx` are part of the live session-expiry path and are absent from the spec.
- `src/lib/turnstile.ts` is a material auth/security surface; the spec misses that login and password reset run it in lenient fail-open mode.
- Public non-API pages also bypass RLS with service-role reads: `src/app/l/[slug]/page.tsx` and `src/lib/bookings.ts`.
- Page-level authorization is broader than the spec suggests: many pages gate inline with `getCurrentUser()` rather than `requireAuth()` / `requireAdmin()`.
- Service-role helper surfaces the spec does not discuss include `src/lib/bookings.ts`, `src/lib/all-bookings.ts`, `src/lib/customers.ts`, `src/lib/events.ts`, and planning helpers.
- Newer auth/RLS migrations are omitted from the narrative: `20260321000001_fix_event_update_rls.sql`, `20260410120002_tighten_event_bookings_rls.sql`, `20260410120003_venue_manager_event_visibility.sql`, `20260414130000_remove_anon_booking_insert.sql`, `20260414130001_harden_create_booking_rpc.sql`.

**Recent Commits That May Post-Date The Spec**
- `6086ce9` on April 14, 2026 at 16:13 BST: invite-system fixes in `src/actions/users.ts`.
- `54cb3ed` on April 14, 2026 at 11:22 BST: added `strict-dynamic` to CSP in `middleware.ts`.
- `24092ee` on April 14, 2026 at 11:18 BST: hardened public booking flow and Turnstile behavior.
- Because the spec only records a date, not a timestamp, these same-day commits may be newer than the document.

**Severity And Fix Soundness**
- `3.1` being `High` is defensible, but the scope is too narrow: it should include other public API routes and the public landing-page service-role read.
- `5.1` should not remain `High` as written; it is a medium-severity partial-coverage problem, not a total absence of mutation audit logging.
- `2.1` should be narrowed and downgraded; role changes are already logged, just without enough metadata.
- `2.3` / `4.3` should be retired or rewritten around write-side scoping; the proposed read-side RLS fix targets a problem already addressed.
- `5.4` should be reframed as missing integration/e2e coverage, not “no automated auth regression tests”.
- `2.2`’s proposed fix is incomplete; revoke from `PUBLIC` as well, not only `anon`.
- `1.3`’s proposed middleware update is directionally sound, but a fire-and-forget write on every request will add constant DB churn unless it is throttled or batched.