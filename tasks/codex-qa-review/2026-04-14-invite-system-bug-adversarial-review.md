# Adversarial Review: Invite System Bug Investigation

**Date:** 2026-04-14
**Mode:** Adversarial Challenge (Mode A)
**Engines:** Claude + Codex (full adversarial — 3 Codex reviewers)
**Scope:** User invite and resend-invite flows across src/actions/users.ts, src/components/users/, src/lib/notifications.ts, src/app/auth/confirm/route.ts, middleware.ts
**Spec:** N/A (bug investigation)

## Inspection Inventory

### Inspected
- src/actions/users.ts (inviteUserAction, resendInviteAction, updateUserAction)
- src/components/users/users-manager.tsx (InviteUserForm, UserDesktopRow, UserCardMobile)
- src/components/users/resend-invite-button.tsx
- src/lib/notifications.ts (sendInviteEmail, renderEmailTemplate, escapeHtml)
- src/lib/app-url.ts (resolveAppUrl)
- src/app/auth/confirm/route.ts (token exchange)
- src/app/users/page.tsx (page-level auth + data fetching)
- src/lib/auth.ts (getCurrentUser)
- src/lib/auth/session.ts (session management)
- src/lib/users.ts (listUsersWithAuthData)
- src/lib/supabase/admin.ts (admin client)
- src/lib/supabase/server.ts (action client)
- src/lib/env.ts (env validation)
- src/lib/auth/__tests__/invite.test.ts (test coverage)
- middleware.ts (auth gate, public paths, CSP, CSRF)
- next.config.ts (server actions config)
- vercel.json (cron config)
- src/components/ui/submit-button.tsx

### Not Inspected
- Supabase dashboard settings (redirect URL allowlist, SMTP config, site URL)
- Resend dashboard (domain verification, API key status)
- Vercel environment variables (actual deployed values of NEXT_PUBLIC_SITE_URL, RESEND_API_KEY)
- Production server logs
- src/app/login/page.tsx (only referenced by Codex, not fully read by Claude)
- src/app/reset-password/ (password reset card/form UI)

### Limited Visibility Warnings
- Cannot confirm whether RESEND_API_KEY is valid in production or whether the Resend domain is verified
- Cannot confirm Supabase redirect URL allowlist includes the app's /auth/confirm
- Cannot confirm what resolveAppUrl() returns in production vs. local (.env.local shows barons-events.vercel.app)
- The Assumption Breaker noted React 19 hydration may recover nested forms client-side — browser testing required to confirm

## Executive Summary

The invite system has **multiple code-level bugs** that collectively explain both reported symptoms. The resend button is broken by nested HTML forms. New invites can silently succeed without sending email when Supabase returns no action_link. The invite acceptance flow has fragile redirect logic that can strand users. These are code bugs, not configuration issues.

## What Appears Solid

- **InviteUserForm structure** — standalone form, correct useActionState binding, proper Zod validation
- **Server action auth checks** — both actions verify getCurrentUser() and role === "central_planner"
- **Supabase admin client setup** — service-role client correctly configured with server-only guard
- **Middleware public paths** — /auth/confirm and /reset-password correctly whitelisted
- **Test coverage of happy path** — invite.test.ts covers core invite + resend flows with good mock structure
- **Audit logging** — both actions log auth events on success
- **Rate limit handling** — 429 from generateLink produces a specific user-friendly message
- **Atomicity on upsert failure** — if users table upsert fails, auth user is cleaned up

## Critical Risks

### CR-1: Silent success without email (inviteUserAction)
- **Type:** Confirmed defect
- **Severity:** Critical
- **Confidence:** High
- **Evidence:** Direct observation
- **Engines:** Codex (Assumption Breaker + Workflow)
- **File:** src/actions/users.ts:138-177
- **Description:** If `generateLink` returns a `userId` but no `action_link`, the email send is skipped (inside `if (actionLink)` at line 160), but the function falls through to audit logging and returns `{ success: true, message: "Invite sent." }` at line 177. The user record exists in both auth and public.users, the admin sees success, but no email was ever sent.
- **Why it matters:** This is the most likely explanation for "new invites aren't being sent out" — the admin sees "Invite sent" but the invitee never receives anything.
- **Blocking:** Yes

### CR-2: Nested form breaks resend button
- **Type:** Confirmed defect
- **Severity:** Critical
- **Confidence:** High (code-level), Medium (runtime behaviour — React hydration may partially recover)
- **Evidence:** Direct observation + Codex SSR verification
- **Engines:** Claude + Codex (all three reviewers)
- **Files:** src/components/users/users-manager.tsx:178,210,280,305 + src/components/users/resend-invite-button.tsx:34
- **Description:** ResendInviteButton renders a `<form>` inside the outer user-update `<form>` in both UserDesktopRow and UserCardMobile. Invalid HTML. On SSR-loaded pages, clicking "Resend invite" submits the outer updateUserAction form instead. The Assumption Breaker notes React 19 hydration may recreate separate forms client-side, but SSR and hard-refresh behaviour is definitively broken.
- **Why it matters:** Directly explains "resend invite link isn't working on /users."
- **Blocking:** Yes

## Implementation Defects

### ID-1: Non-atomic invite creation
- **Type:** Confirmed defect
- **Severity:** High
- **Confidence:** High
- **Files:** src/actions/users.ts:146-165
- **Description:** inviteUserAction creates the auth user and upserts public.users BEFORE attempting email send. If email fails, the records persist with no cleanup. The UI shows an error, but the form doesn't reset and the user already exists — retrying may hit "user already exists" from Supabase.
- **Blocking:** No (advisory — should fix alongside CR-1)

### ID-2: Post-email audit failure can delete auth user
- **Type:** Confirmed defect
- **Severity:** High
- **Confidence:** High
- **File:** src/actions/users.ts:168-187
- **Description:** The audit logging code (hashEmailForAudit + logAuthEvent) runs inside the same try/catch as the upsert. If either throws after the email has already been sent successfully, the catch block deletes the auth user — invalidating the invite link the user already received.
- **Blocking:** No (advisory — the audit functions are unlikely to throw, but the code structure is dangerous)

### ID-3: resendInviteAction trusts client-supplied email
- **Type:** Confirmed defect
- **Severity:** High
- **Confidence:** High
- **Engines:** Codex (Reality Mapper + Assumption Breaker + Workflow)
- **Files:** src/components/users/resend-invite-button.tsx:35-37, src/actions/users.ts:210-238
- **Description:** The action reads email and fullName from hidden form inputs. It checks confirmation status by userId via getUserById but never verifies the submitted email matches that auth user. A tampered request could send an invite to a different email address. Also a TOCTOU gap — no lock between the check and the generateLink call.
- **Blocking:** No (security advisory — should fix)

### ID-4: Double HTML escaping in sendInviteEmail
- **Type:** Confirmed defect
- **Severity:** Medium
- **Confidence:** High
- **Engines:** Claude + Codex (Assumption Breaker)
- **File:** src/lib/notifications.ts:386,46,188
- **Description:** escapeHtml(fullName) is called to build the greeting, then the whole intro string is escaped again in renderEmailTemplate. Names with & < > " ' are double-escaped in HTML. The Assumption Breaker also noted the plaintext version is affected because intro is reused raw in textParts. Other email functions use buildGreeting() which doesn't pre-escape — this is inconsistent.
- **Blocking:** No (cosmetic)

### ID-5: Invisible field errors on invite form
- **Type:** Confirmed defect
- **Severity:** Medium
- **Confidence:** High
- **Engine:** Codex (Workflow)
- **Files:** src/components/users/users-manager.tsx:60-69
- **Description:** The form only renders FieldError for email and role. If Zod validation fails on fullName or venueId, the effect suppresses the toast (because fieldErrors is defined) but no visible error is shown. The form appears to do nothing.
- **Blocking:** No (UX bug)

## Workflow & Failure-Path Defects

### WF-1: Auth confirm route redirect fragility
- **Type:** Confirmed defect
- **Severity:** High
- **Confidence:** Medium (depends on Supabase callback format)
- **Engine:** Codex (Assumption Breaker + Workflow)
- **File:** src/app/auth/confirm/route.ts:48-66
- **Description:** If the callback arrives as `code` without `type`, the route exchanges the code but falls through to redirect to `/` instead of `/reset-password`. Since /auth/confirm never creates an app-session-id, the middleware then sees a valid Supabase JWT but no app session and redirects to /login?reason=session_missing. The invite acceptance silently fails.
- **Blocking:** No (may not trigger with current Supabase config, but fragile)

### WF-2: Login page doesn't display auth/confirm errors
- **Type:** Confirmed defect
- **Severity:** Medium
- **Confidence:** High
- **Engine:** Codex (Workflow)
- **Files:** src/app/auth/confirm/route.ts:33-35,57-59, src/app/login/page.tsx
- **Description:** The auth confirm route redirects to /login with `?error=invalid_token|missing_token|server_error`, but the login page only handles `?reason=session_*` params. Failed invite acceptances produce a silent redirect to login with no user-facing message.
- **Blocking:** No (UX gap)

### WF-3: Orphaned user shows resend button
- **Type:** Plausible but unverified
- **Severity:** Medium
- **Confidence:** Medium
- **Engine:** Codex (Workflow)
- **File:** src/lib/users.ts:69-72
- **Description:** If a public.users row exists without a matching auth user (e.g., from a failed invite cleanup), listUsersWithAuthData treats it as Pending (emailConfirmedAt: null). The resend button appears but there may be no valid auth invite to resend — generateLink would create a new one, which may or may not work depending on Supabase state.
- **Blocking:** No

## Unproven Assumptions

1. **React 19 hydration recovery for nested forms** — The Assumption Breaker claims React may recover client-side after hydration mismatch. Needs browser testing. If true, the resend button might work on client-navigated pages but fail on hard refresh/SSR.
2. **resolveAppUrl() production value** — .env.local shows `barons-events.vercel.app`. If NEXT_PUBLIC_SITE_URL in production is wrong, all invite links redirect to the wrong domain. Needs Vercel env var check.
3. **Supabase action_link format** — The Workflow reviewer noted a potential mismatch between the raw Supabase verify URL and the token_hash flow that /auth/confirm expects. Needs integration testing or Supabase docs confirmation.
4. **Whether generateLink ever returns userId without action_link** — The silent success bug (CR-1) is real code, but we haven't confirmed this actually happens with the current Supabase version.

## Recommended Fix Order

1. **CR-1** — Fix silent success (guard against null action_link) — simplest, highest impact
2. **CR-2** — Fix nested form (move ResendInviteButton outside update forms)
3. **ID-2** — Move audit logging outside the try/catch that triggers rollback
4. **ID-1** — Restructure invite flow for better atomicity (email before DB, or proper rollback)
5. **ID-3** — Look up email by userId server-side instead of trusting client
6. **ID-4** — Fix double-escaping (use buildGreeting pattern or don't pre-escape)
7. **ID-5** — Add missing FieldError components for fullName/venueId
8. **WF-1** — Harden auth/confirm redirect logic
9. **WF-2** — Display error params on login page

## Follow-Up Review Required

- CR-1 and CR-2 fixes need re-review to confirm they resolve the user-reported symptoms
- WF-1 needs integration testing with actual Supabase invite flow to confirm callback format
- Verify NEXT_PUBLIC_SITE_URL in Vercel production env vars
- Verify Resend domain verification status
