# Adversarial Review: Turnstile CAPTCHA React Fix

**Date:** 2026-04-15
**Mode:** Code Review (Mode B) with adversarial framing
**Engines:** Claude + Codex (4 reviewers deployed; 3 completed, 1 timed out)
**Scope:** Turnstile widget replacement across login, forgot-password, and booking forms
**Spec:** N/A (bug fix, not feature implementation)

## Inspection Inventory

### Inspected
- All 8 changed files (git diff)
- `src/lib/turnstile.ts` — server-side verification
- `src/actions/auth.ts` — login + password reset turnstile checks
- `src/actions/bookings.ts` — booking turnstile check
- `middleware.ts` — CSP headers (script-src, frame-src, connect-src)
- `node_modules/@marsidev/react-turnstile/dist/index.js` — library internals
- `node_modules/@marsidev/react-turnstile/dist/index.d.ts` — type definitions
- `src/app/layout.tsx` — nonce usage in root layout
- All Turnstile-related test files (6 files)
- `package.json` + `package-lock.json` — dependency addition

### Not Inspected
- Live browser/runtime behaviour (CSP enforcement, widget rendering)
- Cloudflare Turnstile dashboard configuration (sitekey/domain bindings)
- Vercel production logs for the original "Security check failed" errors

### Limited Visibility Warnings
- CSP `strict-dynamic` trust propagation is confirmed by spec but unverified at runtime in this repo's production environment
- The root cause of the original bug has not been definitively proven — multiple causes are plausible

## Executive Summary

The fix correctly replaces a fragile implicit Turnstile rendering pattern with a React-lifecycle-aware component. The `@marsidev/react-turnstile` library properly handles re-renders, token expiry, and script injection. After Codex review, the nonce was restored (belt-and-suspenders for CSP), diagnostic logging was added to `verifyTurnstile`, and dead code was cleaned up. The fix materially improves reliability but cannot guarantee it addresses the sole root cause — server-side logging will help diagnose if the issue recurs.

## What Appears Solid

- **Hidden input placement**: Confirmed by both engines. The library renders the response field inside the widget container, which is inside the `<form>`. Both `FormData` (login/forgot-password) and `querySelector` (booking) will find it.
- **Token auto-refresh**: `refreshExpired: "auto"` properly refreshes expired tokens on already-mounted widgets.
- **CSP compatibility**: `strict-dynamic` propagates trust from nonced Next.js scripts to dynamically injected Turnstile script. URL allowlist `https://challenges.cloudflare.com` serves as CSP Level 2 fallback. Nonce also passed explicitly for defence-in-depth.
- **Server-side contract unchanged**: `verifyTurnstile()` still reads `cf-turnstile-response` and validates via Cloudflare siteverify. No server-side changes needed for the widget swap.
- **Security posture maintained**: No new attack surfaces. Token replay delegated to Cloudflare (single-use). Strict mode fail-closed behaviour preserved.
- **Supply chain**: `@marsidev/react-turnstile@1.5.0` locked with integrity hash in lockfile.

## Critical Risks

None identified post-correction. The nonce restoration addressed the highest-confidence finding.

## Spec Defects

N/A — no spec document for this bug fix.

## Implementation Defects

### ID: AB-001 — Root cause not definitively proven
- **Type:** Plausible but unverified
- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:** The Assumption Breaker identified that "Security check failed" can be triggered by: (1) widget not rendering (old pattern), (2) missing `TURNSTILE_SECRET_KEY` in production, (3) Cloudflare siteverify API failure, (4) token expiry, (5) CSP blocking the script. The fix addresses (1) and (4) but not (2), (3), or (5).
- **Mitigation applied:** Added diagnostic logging to `verifyTurnstile` with action name, error codes, and HTTP status. This will show the exact failure reason in Vercel logs if the bug recurs.
- **Status:** MITIGATED — monitor production logs.

### ID: AB-002 — Widget unmount/remount loses token (addressed by library)
- **Type:** Plausible but unverified
- **Severity:** Low
- **Confidence:** Medium
- **Evidence:** The library calls `turnstile.remove()` on unmount and `turnstile.render()` on remount. This is dramatically better than the old pattern (which never re-rendered), but a brief window exists where the token is absent. `refreshExpired: "auto"` only helps an already-mounted widget.
- **Impact:** Unlikely in normal usage — React re-renders don't unmount/remount unless the component's key or parent tree changes.
- **Status:** ACCEPTABLE RISK.

## Architecture & Integration Defects

None identified.

## Security & Data Risks

### ID: SEC-001 — Supply chain addition (Low)
- **Type:** Strongly suspected (inherent, not a defect)
- **Severity:** Low
- **Evidence:** Adding `@marsidev/react-turnstile` creates a new trust boundary. The package auto-injects a script from `challenges.cloudflare.com`. Both the npm package and the Cloudflare-hosted script are trusted third parties.
- **Mitigation:** Lockfile integrity hash. Package is widely used (~170k weekly downloads).

### ID: SEC-002 — Hostname validation missing in verifyTurnstile
- **Type:** Hardening gap (pre-existing, not introduced by this fix)
- **Severity:** Low
- **Evidence:** `verifyTurnstile` checks `action` but not `hostname`. Cloudflare recommends validating both.
- **Status:** ADVISORY — not blocking for this fix.

## Recommended Fix Order

All fixes have been applied in this iteration:
1. Replaced implicit Turnstile with `@marsidev/react-turnstile` (React lifecycle fix)
2. Restored CSP nonce passthrough (belt-and-suspenders)
3. Added diagnostic logging to `verifyTurnstile` (root cause visibility)
4. Dead nonce code in `src/app/l/[slug]/page.tsx` is now used again

## Follow-Up Review Required

- [ ] **AB-001**: Monitor Vercel production logs after deployment for `[turnstile]` log entries. If "Security check failed" recurs, the logs will show whether it's token-missing, API-failure, or secret-missing.
- [ ] **Runtime CSP test**: Verify in production browser devtools that no CSP violations are logged on login/forgot-password/booking pages.
