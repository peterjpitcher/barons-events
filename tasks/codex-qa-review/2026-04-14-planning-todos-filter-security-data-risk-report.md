# Security & Data Risk Review: Planning Todos Filter Changes

**Date:** 2026-04-14
**Reviewer:** Security & Data Risk Reviewer (Adversarial Review System)
**Scope:** currentUserId prop, alert-based filtering, optimistic mark-done in planning board

---

## Findings

### SEC-001: currentUserId is securely server-sourced — NO VULNERABILITY

- **Type:** Authentication
- **Severity:** None (Informational)
- **Confidence:** High
- **OWASP:** N/A
- **Evidence:** `src/app/planning/page.tsx:14-40` — `currentUserId` is obtained from `getCurrentUser()` on the server and passed as a prop to `<PlanningBoard>`. The client component receives it as a read-only prop and never writes it back to a server action. The `togglePlanningTaskStatusAction` does not accept a userId parameter from the client — it calls `ensureUser()` internally (line 446 of `src/actions/planning.ts`), which independently verifies the session.
- **Exploit Scenario:** None. A client cannot spoof `currentUserId` in any way that affects server-side authorization. The prop is used purely for client-side UX sorting/filtering.
- **Disposition:** **No action required.**

---

### SEC-002: "My tasks" filter is client-side only — acceptable UX-only behaviour

- **Type:** Authorization
- **Severity:** None (Informational)
- **Confidence:** High
- **OWASP:** N/A
- **Evidence:** `src/components/planning/planning-todos-by-person-view.tsx:142-145` — `visibleGroups` filters by `currentUserId` client-side. The full `items` array (all planning items the user is authorized to see) is already fetched server-side and passed as props.
- **Exploit Scenario:** None. The "Show everyone" toggle (line 189-206) reveals tasks that the user already has server-side authorization to view via `canViewPlanning()`. Both `central_planner` and `executive` roles are intended to see all planning items. This is by design, not a data leak.
- **Disposition:** **No action required.** The toggle is a UX convenience, not a security boundary.

---

### SEC-003: togglePlanningTaskStatusAction re-verifies auth server-side — SECURE

- **Type:** Authentication / Authorization
- **Severity:** None (Informational)
- **Confidence:** High
- **OWASP:** N/A
- **Evidence:** `src/actions/planning.ts:445-461` — The action calls `ensureUser()` (line 446) which calls `getCurrentUser()` and checks `canUsePlanning(user.role)`. Only `central_planner` role passes this check (`src/lib/roles.ts:51-53`). Input is validated with Zod (`z.object({ taskId: uuidSchema, status: taskStatusSchema })`).
- **Exploit Scenario:** An `executive` (read-only) user could attempt to call the server action directly. This is correctly blocked by `ensureUser()` which requires `canUsePlanning` (central_planner only). However, see SEC-004 for a related concern.
- **Disposition:** **No action required.**

---

### SEC-004: Executive role sees mark-done checkbox despite lacking write permission

- **Type:** Authorization (UI leaks capability)
- **Severity:** Low
- **Confidence:** High
- **OWASP:** A01:2021 — Broken Access Control
- **Evidence:** `src/components/planning/planning-todos-by-person-view.tsx:264-270` — The checkbox button for marking tasks as done is rendered unconditionally for all users viewing the todos view. The `PlanningBoard` component does not pass any write-permission flag to `PlanningTodosByPersonView`. An `executive` role user will see the checkbox, click it, get an optimistic UI update, then receive an error toast when the server rejects it.
- **Exploit Scenario:** An executive user clicks "mark done" on a task. The UI optimistically hides the task. The server returns `{ success: false }` because `ensureUser()` rejects the non-central_planner role. The task reappears with an error toast. No data corruption occurs, but the UX is misleading and creates momentary stale state.
- **Disposition:** **Advisory.** The server correctly blocks the mutation, so no actual security breach. However, the UI should conditionally hide or disable the mark-done checkbox when the user lacks write permission. Pass a `canEdit` prop derived from `canUsePlanning(user.role)` to the todos view.

---

### SEC-005: optimisticallyDone Set accumulates entries without full cleanup

- **Type:** Data Integrity
- **Severity:** Low
- **Confidence:** Medium
- **OWASP:** N/A (client-side state)
- **Evidence:** `src/components/planning/planning-todos-by-person-view.tsx:64,163,176` — On successful mark-done, the task ID stays in `optimisticallyDone` forever. `router.refresh()` triggers a server re-render that provides fresh `items` props, and the `useMemo` at line 70 already skips tasks where `task.status === "done"`, so the stale entry in `optimisticallyDone` is harmless for that task. However, the Set grows monotonically within a session.
- **Risk:** If a user marks many tasks as done in a single session (e.g., 100+), the Set grows but has negligible memory impact. The real risk is UUID collision in a hypothetical task-recreation scenario where a previously-done task ID gets recycled — extremely unlikely with UUIDs.
- **Disposition:** **Advisory.** Low practical risk. For hygiene, consider clearing `optimisticallyDone` entries that appear in the refreshed `items` with `status === "done"` via a `useEffect` after `router.refresh()` completes.

---

### SEC-006: Alert filter values are type-safe via TypeScript union — NO VULNERABILITY

- **Type:** Input Validation
- **Severity:** None (Informational)
- **Confidence:** High
- **OWASP:** N/A
- **Evidence:** `src/lib/planning/types.ts:96` — `TodoAlertFilter` is a string union type `"overdue_items" | "overdue_tasks" | "due_soon_items" | "due_soon_tasks"`. The `todoAlertFilter` state in `planning-board.tsx:109` is typed as `TodoAlertFilter | null`. The `PlanningAlertStrip` component only emits values from the hardcoded `rows` array (line 18-51 of planning-alert-strip.tsx), each with a `filterKey` typed as `TodoAlertFilter`. An unexpected value cannot be passed through normal UI interaction.
- **Fallback behaviour:** If `alertFilter` is `null` or `undefined`, the `switch` in `getFilterDescription` returns the default description (line 52), and the filter logic in `useMemo` falls through to the `else` branch (line 91-93) which shows tasks due today or earlier. This is safe — no unfiltered data exposure.
- **Disposition:** **No action required.**

---

### SEC-007: `today` prop is server-sourced and used for display/filtering only

- **Type:** Input Validation
- **Severity:** None (Informational)
- **Confidence:** High
- **OWASP:** N/A
- **Evidence:** `src/app/planning/page.tsx:27` — `today` is derived from `new Date()` on the server and passed through `boardData.today`. It flows to the client as a string prop (`data.today`). A client cannot modify this prop to see different data — the `items` array is already fixed server-side. Manipulating `today` via React DevTools would only affect which tasks appear as "overdue" vs "due soon" in the client-side filter — no additional data would be exposed since all items are already in the prop.
- **Disposition:** **No action required.**

---

### SEC-008: Page-level permission check is in place

- **Type:** Authorization
- **Severity:** None (Informational)
- **Confidence:** High
- **OWASP:** N/A
- **Evidence:** `src/app/planning/page.tsx:13-21` — The page checks `getCurrentUser()` and redirects unauthenticated users to `/login`. It then checks `canViewPlanning(user.role)` and redirects unauthorized users to `/unauthorized`. Only `central_planner` and `executive` roles pass this gate.
- **Disposition:** **No action required.**

---

### SEC-009: All users' task details visible to all authorized viewers

- **Type:** Data Exposure
- **Severity:** None (Informational / By Design)
- **Confidence:** High
- **OWASP:** N/A
- **Evidence:** `src/components/planning/planning-todos-by-person-view.tsx:96-104,113-115` — Task details (title, due date, assignee name, planning item title) for all users are visible in the "Show everyone" view. The data is fetched server-side by `listPlanningBoardData` which returns all planning items regardless of assignee.
- **Assessment:** This is by design. Both `central_planner` and `executive` roles are meant to have full visibility into the planning workspace. The "my tasks" filter is a convenience, not a privacy boundary. User email addresses from the `assignees` array are present in the data but not rendered in the todos view UI.
- **Disposition:** **No action required.** If email addresses should not be sent to the client in the todos context, consider stripping them from the task assignee data before passing to the component.

---

## Summary

| ID | Finding | Severity | Blocking? |
|----|---------|----------|-----------|
| SEC-001 | currentUserId securely server-sourced | None | No |
| SEC-002 | Client-side "my tasks" filter is UX-only | None | No |
| SEC-003 | Server action re-verifies auth | None | No |
| SEC-004 | Executive sees mark-done UI despite lacking write permission | Low | No (Advisory) |
| SEC-005 | optimisticallyDone Set grows monotonically | Low | No (Advisory) |
| SEC-006 | Alert filter values type-safe | None | No |
| SEC-007 | `today` prop server-sourced, display-only | None | No |
| SEC-008 | Page-level permission check present | None | No |
| SEC-009 | All task details visible to authorized viewers (by design) | None | No |

**Blocking findings:** 0
**Advisory findings:** 2 (SEC-004, SEC-005)

## Recommended Actions

1. **SEC-004 (Advisory):** Pass a `canEdit` boolean prop to `PlanningTodosByPersonView` and conditionally render or disable the mark-done checkbox. This prevents confusing optimistic-then-revert UX for read-only users.

2. **SEC-005 (Advisory):** Add a `useEffect` that clears entries from `optimisticallyDone` when the refreshed `items` prop confirms those tasks are now `status === "done"`. This is purely a hygiene improvement with no security impact.

**Overall assessment:** The changes are secure. Authentication and authorization are properly handled server-side. The `currentUserId` flow follows best practices (server-sourced, client-consumed as read-only). Input validation via Zod and TypeScript unions prevents injection of unexpected filter values. No data exposure beyond what is authorized by the role-based access model.
