# Claude Hand-Off Brief: Idle Timeout Removal

**Generated:** 2026-04-10
**Review mode:** Code Review (Mode B)
**Overall risk assessment:** Low (no blocking defects, advisory items only)

## DO NOT REWRITE
- `middleware.ts` — session validation flow is correct and clean
- `src/lib/auth/session.ts` — `validateSession()` and `cleanupExpiredSessions()` are correctly simplified
- `src/app/layout.tsx` — `AppShell` renders correctly without `IdleTimeoutProvider`
- `src/lib/auth/__tests__/session.test.ts` — test structure and imports are correct
- Session creation, destruction, lockout, and cron cleanup — all functioning correctly
- Session fixation protection (`session.userId === user.id`) — intact

## SPEC REVISION REQUIRED

None. This was a feature removal, not a spec-driven change.

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-001:** Remove the `reason=idle` banner from `src/app/login/page.tsx:62` — this UI is now unreachable. Optionally add a banner for `reason=session_expired` so users know why they were redirected.
- [ ] **IMPL-002:** Update the comment in `src/app/api/cron/cleanup-auth/route.ts:8` — change "expired and idle app_sessions" to "expired app_sessions" to match current behaviour.
- [ ] **IMPL-003 (optional):** Remove `auth.session.expired.idle` from the audit event type union in `src/lib/audit-log.ts:53`. Note: keeping it is acceptable for historical audit log compatibility — it just won't be emitted anymore.
- [ ] **IMPL-004 (optional):** Remove the `cleanup_auth_records()` DB function's idle-timeout logic via a new migration, since the app layer no longer enforces idle expiry. Only if this function is not called by any DB trigger or external system.

## ASSUMPTIONS TO RESOLVE

- [ ] **ASSUMPTION-1:** Are shared/public computers a use case for BaronsHub? If yes, 24hr-only sessions without idle timeout may need compensating controls (shorter expiry, session cookies without `maxAge`, or step-up re-auth). → Ask: product owner
- [ ] **ASSUMPTION-2:** Can the Supabase JWT refresh token extend the JWT beyond the custom session's 24hr `expires_at`? If yes, this could cause a redirect loop at session expiry. → Test: manipulate `expires_at` in DB and attempt navigation.

## REPO CONVENTIONS TO PRESERVE

- Server actions must re-verify auth server-side (already preserved)
- All mutations must call `logAuditEvent()` (already preserved)
- `snake_case` DB columns, `camelCase` TypeScript types (already preserved)
- Conventional commits for the eventual commit message

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] IMPL-001: Verify login page renders correctly after removing idle banner
- [ ] IMPL-002: Verify cron route comment accuracy

## REVISION PROMPT

You are cleaning up residual idle-timeout references after the main removal.

Apply these changes in order:

1. In `src/app/login/page.tsx`: remove the `reason=idle` banner UI. Optionally add handling for `reason=session_expired` to show "Your session has expired. Please sign in again."
2. In `src/app/api/cron/cleanup-auth/route.ts`: update the JSDoc comment from "expired and idle app_sessions" to "expired app_sessions".
3. Preserve all other files — they are correct as-is.

After applying changes, confirm:
- [ ] Login page no longer references idle timeout
- [ ] Cron route comment matches implementation
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
