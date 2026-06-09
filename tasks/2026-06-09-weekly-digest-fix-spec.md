# Implementation Spec — Fix weekly digest to-do truncation

**Date:** 2026-06-09 · **Author:** investigation session · **Status:** validated spec, ready for implementation (no product code changed yet)
**Companion:** root-cause discovery in [tasks/2026-06-09-weekly-digest-missing-todos.md](2026-06-09-weekly-digest-missing-todos.md)
**Complexity:** S (single implementation file + existing weekly-digest test file). No schema/migration. No env vars.

**Validation note (09 Jun):** The provided "original brief" path points to a CareerHub UI/UX redesign
handoff, not a BaronsHub weekly digest brief. This spec is therefore validated against the BaronsHub
root-cause discovery document and current BaronsHub code/tests, not against that unrelated handoff.

---

## 1. Objective

Make the mandatory Tuesday weekly update email (`sendMandatoryWeeklyUpdateEmail`) report **every**
qualifying open to-do for **every** recipient, instead of an arbitrary ≤1,000-row slice. Behaviour
must become deterministic and complete regardless of how many tasks exist globally.

## 2. Root cause (recap)

`sendMandatoryWeeklyUpdateEmail` ([src/lib/notifications.ts:1930-1963](../src/lib/notifications.ts))
fetches all assignee/task rows for all users in two queries with **no `.range()`, `.limit()` or
`.order()`**, then groups them in JS. Supabase/PostgREST caps un-ranged responses at **1,000 rows**.
Live volumes: assignee-join = **11,068** rows, legacy = **3,707** rows. The returned 1,000-row slice
is unordered, so an unpredictable subset of users (Harry on 09 Jun) gets an empty to-do section.

The **correct pattern already exists** in the same file: `sendWeeklyDigestEmail` (line 2168) defines a
local `fetchDigestRows` helper (line 2200) that pages through results with `.range()` (pageSize 1000)
until a short page returns. `sendMandatoryWeeklyUpdateEmail` simply never adopted it.

## 3. Scope

**In scope (required):**
- Hoist the pagination helper to module scope and use it in `sendMandatoryWeeklyUpdateEmail`.
- Add a stable `.order()` to every query that uses `fetchDigestRows`, so `.range()` pagination is reliable.
- Page the weekly update recipient query too, so the "every recipient" objective has no hidden 1,000-row cap.
- Push the `due_date <= today+14` filter into SQL on the legacy query (cheap, large reduction).
- A regression test proving a user with >1,000 global sibling rows still receives their tasks.

**In scope (recommended, low risk):**
- Push `status='open'` + `due_date<=limit` filters into SQL on the assignee-join query via embedded-
  resource filters (turns an 11k-row multi-page fetch into a single small page).

**Out of scope:**
- Re-sending this week's emails — **declined by product owner (09 Jun)**. Corrected digest goes out
  automatically next Tuesday (16 Jun).
- The daily digest's send logic (only the ordering hardening above).
- Unrelated observations (see §10).

## 4. Design decision

Use **offset pagination with a stable sort**, matching the existing `fetchDigestRows`. Rationale:
it is already proven in this file, requires no new dependency, and the volumes (low tens of thousands)
do not justify keyset pagination. The `.order("id")` addition is the one correctness gap in the
existing helper usage and must be included. SQL-side filtering is layered on top to keep page counts
and DB cost low; the existing in-JS filters in `normaliseWeeklyTask` remain as a safety net, so the
fix is correct even if an embedded filter is mis-specified.

---

## 5. Detailed changes

### Change 1 — Hoist `fetchDigestRows` to module scope (required)

**File:** `src/lib/notifications.ts`

Move the helper out of `sendWeeklyDigestEmail` so both functions can call it. Place it at module
scope (e.g. just below the constants near the top, after line 23, or immediately above
`sendMandatoryWeeklyUpdateEmail`). The body is **identical** to the current local definition
(lines 2200-2220) — it captures nothing from the enclosing scope (the caller passes `buildQuery`),
so this is a pure move:

```ts
/**
 * Fetch ALL rows for a Supabase query, paging past PostgREST's 1000-row response cap.
 * The builder MUST apply a stable .order() so range/offset pages don't skip or repeat rows.
 */
async function fetchDigestRows<T>(label: string, buildQuery: () => any): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const query = buildQuery();
    const canPage = typeof query.range === "function";
    const result = canPage ? await query.range(from, from + pageSize - 1) : await query;
    if (result.error) throw new Error(`Failed to fetch ${label}: ${result.error.message}`);
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (!canPage || page.length < pageSize) return rows;
  }
}
```

Then **delete** the local copy inside `sendWeeklyDigestEmail` (lines 2200-2220). No call-site changes
needed there (same name, same signature).

### Change 2 — Add stable ordering to all `fetchDigestRows` callers (required)

**File:** `src/lib/notifications.ts`

Every query passed to `fetchDigestRows` must have a deterministic order. Otherwise offset/range
pagination can skip or duplicate rows between pages.

Inside `sendWeeklyDigestEmail`:
- Append `.order("id", { ascending: true })` to the `planning_task_assignees` builder after
  `.not("user_id","is",null)`.
- Append `.order("id", { ascending: true })` to the `planning_tasks` builder after
  `.not("assignee_id","is",null)`.
- Keep the existing event ordering by `start_at`, but add a unique tie-breaker:
  `.order("start_at", { ascending: true }).order("id", { ascending: true })`.
- Append `.order("id", { ascending: true })` to the `users` builder after `.is("deactivated_at", null)`.

Inside `sendMandatoryWeeklyUpdateEmail`, the new users and task builders in Change 3 must also order
by `id` before `fetchDigestRows` applies `.range()`.

### Change 3 — Paginate + filter the weekly update's recipient/task queries (required)

**File:** `src/lib/notifications.ts` (inside `sendMandatoryWeeklyUpdateEmail`)

**3a. Move the existing `type WeeklyUser` above the `Promise.all` block.** The users query will now
return an array directly, so the type must be available before the fetch call. Do not duplicate the
type lower in the function.

**3b. The `Promise.all` block (lines 1930-1963).** Replace the raw users query and the two raw task
queries with paginated fetches. Keep `approvalAudit` and `debriefs` as-is (current production
cardinality is well under 1,000 and they are not part of the reported bug). Result:

```ts
const [userRows, assigneeRows, legacyTasks, approvalAuditResult, debriefsResult] = await Promise.all([
  fetchDigestRows<WeeklyUser>("weekly update users", () =>
    db
      .from("users")
      .select("id, email, full_name, venue_id, weekly_digest_last_sent_on")
      .is("deactivated_at", null)
      .order("id", { ascending: true })
  ),

  fetchDigestRows<Record<string, unknown>>("weekly assignee tasks", () =>
    (db as any)
      .from("planning_task_assignees")
      .select(`
        user_id,
        planning_task:planning_tasks!inner(
          id, title, due_date, assignee_id, status,
          planning_item:planning_items!inner(id, title, event:events(id, title, venue_id, event_venues(venue_id)))
        )
      `)
      .not("user_id", "is", null)
      // Optional optimisation (Change 4): .eq("planning_task.status","open").lte("planning_task.due_date", todoDueLimit)
      .order("id", { ascending: true })
  ),

  fetchDigestRows<Record<string, unknown>>("weekly legacy tasks", () =>
    (db as any)
      .from("planning_tasks")
      .select(`
        id, title, due_date, assignee_id, status,
        planning_item:planning_items!inner(id, title, event:events(id, title, venue_id, event_venues(venue_id)))
      `)
      .eq("status", "open")
      .lte("due_date", todoDueLimit)            // NEW: push the 14-day window into SQL
      .not("assignee_id", "is", null)
      .order("id", { ascending: true })          // NEW: stable order for range paging
  ),

  db
    .from("audit_log")
    .select("entity_id, created_at")
    .eq("entity", "event").eq("action", "event.approved")
    .gte("created_at", sevenDaysAgo),

  (db as any)
    .from("debriefs")
    .select("event_id, submitted_at, sales_uplift_percent, event:events(id, title, start_at, venue_id, venue:venues!events_venue_id_fkey(name), event_venues(venue_id))")
    .gte("submitted_at", sevenDaysAgo)
]);
```

**3c. Remove the now-invalid users/task error guards.** `fetchDigestRows` throws on error, so delete:

```ts
if (usersResult.error) throw new Error(`Could not load digest users: ${usersResult.error.message}`);
if (assigneeRowsResult.error) throw new Error(`Could not load assigned planning tasks: ${assigneeRowsResult.error.message}`);
if (legacyTasksResult.error) throw new Error(`Could not load legacy planning tasks: ${legacyTasksResult.error.message}`);
```

Keep the `approvalAuditResult` and `debriefsResult` guards (those remain `{data,error}`).

**3d. Update the consumers to read arrays directly.**
- User setup: `const users = ((usersResult.data ?? []) as WeeklyUser[])` → `const users = userRows`
  before the existing `.filter(...)` chain.
- Line 2024: `for (const row of (assigneeRowsResult.data ?? []) as Array<...>)` → `for (const row of assigneeRows as Array<Record<string, unknown>>)`
- Line 2030: `for (const rawTask of (legacyTasksResult.data ?? []) as Array<...>)` → `for (const rawTask of legacyTasks as Array<Record<string, unknown>>)`

No change to `normaliseWeeklyTask`, `addTask`, dedup, scope, or rendering — the in-JS `due_date <= todoDueLimit`
and `status==='open'` filters stay as the safety net.

### Change 4 — Embedded-resource SQL filter on the assignee-join query (optional optimisation)

Add to the assignee builder in 3a: `.eq("planning_task.status", "open").lte("planning_task.due_date", todoDueLimit)`.
Because the embed is `!inner`, these filter the top-level rows server-side, shrinking ~11k rows to the
handful actually due within the window.

Do **not** treat the mocked unit test as proof that PostgREST applies embedded-resource filters
correctly; a mock can only prove the builder received `.eq()` / `.lte()` calls. Ship this optimisation
only after either:
- a local/live Supabase smoke query confirms the `planning_task.*` embedded filters reduce the returned
  `planning_task_assignees` rows as expected, or
- the code is deployed without Change 4 and relies on pagination + the existing JS safety filters.

---

## 6. Tests (required)

**Existing file:** `src/lib/__tests__/weekly-digest.test.ts` (Vitest). Add the regression coverage to
the existing `sendMandatoryWeeklyUpdateEmail` describe block unless the test file becomes unwieldy.

Mocks:
- `vi.mock("@/lib/supabase/admin")` already exists. Extend the fake query builder so it records
  `.range()`, `.order()`, and optional embedded `.eq()` / `.lte()` calls and can serve fixture datasets
  across pages. When a query is awaited without `.range()`, return only the first 1,000 rows to mimic
  PostgREST's default cap; this is what makes the regression fail against the old implementation.
- `vi.mock("resend")` already captures `emails.send`; assert on the payloads.
- Do not try to stub private helpers such as `areOperationalEmailsEnabled` or `getResendClient`.
  Follow the existing tests: set `BARONSHUB_OPERATIONAL_EMAILS_ENABLED=true`, set `RESEND_API_KEY`,
  and mock `getTodayLondonIsoDate` to a **Tuesday** such as `2026-06-09`.

Cases:
1. **Regression (the bug):** target user "Harry" has tasks that only appear in **page 2** (rows
   1000-1090); page 1 (rows 0-999) contains only other users' rows. Assert Harry's `emails.send`
   payload contains his task titles (i.e. `todoItems.length > 0`). This fails on current code (no
   `.range`, page 1 only) and passes after the fix.
2. **Pagination boundary:** dataset of exactly 1,000 then 1 more row → assert the helper makes a second
   `.range()` call and the 1,001st row is included.
3. **No-op guards still hold:** non-Tuesday → returns `{sent:0,...}` and `emails.send` not called;
   user already sent this ISO week → excluded.
4. **Ordering:** assert the paginated users/task queries receive `.order("id", { ascending: true })`;
   also assert the existing `sendWeeklyDigestEmail` paginated builders are ordered after Change 2.
5. **(If Change 4 shipped)** assert the assignee builder received `.eq("planning_task.status","open")`
   and `.lte("planning_task.due_date", ...)`. Treat this as call-shape coverage only; use the smoke
   query in Change 4 to validate real PostgREST filtering semantics.

Do not export `fetchDigestRows` purely for testing. Test it through `sendMandatoryWeeklyUpdateEmail`
and `sendWeeklyDigestEmail`; exporting a private helper would widen the module API for no product value.
Update `audit-coverage.test.ts` allowlist only if it flags the touched function (it should not — no
mutation added).

## 7. Verification pipeline (before commit)

```
npm run lint        # zero warnings
npm run typecheck    # note the renamed bindings (userRows/assigneeRows/legacyTasks) and removed .error guards
npm run test         # new test green + existing suite green
npm run build        # production build
```

## 8. Post-deploy verification (no emails sent)

The function only runs Tuesdays, so it cannot be safely dry-run on demand. Verify via:
- the regression test (primary evidence), and
- on the next live run (Tue 16 Jun) confirm `audit_log` digest `sent` count and spot-check that a
  heavy user (Harry) received a populated list. Optionally add a temporary `console.info` of total
  `tasksByUser` size for one run, then remove.

## 9. Risks & rollback

- **Risk:** extra DB round-trips. With Change 3's `due_date` filter (and Change 4), the result set is
  small → typically a single page. Without Change 4, the assignee query may page ~12 times once per
  weekly run — acceptable. **Mitigation:** ship Change 4 only after a Supabase smoke query confirms
  the embedded-resource filter; otherwise rely on pagination and the JS safety filters.
- **Risk:** `.range()` without order skips rows — addressed by the mandatory `.order("id")`.
- **No** schema, migration, RLS, or env change. **Rollback:** revert the single commit.

## 10. Out-of-scope observations (log only, do not action here)

- **Role data drift:** Harry's `users.role = "manager"`, not the documented `administrator/office_worker/executive`
  (after commit `217b692`). Not the cause (digest doesn't gate on role) but worth a separate data audit.
- **`weekly_digest_logs` table is unused** by this function (it logs to `audit_log` entity=`digest`). Dead schema — separate cleanup.
- **`sendWeeklyDigestEmail` naming** is misleading (it is the frequency-gated *to-do* digest, not the weekly update). Optional rename later.
