# Auth & RBAC Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 17 auth, RBAC, RLS, and session management vulnerabilities identified by a 6-reviewer adversarial audit.

**Architecture:** Defence-in-depth fixes across three layers — database (migrations for RLS and SECURITY DEFINER hardening), server actions (ownership checks, validation ordering, session handling), and observability (audit log fixes, structured logging). No new tables or UI components; all changes tighten existing code.

**Tech Stack:** Next.js 16.1, React 19.1, TypeScript strict, Supabase PostgreSQL, Vitest

**Spec:** `docs/superpowers/specs/2026-04-10-auth-rbac-audit-design.md` (v2)

---

## File Map

| Status | File | Purpose |
|--------|------|---------|
| CREATE | `supabase/migrations/20260410120000_harden_security_definer_rpcs.sql` | C1: REVOKE/GRANT on 7 unhardened SECURITY DEFINER functions |
| CREATE | `supabase/migrations/20260410120001_fix_audit_log_schema.sql` | C2: extend entity_type, change entity_id to text |
| MODIFY | `src/lib/audit-log.ts` | C2: fix logAuthEvent error handling, update RecordAuditParams type |
| MODIFY | `src/actions/bookings.ts` | C3: cancel ownership check, C4: Turnstile, M5: idempotency comment |
| CREATE | `src/lib/turnstile.ts` | C4: extracted shared verifyTurnstile helper |
| MODIFY | `src/actions/auth.ts` | C4: import shared Turnstile, H2: move lockout clear, H4: fatal session creation |
| MODIFY | `src/app/l/[slug]/BookingForm.tsx` | C4: add Turnstile widget |
| MODIFY | `src/app/planning/page.tsx` | H1: role gate before loader |
| MODIFY | `src/app/events/[eventId]/page.tsx` | H1: gate planning/SOP data |
| MODIFY | `src/actions/events.ts` | H3: move status check before artist sync |
| MODIFY | `src/lib/auth.ts` | H5: role normalisation warning |
| CREATE | `supabase/migrations/20260410120002_tighten_event_bookings_rls.sql` | M1: scope bookings RLS by role/venue |
| MODIFY | `src/actions/planning.ts` | M2: canUsePlanning for dismissal |
| MODIFY | `src/lib/auth/session.ts` | M3: align lockout windows, add login_attempts cleanup |
| MODIFY | `src/lib/public-api/events.ts` | M4: remove notes fallback |
| MODIFY | `src/app/api/cron/cleanup-auth/route.ts` | M6: structured logging |
| MODIFY | `src/app/api/cron/refresh-inspiration/route.ts` | M6: structured logging |
| MODIFY | `src/app/api/cron/sms-post-event/route.ts` | M6: structured logging |
| MODIFY | `src/app/api/cron/sms-reminders/route.ts` | M6: structured logging |
| CREATE | `supabase/migrations/20260410120003_venue_manager_event_visibility.sql` | M7: venue-scoped SELECT for venue_managers |
| MODIFY | `src/actions/customers.ts` | M8: documentation comment |
| MODIFY | `src/actions/artists.ts` | L1: documentation comment |

---

## Chunk 1: Critical Database Hardening (C1 + C2)

### Task 1: Harden SECURITY DEFINER RPCs

**Files:**
- Create: `supabase/migrations/20260410120000_harden_security_definer_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Harden SECURITY DEFINER functions that lack REVOKE/GRANT.
-- Pattern reference: 20260225000002_atomic_artist_sync_and_event_version.sql

-- 1. create_booking (20260313000000_event_bookings.sql)
alter function public.create_booking(uuid, text, text, text, text, int)
  set search_path = public;
revoke all on function public.create_booking(uuid, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.create_booking(uuid, text, text, text, text, int)
  to service_role;

-- 2. get_reminder_bookings (20260313000000_event_bookings.sql)
alter function public.get_reminder_bookings()
  set search_path = public;
revoke all on function public.get_reminder_bookings()
  from public, anon, authenticated;
grant execute on function public.get_reminder_bookings()
  to service_role;

-- 3. get_post_event_bookings (20260313000000_event_bookings.sql)
alter function public.get_post_event_bookings()
  set search_path = public;
revoke all on function public.get_post_event_bookings()
  from public, anon, authenticated;
grant execute on function public.get_post_event_bookings()
  to service_role;

-- 4. list_customers_with_stats (20260313000001_add_customers_and_consent.sql)
alter function public.list_customers_with_stats(uuid)
  set search_path = public;
revoke all on function public.list_customers_with_stats(uuid)
  from public, anon, authenticated;
grant execute on function public.list_customers_with_stats(uuid)
  to service_role;

-- 5. cleanup_auth_records (20260311100000_auth_session_tables.sql)
alter function public.cleanup_auth_records()
  set search_path = public;
revoke all on function public.cleanup_auth_records()
  from public, anon, authenticated;
grant execute on function public.cleanup_auth_records()
  to service_role;

-- 6. generate_sop_checklist (20260408120003_add_sop_rpc_functions.sql)
alter function public.generate_sop_checklist(uuid)
  set search_path = public;
revoke all on function public.generate_sop_checklist(uuid)
  from public, anon, authenticated;
grant execute on function public.generate_sop_checklist(uuid)
  to service_role;

-- 7. recalculate_sop_dates (20260408120003_add_sop_rpc_functions.sql)
alter function public.recalculate_sop_dates(uuid)
  set search_path = public;
revoke all on function public.recalculate_sop_dates(uuid)
  from public, anon, authenticated;
grant execute on function public.recalculate_sop_dates(uuid)
  to service_role;
```

- [ ] **Step 2: Verify function signatures match**

Run against the database or check the migration files to confirm each function's argument types match the REVOKE/GRANT statements above. The `create_booking` signature in particular must match `20260313000000_event_bookings.sql`.

```bash
grep -n "create or replace function public.create_booking" supabase/migrations/20260313000000_event_bookings.sql
grep -n "create or replace function public.get_reminder_bookings" supabase/migrations/20260313000000_event_bookings.sql
grep -n "create or replace function public.get_post_event_bookings" supabase/migrations/20260313000000_event_bookings.sql
grep -n "create or replace function public.list_customers_with_stats" supabase/migrations/20260313000001_add_customers_and_consent.sql
grep -n "create or replace function public.cleanup_auth_records" supabase/migrations/20260311100000_auth_session_tables.sql
grep -n "create or replace function public.generate_sop_checklist" supabase/migrations/20260408120003_add_sop_rpc_functions.sql
grep -n "create or replace function public.recalculate_sop_dates" supabase/migrations/20260408120003_add_sop_rpc_functions.sql
```

Adjust argument types in the migration if they don't match.

- [ ] **Step 3: Test migration locally**

```bash
npx supabase db push --dry-run
```

Expected: migration applies without errors.

- [ ] **Step 4: Apply migration**

```bash
npx supabase db push
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260410120000_harden_security_definer_rpcs.sql
git commit -m "fix: harden SECURITY DEFINER RPCs with REVOKE/GRANT + search_path"
```

---

### Task 2: Fix audit log schema

**Files:**
- Create: `supabase/migrations/20260410120001_fix_audit_log_schema.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Fix audit_log to support auth, customer, and booking entity types.
-- entity_id must be text because auth events use "system" (not a UUID).

-- 1. Change entity_id from uuid to text
alter table public.audit_log
  alter column entity_id type text using entity_id::text;

-- 2. Drop the old entity CHECK and replace with expanded version
alter table public.audit_log
  drop constraint if exists audit_log_entity_check;

alter table public.audit_log
  add constraint audit_log_entity_check
    check (entity in (
      'event',
      'sop_template',
      'planning_task',
      'auth',
      'customer',
      'booking'
    )) not valid;

-- 3. Drop the old action CHECK and replace with expanded version
alter table public.audit_log
  drop constraint if exists audit_log_action_check;

alter table public.audit_log
  add constraint audit_log_action_check
    check (action in (
      'event.created',
      'event.updated',
      'event.artists_updated',
      'event.submitted',
      'event.approved',
      'event.needs_revisions',
      'event.rejected',
      'event.completed',
      'event.assignee_changed',
      'event.deleted',
      'event.status_changed',
      'event.website_copy_generated',
      'event.debrief_updated',
      'sop_section.created',
      'sop_section.updated',
      'sop_section.deleted',
      'sop_task_template.created',
      'sop_task_template.updated',
      'sop_task_template.deleted',
      'sop_dependency.created',
      'sop_dependency.deleted',
      'sop_checklist.generated',
      'sop_checklist.dates_recalculated',
      'planning_task.status_changed',
      'planning_task.reassigned',
      'auth.login.success',
      'auth.login.failure',
      'auth.lockout',
      'auth.logout',
      'auth.password_reset.requested',
      'auth.password_updated',
      'auth.invite.sent',
      'auth.invite.accepted',
      'auth.invite.resent',
      'auth.role.changed',
      'auth.session.expired.idle',
      'auth.session.expired.absolute',
      'customer.erased',
      'booking.cancelled'
    )) not valid;
```

- [ ] **Step 2: Test migration locally**

```bash
npx supabase db push --dry-run
```

- [ ] **Step 3: Apply migration**

```bash
npx supabase db push
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260410120001_fix_audit_log_schema.sql
git commit -m "fix: extend audit_log entity/action constraints and change entity_id to text"
```

---

### Task 3: Fix audit log error handling in code

**Files:**
- Modify: `src/lib/audit-log.ts`

- [ ] **Step 1: Update RecordAuditParams type to include new entity types**

In `src/lib/audit-log.ts`, find:

```typescript
type RecordAuditParams = {
  entity: "event" | "sop_template" | "planning_task";
```

Replace with:

```typescript
type RecordAuditParams = {
  entity: "event" | "sop_template" | "planning_task" | "auth" | "customer" | "booking";
```

- [ ] **Step 2: Fix logAuthEvent to check for errors**

In `src/lib/audit-log.ts`, find the `logAuthEvent` function's try block where it calls `db.from("audit_log").insert(...)`. After the insert call, add error checking. Find:

```typescript
    await db.from("audit_log").insert({
      entity: "auth",
      entity_id: params.userId ?? "system",
      action: params.event,
      actor_id: params.userId ?? null,
      meta: serialiseMeta({
        ip_address: params.ipAddress ?? null,
        user_agent: params.userAgent ?? null,
        email_hash: params.emailHash ?? null,
        ...(params.meta ?? {})
      })
    });
```

Replace with:

```typescript
    const { error } = await db.from("audit_log").insert({
      entity: "auth",
      entity_id: params.userId ?? "system",
      action: params.event,
      actor_id: params.userId ?? null,
      meta: serialiseMeta({
        ip_address: params.ipAddress ?? null,
        user_agent: params.userAgent ?? null,
        email_hash: params.emailHash ?? null,
        ...(params.meta ?? {})
      })
    });
    if (error) {
      console.warn("[audit] Auth event insert failed:", error.message, { event: params.event });
    }
```

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit-log.ts
git commit -m "fix: extend audit entity types and add error checking to logAuthEvent"
```

---

## Chunk 2: Booking Action Fixes (C3 + C4)

### Task 4: Extract verifyTurnstile to shared helper

**Files:**
- Create: `src/lib/turnstile.ts`
- Modify: `src/actions/auth.ts`

- [ ] **Step 1: Create shared Turnstile helper**

Create `src/lib/turnstile.ts`:

```typescript
"use server";

/**
 * Verify a Cloudflare Turnstile CAPTCHA token.
 * Fails soft per auth standard §6 — service unavailability should not block users.
 */
export async function verifyTurnstile(token: string | null, action: string): Promise<boolean> {
  if (!token) {
    console.warn("[turnstile] No token received — widget may not have loaded. Failing soft.");
    return true;
  }
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn("[turnstile] TURNSTILE_SECRET_KEY not set — skipping verification");
    return true;
  }
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token })
    });
    if (!res.ok) {
      console.warn("[turnstile] siteverify API unavailable — failing soft");
      return true;
    }
    const data = (await res.json()) as { success: boolean; action?: string };
    if (data.action && data.action !== action) {
      return false;
    }
    return data.success === true;
  } catch {
    console.warn("[turnstile] siteverify error — failing soft");
    return true;
  }
}
```

- [ ] **Step 2: Update auth.ts to import from shared helper**

In `src/actions/auth.ts`, remove the private `verifyTurnstile` function (lines 70-102) and add an import at the top:

```typescript
import { verifyTurnstile } from "@/lib/turnstile";
```

- [ ] **Step 3: Run type check and tests**

```bash
npx tsc --noEmit && npm test
```

Expected: all pass — no behaviour change.

- [ ] **Step 4: Commit**

```bash
git add src/lib/turnstile.ts src/actions/auth.ts
git commit -m "refactor: extract verifyTurnstile to shared helper"
```

---

### Task 5: Add ownership check to cancelBookingAction

**Files:**
- Modify: `src/actions/bookings.ts`

- [ ] **Step 1: Add ownership verification**

In `src/actions/bookings.ts`, find `cancelBookingAction`. After the `getCurrentUser()` check, add ownership verification before calling `cancelBooking()`. The current code is:

```typescript
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "Unauthorized" };
```

Replace with:

```typescript
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "Unauthorized" };

  // Ownership check: only central_planner or venue_manager for their venue
  if (user.role !== "central_planner") {
    if (user.role !== "venue_manager") {
      return { success: false, message: "You do not have permission to cancel bookings." };
    }
    // Venue manager — verify the booking's event belongs to their venue
    const db = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
    const { data: booking } = await db
      .from("event_bookings")
      .select("event_id")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return { success: false, message: "Booking not found." };

    const { data: event } = await db
      .from("events")
      .select("venue_id")
      .eq("id", booking.event_id)
      .maybeSingle();
    if (!event || event.venue_id !== user.venueId) {
      return { success: false, message: "You can only cancel bookings for events at your venue." };
    }
  }
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/actions/bookings.ts
git commit -m "fix: add ownership check to cancelBookingAction"
```

---

### Task 6: Add Turnstile to public booking flow

**Files:**
- Modify: `src/actions/bookings.ts`
- Modify: `src/app/l/[slug]/BookingForm.tsx`

- [ ] **Step 1: Add Turnstile verification to createBookingAction**

In `src/actions/bookings.ts`, add the import:

```typescript
import { verifyTurnstile } from "@/lib/turnstile";
```

In the `createBookingAction` function, add Turnstile verification after the rate limit check and before the capacity/booking logic. Find the line after rate limiting where validation begins, and add:

```typescript
  // Verify Turnstile CAPTCHA
  const turnstileValid = await verifyTurnstile(input.turnstileToken ?? null, "booking");
  if (!turnstileValid) {
    return { success: false, message: "Security check failed. Please try again." };
  }
```

Also update the input type/schema to accept the optional `turnstileToken` field. In the Zod schema for booking input, add:

```typescript
  turnstileToken: z.string().optional(),
```

- [ ] **Step 2: Add Turnstile widget to BookingForm**

In `src/app/l/[slug]/BookingForm.tsx`, add the Turnstile widget before the submit button. Add the Turnstile script in a useEffect and a hidden input for the token:

```tsx
// Add to imports
import { useEffect, useRef } from "react";

// Add inside the component, before the return
const turnstileRef = useRef<HTMLDivElement>(null);
const [turnstileToken, setTurnstileToken] = useState<string>("");

useEffect(() => {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey || !turnstileRef.current) return;

  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  script.async = true;
  script.onload = () => {
    if (window.turnstile && turnstileRef.current) {
      window.turnstile.render(turnstileRef.current, {
        sitekey: siteKey,
        action: "booking",
        callback: (token: string) => setTurnstileToken(token),
      });
    }
  };
  document.head.appendChild(script);
  return () => { document.head.removeChild(script); };
}, []);
```

Add the widget div before the submit button in the JSX:

```tsx
<div ref={turnstileRef} className="mb-4" />
```

Pass `turnstileToken` in the action call input object.

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/actions/bookings.ts src/app/l/[slug]/BookingForm.tsx
git commit -m "fix: add Turnstile CAPTCHA to public booking flow"
```

---

## Chunk 3: High-Severity Fixes (H1-H5)

### Task 7: Gate planning page and event detail planning data

**Files:**
- Modify: `src/app/planning/page.tsx`
- Modify: `src/app/events/[eventId]/page.tsx`

- [ ] **Step 1: Add role gate to planning page**

In `src/app/planning/page.tsx`, add the import:

```typescript
import { canViewPlanning } from "@/lib/roles";
```

After the auth check (`if (!user) { redirect("/login"); }`), add:

```typescript
  if (!canViewPlanning(user.role)) {
    redirect("/unauthorized");
  }
```

This must come BEFORE the `Promise.all` that calls `listPlanningBoardData()`.

- [ ] **Step 2: Gate planning/SOP data on event detail page**

In `src/app/events/[eventId]/page.tsx`, find the section that fetches linked planning item and SOP tasks (around line 110). Wrap it in a role check:

```typescript
  let sopTasks: PlanningTask[] = [];
  let sopPlanningItemId: string | null = null;
  if (canViewPlanning(user.role)) {
    const db = createSupabaseAdminClient();
    // ... existing planning item fetch logic ...
  }
```

Add the import if not already present:

```typescript
import { canViewPlanning } from "@/lib/roles";
```

- [ ] **Step 3: Run type check and build**

```bash
npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/planning/page.tsx src/app/events/[eventId]/page.tsx
git commit -m "fix: gate planning page and event detail planning data behind canViewPlanning"
```

---

### Task 8: Move lockout clearing from password reset request to completion

**Files:**
- Modify: `src/actions/auth.ts`

- [ ] **Step 1: Remove lockout clearing from requestPasswordResetAction**

In `src/actions/auth.ts`, find the `requestPasswordResetAction` function. Remove the `clearLockoutForAllIps` call (around line 280). Find:

```typescript
    try {
      await clearLockoutForAllIps(email);
    } catch {
      // Non-fatal — lockout records are housekeeping
    }
```

Delete those lines entirely.

- [ ] **Step 2: Add lockout clearing to completePasswordResetAction**

In `src/actions/auth.ts`, find `completePasswordResetAction`. After the password is successfully updated and sessions are destroyed (after `destroyAllSessionsForUser`), add:

```typescript
    // Clear lockout records now that the user has proved mailbox ownership
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser?.email) {
        await clearLockoutForAllIps(currentUser.email);
      }
    } catch {
      // Non-fatal — lockout records are housekeeping
    }
```

Ensure `clearLockoutForAllIps` is still imported at the top of the file.

- [ ] **Step 3: Run type check and tests**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/actions/auth.ts
git commit -m "fix: move lockout clearing to password reset completion (requires mailbox proof)"
```

---

### Task 9: Fix event submit ordering — status check before artist sync

**Files:**
- Modify: `src/actions/events.ts`

- [ ] **Step 1: Move status validation before artist sync**

In `src/actions/events.ts`, find `submitEventForReviewAction`. The current flow for existing events is:
1. Artist sync (line ~1144)
2. Image upload (line ~1165)
3. Status check (line ~1192)

Restructure so the status check comes first. Find the block where the existing event is loaded and verified, then move the status check to immediately after loading the event:

```typescript
    // For existing events: check status FIRST, before any mutations
    if (existingEvent) {
      if (!["draft", "needs_revisions"].includes(existingEvent.status)) {
        if (existingEvent.status === "approved") {
          return { success: false, message: "This event has already been approved." };
        }
        return { success: false, message: `Cannot submit: event is currently "${existingEvent.status}".` };
      }

      // Status is valid — now safe to sync artists and upload images
      // ... artist sync code ...
      // ... image upload code ...
    }
```

Remove the duplicate status check from its original position later in the function.

- [ ] **Step 2: Run type check and tests**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/events.ts
git commit -m "fix: validate event status before artist sync in submitEventForReviewAction"
```

---

### Task 10: Make sign-in session creation fatal on failure

**Files:**
- Modify: `src/actions/auth.ts`

- [ ] **Step 1: Change session creation error handling**

In `src/actions/auth.ts`, find the `signInAction` function's session creation block (around line 183). The current code treats `createSession()` failure as non-fatal. Change it to be fatal. Find the try/catch around `createSession` and replace the catch handling:

```typescript
    // Create app session — MUST succeed for protected routes to work
    try {
      const sessionId = await createSession(authUser.id, {
        userAgent: headers().get("user-agent") ?? "unknown",
        ipAddress: clientIp ?? "unknown"
      });
      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);
    } catch (sessionErr) {
      console.error("[auth] App session creation failed — aborting login:", sessionErr);
      // Sign out the Supabase session to prevent JWT-without-app-session state
      await supabase.auth.signOut();
      await logAuthEvent({
        event: "auth.login.failure",
        userId: authUser.id,
        ipAddress: clientIp ?? undefined,
        meta: { reason: "session_creation_failed" }
      });
      return {
        success: false,
        message: "Sign in failed due to a server error. Please try again."
      };
    }
```

- [ ] **Step 2: Run type check and tests**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/auth.ts
git commit -m "fix: make app session creation fatal in signInAction to prevent redirect loop"
```

---

### Task 11: Add role normalisation warning

**Files:**
- Modify: `src/lib/auth.ts`

- [ ] **Step 1: Add warning log**

In `src/lib/auth.ts`, find the `getCurrentUser` function where it calls `normalizeRole()`. After the call, add a warning if the result is null. Find the section where role is checked:

```typescript
  const role = normalizeRole(profile.role);
  if (!role) return null;
```

Replace with:

```typescript
  const role = normalizeRole(profile.role);
  if (!role) {
    console.warn(`[auth] User ${userId} has unrecognised role "${profile.role}" — treating as unauthenticated`);
    return null;
  }
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth.ts
git commit -m "fix: log warning when role normalisation returns null"
```

---

## Chunk 4: Medium-Severity Fixes (M1-M8)

### Task 12: Tighten event bookings RLS

**Files:**
- Create: `supabase/migrations/20260410120002_tighten_event_bookings_rls.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Tighten event_bookings RLS: scope by role and venue instead of any authenticated user.
-- Defence-in-depth — app-layer checks (C3) are the primary control because
-- booking helpers use the admin client.

-- Drop overly permissive policies
drop policy if exists "staff_read_bookings" on public.event_bookings;
drop policy if exists "staff_update_bookings" on public.event_bookings;

-- Central planners see all bookings
create policy "planner_read_bookings" on public.event_bookings
  for select to authenticated
  using (
    public.current_user_role() = 'central_planner'
  );

-- Venue managers see bookings for events at their venue
create policy "venue_manager_read_bookings" on public.event_bookings
  for select to authenticated
  using (
    public.current_user_role() = 'venue_manager'
    and exists (
      select 1 from public.events e
      where e.id = event_bookings.event_id
        and e.venue_id = (select venue_id from public.users where id = auth.uid())
    )
  );

-- Central planners can update any booking
create policy "planner_update_bookings" on public.event_bookings
  for update to authenticated
  using (
    public.current_user_role() = 'central_planner'
  );

-- Venue managers can update bookings for events at their venue
create policy "venue_manager_update_bookings" on public.event_bookings
  for update to authenticated
  using (
    public.current_user_role() = 'venue_manager'
    and exists (
      select 1 from public.events e
      where e.id = event_bookings.event_id
        and e.venue_id = (select venue_id from public.users where id = auth.uid())
    )
  );
```

- [ ] **Step 2: Test and apply migration**

```bash
npx supabase db push --dry-run && npx supabase db push
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260410120002_tighten_event_bookings_rls.sql
git commit -m "fix: tighten event_bookings RLS to scope by role and venue"
```

---

### Task 13: Fix executive inspiration dismissal

**Files:**
- Modify: `src/actions/planning.ts`

- [ ] **Step 1: Change role check**

In `src/actions/planning.ts`, find `dismissInspirationItemAction` (around line 610). Find:

```typescript
  if (!canViewPlanning(user.role)) {
```

Replace with:

```typescript
  if (!canUsePlanning(user.role)) {
```

Update the import at the top of the file to include `canUsePlanning` if not already imported:

```typescript
import { canUsePlanning } from "@/lib/roles";
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/planning.ts
git commit -m "fix: restrict inspiration dismissal to central_planner (canUsePlanning)"
```

---

### Task 14: Align lockout windows and add login_attempts cleanup

**Files:**
- Modify: `src/lib/auth/session.ts`

- [ ] **Step 1: Fix isLockedOut to use the same window as recording**

In `src/lib/auth/session.ts`, find `isLockedOut`. The current query checks `LOCKOUT_DURATION_MINUTES` (30 minutes). Change it to use `LOCKOUT_WINDOW_MINUTES` (15 minutes) for counting failures, while keeping the lockout duration at 30 minutes:

The logic should be: count failures in the last LOCKOUT_WINDOW_MINUTES (15). If >= LOCKOUT_THRESHOLD (5), check if the most recent failure is within LOCKOUT_DURATION_MINUTES (30) — if so, locked out.

Review the exact current implementation and ensure the recording window and checking window are consistent. If `isLockedOut` counts failures over 30 minutes but `recordFailedLoginAttempt` counts over 15 minutes, align both to 15 minutes for counting, with the lockout lasting 30 minutes from the last failure.

- [ ] **Step 2: Add login_attempts cleanup to cleanupExpiredSessions**

In `src/lib/auth/session.ts`, find `cleanupExpiredSessions`. After the existing session cleanup, add:

```typescript
  // Clean up stale login_attempts (older than lockout duration)
  const attemptCutoff = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString();
  await db.from("login_attempts").delete().lt("attempted_at", attemptCutoff);
```

- [ ] **Step 3: Run type check and tests**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/session.ts
git commit -m "fix: align lockout windows and add login_attempts cleanup"
```

---

### Task 15: Remove public API notes leak

**Files:**
- Modify: `src/lib/public-api/events.ts`

- [ ] **Step 1: Remove notes fallback**

In `src/lib/public-api/events.ts`, find the `toPublicEvent` function. Find where `description` is set with a fallback to `notes`. Change it to only use `public_description`:

Find the line that looks like:

```typescript
    description: event.public_description || event.notes || null,
```

Replace with:

```typescript
    description: event.public_description || null,
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/public-api/events.ts
git commit -m "fix: remove internal notes fallback from public API event response"
```

---

### Task 16: Add structured logging to cron endpoints

**Files:**
- Modify: `src/app/api/cron/cleanup-auth/route.ts`
- Modify: `src/app/api/cron/refresh-inspiration/route.ts`
- Modify: `src/app/api/cron/sms-post-event/route.ts`
- Modify: `src/app/api/cron/sms-reminders/route.ts`

- [ ] **Step 1: Add logging to each cron route**

In each cron route's handler function, add a structured log entry after the auth check passes and before the main work:

```typescript
  console.log(JSON.stringify({
    event: "cron.invoked",
    endpoint: "<endpoint-name>",
    ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown",
    timestamp: new Date().toISOString()
  }));
```

Replace `<endpoint-name>` with the specific route name: `"cleanup-auth"`, `"refresh-inspiration"`, `"sms-post-event"`, `"sms-reminders"`.

Also add a log at the end:

```typescript
  console.log(JSON.stringify({
    event: "cron.completed",
    endpoint: "<endpoint-name>",
    timestamp: new Date().toISOString()
  }));
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/
git commit -m "fix: add structured logging to cron endpoints"
```

---

### Task 17: Add venue-scoped event visibility for venue managers

**Files:**
- Create: `supabase/migrations/20260410120003_venue_manager_event_visibility.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Allow venue managers to see all events at their venue, not just their own.
-- Current policy only allows created_by or assignee_id access.

-- Drop the existing venue_manager SELECT condition and replace
-- The current events SELECT policy is in 20260225000003_schema_integrity.sql
-- We need to drop and recreate it.

drop policy if exists "events_select_policy" on public.events;

create policy "events_select_policy" on public.events
  for select to authenticated
  using (
    deleted_at is null
    and (
      -- Central planners, reviewers, and executives see all events
      public.current_user_role() in ('central_planner', 'reviewer', 'executive')
      -- Venue managers see all events at their venue
      or (
        public.current_user_role() = 'venue_manager'
        and (
          created_by = auth.uid()
          or assignee_id = auth.uid()
          or venue_id = (select venue_id from public.users where id = auth.uid())
        )
      )
    )
  );
```

- [ ] **Step 2: Verify the existing policy name**

```bash
grep -n "create policy.*events" supabase/migrations/20260225000003_schema_integrity.sql
```

Ensure the policy name in the DROP statement matches exactly.

- [ ] **Step 3: Test and apply migration**

```bash
npx supabase db push --dry-run && npx supabase db push
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260410120003_venue_manager_event_visibility.sql
git commit -m "feat: allow venue managers to see all events at their venue"
```

---

### Task 18: Documentation comments (M8 + L1)

**Files:**
- Modify: `src/actions/customers.ts`
- Modify: `src/actions/artists.ts`

- [ ] **Step 1: Add GDPR intent comment to deleteCustomerAction**

In `src/actions/customers.ts`, add a comment above the role check in `deleteCustomerAction`:

```typescript
  // GDPR erasure — intentionally restricted to central_planner only.
  // No venue scoping needed: this is a privileged administrative action.
  if (user.role !== "central_planner") {
```

- [ ] **Step 2: Add intent comment to restoreArtistAction**

In `src/actions/artists.ts`, add a comment above the role check in `restoreArtistAction`:

```typescript
  // Intentionally planner-only: venue managers can archive but must
  // escalate to a planner to restore. The restore UI is on /settings (planner-only).
  if (user.role !== "central_planner") {
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/customers.ts src/actions/artists.ts
git commit -m "docs: add intent comments to GDPR erasure and artist restore restrictions"
```

---

## Deferred: M5 — Booking Idempotency

Booking double-submit prevention (M5) is deferred from this plan because it requires a product decision on the deduplication key — options include (event_id + mobile + time window) or a client-generated idempotency token. The fix should be planned separately after the deduplication strategy is agreed.

---

## Chunk 5: Verification

### Task 19: Full verification pipeline

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: zero errors, zero warnings.

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: clean compilation.

- [ ] **Step 3: Tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: successful production build.

- [ ] **Step 5: Migration dry run**

```bash
npx supabase db push --dry-run
```

Expected: all 4 new migrations apply cleanly.
