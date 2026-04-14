# Adversarial Review: Idle Timeout Removal

**Date:** 2026-04-10
**Mode:** Code Review (Mode B)
**Engines:** Claude + Codex (full dual-engine)
**Scope:** Removal of auto-sign-out/idle-timeout functionality
**Reviewers:** Repo Reality Mapper, Assumption Breaker, Security & Data Risk, Workflow & Failure-Path, Integration & Architecture

## Inspection Inventory

### Inspected
- All modified files in current state: `middleware.ts`, `src/lib/auth/session.ts`, `src/app/layout.tsx`, `src/lib/auth/__tests__/session.test.ts`
- Confirmed deleted files: `src/hooks/use-idle-timeout.ts`, `src/components/shell/idle-timeout-provider.tsx`, `src/app/api/auth/heartbeat/route.ts`
- Session lifecycle consumers: `src/actions/auth.ts`, `src/actions/users.ts`
- Auth infrastructure: `src/lib/auth.ts`, `src/lib/audit-log.ts`, `src/lib/supabase/admin.ts`
- Login page: `src/app/login/page.tsx`
- Cron cleanup: `src/app/api/cron/cleanup-auth/route.ts`
- Shell components: `src/components/shell/app-shell.tsx`
- Database schema: `supabase/migrations/20260311100000_auth_session_tables.sql`
- Audit tests: `src/lib/auth/__tests__/audit.test.ts`
- CLAUDE.md (project + workspace)

### Not Inspected
- Supabase RLS policies (not accessible from code review)
- Vercel Cron schedule configuration
- Production database state

### Limited Visibility Warnings
- The redirect-loop finding (CROSS-001) is inferred from code reading, not runtime-tested
- The password-reset orphaned-session finding (CROSS-003) is a pre-existing issue, not introduced by this change

## Executive Summary

The idle timeout removal is structurally clean — no dangling imports, no broken exports, no runtime errors. However, the review surfaced **one high-severity workflow issue** (potential redirect loop when custom session expires but Supabase JWT survives), several pieces of **dead surface area** that should be cleaned up (idle UI, audit events, comments, schema), and a **security policy consideration** (24hr-only sessions on shared computers) that needs product sign-off rather than code changes.

## What Appears Solid

- **File deletions are complete.** All three deleted files confirmed absent from disk.
- **No dangling runtime references.** No live `src/` code references `renewSession`, `IDLE_TIMEOUT_MS`, `useIdleTimeout`, `IdleTimeoutProvider`, or `/api/auth/heartbeat`.
- **Middleware flow is coherent.** Import list is clean, session validation path works, session-fixation check intact.
- **Layout change is clean.** `AppShell` renders correctly without the `IdleTimeoutProvider` wrapper.
- **Test imports are correct.** All remaining tests reference real exports only.
- **Session creation, validation, destruction, and cron cleanup all function correctly** for the new absolute-expiry-only model.
- **Session fixation protections intact.** `session.userId === user.id` check preserved.
- **Heartbeat removal is net-positive security.** Removes an unauthenticated-session-renewal surface.

## Critical Risks

None. No auth bypass, no data loss, no breaking runtime errors.

## Implementation Defects

### CROSS-001: Potential redirect loop when custom session expires but Supabase JWT survives
- **ID:** CROSS-001
- **Type:** Strongly suspected defect (pre-existing, not introduced by this change)
- **Severity:** High
- **Confidence:** Medium
- **Evidence:** `middleware.ts:216-241` redirects to `/login` with `reason=session_expired` but does NOT sign out Supabase. `src/app/login/page.tsx:41` redirects authenticated Supabase users away from login immediately. If the Supabase JWT outlives the 24hr custom session, the user bounces between middleware and login.
- **Engines that flagged:** Codex (Security, Workflow, Integration — all three independently)
- **Why it may be wrong:** The Supabase JWT and custom session cookie both have 24hr lifetimes, so they likely expire together. The loop would only occur if Supabase's refresh token extends the JWT beyond the custom session's `expires_at`.
- **What would confirm it:** Manual test — log in, wait 24hrs (or manipulate `expires_at` in DB), attempt navigation.
- **Blocking or advisory:** Advisory (pre-existing issue, not introduced by this change)
- **Action owner:** Follow-up investigation

### CROSS-002: Dead idle-timeout surface area across multiple files
- **ID:** CROSS-002
- **Type:** Confirmed defect (incomplete cleanup)
- **Severity:** Low
- **Confidence:** High
- **Evidence:**
  - `src/app/login/page.tsx:62` — renders "signed out due to inactivity" banner for `reason=idle`, but no code path produces this reason anymore
  - `src/lib/audit-log.ts:53` — `auth.session.expired.idle` still in the event type union
  - `src/lib/auth/__tests__/audit.test.ts:184` — test exercises the dead idle audit event
  - `src/app/api/cron/cleanup-auth/route.ts:8` — comment says "expired and idle" but only absolute expiry is cleaned
  - `supabase/migrations/20260311100000_auth_session_tables.sql:38` — `cleanup_auth_records()` DB function still performs idle cleanup (30min cutoff)
- **Engines that flagged:** Codex (all 4 reviewers)
- **Blocking or advisory:** Advisory (no runtime impact, but creates maintenance confusion and false sense of security)
- **Action owner:** Implementation change

### CROSS-003: Password reset creates orphaned app session
- **ID:** CROSS-003
- **Type:** Confirmed defect (pre-existing)
- **Severity:** Low
- **Confidence:** High
- **Evidence:** `src/actions/auth.ts:311-348` — `completePasswordResetAction` destroys all sessions, creates a replacement app session, sets the cookie, then signs Supabase out. Leaves an orphaned `app_sessions` row until next login or cron cleanup.
- **Engines that flagged:** Codex (Workflow, Integration)
- **Why it may be wrong:** The orphaned row is cleaned up by cron and doesn't grant access without a valid JWT. Consumes one of 5 session slots temporarily.
- **Blocking or advisory:** Advisory (pre-existing, not introduced by this change)

## Security & Data Risks

### SEC-001: 24hr-only sessions on shared/public computers
- **ID:** SEC-001
- **Type:** Needs human product decision
- **Severity:** High (if shared computers are in scope)
- **Confidence:** High
- **Evidence:** Sessions now persist for the full 24hr window regardless of user activity. On an unlocked shared machine, the next person can use the previous user's session.
- **Engines that flagged:** Codex (Security)
- **Action owner:** Human decision — is this acceptable for the product's use case?
- **Blocking or advisory:** Advisory (requires product/security sign-off, not a code defect)

## Unproven Assumptions

1. **"24hr absolute-only is sufficient security"** — This is a product/security policy decision, not verifiable from code. If shared-computer scenarios are in scope, compensating controls may be needed.
2. **"Supabase JWT and custom session expire together"** — Likely true (both set to 24hr), but Supabase token refresh could extend the JWT beyond the custom session. Needs testing.

## Recommended Fix Order

1. **Clean up dead idle surface area (CROSS-002)** — Low effort, eliminates maintenance confusion
   - Remove `reason=idle` banner from login page
   - Remove `auth.session.expired.idle` from audit event union (or keep for historical audit log compatibility)
   - Update cron route comment
   - Consider removing `cleanup_auth_records()` DB function's idle logic in a migration
2. **Get product sign-off on SEC-001** — 24hr-only sessions without idle timeout
3. **Investigate CROSS-001** — Test whether Supabase JWT can outlive custom session and cause redirect loop (pre-existing issue)

## Follow-Up Review Required

- [ ] CROSS-001: Re-review redirect-loop risk after testing JWT/session lifetime alignment
- [ ] SEC-001: Re-review after product decision on shared-computer policy
