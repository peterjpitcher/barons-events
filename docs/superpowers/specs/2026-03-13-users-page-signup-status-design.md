# Users Page — Signup Status, Last Login & Resend Invite

**Date:** 2026-03-13
**Status:** Approved

---

## Overview

Enhance the `/users` page so central planners can see at a glance whether each invited user has accepted their invite and when they last signed in, and can resend the invite to users who are still pending.

---

## 1. Data Layer

### New type

```ts
export type EnrichedUser = AppUserRow & {
  emailConfirmedAt: Date | null;
  lastSignInAt: Date | null;
};
```

### New function: `listUsersWithAuthData()` in `src/lib/users.ts`

1. Fetches all rows from the public `users` table (existing logic, unchanged).
2. Pages through `supabase.auth.admin.listUsers({ perPage: 1000 })` using a `do-while` loop. The response shape is `{ data: { users, nextPage, lastPage, total }, error }` — `users` is nested under `data.users`. Fetch page 1 unconditionally, accumulate `data.users` into the result array, then continue fetching `data.nextPage` while `response.data.nextPage !== null`. This is reliable because the API explicitly sets `nextPage: null` on the final page regardless of record count — do not use a `length === perPage` heuristic.
3. Builds a `Map<string, { emailConfirmedAt: Date | null; lastSignInAt: Date | null }>` keyed by `id` for O(1) lookup.
4. Merges into `EnrichedUser[]` by iterating the public `users` rows. If a public `users` row has no corresponding auth record (e.g. a rollback left an orphaned DB row), it is included with `emailConfirmedAt: null, lastSignInAt: null` rather than excluded.
5. Auth records with no matching public `users` row (orphaned auth users) are not shown — the merge is driven by the public `users` table.

The users page (`src/app/users/page.tsx`) switches from `listUsers()` to `listUsersWithAuthData()` and passes `EnrichedUser[]` to `UsersManager`.

---

## 2. Resend Invite Server Action

New `resendInviteAction` in `src/actions/users.ts`.

**Signature** (two-argument form required by `useActionState`):

```ts
export async function resendInviteAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult>
```

**Input (FormData):** `userId`, `email`, `fullName`

`role` and `venueId` are intentionally excluded — this action only resends the email and does not update the user's role or venue assignment. `fullName` is included solely to personalise the invite email greeting via the `data` payload passed to `generateLink`.

**Steps:**

1. Auth check — current user must be `central_planner`.
2. Call `adminClient.auth.admin.getUserById(userId)` to fetch the target user's auth record. If the returned user has `email_confirmed_at` set (non-null), return `{ success: false, message: "This user has already accepted their invite." }`.
3. Build `confirmUrl` from `resolveAppUrl()` (same as `inviteUserAction`).
4. Call `adminClient.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name: fullName ?? undefined }, redirectTo: confirmUrl } })`. On error, return `{ success: false, message: "Invitation failed. Please try again." }`.
5. Call `sendInviteEmail(email, actionLink, fullName)`. If it returns `false`, return `{ success: false, message: "Invite created but the email failed to send. Please try again." }`.
6. Hash the email for the audit log: `const emailHash = await hashEmailForAudit(email)` (SHA-256 — required by the workspace auth standard; never log plaintext email).
7. Call `logAuthEvent({ event: "auth.invite.resent", userId: currentUser.id, emailHash, meta: { inviteeId: userId } })`.
8. No `revalidatePath` call is needed — resending the invite does not change any column in the `users` table or affect the invitee's pending status. The Supabase client queries in `listUsersWithAuthData()` do not go through the Next.js fetch cache (they use the Supabase JS client, not `fetch()`), so `router.refresh()` in the client will trigger a fresh server render that re-queries the database directly.
9. Return `{ success: true, message: "Invite resent." }`.

---

## 3. UI Changes

### Status logic

| Condition | Status | Colour |
|-----------|--------|--------|
| `emailConfirmedAt === null` | Pending | Amber |
| `emailConfirmedAt !== null` | Active | Green |

### Last login formatting

Add `formatRelativeTime(date: Date | null): string` to `src/lib/datetime.ts` using `Intl.RelativeTimeFormat("en-GB", { numeric: "auto" })`. Returns "Never signed in" when `date` is null. Note: the value is computed at SSR time and is accurate at the moment of page render; it does not live-update in the browser (acceptable for this use case).

### Desktop table (`UserDesktopRow`)

The Name column is widened from `minmax(0,2fr)` to `minmax(0,2.5fr)` in both the header row and the data row grid to accommodate three lines of content. The overall column definition becomes:

```
grid-cols-[minmax(0,2.5fr)_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_auto]
```

The Name cell renders:

- **Line 1:** existing full-name `<Input>`
- **Line 2:** coloured dot + "Active" or "Pending" label (small, muted) + `·` separator + last login hint (e.g. "Last login yesterday" or "Never signed in")
- **Pending only — Line 3:** `<ResendInviteButton>` rendered below the status line

`UserDesktopRow` prop type updates from `user: AppUserRow` to `user: EnrichedUser`.

### Mobile card (`UserCardMobile`)

- Status badge (Active / Pending pill) added below the user's name in the card header
- Last login text in muted style below the email
- Pending only: `<ResendInviteButton>` at the bottom of the card content, above the save button

`UserCardMobile` prop type updates from `user: AppUserRow` to `user: EnrichedUser`.

### `UsersManager`

Prop type updates from `users: AppUserRow[]` to `users: EnrichedUser[]`. No other changes — it passes the enriched user straight through to `UserCardMobile` and `UserDesktopRow`.

### `ResendInviteButton` component

New standalone `'use client'` component at `src/components/users/resend-invite-button.tsx`.

- Uses `useActionState(resendInviteAction, undefined)` independently from the update form's `useActionState` hook.
- Renders a `<form>` with hidden inputs: `userId`, `email`, `fullName`.
- Button: small text-style with a mail icon (`<Mail className="h-3 w-3" />`).
- On success: toasts "Invite resent to {email}" and calls `router.refresh()` to reload the page.
- On failure: toasts the error message.

---

## 4. Audit Log

Add `"auth.invite.resent"` to the `AuthEventType` union in `src/lib/audit-log.ts`. Note: `AuthEventType` is a private (unexported) type within that file — no import sites need updating, only the union literal itself.

---

## 5. Files Changed

| File | Change |
|------|--------|
| `src/lib/users.ts` | Add `EnrichedUser` type and `listUsersWithAuthData()` |
| `src/lib/datetime.ts` | Add `formatRelativeTime()` helper |
| `src/lib/audit-log.ts` | Add `"auth.invite.resent"` to private `AuthEventType` union |
| `src/app/users/page.tsx` | Switch to `listUsersWithAuthData()` |
| `src/components/users/users-manager.tsx` | Update prop types on `UsersManager`, `UserCardMobile`, `UserDesktopRow`; add status/last-login UI; render `ResendInviteButton` for pending users |
| `src/components/users/resend-invite-button.tsx` | New `ResendInviteButton` client component |
| `src/actions/users.ts` | Add `resendInviteAction` |
| `src/lib/auth/__tests__/invite.test.ts` | Append new `describe("resendInviteAction")` block; add `resendInviteAction` to the import line; add `mockGetUserById` to the hoisted mock state and the admin stub |

---

## 6. Error Handling & Edge Cases

- **User already active:** UI does not render the resend button; server-side `getUserById` check guards regardless.
- **`listUsersWithAuthData()` throws:** Propagates up to the page error boundary (consistent with existing `listUsers()` behaviour).
- **Resend email fails:** Returns `{ success: false }` so admin sees the error rather than false success.
- **No auth metadata match for a public user row:** Treated as `emailConfirmedAt: null, lastSignInAt: null` — user shown as Pending.
- **Orphaned auth record (auth user with no public row):** Not shown — merge is driven by the public `users` table.

---

## 7. Testing

Append a new `describe("resendInviteAction")` block to `src/lib/auth/__tests__/invite.test.ts`. Required additions to that file:

- Import: add `resendInviteAction` to the existing import from `"@/actions/users"`.
- Hoisted mock state: add a `getUserByIdResult` field to the shared `state` object with a default resolved value of `{ data: { user: { email_confirmed_at: null } }, error: null }` (a pending user). Add `mockGetUserById = vi.fn().mockImplementation(() => Promise.resolve(state.getUserByIdResult))`.
- Admin stub: add `getUserById: mockGetUserById` alongside the existing `generateLink` and `deleteUser` entries in the `auth.admin` mock object.

Tests:

1. **Non-planner rejected** — `getCurrentUser` returns non-planner; action returns `success: false` without calling `getUserById`.
2. **Active user rejected** — set `state.getUserByIdResult = { data: { user: { email_confirmed_at: "2026-01-01T00:00:00Z" } }, error: null }`; action returns `success: false` with message matching "already accepted".
3. **Happy path** — `getUserById` returns unconfirmed user → `generateLink` called → `sendInviteEmail` called → `logAuthEvent` called with `event: "auth.invite.resent"` → returns `{ success: true }`.
4. **Email delivery failure** — `sendInviteEmail` returns `false`; action returns `{ success: false }`.
5. **`generateLink` failure** — error returned; action returns `{ success: false }` without calling `sendInviteEmail`.
