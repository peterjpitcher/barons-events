# Auth Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all High and Medium severity gaps from the auth system audit spec, covering login hardening, public API RLS migration, cron auth, audit logging completion, error sanitisation, and the landing page metadata leak.

**Architecture:** Six independent work streams executed in priority order. Each stream produces independently deployable commits. Database migrations are sequenced to avoid conflicts. All changes use existing patterns (no new abstractions).

**Tech Stack:** Next.js 16, Supabase (PostgreSQL + RLS), TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-14-auth-system-audit-design.md`

---

## File Structure

### Files to Modify

| File | Changes |
|------|---------|
| `src/actions/auth.ts` | Differentiate service errors from auth failures (1.5), fix session teardown (1.6) |
| `src/lib/turnstile.ts` | No code change — document fail-open decision |
| `src/app/api/cron/cleanup-auth/route.ts` | Swap to `timingSafeEqual()` (3.4) |
| `src/app/api/cron/sms-reminders/route.ts` | Swap to `timingSafeEqual()` (3.4) |
| `src/app/api/cron/sms-post-event/route.ts` | Swap to `timingSafeEqual()` (3.4) |
| `src/app/api/cron/refresh-inspiration/route.ts` | Swap to `timingSafeEqual()` (3.4) |
| `src/app/api/v1/events/route.ts` | Remove service-role, use anon client (3.1) |
| `src/app/api/v1/events/[eventId]/route.ts` | Remove service-role, use anon client (3.1) |
| `src/app/api/v1/events/by-slug/[slug]/route.ts` | Remove service-role, use anon client (3.1) |
| `src/app/api/v1/event-types/route.ts` | Remove service-role, use anon client (3.1) |
| `src/app/api/v1/venues/route.ts` | Remove service-role, use anon client (3.1) |
| `src/app/api/v1/opening-times/route.ts` | Remove service-role, use anon client (3.1) |
| `src/app/l/[slug]/page.tsx` | Filter by status in query (3.5) |
| `src/lib/audit-log.ts` | Extend `RecordAuditParams` entity union (5.1) |
| `src/actions/artists.ts` | Add audit logging (5.1) |
| `src/actions/event-types.ts` | Add audit logging (5.1) |
| `src/actions/links.ts` | Add audit logging (5.1) |
| `src/actions/opening-hours.ts` | Add audit logging (5.1) |
| `src/actions/planning.ts` | Add audit logging (5.1) |
| `src/actions/venues.ts` | Add audit logging (5.1) |
| `src/actions/users.ts` | Enrich role change log with old values (2.1) |
| `src/actions/events.ts` | Add audit to saveEventDraftAction, updateBookingSettingsAction (5.1) |

### Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/YYYYMMDDHHMMSS_audit_log_immutability.sql` | Immutability trigger on audit_log (4.2) |
| `supabase/migrations/YYYYMMDDHHMMSS_users_sensitive_column_audit.sql` | Trigger for role/venue_id changes (4.5) |
| `supabase/migrations/YYYYMMDDHHMMSS_anon_events_rls.sql` | Anon RLS policy for public API (3.1) |
| `supabase/migrations/YYYYMMDDHHMMSS_venue_write_rls.sql` | Venue-scoped write RLS on events (2.3) |
| `supabase/migrations/YYYYMMDDHHMMSS_revoke_anon_current_user_role.sql` | Revoke anon from current_user_role() (2.2) |
| `src/lib/cron-auth.ts` | Shared constant-time cron auth helper (3.4) |

### Test Files to Create/Modify

| File | Tests |
|------|-------|
| `src/actions/__tests__/auth-login-errors.test.ts` | Service error vs auth failure differentiation |
| `src/actions/__tests__/auth-reset-teardown.test.ts` | Password reset session teardown error handling |
| `src/lib/__tests__/cron-auth.test.ts` | Constant-time cron auth helper |
| `src/actions/__tests__/audit-logging.test.ts` | Mutation audit coverage for 6 action files |

---

## Task 1: Fix Login — Differentiate Service Errors from Auth Failures (Gap 1.5)

**Files:**
- Modify: `src/actions/auth.ts:116-131`
- Create: `src/actions/__tests__/auth-login-errors.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/actions/__tests__/auth-login-errors.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn()
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn()
}));
vi.mock("@/lib/auth/session", () => ({
  createSession: vi.fn().mockResolvedValue("session-id"),
  destroyAllSessionsForUser: vi.fn(),
  clearLockoutForAllIps: vi.fn(),
  recordFailedLoginAttempt: vi.fn(),
  isLockedOut: vi.fn().mockResolvedValue(false),
  clearLockoutForIp: vi.fn(),
  makeSessionCookieOptions: vi.fn().mockReturnValue({}),
  SESSION_COOKIE_NAME: "app-session-id"
}));
vi.mock("@/lib/auth/password-policy", () => ({
  validatePassword: vi.fn().mockResolvedValue({ valid: true, errors: [] })
}));
vi.mock("@/lib/audit-log", () => ({
  logAuthEvent: vi.fn().mockResolvedValue(undefined),
  hashEmailForAudit: vi.fn().mockResolvedValue("hashed")
}));
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true)
}));
vi.mock("@/lib/notifications", () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true)
}));
vi.mock("@/lib/app-url", () => ({
  resolveAppUrl: vi.fn().mockReturnValue("http://localhost:3000")
}));
vi.mock("@/lib/form-errors", () => ({
  getFieldErrors: vi.fn().mockReturnValue({})
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn()
  }),
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue("127.0.0.1")
  })
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn()
}));

import { signInAction } from "../auth";
import { recordFailedLoginAttempt } from "@/lib/auth/session";
import { logAuthEvent } from "@/lib/audit-log";
import { createSupabaseActionClient } from "@/lib/supabase/server";

describe("signInAction — service error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should NOT record a failed login attempt when Supabase returns a 5xx/service error", async () => {
    const mockSupabase = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "Database connection error", status: 500 }
        })
      }
    };
    vi.mocked(createSupabaseActionClient).mockResolvedValue(mockSupabase as never);

    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("password", "password123");

    const result = await signInAction(undefined, formData);

    expect(result.success).toBe(false);
    expect(result.message).toContain("server error");
    expect(recordFailedLoginAttempt).not.toHaveBeenCalled();
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.login.failure" })
    );
  });

  it("should record a failed login attempt for invalid_credentials error", async () => {
    const mockSupabase = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "Invalid login credentials", status: 400, code: "invalid_credentials" }
        })
      }
    };
    vi.mocked(createSupabaseActionClient).mockResolvedValue(mockSupabase as never);

    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("password", "wrongpassword");

    const result = await signInAction(undefined, formData);

    expect(result.success).toBe(false);
    expect(result.message).toBe("Those details didn't match.");
    expect(recordFailedLoginAttempt).toHaveBeenCalledWith("user@example.com", expect.any(String));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/actions/__tests__/auth-login-errors.test.ts --reporter=verbose`
Expected: FAIL — current code treats all errors identically.

- [ ] **Step 3: Implement the fix in signInAction**

In `src/actions/auth.ts`, replace lines 119-131:

```typescript
  if (error) {
    // Distinguish auth failures from service errors
    const isServiceError = (error as { status?: number }).status !== undefined &&
      (error as { status?: number }).status! >= 500;

    if (isServiceError) {
      // Service errors should NOT burn lockout budget
      console.error("[auth] Supabase service error during sign-in:", error.message);
      return {
        success: false,
        message: "Sign in is temporarily unavailable. Please try again shortly."
      };
    }

    // Genuine auth failure — record attempt and log
    await recordFailedLoginAttempt(parsed.data.email, ip);
    const emailHash = await hashEmailForAudit(parsed.data.email);
    await logAuthEvent({
      event: "auth.login.failure",
      ipAddress: ip,
      emailHash,
      userAgent: headerStore.get("user-agent") ?? undefined,
      meta: { reason: error.message }
    });
    return { success: false, message: "Those details didn't match." };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/actions/__tests__/auth-login-errors.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/actions/auth.ts src/actions/__tests__/auth-login-errors.test.ts
git commit -m "fix: don't burn lockout budget on Supabase service errors

Differentiates 5xx service errors from auth failures in signInAction.
Service errors now return a distinct message and skip
recordFailedLoginAttempt, preventing legitimate users from getting
locked out during Supabase outages.

Spec ref: gap 1.5"
```

---

## Task 2: Fix Password Reset Session Teardown (Gap 1.6)

**Files:**
- Modify: `src/actions/auth.ts:310-349`
- Create: `src/actions/__tests__/auth-reset-teardown.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/actions/__tests__/auth-reset-teardown.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn()
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn()
}));
vi.mock("@/lib/auth/session", () => ({
  createSession: vi.fn().mockResolvedValue("new-session"),
  destroyAllSessionsForUser: vi.fn(),
  clearLockoutForAllIps: vi.fn(),
  recordFailedLoginAttempt: vi.fn(),
  isLockedOut: vi.fn().mockResolvedValue(false),
  makeSessionCookieOptions: vi.fn().mockReturnValue({}),
  SESSION_COOKIE_NAME: "app-session-id"
}));
vi.mock("@/lib/auth/password-policy", () => ({
  validatePassword: vi.fn().mockResolvedValue({ valid: true, errors: [] })
}));
vi.mock("@/lib/audit-log", () => ({
  logAuthEvent: vi.fn().mockResolvedValue(undefined),
  hashEmailForAudit: vi.fn().mockResolvedValue("hashed")
}));
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true)
}));
vi.mock("@/lib/notifications", () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true)
}));
vi.mock("@/lib/app-url", () => ({
  resolveAppUrl: vi.fn().mockReturnValue("http://localhost:3000")
}));
vi.mock("@/lib/form-errors", () => ({
  getFieldErrors: vi.fn().mockReturnValue({})
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue("127.0.0.1") })
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn()
}));

import { completePasswordResetAction } from "../auth";
import { destroyAllSessionsForUser } from "@/lib/auth/session";
import { logAuthEvent } from "@/lib/audit-log";
import { createSupabaseActionClient } from "@/lib/supabase/server";

describe("completePasswordResetAction — teardown error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return error status when session destruction fails", async () => {
    vi.mocked(destroyAllSessionsForUser).mockRejectedValue(new Error("DB unreachable"));

    const mockSupabase = {
      auth: {
        updateUser: vi.fn().mockResolvedValue({ error: null }),
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@test.com" } } }),
        signOut: vi.fn().mockResolvedValue({ error: null })
      }
    };
    vi.mocked(createSupabaseActionClient).mockResolvedValue(mockSupabase as never);

    const formData = new FormData();
    formData.set("password", "ValidPassword123!");
    formData.set("confirmPassword", "ValidPassword123!");

    const result = await completePasswordResetAction({ status: "idle" }, formData);

    // Should log a critical audit event when teardown fails
    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "auth.password_updated",
        meta: expect.objectContaining({ session_teardown_failed: true })
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/actions/__tests__/auth-reset-teardown.test.ts --reporter=verbose`
Expected: FAIL — current code swallows the session destruction error silently.

- [ ] **Step 3: Implement the fix**

In `src/actions/auth.ts`, replace the session destruction block (lines 311-346):

```typescript
  // Destroy all sessions then sign out
  let sessionTeardownFailed = false;
  try {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (currentUser) {
      // Destroy all app sessions
      try {
        await destroyAllSessionsForUser(currentUser.id);
      } catch (destroyError) {
        console.error("Failed to destroy sessions after password reset:", destroyError);
        sessionTeardownFailed = true;
      }

      // Issue a replacement session cookie (will be invalidated by signOut below)
      try {
        const cookieStore = await cookies();
        const newSessionId = await createSession(currentUser.id, {
          userAgent: "",
          ipAddress: "",
        });
        cookieStore.set(SESSION_COOKIE_NAME, newSessionId, makeSessionCookieOptions());
      } catch (sessionError) {
        console.error("Failed to issue replacement session after password reset:", sessionError);
      }

      await logAuthEvent({
        event: "auth.password_updated",
        userId: currentUser.id,
        meta: sessionTeardownFailed ? { session_teardown_failed: true } : undefined
      });

      // Clear lockout records — user proved mailbox ownership
      try {
        const { data: { user: refreshedUser } } = await supabase.auth.getUser();
        if (refreshedUser?.email) {
          await clearLockoutForAllIps(refreshedUser.email);
        }
      } catch {
        // Non-fatal — lockout records are housekeeping
      }
    }
  } catch (err) {
    console.error("Password reset post-update flow failed:", err);
    sessionTeardownFailed = true;
  }

  // Sign out the Supabase session
  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    console.error("signOut failed after password reset:", signOutError);
    sessionTeardownFailed = true;
  }

  if (sessionTeardownFailed) {
    // Password was changed but old sessions may still be active
    return {
      status: "success",
      message: "Password updated. For security, please sign in again on all your devices."
    };
  }

  return { status: "success" };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/actions/__tests__/auth-reset-teardown.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/actions/auth.ts src/actions/__tests__/auth-reset-teardown.test.ts
git commit -m "fix: handle session teardown errors in password reset

destroyAllSessionsForUser and signOut errors are now caught and
logged with session_teardown_failed metadata. Users are warned to
sign in again on all devices when teardown is incomplete.

Spec ref: gap 1.6"
```

---

## Task 3: Fix Cron Route Auth — Constant-Time Comparison (Gap 3.4)

**Files:**
- Create: `src/lib/cron-auth.ts`
- Create: `src/lib/__tests__/cron-auth.test.ts`
- Modify: `src/app/api/cron/cleanup-auth/route.ts`
- Modify: `src/app/api/cron/sms-reminders/route.ts`
- Modify: `src/app/api/cron/sms-post-event/route.ts`
- Modify: `src/app/api/cron/refresh-inspiration/route.ts`

- [ ] **Step 1: Write the failing test for the shared helper**

```typescript
// src/lib/__tests__/cron-auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("verifyCronSecret", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("should reject when CRON_SECRET is not set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const { verifyCronSecret } = await import("../cron-auth");
    expect(verifyCronSecret("Bearer some-token")).toBe(false);
  });

  it("should reject when authHeader is null", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { verifyCronSecret } = await import("../cron-auth");
    expect(verifyCronSecret(null)).toBe(false);
  });

  it("should reject when token doesn't match", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    const { verifyCronSecret } = await import("../cron-auth");
    expect(verifyCronSecret("Bearer wrong-secret")).toBe(false);
  });

  it("should accept when token matches", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    const { verifyCronSecret } = await import("../cron-auth");
    expect(verifyCronSecret("Bearer correct-secret")).toBe(true);
  });

  it("should reject when prefix is not Bearer", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    const { verifyCronSecret } = await import("../cron-auth");
    expect(verifyCronSecret("Basic correct-secret")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/cron-auth.test.ts --reporter=verbose`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the shared cron auth helper**

```typescript
// src/lib/cron-auth.ts
import "server-only";
import { timingSafeEqual } from "crypto";

/**
 * Verify a cron route's Bearer token against CRON_SECRET using
 * constant-time comparison to prevent timing attacks.
 */
export function verifyCronSecret(authHeader: string | null): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !authHeader) return false;

  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;

  const token = authHeader.slice(prefix.length);

  // Constant-time comparison — both must be same length for timingSafeEqual
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(cronSecret);

  if (tokenBuf.length !== secretBuf.length) return false;

  return timingSafeEqual(tokenBuf, secretBuf);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/cron-auth.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Update all 4 cron routes**

Replace the auth check in each cron route. Example for `cleanup-auth/route.ts`:

```typescript
// Replace lines 13-18:
import { verifyCronSecret } from "@/lib/cron-auth";

// ... inside GET handler:
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
```

Apply the same pattern to:
- `src/app/api/cron/sms-reminders/route.ts` — replace lines 14-18
- `src/app/api/cron/sms-post-event/route.ts` — replace the equivalent block
- `src/app/api/cron/refresh-inspiration/route.ts` — replace the equivalent block

Remove the inline `cronSecret` and `authHeader` variables from each file; the helper handles everything.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/lib/cron-auth.ts src/lib/__tests__/cron-auth.test.ts \
  src/app/api/cron/cleanup-auth/route.ts \
  src/app/api/cron/sms-reminders/route.ts \
  src/app/api/cron/sms-post-event/route.ts \
  src/app/api/cron/refresh-inspiration/route.ts
git commit -m "fix: use constant-time comparison for cron route auth

Replaces plain !== string comparison with timingSafeEqual via a
shared verifyCronSecret helper. Prevents timing attacks on
CRON_SECRET validation across all 4 cron routes.

Spec ref: gap 3.4"
```

---

## Task 4: Fix Landing Page Metadata Leak (Gap 3.5)

**Files:**
- Modify: `src/app/l/[slug]/page.tsx:55-117`

- [ ] **Step 1: Add status filter to getEventBySlug query**

In `src/app/l/[slug]/page.tsx`, modify the `getEventBySlug` function to filter by public status:

```typescript
async function getEventBySlug(slug: string): Promise<EventRow | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("events")
    .select(
      "id, title, public_title, public_teaser, public_description, public_highlights, event_image_path, start_at, seo_slug, booking_enabled, total_capacity, max_tickets_per_booking, status, venue:venues(id, name)"
    )
    .eq("seo_slug", slug)
    .is("deleted_at", null)
    .in("status", ["approved", "completed"])
    .maybeSingle();
```

- [ ] **Step 2: Simplify the page component guard**

The page component at line 123 can now be simplified since the query already filters:

```typescript
  if (!event || !event.booking_enabled) {
    notFound();
  }
```

- [ ] **Step 3: Run build to verify no breakage**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/l/[slug]/page.tsx
git commit -m "fix: filter by public status in landing page query

Adds .in('status', ['approved', 'completed']) to getEventBySlug so
generateMetadata cannot leak titles/descriptions for draft events.
Previously, status was only checked in the page component body,
after metadata was already built.

Spec ref: gap 3.5"
```

---

## Task 5: Database Migrations — Audit Immutability + Sensitive Column Triggers + Venue Write RLS + Anon RLS + Revoke Anon (Gaps 4.2, 4.5, 2.3, 3.1, 2.2)

**Files:**
- Create: `supabase/migrations/20260414150000_audit_log_immutability.sql`
- Create: `supabase/migrations/20260414150001_users_sensitive_column_audit.sql`
- Create: `supabase/migrations/20260414150002_venue_write_rls.sql`
- Create: `supabase/migrations/20260414150003_anon_events_rls.sql`
- Create: `supabase/migrations/20260414150004_revoke_anon_current_user_role.sql`

- [ ] **Step 1: Create audit_log immutability trigger migration**

```sql
-- supabase/migrations/20260414150000_audit_log_immutability.sql
-- Gap 4.2: Make audit_log immutable — prevent UPDATE and DELETE.
-- IMPORTANT: This is a load-bearing constraint. Do not remove without replacement.

CREATE OR REPLACE FUNCTION raise_audit_immutable_error()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log records are immutable — updates and deletes are not permitted';
END;
$$;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION raise_audit_immutable_error();
```

- [ ] **Step 2: Create users sensitive column audit trigger migration**

```sql
-- supabase/migrations/20260414150001_users_sensitive_column_audit.sql
-- Gap 4.5: Log role and venue_id changes at DB level as a safety net.
-- Complements app-level audit in updateUserAction().

CREATE OR REPLACE FUNCTION audit_users_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when role or venue_id actually changed
  IF (OLD.role IS DISTINCT FROM NEW.role) OR (OLD.venue_id IS DISTINCT FROM NEW.venue_id) THEN
    INSERT INTO audit_log (entity, entity_id, action, actor_id, meta)
    VALUES (
      'user',
      NEW.id::text,
      'user.sensitive_column_changed',
      auth.uid()::text,
      jsonb_build_object(
        'old_role', OLD.role,
        'new_role', NEW.role,
        'old_venue_id', OLD.venue_id,
        'new_venue_id', NEW.venue_id,
        'source', 'db_trigger'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_sensitive_audit
  AFTER UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION audit_users_sensitive_columns();

-- Lock down the function
REVOKE ALL ON FUNCTION audit_users_sensitive_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_users_sensitive_columns() FROM anon;
REVOKE ALL ON FUNCTION audit_users_sensitive_columns() FROM authenticated;
```

- [ ] **Step 3: Create venue write RLS migration**

```sql
-- supabase/migrations/20260414150002_venue_write_rls.sql
-- Gap 2.3: Add venue-scoped UPDATE policy for events.
-- Read-side already handled by 20260410120003_venue_manager_event_visibility.sql.

-- Drop existing update policy and replace with venue-aware version
DROP POLICY IF EXISTS "event_update_policy" ON events;

CREATE POLICY "event_update_policy" ON events
  FOR UPDATE
  USING (
    -- Central planners can update any event
    public.current_user_role() = 'central_planner'
    OR
    -- Creators can update their own events
    auth.uid() = created_by
    OR
    -- Venue managers can update events at their venue
    (
      public.current_user_role() = 'venue_manager'
      AND venue_id = (SELECT venue_id FROM users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    public.current_user_role() = 'central_planner'
    OR auth.uid() = created_by
    OR (
      public.current_user_role() = 'venue_manager'
      AND venue_id = (SELECT venue_id FROM users WHERE id = auth.uid())
    )
  );
```

- [ ] **Step 4: Create anon events RLS policy for public API**

```sql
-- supabase/migrations/20260414150003_anon_events_rls.sql
-- Gap 3.1: Allow anon role to read published events for public API.
-- This replaces service-role bypass with proper RLS enforcement.

CREATE POLICY "anon_read_published_events" ON events
  FOR SELECT
  TO anon
  USING (
    status IN ('approved', 'completed')
    AND deleted_at IS NULL
  );

-- Also allow anon to read venues (public data)
CREATE POLICY "anon_read_venues" ON venues
  FOR SELECT
  TO anon
  USING (true);

-- Allow anon to read event_types (public data)
CREATE POLICY "anon_read_event_types" ON event_types
  FOR SELECT
  TO anon
  USING (true);

-- Allow anon to read venue_opening_hours (public data)
CREATE POLICY "anon_read_opening_hours" ON venue_opening_hours
  FOR SELECT
  TO anon
  USING (true);

-- Allow anon to read venue_service_types (public data)
CREATE POLICY "anon_read_service_types" ON venue_service_types
  FOR SELECT
  TO anon
  USING (true);

-- Allow anon to read venue_opening_overrides (public data)
CREATE POLICY "anon_read_opening_overrides" ON venue_opening_overrides
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "anon_read_override_venues" ON venue_opening_override_venues
  FOR SELECT
  TO anon
  USING (true);
```

- [ ] **Step 5: Create revoke anon from current_user_role migration**

```sql
-- supabase/migrations/20260414150004_revoke_anon_current_user_role.sql
-- Gap 2.2: Remove unnecessary anon access to current_user_role().
-- The function returns null for anon callers anyway.

REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC;
```

- [ ] **Step 6: Dry-run migrations**

Run: `npx supabase db push --dry-run`
Expected: All 5 migrations apply without error.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260414150000_audit_log_immutability.sql \
  supabase/migrations/20260414150001_users_sensitive_column_audit.sql \
  supabase/migrations/20260414150002_venue_write_rls.sql \
  supabase/migrations/20260414150003_anon_events_rls.sql \
  supabase/migrations/20260414150004_revoke_anon_current_user_role.sql
git commit -m "feat: auth hardening migrations — immutable audit, venue write RLS, anon policies

Five migrations:
- audit_log immutability trigger (gap 4.2)
- users sensitive column audit trigger for role/venue_id (gap 4.5)
- venue-scoped UPDATE RLS on events (gap 2.3)
- anon SELECT policies for public API tables (gap 3.1)
- revoke anon from current_user_role() (gap 2.2)

Spec ref: gaps 4.2, 4.5, 2.3, 3.1, 2.2"
```

---

## Task 6: Migrate Public API Routes from Service-Role to Anon Client (Gap 3.1)

**Files:**
- Modify: `src/app/api/v1/events/route.ts`
- Modify: `src/app/api/v1/events/[eventId]/route.ts`
- Modify: `src/app/api/v1/events/by-slug/[slug]/route.ts`
- Modify: `src/app/api/v1/event-types/route.ts`
- Modify: `src/app/api/v1/venues/route.ts`
- Modify: `src/app/api/v1/opening-times/route.ts`

**Depends on:** Task 5 (anon RLS policies must exist first).

- [ ] **Step 1: In each file, replace the admin client import with the server readonly client**

For each of the 6 files, change:

```typescript
// Before:
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// ... later:
const db = createSupabaseAdminClient();

// After:
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
// ... later:
const db = await createSupabaseReadonlyClient();
```

Note: `createSupabaseReadonlyClient()` is async (returns a Promise), while `createSupabaseAdminClient()` is sync. Add `await` at every call site.

- [ ] **Step 2: Keep existing status filters as defence-in-depth**

The existing `.in("status", [...])` and `.is("deleted_at", null)` filters in event routes should remain as application-level defence-in-depth, even though RLS now also enforces them.

- [ ] **Step 3: Run the public API tests**

Run: `npx vitest run src/lib/public-api/__tests__/ --reporter=verbose`
Expected: All public API tests pass (tests may need mock updates for the new client).

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/events/route.ts \
  "src/app/api/v1/events/[eventId]/route.ts" \
  "src/app/api/v1/events/by-slug/[slug]/route.ts" \
  src/app/api/v1/event-types/route.ts \
  src/app/api/v1/venues/route.ts \
  src/app/api/v1/opening-times/route.ts
git commit -m "fix: replace service-role with anon client in public API routes

All /api/v1/* routes now use createSupabaseReadonlyClient() instead
of createSupabaseAdminClient(). RLS anon policies (previous migration)
enforce that only approved/completed events are visible. Existing
status filters retained as defence-in-depth.

Spec ref: gap 3.1"
```

---

## Task 7: Extend Audit Entity Type + Add Logging to 6 Unaudited Action Files (Gap 5.1)

**Files:**
- Modify: `src/lib/audit-log.ts:8` (extend entity union)
- Modify: `src/actions/artists.ts`
- Modify: `src/actions/event-types.ts`
- Modify: `src/actions/links.ts`
- Modify: `src/actions/opening-hours.ts`
- Modify: `src/actions/planning.ts`
- Modify: `src/actions/venues.ts`
- Modify: `src/actions/events.ts` (2 unlogged paths)
- Modify: `src/actions/users.ts` (enrich role change metadata — gap 2.1)

- [ ] **Step 1: Extend the audit entity type union**

In `src/lib/audit-log.ts`, line 8, update:

```typescript
type RecordAuditParams = {
  entity: "event" | "sop_template" | "planning_task" | "auth" | "customer" | "booking" | "artist" | "event_type" | "link" | "opening_hours" | "planning" | "venue" | "user";
  entityId: string;
  action: string;
  meta?: Record<string, unknown>;
  actorId?: string | null;
};
```

- [ ] **Step 2: Add audit logging to each unaudited action file**

For each file, add the import at the top and a `recordAuditLogEntry()` call after each successful mutation. The pattern is the same for all — shown here for `artists.ts`:

```typescript
// Add to imports:
import { recordAuditLogEntry } from "@/lib/audit-log";

// After each successful create/update/delete, add (fire-and-forget):
recordAuditLogEntry({
  entity: "artist",
  entityId: result.id,
  action: "artist.created",
  actorId: user.id,
  meta: { name: validatedData.name }
}).catch(() => {});
```

Apply to each file with the appropriate entity and action:

| File | Entity | Actions to log |
|------|--------|---------------|
| `artists.ts` | `"artist"` | `artist.created`, `artist.updated`, `artist.archived` |
| `event-types.ts` | `"event_type"` | `event_type.created`, `event_type.updated`, `event_type.deleted` |
| `links.ts` | `"link"` | `link.created`, `link.updated`, `link.deleted` |
| `opening-hours.ts` | `"opening_hours"` | `opening_hours.updated` |
| `planning.ts` | `"planning"` | `planning.series_created`, `planning.series_updated`, `planning.item_created`, etc. |
| `venues.ts` | `"venue"` | `venue.created`, `venue.updated` |
| `events.ts` | `"event"` | `event.draft_saved` (in `saveEventDraftAction`), `event.booking_settings_updated` (in `updateBookingSettingsAction`) |

- [ ] **Step 3: Enrich role change audit in users.ts (gap 2.1)**

In `src/actions/users.ts`, before the update call, fetch the current role and venue_id:

```typescript
// Before the update, fetch current values
const { data: currentUserData } = await supabase
  .from("users")
  .select("role, venue_id")
  .eq("id", targetUserId)
  .single();

// ... after the update succeeds, update the existing logAuthEvent call:
await logAuthEvent({
  event: "auth.role.changed",
  userId: user.id,
  meta: {
    targetUserId,
    oldRole: currentUserData?.role ?? "unknown",
    newRole: validatedRole,
    oldVenueId: currentUserData?.venue_id ?? null,
    newVenueId: validatedVenueId ?? null
  }
});
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audit-log.ts \
  src/actions/artists.ts src/actions/event-types.ts \
  src/actions/links.ts src/actions/opening-hours.ts \
  src/actions/planning.ts src/actions/venues.ts \
  src/actions/events.ts src/actions/users.ts
git commit -m "feat: complete mutation audit logging across all action files

Extends audit entity types and adds recordAuditLogEntry() to the 6
previously unaudited action files: artists, event-types, links,
opening-hours, planning, venues. Also adds audit to 2 unlogged
event paths (saveEventDraftAction, updateBookingSettingsAction).
Enriches role change audit with old/new role and venue metadata.

Spec ref: gaps 5.1, 2.1"
```

---

## Task 8: Fix Invite Rollback Error Handling (Gap 5.5)

**Files:**
- Modify: `src/actions/users.ts` (invite rollback catch block)

- [ ] **Step 1: Find and fix the rollback**

In `src/actions/users.ts`, in the `inviteUserAction` catch block where `deleteUser` is called, replace the fire-and-forget with error checking:

```typescript
// Replace the existing rollback pattern:
try {
  const { error: deleteError } = await admin.auth.admin.deleteUser(authUserId);
  if (deleteError) {
    console.error("[invite] Rollback failed — orphaned auth user:", authUserId, deleteError);
    await logAuthEvent({
      event: "auth.invite.sent",
      userId: user.id,
      meta: {
        targetEmail: emailForLog,
        rollback_failed: true,
        orphaned_auth_user_id: authUserId,
        original_error: originalError instanceof Error ? originalError.message : "unknown"
      }
    });
  }
} catch (rollbackError) {
  console.error("[invite] Rollback threw — orphaned auth user:", authUserId, rollbackError);
}
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/actions/users.ts
git commit -m "fix: check invite rollback delete error and log orphaned users

The invite catch path now checks the return value of deleteUser()
and logs a critical audit event with the orphaned auth user ID
when rollback fails, enabling manual cleanup.

Spec ref: gap 5.5"
```

---

## Task 9: Sanitise Server Action Error Messages (Gap 5.6)

**Files:**
- Modify: `src/actions/events.ts` (error message patterns)
- Modify: `src/actions/sop.ts` (error message patterns)

- [ ] **Step 1: Find and replace error detail leakage patterns**

Search for patterns like `${error.message}`, `${detail.slice(0, 120)}`, `error instanceof Error ? error.message : "..."` in server actions and replace with generic messages:

In `src/actions/events.ts:923` (and similar patterns):
```typescript
// Before:
return { success: false, message: `Could not save the draft: ${detail.slice(0, 120)}` };

// After:
console.error("[events] Draft save failed:", detail);
return { success: false, message: "Could not save the draft. Please try again." };
```

In `src/actions/sop.ts:126` (and similar patterns):
```typescript
// Before:
message: error instanceof Error ? error.message : "Could not create section."

// After:
if (error instanceof Error) console.error("[sop] Section creation failed:", error.message);
message: "Could not create section. Please try again."
```

- [ ] **Step 2: Run build to check for regressions**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/actions/events.ts src/actions/sop.ts
git commit -m "fix: sanitise server action error messages

Replaces backend error detail leakage (PostgREST messages, policy
names) with generic user-facing messages. Detailed errors are now
logged server-side only.

Spec ref: gap 5.6"
```

---

## Task 10: Verification Pipeline

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: Zero errors, zero warnings.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Successful production build.

- [ ] **Step 5: Dry-run migrations**

Run: `npx supabase db push --dry-run`
Expected: All migrations apply cleanly.

---

## Summary

| Task | Gaps | Priority |
|------|------|----------|
| 1. Login service error differentiation | 1.5 | High |
| 2. Password reset teardown | 1.6 | High |
| 3. Cron auth constant-time | 3.4 | Low (but trivial) |
| 4. Landing page metadata leak | 3.5 | Medium |
| 5. Database migrations (5 in batch) | 4.2, 4.5, 2.3, 3.1, 2.2 | Mixed |
| 6. Public API RLS migration | 3.1 | High |
| 7. Audit logging completion | 5.1, 2.1 | Medium |
| 8. Invite rollback error handling | 5.5 | Medium |
| 9. Error message sanitisation | 5.6 | Medium |
| 10. Verification pipeline | — | — |

**Not included in this plan (lower priority / blocked):**
- Gap 1.2 (password reset rate limiting) — needs Upstash Redis setup, pair with 3.2
- Gap 1.4 (Turnstile fail-open) — needs product decision
- Gap 3.2 (Upstash rate limiter) — infrastructure dependency
- Gaps 1.1, 1.3 (session refresh, idle timeout) — low priority
- Gap 1.7 (password no-reuse enforcement) — low priority
- Gap 1.8 (Supabase cookie hardening) — low priority
- Gaps 5.2, 5.3, 5.7, 5.8, 5.9 (documentation and minor fixes) — low priority
- Gaps 2.4, 2.5 (product decisions / testing) — blocked on human input
- Gap 5.4 (integration tests) — large effort, separate plan
