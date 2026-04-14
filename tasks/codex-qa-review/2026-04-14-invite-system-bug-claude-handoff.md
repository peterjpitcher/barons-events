# Claude Hand-Off Brief: Invite System Bug Fixes

**Generated:** 2026-04-14
**Review mode:** Adversarial Challenge (Mode A)
**Overall risk assessment:** Critical

## DO NOT REWRITE
- InviteUserForm structure (standalone form, useActionState binding) — working correctly
- Server action auth checks (getCurrentUser + role guard) — sound
- Supabase admin client setup — correct
- Middleware public path configuration for /auth/confirm and /reset-password — correct
- invite.test.ts test structure — good mock pattern, just needs more test cases
- Rate limit handling for generateLink 429 — correct
- Audit logging event names and structure — correct

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **FIX-1 (Critical):** src/actions/users.ts:160-177 — Guard against null action_link. If `actionLink` is null after a successful `generateLink`, return `{ success: false, message: "Invitation could not be sent. Please try again." }` instead of falling through to success. Move the success return inside the `if (actionLink)` block or add an explicit `else` that returns failure.

- [ ] **FIX-2 (Critical):** src/components/users/users-manager.tsx — Move ResendInviteButton OUTSIDE the update `<form>` in both UserDesktopRow (line ~306) and UserCardMobile (line ~212). Place it as a sibling element after the form closes, not inside it. Preserve the visual layout with wrapper divs as needed.

- [ ] **FIX-3 (High):** src/actions/users.ts:168-187 — Move audit logging (hashEmailForAudit + logAuthEvent) OUTSIDE the try/catch that triggers auth user deletion on failure. The audit code should not be able to trigger rollback of a successfully created invite. Restructure as: try { upsert + email } catch { rollback }, then audit logging separately with its own try/catch.

- [ ] **FIX-4 (High):** src/actions/users.ts:146-165 — Restructure invite flow so that if email send fails, the auth user is also cleaned up (same rollback as upsert failure). Currently: auth user + DB row persist after email failure, creating orphaned pending users.

- [ ] **FIX-5 (High):** src/actions/users.ts:210-264 — In resendInviteAction, look up the user's email from the auth record (authData.user.email) instead of trusting the client-supplied email from hidden form inputs. Use the server-side email for generateLink and sendInviteEmail. The fullName can optionally be looked up from the users table too.

- [ ] **FIX-6 (Medium):** src/lib/notifications.ts:386 — Remove the pre-escaping of fullName. Change `const greeting = fullName ? \`Hi ${escapeHtml(fullName)},\` : "Hi there,";` to `const greeting = fullName ? \`Hi ${fullName},\` : "Hi there,";` — renderEmailTemplate already escapes the full intro string. This aligns with the pattern used by buildGreeting() elsewhere in the file.

- [ ] **FIX-7 (Medium):** src/components/users/users-manager.tsx:60-69 — Add FieldError components for fullName and venueId in InviteUserForm, matching the pattern used for email and role.

- [ ] **FIX-8 (Medium):** src/app/auth/confirm/route.ts:62-66 — When the code exchange succeeds but `type` is null, default to redirecting to `/reset-password` for safety (or at minimum, check if the user has an app-session before sending them to `/`). Currently falls through to `/${nextPath}` which hits middleware's session check and fails.

- [ ] **FIX-9 (Low):** src/app/login/page.tsx — Display user-friendly messages for `?error=invalid_token`, `?error=missing_token`, and `?error=server_error` query params, matching the existing pattern for `?reason=*` params.

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1:** What does `resolveAppUrl()` return in production? Check Vercel env var `NEXT_PUBLIC_SITE_URL`. If it returns a Vercel preview URL instead of the production domain, all invite links redirect to the wrong place. → Check: `vercel env ls` or Vercel dashboard.

- [ ] **ASM-2:** Is the Resend domain `baronshub.orangejelly.co.uk` verified? If not, emails may be silently rejected. → Check: Resend dashboard.

- [ ] **ASM-3:** Is `https://baronshub.orangejelly.co.uk/auth/confirm` (or whatever resolveAppUrl returns) in the Supabase Redirect URLs allowlist? If not, Supabase may strip the redirect after token verification. → Check: Supabase dashboard → Authentication → URL Configuration.

- [ ] **ASM-4:** Does Supabase's `generateLink({ type: "invite" })` ever return a userId without an action_link in the current version? The silent success bug (FIX-1) is real defensive coding regardless, but confirming this happens would explain the symptom. → Check: Supabase JS client version and docs.

## REPO CONVENTIONS TO PRESERVE

- Server actions return `Promise<ActionResult>` with `{ success, message, fieldErrors? }`
- All mutations log audit events via `logAuthEvent()`
- Use `createSupabaseAdminClient()` for admin operations (never anon client)
- Forms use `useActionState` + `useEffect` for toast notifications
- Field errors displayed via `<FieldError>` component
- Email sending uses `sendInviteEmail()` → Resend SDK, with null-check on `getResendClient()`

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CR-1/FIX-1: Re-verify that null action_link now returns failure instead of success
- [ ] CR-2/FIX-2: Browser-test resend button on both SSR and client-navigated /users page
- [ ] FIX-3: Verify audit logging failure no longer triggers auth user deletion
- [ ] FIX-5: Verify resendInviteAction uses server-looked-up email, not client input
- [ ] Add test cases to invite.test.ts for: null action_link, email send failure with rollback

## REVISION PROMPT

You are fixing the invite system based on an adversarial review (3 Codex reviewers + Claude analysis).

Apply these changes in order:

1. **FIX-1** (src/actions/users.ts) — After line 139, add an explicit check: if actionLink is null, return failure. Do NOT let the function fall through to the success path without an email being sent.

2. **FIX-2** (src/components/users/users-manager.tsx) — In UserDesktopRow and UserCardMobile, move the ResendInviteButton rendering OUTSIDE the `<form action={formAction}>` element. It must be a sibling, not a child. Maintain the visual layout.

3. **FIX-3** (src/actions/users.ts) — Restructure inviteUserAction so that audit logging (lines 168-174) is NOT inside the try/catch that triggers deleteUser rollback (lines 178-186). Wrap audit in its own try/catch after the main success path.

4. **FIX-4** (src/actions/users.ts) — If sendInviteEmail returns false, roll back the auth user (deleteUser) the same way upsert failure does, so orphaned pending users don't accumulate.

5. **FIX-5** (src/actions/users.ts) — In resendInviteAction, after getUserById succeeds, use authData.user.email instead of the client-supplied email for generateLink and sendInviteEmail.

6. **FIX-6** (src/lib/notifications.ts) — Remove escapeHtml from the greeting in sendInviteEmail. renderEmailTemplate already escapes.

7. **FIX-7** (src/components/users/users-manager.tsx) — Add FieldError for fullName and venueId in InviteUserForm.

8. **FIX-8** (src/app/auth/confirm/route.ts) — Default to /reset-password when code exchange succeeds but type is null.

9. **FIX-9** (src/app/login/page.tsx) — Add error param display for invalid_token, missing_token, server_error.

Preserve these decisions: InviteUserForm structure, auth checks, admin client usage, test mock pattern, rate limit handling.

Verify these assumptions before proceeding: ASM-1 (production NEXT_PUBLIC_SITE_URL), ASM-2 (Resend domain), ASM-3 (Supabase redirect URLs), ASM-4 (generateLink behaviour).

After applying changes, confirm:
- [ ] All implementation changes applied
- [ ] No sound decisions were overwritten
- [ ] invite.test.ts updated with new test cases for null action_link and email failure rollback
- [ ] Assumptions flagged for human review
