# Auth Audit Brief — BARONS-BaronsHub

## Objective
Audit the BaronsHub application against the workspace auth standard (`/Users/peterpitcher/Cursor/.claude/rules/auth-standard.md`). Identify every gap, deviation, and missing requirement. This is a discovery-only phase — produce a full findings report, not fixes.

## Auth Standard Location
`/Users/peterpitcher/Cursor/.claude/rules/auth-standard.md`

## Project Root
`/Users/peterpitcher/Cursor/BARONS-BaronsHub`

## Key Files (from recon)

### Auth-Critical (read in full)
- `middleware.ts` — session refresh, public paths, security headers, auth gate
- `src/actions/auth.ts` — signIn, signOut, requestPasswordReset, completePasswordReset
- `src/actions/users.ts` — inviteUser, updateUser (role changes)
- `src/lib/auth.ts` — getSession(), getCurrentUser()
- `src/lib/supabase/server.ts` — all three client factories (readonly, action, service role)
- `src/lib/roles.ts` — RBAC capability model
- `src/lib/audit-log.ts` — audit logging implementation
- `src/lib/users.ts` — listUsers, updateUser (DB layer)
- `src/lib/notifications.ts` — email dispatch (password reset email)
- `src/app/login/login-form.tsx` — sign-in form
- `src/app/login/page.tsx`
- `src/app/forgot-password/page.tsx`
- `src/app/forgot-password/forgot-password-form.tsx`
- `src/app/reset-password/page.tsx`
- `src/app/reset-password/reset-password-card.tsx`
- `src/app/layout.tsx` — root layout (idle timeout hook would live here)
- `src/lib/validation.ts` — password validation schema (if any)

### Supporting (read when tracing flows)
- `src/app/users/page.tsx` — user management UI
- `src/components/users/users-manager.tsx`
- `src/lib/public-api/auth.ts` — API key validation
- Any files checking `getCurrentUser()` or role in server actions/pages

### Peripheral (scan for hardcoded values, role strings, auth references)
- All other `src/actions/*.ts` files
- All `src/app/*/page.tsx` files

## Known Issues (from initial recon — confirm and detail)
1. **Middleware uses `getSession()` not `getUser()`** — trusts local cookie without server revalidation
2. **No security headers** in middleware (no CSP, HSTS, X-Frame-Options, etc.)
3. **No CSRF protection** — no token generation, no mutation validation
4. **No custom session layer** — no Redis, no app-session-id, no idle/absolute timeout, no revocation
5. **No account lockout** — no failed attempt tracking
6. **No rate limiting** on auth endpoints
7. **No CAPTCHA** on sign-in or forgot-password
8. **Role model mismatch** — app uses venue_manager/reviewer/central_planner/executive; standard mandates admin/editor/viewer
9. **Missing required auth helpers** — no requireAuth(), requireAdmin(), withAuth(), withAdminAuth()
10. **No browser Supabase client** — no src/lib/supabase/client.ts
11. **No PKCE flow configured** on any client
12. **Auth audit logging absent** — audit_log only covers entity="event"
13. **Password policy too weak** — 8 char min, no complexity, no HIBP check
14. **No idle timeout UX** — no useIdleTimeout() hook, no heartbeat endpoint
15. **No branded email templates** documented
16. **Invite atomicity gap** — if DB upsert fails after invite API succeeds, half-created user left in auth
17. **Role stored in users DB table** not in `app_metadata`
18. **Service role client not marked server-only** and in wrong file location

## Business Rules
- Invite-only system (no public sign-up)
- Four custom roles: venue_manager, reviewer, central_planner, executive
- Only central_planner can manage users and settings
- Events go through draft → published → completed workflow
- Auth-standard.md is the binding compliance document

## What Agents Must NOT Do
- Propose fixes or code changes
- Skip the partial-failure path analysis
- Treat any item as "probably fine" without verifying in code
