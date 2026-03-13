# Users Page — Signup Status, Last Login & Resend Invite Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the `/users` page with signup status (Active/Pending), last login time, and a per-row "Resend invite" button for pending users.

**Architecture:** A new `listUsersWithAuthData()` server function merges the public `users` table with Supabase auth metadata (fetched via the Admin client). A new `resendInviteAction` server action handles resends with the same `generateLink` + Resend pattern as the existing invite flow. A standalone `ResendInviteButton` client component holds its own `useActionState` to avoid interfering with the per-row update form.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Supabase JS v2 (`@supabase/supabase-js`), Tailwind CSS, Sonner toasts, Lucide icons, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-13-users-page-signup-status-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/datetime.ts` | Modify | Add `formatRelativeTime()` helper |
| `src/lib/audit-log.ts` | Modify | Add `"auth.invite.resent"` to `AuthEventType` union |
| `src/lib/users.ts` | Modify | Add `EnrichedUser` type + `listUsersWithAuthData()` |
| `src/actions/users.ts` | Modify | Add `resendInviteAction` |
| `src/lib/auth/__tests__/invite.test.ts` | Modify | Append `describe("resendInviteAction")` block |
| `src/components/users/resend-invite-button.tsx` | Create | Standalone client component for resend |
| `src/components/users/users-manager.tsx` | Modify | Prop types → `EnrichedUser`; status/last-login UI; render `ResendInviteButton` |
| `src/app/users/page.tsx` | Modify | Switch `listUsers()` → `listUsersWithAuthData()` |

---

## Chunk 1: Utilities, Data Layer & Tests

### Task 1: Add `formatRelativeTime` to datetime utilities

**Files:**
- Modify: `src/lib/datetime.ts`

- [ ] **Step 1: Add `formatRelativeTime` at the bottom of `src/lib/datetime.ts`**

  Append this function after the existing exports:

  ```typescript
  /**
   * Returns a human-readable relative time string for display (e.g. "3 days ago", "yesterday").
   * Returns "Never signed in" when date is null.
   * Value is computed at call time (SSR) — it does not live-update in the browser.
   */
  export function formatRelativeTime(date: Date | null): string {
    if (!date) return "Never signed in";

    const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
    const diffMs = date.getTime() - Date.now();
    const absDiffMs = Math.abs(diffMs);

    if (absDiffMs < 60_000) {
      return rtf.format(Math.round(diffMs / 1000), "second");
    }
    if (absDiffMs < 3_600_000) {
      return rtf.format(Math.round(diffMs / 60_000), "minute");
    }
    if (absDiffMs < 86_400_000) {
      return rtf.format(Math.round(diffMs / 3_600_000), "hour");
    }
    if (absDiffMs < 2_592_000_000) {
      return rtf.format(Math.round(diffMs / 86_400_000), "day");
    }
    if (absDiffMs < 31_536_000_000) {
      return rtf.format(Math.round(diffMs / 2_592_000_000), "month");
    }
    return rtf.format(Math.round(diffMs / 31_536_000_000), "year");
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

  ```bash
  npm run typecheck
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/datetime.ts
  git commit -m "feat: add formatRelativeTime utility to datetime helpers"
  ```

---

### Task 2: Add `"auth.invite.resent"` to the audit log type

**Files:**
- Modify: `src/lib/audit-log.ts`

- [ ] **Step 1: Open `src/lib/audit-log.ts` and find the `AuthEventType` union (around line 53)**

  The union currently ends with `"auth.session.expired.absolute"`. Add the new member:

  ```typescript
  // Before:
  type AuthEventType =
    | "auth.login.success"
    | "auth.login.failure"
    | "auth.lockout"
    | "auth.logout"
    | "auth.password_reset.requested"
    | "auth.password_updated"
    | "auth.invite.sent"
    | "auth.invite.accepted"
    | "auth.role.changed"
    | "auth.session.expired.idle"
    | "auth.session.expired.absolute";

  // After (add the new member at the end):
  type AuthEventType =
    | "auth.login.success"
    | "auth.login.failure"
    | "auth.lockout"
    | "auth.logout"
    | "auth.password_reset.requested"
    | "auth.password_updated"
    | "auth.invite.sent"
    | "auth.invite.accepted"
    | "auth.invite.resent"
    | "auth.role.changed"
    | "auth.session.expired.idle"
    | "auth.session.expired.absolute";
  ```

  Note: `AuthEventType` is a private type (not exported). No import sites need updating.

- [ ] **Step 2: Verify TypeScript compiles cleanly**

  ```bash
  npm run typecheck
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/audit-log.ts
  git commit -m "feat: add auth.invite.resent to audit event type"
  ```

---

### Task 3: Add `EnrichedUser` type and `listUsersWithAuthData()` to users lib

**Files:**
- Modify: `src/lib/users.ts`

- [ ] **Step 1: Add imports at the top of `src/lib/users.ts`**

  The file currently imports:
  ```typescript
  import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
  ```

  Add after it:
  ```typescript
  import { createSupabaseAdminClient } from "@/lib/supabase/admin";
  import type { User as SupabaseUser } from "@supabase/supabase-js";
  ```

  `SupabaseUser` is the type returned by `auth.admin.listUsers()`. Importing it avoids the TypeScript strict error that occurs when pushing `AuthUser[]` (which has many fields) into a narrowly-typed inline array.

- [ ] **Step 2: Add the `EnrichedUser` type directly after the existing `AppUserRow` export**

  ```typescript
  export type EnrichedUser = AppUserRow & {
    emailConfirmedAt: Date | null;
    lastSignInAt: Date | null;
  };
  ```

- [ ] **Step 3: Add `listUsersWithAuthData()` after the existing `listUsers()` function**

  ```typescript
  type AuthMeta = {
    emailConfirmedAt: Date | null;
    lastSignInAt: Date | null;
  };

  export async function listUsersWithAuthData(): Promise<EnrichedUser[]> {
    // 1. Fetch public users table
    const supabase = await createSupabaseReadonlyClient();
    const { data: publicUsers, error: usersError } = await supabase
      .from("users")
      .select("*")
      .order("full_name", { ascending: true });

    if (usersError) {
      throw new Error(`Could not load users: ${usersError.message}`);
    }

    // 2. Page through auth users using the API's nextPage cursor.
    //    Default page size is 50 — use 1000 to minimise round-trips.
    //    Loop terminates when data.nextPage === null (set by Supabase on the last page).
    const adminClient = createSupabaseAdminClient();
    // Type as SupabaseUser[] so data.users (User[]) can be pushed directly without TypeScript
    // rejecting a narrower inline array type.
    const allAuthUsers: SupabaseUser[] = [];
    let page = 1;

    do {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(`Could not fetch auth users: ${error.message}`);
      allAuthUsers.push(...data.users);
      if (!data.nextPage) break;   // null on last page; also guards undefined
      page = data.nextPage;
    } while (true);

    // 3. Build O(1) lookup map
    const authMap = new Map<string, AuthMeta>(
      allAuthUsers.map((u) => [
        u.id,
        {
          emailConfirmedAt: u.email_confirmed_at ? new Date(u.email_confirmed_at) : null,
          lastSignInAt: u.last_sign_in_at ? new Date(u.last_sign_in_at) : null
        }
      ])
    );

    // 4. Merge: public users drive the list. Missing auth record → treat as pending.
    return (publicUsers ?? []).map((user) => {
      const meta = authMap.get(user.id) ?? { emailConfirmedAt: null, lastSignInAt: null };
      return { ...user, ...meta };
    });
  }
  ```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

  ```bash
  npm run typecheck
  ```

  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/users.ts
  git commit -m "feat: add EnrichedUser type and listUsersWithAuthData"
  ```

---

## Chunk 2: Server Action & Tests

### Task 4: Add `resendInviteAction` server action

**Files:**
- Modify: `src/actions/users.ts`

- [ ] **Step 1: Add `sendInviteEmail` is already imported — verify it and add `resendInviteAction` at the bottom of `src/actions/users.ts`**

  The file already imports `sendInviteEmail`, `createSupabaseAdminClient`, `resolveAppUrl`, `getCurrentUser`, `logAuthEvent`, `hashEmailForAudit`, and `ActionResult`. No new imports needed.

  > **Note — `revalidatePath` is intentionally absent from this action.** Resending an invite does not write to the `users` table or change the invitee's `email_confirmed_at` status, so there is nothing to revalidate in the Next.js cache. The `listUsersWithAuthData()` function bypasses the fetch cache (it calls the Supabase JS client directly, not `fetch()`), so the `router.refresh()` call in `ResendInviteButton` triggers a fresh server render that re-queries the DB. Do not add `revalidatePath("/users")` here.

  Append at the end of the file:

  ```typescript
  export async function resendInviteAction(
    _: ActionResult | undefined,
    formData: FormData
  ): Promise<ActionResult> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      redirect("/login");
    }
    if (currentUser.role !== "central_planner") {
      return { success: false, message: "Only planners can resend invites." };
    }

    // Validate inputs — consistent with the Zod pattern used in inviteUserAction and updateUserAction.
    // `z` is already imported in this file (used by existing schemas above).
    const resendSchema = z.object({
      userId: z.string().uuid(),
      email: z.string().email({ message: "Enter a valid email" }),
      fullName: z.string().max(120).optional()
    });

    const parsed = resendSchema.safeParse({
      userId: formData.get("userId"),
      email: formData.get("email"),
      fullName: typeof formData.get("fullName") === "string" ? formData.get("fullName") : undefined
    });

    if (!parsed.success) {
      return { success: false, message: "Missing required fields." };
    }

    const userId = parsed.data.userId;
    const email = parsed.data.email;
    const fullName = parsed.data.fullName ?? null;   // undefined → null, consistent with inviteUserAction pattern

    const adminClient = createSupabaseAdminClient();

    // Verify the user hasn't already confirmed their email
    const { data: authData, error: getUserError } = await adminClient.auth.admin.getUserById(userId);
    if (getUserError) {
      console.error("[resend-invite] getUserById failed:", getUserError.message);
      return { success: false, message: "Could not verify invite status. Please try again." };
    }
    if (authData?.user?.email_confirmed_at) {   // double-guard: authData itself can be null
      return { success: false, message: "This user has already accepted their invite." };
    }

    const confirmUrl = new URL("/auth/confirm", resolveAppUrl()).toString();

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: { full_name: fullName ?? undefined },
        redirectTo: confirmUrl
      }
    });

    if (linkError) {
      console.error("[resend-invite] generateLink failed:", linkError.status, linkError.message);
      if (linkError.status === 429) {
        return { success: false, message: "Too many invitations sent recently. Please wait a few minutes and try again." };
      }
      return { success: false, message: "Invitation failed. Please try again." };
    }

    const actionLink = linkData?.properties?.action_link ?? null;

    // For a resend action the entire purpose is sending an email, so a missing action_link
    // (generateLink succeeded but returned no link) is treated as an error rather than a silent skip.
    if (!actionLink) {
      console.error("[resend-invite] generateLink returned no action_link for", email);
      return { success: false, message: "Invitation failed. Please try again." };
    }

    const sent = await sendInviteEmail(email, actionLink, fullName);
    if (!sent) {
      console.error("[resend-invite] Resend failed to deliver invite email to", email);
      return { success: false, message: "Invite created but the email failed to send. Please try again." };
    }

    const emailHash = await hashEmailForAudit(email);
    await logAuthEvent({
      event: "auth.invite.resent",
      userId: currentUser.id,
      emailHash,
      meta: { inviteeId: userId }
    });

    return { success: true, message: "Invite resent." };
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

  ```bash
  npm run typecheck
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/actions/users.ts
  git commit -m "feat: add resendInviteAction server action"
  ```

---

### Task 5: Write and run tests for `resendInviteAction`

**Files:**
- Modify: `src/lib/auth/__tests__/invite.test.ts`

- [ ] **Step 1: Update the hoisted mock state to add `getUserByIdResult` and `mockGetUserById`**

  Inside the `vi.hoisted(() => { ... })` block, extend the `state` object by adding the new field immediately after `sendInviteEmailResult`:

  ```typescript
  // Before (end of state object):
  sendInviteEmailResult: true as boolean
  ```

  ```typescript
  // After:
  sendInviteEmailResult: true as boolean,
  getUserByIdResult: {
    data: { user: { email_confirmed_at: null as string | null } },
    error: null as { message: string } | null
  }
  ```

  Add the mock function after `mockHashEmailForAudit`:

  ```typescript
  const mockGetUserById = vi.fn().mockImplementation(() => Promise.resolve(state.getUserByIdResult));
  ```

  Add `mockGetUserById` to the `return` statement inside `vi.hoisted`:

  ```typescript
  // Before:
  return {
    mockGenerateLink,
    mockDeleteUser,
    mockSendInviteEmail,
    mockUpsert,
    mockGetCurrentUser,
    mockRevalidatePath,
    mockLogAuthEvent,
    mockHashEmailForAudit,
    state
  };
  ```

  ```typescript
  // After:
  return {
    mockGenerateLink,
    mockDeleteUser,
    mockSendInviteEmail,
    mockUpsert,
    mockGetCurrentUser,
    mockRevalidatePath,
    mockLogAuthEvent,
    mockHashEmailForAudit,
    mockGetUserById,
    state
  };
  ```

  Add `mockGetUserById` to the destructuring at the top of the file:

  ```typescript
  // Before:
  const {
    mockGenerateLink,
    mockDeleteUser,
    mockSendInviteEmail,
    mockUpsert,
    mockGetCurrentUser,
    mockRevalidatePath,
    mockLogAuthEvent,
    mockHashEmailForAudit,
    state
  } = vi.hoisted(...)
  ```

  ```typescript
  // After:
  const {
    mockGenerateLink,
    mockDeleteUser,
    mockSendInviteEmail,
    mockUpsert,
    mockGetCurrentUser,
    mockRevalidatePath,
    mockLogAuthEvent,
    mockHashEmailForAudit,
    mockGetUserById,
    state
  } = vi.hoisted(...)
  ```

- [ ] **Step 2: Add `getUserById` to the admin client stub in the `vi.mock("@/lib/supabase/admin")` block**

  The `auth.admin` object currently has `generateLink` and `deleteUser`. Add `getUserById`:

  ```typescript
  auth: {
    admin: {
      generateLink: mockGenerateLink,
      deleteUser: mockDeleteUser,
      getUserById: mockGetUserById   // ← add this
    }
  },
  ```

- [ ] **Step 3: Add `resendInviteAction` to the import from `"@/actions/users"`**

  Change:
  ```typescript
  import { inviteUserAction } from "@/actions/users";
  ```
  To:
  ```typescript
  import { inviteUserAction, resendInviteAction } from "@/actions/users";
  ```

- [ ] **Step 4: Write the failing tests — append a new `describe("resendInviteAction")` block at the bottom of the file (after the closing `}` of the existing `describe("inviteUserAction")` block)**

  The new block has its own `beforeEach` that handles all state and mock resets independently. You do NOT need to add `mockGetUserById` to the existing `inviteUserAction` `beforeEach` — the two `describe` blocks are isolated, and `inviteUserAction` tests never call `getUserById`.

  ```typescript
  describe("resendInviteAction", () => {
    beforeEach(() => {
      vi.clearAllMocks();

      state.generateLinkResult = {
        data: {
          user: { id: "new-user-uuid" },
          properties: { action_link: "https://project.supabase.co/auth/v1/verify?token=abc123&type=invite&redirect_to=https://app.example.com/auth/confirm" }
        },
        error: null
      };
      state.getUserByIdResult = {
        data: { user: { email_confirmed_at: null } },
        error: null
      };
      state.sendInviteEmailResult = true;

      mockGetCurrentUser.mockResolvedValue(PLANNER_USER);
      mockGenerateLink.mockImplementation(() => Promise.resolve(state.generateLinkResult));
      mockGetUserById.mockImplementation(() => Promise.resolve(state.getUserByIdResult));
      mockSendInviteEmail.mockImplementation(() => Promise.resolve(state.sendInviteEmailResult));
      mockLogAuthEvent.mockResolvedValue(undefined);
      mockHashEmailForAudit.mockResolvedValue("mock-email-hash-64-char-hex-aabbcc");
    });

    // 1. Non-planner rejected
    it("should return an error when the current user is not a central_planner", async () => {
      mockGetCurrentUser.mockResolvedValue({ ...PLANNER_USER, role: "reviewer" });

      const result = await resendInviteAction(
        undefined,
        createFormData({ userId: "some-uuid", email: "user@example.com", fullName: "Test User" })
      );

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/only planners/i);
      expect(mockGetUserById).not.toHaveBeenCalled();
    });

    // 2. Active user rejected
    it("should return an error when the user has already confirmed their email", async () => {
      state.getUserByIdResult = {
        data: { user: { email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null
      };
      mockGetUserById.mockImplementation(() => Promise.resolve(state.getUserByIdResult));

      const result = await resendInviteAction(
        undefined,
        createFormData({ userId: "confirmed-uuid", email: "active@example.com", fullName: "" })
      );

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/already accepted/i);
      expect(mockGenerateLink).not.toHaveBeenCalled();
    });

    // 3. Happy path
    it("should call generateLink, send invite email, log auth.invite.resent, and return success", async () => {
      const result = await resendInviteAction(
        undefined,
        createFormData({ userId: "pending-uuid", email: "pending@example.com", fullName: "Pending User" })
      );

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/invite resent/i);

      expect(mockGetUserById).toHaveBeenCalledWith("pending-uuid");
      expect(mockGenerateLink).toHaveBeenCalledOnce();
      expect(mockSendInviteEmail).toHaveBeenCalledOnce();
      expect(mockSendInviteEmail).toHaveBeenCalledWith(
        "pending@example.com",
        expect.stringContaining("supabase.co"),
        "Pending User"
      );
      expect(mockLogAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: "auth.invite.resent" })
      );
    });

    // 4. Email delivery failure
    it("should return an error when Resend fails to deliver the resent invite email", async () => {
      state.sendInviteEmailResult = false;
      mockSendInviteEmail.mockResolvedValue(false);

      const result = await resendInviteAction(
        undefined,
        createFormData({ userId: "pending-uuid", email: "noemail@example.com", fullName: "" })
      );

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/email/i);
    });

    // 5. generateLink failure
    it("should return an error when generateLink fails and should not call sendInviteEmail", async () => {
      state.generateLinkResult = {
        data: null,
        error: { status: 500, message: "Internal server error" }
      };
      mockGenerateLink.mockImplementation(() => Promise.resolve(state.generateLinkResult));

      const result = await resendInviteAction(
        undefined,
        createFormData({ userId: "pending-uuid", email: "fail@example.com", fullName: "" })
      );

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/invitation failed/i);
      expect(mockSendInviteEmail).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 5: Run the full test suite to confirm all pass**

  ```bash
  npx vitest run src/lib/auth/__tests__/invite.test.ts 2>&1
  ```

  Expected: 13 tests pass (8 existing + 5 new).

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/auth/__tests__/invite.test.ts
  git commit -m "test: add resendInviteAction tests"
  ```

---

## Chunk 3: UI Components

### Task 6: Create `ResendInviteButton` component

**Files:**
- Create: `src/components/users/resend-invite-button.tsx`

- [ ] **Step 1: Create the file**

  ```typescript
  "use client";

  import { useActionState, useEffect } from "react";
  import { useRouter } from "next/navigation";
  import { toast } from "sonner";
  import { Mail } from "lucide-react";
  import { resendInviteAction } from "@/actions/users";
  import type { ActionResult } from "@/lib/types";

  type ResendInviteButtonProps = {
    userId: string;
    email: string;
    fullName: string | null;
  };

  export function ResendInviteButton({ userId, email, fullName }: ResendInviteButtonProps) {
    const [state, formAction, isPending] = useActionState<ActionResult | undefined, FormData>(
      resendInviteAction,
      undefined
    );
    const router = useRouter();

    useEffect(() => {
      if (!state?.message) return;
      if (state.success) {
        toast.success(`Invite resent to ${email}`);
        router.refresh();
      } else {
        toast.error(state.message);
      }
    }, [state, email, router]);

    return (
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="fullName" value={fullName ?? ""} />
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-primary-700)] hover:underline disabled:opacity-50"
        >
          <Mail className="h-3 w-3" aria-hidden="true" />
          {isPending ? "Sending…" : "Resend invite"}
        </button>
      </form>
    );
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

  ```bash
  npm run typecheck
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/users/resend-invite-button.tsx
  git commit -m "feat: add ResendInviteButton client component"
  ```

---

### Task 7: Update `users-manager.tsx` — prop types, status/last-login UI, render ResendInviteButton

**Files:**
- Modify: `src/components/users/users-manager.tsx`

- [ ] **Step 1: Add new imports at the top of `users-manager.tsx`**

  Add alongside the existing imports:

  ```typescript
  import type { EnrichedUser } from "@/lib/users";
  import { formatRelativeTime } from "@/lib/datetime";
  import { ResendInviteButton } from "@/components/users/resend-invite-button";
  ```

- [ ] **Step 2: Update `UsersManagerProps` to use `EnrichedUser` instead of `AppUserRow`**

  ```typescript
  // Before:
  type UsersManagerProps = {
    users: AppUserRow[];
    venues: VenueRow[];
  };

  // After:
  type UsersManagerProps = {
    users: EnrichedUser[];
    venues: VenueRow[];
  };
  ```

- [ ] **Step 3: Update `UserCardMobile` prop type and add status/last-login UI**

  Change its signature:
  ```typescript
  // Before:
  function UserCardMobile({ user, venues }: { user: AppUserRow; venues: VenueRow[] }) {
  // After:
  function UserCardMobile({ user, venues }: { user: EnrichedUser; venues: VenueRow[] }) {
  ```

  In the `<CardHeader>`, after the existing name/email/role content, add the status badge and last login. The `CardHeader` currently contains:

  ```tsx
  <div>
    <CardTitle className="text-lg text-[var(--color-primary-700)]">{user.full_name ?? user.email}</CardTitle>
    <CardDescription>{user.email}</CardDescription>
  </div>
  <p className="rounded-full bg-muted-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
    {roleLabels[user.role]}
  </p>
  ```

  Replace with:

  ```tsx
  <div className="flex-1 min-w-0">
    <CardTitle className="text-lg text-[var(--color-primary-700)]">{user.full_name ?? user.email}</CardTitle>
    <CardDescription>{user.email}</CardDescription>
    <div className="mt-1 flex items-center gap-1.5">
      <span
        className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${
          user.emailConfirmedAt ? "bg-green-500" : "bg-amber-400"
        }`}
        aria-hidden="true"
      />
      <span className="text-xs text-[var(--color-text-muted)]">
        {user.emailConfirmedAt ? "Active" : "Pending"}
        {" · "}
        {formatRelativeTime(user.lastSignInAt)}
      </span>
    </div>
  </div>
  <p className="flex-shrink-0 rounded-full bg-muted-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
    {roleLabels[user.role]}
  </p>
  ```

  In `<CardContent>`, add `ResendInviteButton` for pending users just before the closing `</form>` tag (before the save button div):

  ```tsx
  {!user.emailConfirmedAt && (
    <div className="md:col-span-2">
      <ResendInviteButton
        userId={user.id}
        email={user.email}
        fullName={user.full_name}
      />
    </div>
  )}
  ```

- [ ] **Step 4: Update `UserDesktopList` prop type**

  It receives `users: AppUserRow[]` via `UsersManagerProps` — this is already covered by updating `UsersManagerProps` above. No separate change needed here.

- [ ] **Step 5: Update `UserDesktopRow` prop type and widen the Name column**

  Change its signature:
  ```typescript
  // Before:
  function UserDesktopRow({ user, venues, isFirst }: { user: AppUserRow; venues: VenueRow[]; isFirst: boolean }) {
  // After:
  function UserDesktopRow({ user, venues, isFirst }: { user: EnrichedUser; venues: VenueRow[]; isFirst: boolean }) {
  ```

  In `UserDesktopList`, find the header row grid class and widen the Name column:
  ```tsx
  // Before:
  className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_auto] ..."
  // After:
  className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_auto] ..."
  ```

  In `UserDesktopRow`, find the form's grid class and apply the same change:
  ```tsx
  // Before:
  className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_auto] ..."
  // After:
  className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_auto] ..."
  ```

  In `UserDesktopRow`, find the Name cell (the first `<div>` in the form grid, which currently contains the full-name input). After the `<Input>`, add status/last-login and the resend button:

  ```tsx
  <div className="flex flex-col gap-1">
    <label className="sr-only" htmlFor={`desktop-fullName-${user.id}`}>
      Full name
    </label>
    <Input
      id={`desktop-fullName-${user.id}`}
      name="fullName"
      defaultValue={user.full_name ?? ""}
      placeholder="Full name"
    />
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${
          user.emailConfirmedAt ? "bg-green-500" : "bg-amber-400"
        }`}
        aria-hidden="true"
      />
      <span className="text-xs text-[var(--color-text-muted)]">
        {user.emailConfirmedAt ? "Active" : "Pending"}
        {" · "}
        {formatRelativeTime(user.lastSignInAt)}
      </span>
    </div>
    {!user.emailConfirmedAt && (
      <ResendInviteButton
        userId={user.id}
        email={user.email}
        fullName={user.full_name}
      />
    )}
  </div>
  ```

- [ ] **Step 6: Verify TypeScript compiles cleanly**

  ```bash
  npm run typecheck
  ```

  Expected: no errors.

- [ ] **Step 7: Run the full test suite**

  ```bash
  npm run test
  ```

  Expected: all tests pass.

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/users/users-manager.tsx
  git commit -m "feat: add signup status, last login and resend invite to users table"
  ```

---

### Task 8: Update the users page to use `listUsersWithAuthData`

**Files:**
- Modify: `src/app/users/page.tsx`

- [ ] **Step 1: Update the import in `src/app/users/page.tsx`**

  ```typescript
  // Before:
  import { listUsers } from "@/lib/users";
  // After:
  import { listUsersWithAuthData } from "@/lib/users";
  ```

- [ ] **Step 2: Update the data fetch call inside the page component**

  ```typescript
  // Before:
  const [users, venues] = await Promise.all([listUsers(), listVenues()]);
  // After:
  const [users, venues] = await Promise.all([listUsersWithAuthData(), listVenues()]);
  ```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

  ```bash
  npm run typecheck
  ```

  Expected: no errors.

- [ ] **Step 4: Run a production build to catch any SSR or import issues**

  ```bash
  npm run build
  ```

  Expected: build succeeds with no errors.

- [ ] **Step 5: Run the full test suite one final time**

  ```bash
  npm run test
  ```

  Expected: all tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add src/app/users/page.tsx
  git commit -m "feat: switch users page to listUsersWithAuthData for signup status"
  ```

---

## Final Verification

- [ ] Start the dev server and navigate to `/users`

  ```bash
  npm run dev
  ```

  Verify:
  - Each user row shows a green "Active" or amber "Pending" dot with status label
  - Last login hint appears (e.g. "3 days ago" or "Never signed in")
  - "Resend invite" link appears only for pending users
  - Clicking "Resend invite" shows a loading state, then toasts success/error
  - Active users show no resend button

- [ ] Run lint

  ```bash
  npm run lint
  ```

  Expected: zero warnings, zero errors.
