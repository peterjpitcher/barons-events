# Claude Hand-Off Brief: Session Expiry Flash Implementation

**Generated:** 2026-04-13
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** Low (critical issue already repaired)

## DO NOT REWRITE
- Middleware dual-layer validation + signOut + cookie transfer (c419076)
- Login page reason code handling and sanitizeRedirect hardening
- session-check endpoint dual-layer validation logic
- SessionMonitor visibilitychange + pageshow listeners
- All existing test files

## SPEC REVISION REQUIRED
None — the spec is satisfied for the scope addressed.

## IMPLEMENTATION CHANGES REQUIRED (advisory, future PR)
- [ ] **ADV-FIX-1:** `src/components/shell/session-monitor.tsx` — Add a `useRef` guard to prevent concurrent session checks on rapid tab switching
- [ ] **ADV-FIX-2:** `src/app/api/auth/session-check/route.ts` — Consider using `createSupabaseActionClient` instead of manual `createServerClient` with no-op cookies, to properly persist token refreshes
- [ ] **ADV-FIX-3:** Standardise server action auth patterns across 11 action files (RC5, separate PR)

## ASSUMPTIONS TO RESOLVE
None remaining — all blocking assumptions resolved during implementation.

## RE-REVIEW REQUIRED AFTER FIXES
- [ ] ADV-FIX-1: Verify concurrent guard works with rapid tab switching
- [ ] ADV-FIX-2: Verify token refresh persistence doesn't create side effects
