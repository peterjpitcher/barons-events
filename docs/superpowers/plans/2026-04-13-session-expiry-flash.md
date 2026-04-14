# Session Expiry Flash Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the redirect loop and stale-UI flash that occurs when a user's 24h app-session expires while Supabase auth remains valid.

**Architecture:** Four surgical changes: (1) middleware signs out Supabase on app-session failure to break the redirect loop, (2) login page handles all session-expiry reason codes, (3) a lightweight `/api/auth/session-check` endpoint validates both session layers, (4) a `SessionMonitor` client component checks on tab refocus and redirects with a subtle overlay. No new dependencies.

**Tech Stack:** Next.js 16.1, React 19.1, TypeScript strict, Supabase SSR, Vitest

**Spec:** `tasks/session-expiry-flash/spec.md` (v2)

---

## Context

After 24h of inactivity, the custom `app-session-id` expires but Supabase's refresh token can keep the JWT alive. This creates a redirect loop: middleware rejects the request and sends the user to `/login`, but the login page sees a valid Supabase user and bounces back. The adversarial review (5 Codex reviewers) confirmed this as the primary bug and identified 6 additional issues. See `tasks/codex-qa-review/2026-04-13-session-expiry-flash-spec-adversarial-review.md`.

**Decisions made:**
- Loop fix: Sign out Supabase in middleware on app-session failure (user re-enters credentials)
- Tab-refocus UX: Subtle overlay while checking session validity

---

## File Map

| Status | File | Purpose |
|--------|------|---------|
| MODIFY | `middleware.ts` | Sign out Supabase on app-session failure + add `redirectedFrom` to all branches |
| MODIFY | `src/app/login/page.tsx` | Handle all reason codes + fix `sanitizeRedirect` backslash |
| MODIFY | `src/actions/auth.ts` | Fix `signInAction` redirect sanitisation backslash |
| CREATE | `src/app/api/auth/session-check/route.ts` | Lightweight dual-layer session validity endpoint |
| CREATE | `src/components/shell/session-monitor.tsx` | Client-side tab-refocus session checker with overlay |
| MODIFY | `src/components/shell/app-shell.tsx` | Wire in SessionMonitor |
| CREATE | `src/lib/__tests__/sanitize-redirect.test.ts` | Tests for redirect sanitisation |
| CREATE | `src/app/api/auth/session-check/__tests__/route.test.ts` | Tests for session-check endpoint |
| CREATE | `src/components/shell/__tests__/session-monitor.test.tsx` | Tests for SessionMonitor |

---

See full plan at `.claude/plans/soft-jumping-stonebraker.md`
