# Users Page — Signup Status, Last Login & Resend Invite

**Date:** 2026-03-13
**Status:** Approved

---

## Overview

Enhance the `/users` page so central planners can see at a glance whether each invited user has accepted their invite and when they last signed in, and can resend the invite to users who are still pending.

---

## 1. Data Layer

### Problem

The public `users` table (fetched by `listUsers()`) does not store signup status or last login time. These fields — `email_confirmed_at` and `last_sign_in_at` — live in Supabase's internal `auth.users` table and are only accessible via the Admin client.

### Solution

New function `listUsersWithAuthData()` in `src/lib/users.ts`:

1. Fetches all rows from the public `users` table (existing logic).
2. Calls `supabase.auth.admin.listUsers()` via the Admin client to retrieve auth metadata for all users in one batch call.
3. Merges by `id` to produce an `EnrichedUser[]` array.

New type:

```ts
export type EnrichedUser = AppUserRow & {
  emailConfirmedAt: Date | null;
  lastSignInAt: Date | null;
};
```

The users page (`src/app/users/page.tsx`) switches from `listUsers()` to `listUsersWithAuthData()` and passes `EnrichedUser[]` to `UsersManager`.

`UsersManager`, `UserDesktopList`, `UserDesktopRow`, and `UserCardMobile` prop types are updated from `AppUserRow` to `EnrichedUser`.

---

## 2. Resend Invite Server Action

New `resendInviteAction` in `src/actions/users.ts`.

**Input (FormData):** `userId`, `email`, `fullName`, `role`, `venueId`

**Steps:**

1. Auth check — current user must be `central_planner`.
2. Admin client verifies the target user's `email_confirmed_at` is still `null`. If the user has already confirmed, return `{ success: false, message: "This user has already accepted their invite." }`.
3. Calls `adminClient.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name }, redirectTo: confirmUrl } })`.
4. Calls `sendInviteEmail(email, actionLink, fullName)`.
5. If email delivery fails, returns `{ success: false, message: "Invite created but the email failed to send. Please try again." }`.
6. On success, logs `auth.invite.sent` audit event and returns `{ success: true, message: "Invite resent." }`.

**Defence in depth:** The UI only renders the resend button for pending users, but the action independently verifies `email_confirmed_at === null` server-side.

---

## 3. UI Changes

### Status logic

| Condition | Status | Colour |
|-----------|--------|--------|
| `emailConfirmedAt === null` | Pending | Amber |
| `emailConfirmedAt !== null` | Active | Green |

Last login formatted as a human-readable relative string ("Today", "3 days ago") or "Never signed in" if `lastSignInAt` is null. Uses `Intl.RelativeTimeFormat` or a small helper.

### Desktop table (`UserDesktopRow`)

Column grid is unchanged (`grid-cols-[2fr_2fr_1.5fr_2fr_auto]`). The Name cell grows to two lines:

- **Line 1:** existing full-name `<Input>`
- **Line 2:** `● Active` or `● Pending` dot + label (small, muted) + `·` + last login hint
- **Pending only — Line 3:** `<ResendInviteButton>` rendered below the status line

### Mobile card (`UserCardMobile`)

- Card header: status badge (Active / Pending pill) added below the user's name
- Below the email: last login text in muted style
- Pending only: "Resend invite" button at the bottom of the card content, above the save button

### `ResendInviteButton` component

Standalone `'use client'` component with its own `useActionState(resendInviteAction)`. Contains hidden inputs for `userId`, `email`, `fullName`, `role`, `venueId`. Renders as a small text-style button with a mail icon. On success, toasts "Invite resent to {email}". On failure, toasts the error message.

Kept separate from the update form so the two `useActionState` hooks don't interfere.

---

## 4. Files Changed

| File | Change |
|------|--------|
| `src/lib/users.ts` | Add `EnrichedUser` type and `listUsersWithAuthData()` |
| `src/app/users/page.tsx` | Switch to `listUsersWithAuthData()` |
| `src/components/users/users-manager.tsx` | Update prop types; add status/last-login UI; add `ResendInviteButton` |
| `src/actions/users.ts` | Add `resendInviteAction` |
| `src/lib/auth/__tests__/invite.test.ts` | Add tests for `resendInviteAction` |

---

## 5. Error Handling & Edge Cases

- **User already active:** Resend button not shown in UI; server action guards and returns a clear error.
- **`listUsers()` admin call fails:** Throw — page-level error boundary catches it (consistent with existing pattern).
- **Resend email fails:** Returns `{ success: false }` so admin sees the error rather than false success.
- **No auth metadata match:** If an auth user record is missing for a `users` row (shouldn't happen), treat as `emailConfirmedAt: null, lastSignInAt: null`.

---

## 6. Testing

New tests in `src/lib/auth/__tests__/invite.test.ts` for `resendInviteAction`:

- Non-planner is rejected
- Active user (email confirmed) is rejected
- Happy path: generates link, sends email, returns success
- Email delivery failure returns error
- Audit event logged on success
