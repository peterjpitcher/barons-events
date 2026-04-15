# Claude Hand-Off Brief: Turnstile CAPTCHA React Fix

**Generated:** 2026-04-15
**Review mode:** Code Review (Mode B)
**Overall risk assessment:** Low (post-correction)

## DO NOT REWRITE
- `src/lib/turnstile.ts` — server-side verification logic is correct; only logging was added
- `src/actions/auth.ts` — Turnstile integration in login/password-reset actions is sound
- `src/actions/bookings.ts` — Turnstile integration in booking action is sound
- `middleware.ts` — CSP headers are correctly configured for Turnstile
- The decision to use `strict` mode for all three flows is appropriate

## SPEC REVISION REQUIRED

N/A — this is a bug fix, not a spec-driven feature.

## IMPLEMENTATION CHANGES REQUIRED

All changes have been applied:

- [x] IMPL-1: `src/components/turnstile-widget.tsx` — Created shared React Turnstile component with nonce passthrough
- [x] IMPL-2: `src/app/forgot-password/forgot-password-form.tsx` — Replaced implicit rendering with TurnstileWidget
- [x] IMPL-3: `src/app/login/login-form.tsx` — Replaced implicit rendering with TurnstileWidget
- [x] IMPL-4: `src/app/l/[slug]/BookingForm.tsx` — Replaced implicit rendering with TurnstileWidget
- [x] IMPL-5: All three pages pass CSP nonce through to TurnstileWidget
- [x] IMPL-6: `src/lib/turnstile.ts` — Added diagnostic logging with action name and error codes

## ASSUMPTIONS TO RESOLVE

- [x] ASSUMPTION-1: `strict-dynamic` propagates trust to dynamically injected Turnstile script → **Confirmed** by Security Reviewer. CSP spec + URL allowlist fallback covers this. Nonce also passed explicitly.
- [x] ASSUMPTION-2: Hidden input renders inside form → **Confirmed** by both engines. Library adds `cf-turnstile-response` inside the widget container div.
- [ ] ASSUMPTION-3: The original bug was caused by the implicit rendering pattern → **Unproven**. Diagnostic logging added so production logs will reveal the actual cause if bug recurs. → Monitor Vercel logs after deploy.

## REPO CONVENTIONS TO PRESERVE

- All Turnstile verification uses `strict` mode (fail-closed)
- CSP nonce generated per-request in middleware and forwarded via `x-nonce` header
- Server actions always re-verify Turnstile server-side (never trust client alone)
- `cf-turnstile-response` is the standard hidden input name

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] AB-001: Monitor production Vercel logs for `[turnstile]` entries after deployment
- [ ] Runtime: Open login + forgot-password + booking pages in Chrome DevTools and check Console for CSP violations

## REVISION PROMPT

All revisions have been applied. No further automated changes needed.

Post-deployment checklist:
1. Deploy to Vercel preview
2. Open `/login` in Chrome DevTools → Console → filter for CSP violations
3. Open `/forgot-password` → submit with invalid email → confirm Turnstile widget survives re-render
4. Open `/forgot-password` → submit with valid email → confirm redirect to success state
5. Open a booking page (`/l/[slug]`) → submit booking → confirm no "Security check failed"
6. Check Vercel Function logs for any `[turnstile]` error/warn entries
