# Weekly Digest Pagination Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sendMandatoryWeeklyUpdateEmail` report every qualifying open to-do for every recipient by paginating its Supabase reads past PostgREST's 1,000-row cap, instead of grouping an arbitrary unordered 1,000-row slice.

**Architecture:** Hoist the existing `fetchDigestRows` offset-pagination helper (already used by `sendWeeklyDigestEmail`) to module scope, give every paginated query a stable `.order("id")`, route the weekly-update users + both task queries through it, and push the `due_date <= today+14` filter into SQL. Behaviour-preserving: the in-JS filters in `normaliseWeeklyTask` stay as a safety net.

**Tech Stack:** TypeScript, Next.js, Supabase JS client (PostgREST), Vitest. Single source file (`src/lib/notifications.ts`) + single test file (`src/lib/__tests__/weekly-digest.test.ts`). No schema, migration, or env changes.

**Spec:** [tasks/2026-06-09-weekly-digest-fix-spec.md](../../../tasks/2026-06-09-weekly-digest-fix-spec.md) · **Root cause:** [tasks/2026-06-09-weekly-digest-missing-todos.md](../../../tasks/2026-06-09-weekly-digest-missing-todos.md)

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/notifications.ts` | Email/digest logic | Hoist `fetchDigestRows`; order + paginate `sendMandatoryWeeklyUpdateEmail`'s users/task queries; add SQL `due_date` filter; order `sendWeeklyDigestEmail`'s paginated builders | 
| `src/lib/__tests__/weekly-digest.test.ts` | Vitest suite for both digest functions | Add a cap-aware paged mock builder + regression/boundary/ordering tests | 

We keep the existing `setupMockDb` Proxy untouched (20+ tests depend on it; it resolves `.range()` to the full dataset, which remains compatible after the fix) and add a **separate** `setupPagedMockDb` helper that simulates the 1,000-row cap — this is what lets the regression test fail on the old code.

---

## Task 0: Branch and confirm a green baseline

**Files:** none (git + test run only)

- [ ] **Step 1: Create the feature branch** (we are on `main`; never commit the fix to `main` directly)

```bash
git checkout -b fix/weekly-digest-pagination
```

- [ ] **Step 2: Run the existing digest suite to confirm a green starting point**

Run: `npx vitest run src/lib/__tests__/weekly-digest.test.ts`
Expected: PASS (all existing `sendWeeklyDigestEmail` and `sendMandatoryWeeklyUpdateEmail` tests green).

---

## Task 1: Hoist `fetchDigestRows` to module scope (pure refactor)

**Files:**
- Modify: `src/lib/notifications.ts` (add module-scope helper before line 1882; delete local copy at lines 2200-2220)

- [ ] **Step 1: Add the module-scope helper immediately above `export async function sendMandatoryWeeklyUpdateEmail` (line 1882)**

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

- [ ] **Step 2: Delete the now-duplicate local definition inside `sendWeeklyDigestEmail`**

Remove the local `async function fetchDigestRows<T>(...) { ... }` (currently lines 2200-2220). Its call sites are unchanged (same name, same signature, now resolved from module scope).

- [ ] **Step 3: Verify the suite still passes (pure refactor, no behaviour change)**

Run: `npx vitest run src/lib/__tests__/weekly-digest.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean (no duplicate-identifier or scope errors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications.ts
git commit -m "refactor: hoist fetchDigestRows pagination helper to module scope"
```

---

## Task 2: Add the cap-aware paged mock builder + the failing regression test

**Files:**
- Modify (Test): `src/lib/__tests__/weekly-digest.test.ts`

- [ ] **Step 1: Add the `setupPagedMockDb` helper** in the "Helpers" section (after `setupMockDb`, before the `// Tests` divider at line 193)

```ts
/**
 * Cap-aware mock admin client for pagination tests.
 *
 * Each `.from(table)` returns a fresh chain backed by `tables[table].rows`.
 * - Awaited WITHOUT `.range()` → resolves only the first 1,000 rows (mimics PostgREST's default cap).
 * - Awaited WITH `.range(from, to)` → resolves `rows.slice(from, to + 1)`.
 * Method calls are recorded in the returned `calls` map (keyed by table) for assertions.
 */
function setupPagedMockDb(tables: Record<string, { rows: unknown[]; error?: unknown }>) {
  const calls: Record<string, { method: string; args: unknown[] }[]> = {};

  function makeChain(table: string) {
    const rows = tables[table]?.rows ?? [];
    const error = tables[table]?.error ?? null;
    let range: [number, number] | null = null;

    const record = (method: string, args: unknown[]) => {
      (calls[table] ??= []).push({ method, args });
    };

    const chain: any = {
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      range(from: number, to: number) {
        record("range", [from, to]);
        range = [from, to];
        return chain;
      },
      then(resolve: (v: unknown) => void) {
        const data = error
          ? null
          : range
            ? rows.slice(range[0], range[1] + 1)
            : rows.slice(0, 1000);
        resolve({ data, error });
      }
    };

    for (const method of [
      "select", "eq", "neq", "lte", "gte", "lt", "gt", "in", "is", "not", "order", "limit", "update", "delete", "upsert"
    ]) {
      chain[method] = (...args: unknown[]) => {
        record(method, args);
        return chain;
      };
    }

    return chain;
  }

  const db = { from: vi.fn((table: string) => makeChain(table)) };
  mockAdmin.mockReturnValue(db);
  return { db, calls };
}
```

- [ ] **Step 2: Write the failing regression test** inside the existing `describe("sendMandatoryWeeklyUpdateEmail", ...)` block (after the existing test, before the closing `});` at line 779)

```ts
  it("includes a user's tasks even when they fall beyond the first 1,000 rows (pagination)", async () => {
    vi.mocked(getTodayLondonIsoDate).mockReturnValue("2026-06-09"); // a Tuesday

    // 1,090 legacy tasks: rows 0-999 belong to another user, rows 1000-1089 to Harry.
    const planningTasks = [
      ...Array.from({ length: 1000 }, (_, i) =>
        makeTask({
          id: `other-${i}`,
          title: `Other task ${i}`,
          due_date: "2026-06-10",
          assignee_id: "user-other",
          planning_item: { id: "pi-other", title: "Other prep", event: null }
        })
      ),
      ...Array.from({ length: 90 }, (_, i) =>
        makeTask({
          id: `harry-${i}`,
          title: `Harry task ${i}`,
          due_date: "2026-06-10",
          assignee_id: "harry",
          planning_item: { id: "pi-harry", title: "Harry prep", event: null }
        })
      )
    ];

    setupPagedMockDb({
      users: {
        rows: [
          { ...makeUser({ id: "user-other", email: "other@example.com", venue_id: null }), weekly_digest_last_sent_on: null },
          { ...makeUser({ id: "harry", email: "harry@example.com", full_name: "Harry Smith", venue_id: null }), weekly_digest_last_sent_on: null }
        ]
      },
      planning_task_assignees: { rows: [] },
      planning_tasks: { rows: planningTasks },
      audit_log: { rows: [] },
      debriefs: { rows: [] }
    });

    const result = await sendMandatoryWeeklyUpdateEmail();

    expect(result.sent).toBe(2);
    const harryCall = mockEmailSend.mock.calls.find((c) => c[0].to[0] === "harry@example.com");
    expect(harryCall).toBeDefined();
    expect(harryCall![0].html).toContain("Harry task");
  });
```

- [ ] **Step 3: Run the regression test and confirm it FAILS on current code**

Run: `npx vitest run src/lib/__tests__/weekly-digest.test.ts -t "fall beyond the first 1,000 rows"`
Expected: FAIL. On the current implementation `planning_tasks` is awaited without `.range()`, so the mock returns only rows 0-999 (no Harry); Harry's email has no to-dos and `expect(...).toContain("Harry task")` fails.

- [ ] **Step 4: Commit the test infra + failing test**

```bash
git add src/lib/__tests__/weekly-digest.test.ts
git commit -m "test: add cap-aware paged mock + failing weekly-digest pagination regression"
```

---

## Task 3: Paginate, order, and filter the weekly-update queries

**Files:**
- Modify: `src/lib/notifications.ts` (`sendMandatoryWeeklyUpdateEmail`: types ~1971-1984, Promise.all 1930-1963, guards 1965-1969, consumers 1986 + 2024 + 2030)

- [ ] **Step 1: Move the `WeeklyUser`/`WeeklyTask` type block above the `Promise.all`**

Cut the block currently at lines 1971-1984:

```ts
  type WeeklyUser = {
    id: string;
    email: string;
    full_name: string | null;
    venue_id: string | null;
    weekly_digest_last_sent_on: string | null;
  };
  type WeeklyTask = {
    id: string;
    title: string;
    dueDate: string | null;
    planningTitle: string;
    eventTitle: string | null;
  };
```

Paste it immediately after the `const sevenDaysAgo = ...;` line (currently 1928), i.e. directly before the `const [usersResult, ...] = await Promise.all([` call. Do not leave a duplicate behind.

- [ ] **Step 2: Replace the `Promise.all` block (lines 1930-1963)** with paginated users + task fetches

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
        .lte("due_date", todoDueLimit)
        .not("assignee_id", "is", null)
        .order("id", { ascending: true })
    ),

    db
      .from("audit_log")
      .select("entity_id, created_at")
      .eq("entity", "event")
      .eq("action", "event.approved")
      .gte("created_at", sevenDaysAgo),

    (db as any)
      .from("debriefs")
      .select("event_id, submitted_at, sales_uplift_percent, event:events(id, title, start_at, venue_id, venue:venues!events_venue_id_fkey(name), event_venues(venue_id))")
      .gte("submitted_at", sevenDaysAgo)
  ]);
```

- [ ] **Step 3: Remove the three now-invalid error guards (lines 1965-1969 region)**

Delete these three lines (the helper throws on error internally):

```ts
  if (usersResult.error) throw new Error(`Could not load digest users: ${usersResult.error.message}`);
  if (assigneeRowsResult.error) throw new Error(`Could not load assigned planning tasks: ${assigneeRowsResult.error.message}`);
  if (legacyTasksResult.error) throw new Error(`Could not load legacy planning tasks: ${legacyTasksResult.error.message}`);
```

Keep the `approvalAuditResult` and `debriefsResult` guards (those two still resolve to `{ data, error }`).

- [ ] **Step 4: Update the users consumer (line 1986)**

Replace:

```ts
  const users = ((usersResult.data ?? []) as WeeklyUser[])
    .filter((user) => Boolean(user.email))
    .filter((user) => !user.weekly_digest_last_sent_on || isoWeekStart(user.weekly_digest_last_sent_on) !== weekStart);
```

with (the array is already typed `WeeklyUser[]` from the generic, so the cast is dropped):

```ts
  const users = userRows
    .filter((user) => Boolean(user.email))
    .filter((user) => !user.weekly_digest_last_sent_on || isoWeekStart(user.weekly_digest_last_sent_on) !== weekStart);
```

- [ ] **Step 5: Update the two task-consumer loops (lines 2024 and 2030)**

Line ~2024 — replace `(assigneeRowsResult.data ?? []) as Array<Record<string, unknown>>` with `assigneeRows as Array<Record<string, unknown>>`:

```ts
  for (const row of assigneeRows as Array<Record<string, unknown>>) {
    const task = normaliseWeeklyTask(row.planning_task ?? row.planning_tasks);
    if (task) taskIdsWithAssigneeRows.add(task.id);
    addTask(typeof row.user_id === "string" ? row.user_id : null, task);
  }
```

Line ~2030 — replace `(legacyTasksResult.data ?? []) as Array<Record<string, unknown>>` with `legacyTasks as Array<Record<string, unknown>>`:

```ts
  for (const rawTask of legacyTasks as Array<Record<string, unknown>>) {
    const task = normaliseWeeklyTask(rawTask);
    if (task && taskIdsWithAssigneeRows.has(task.id)) continue;
    addTask(typeof rawTask.assignee_id === "string" ? rawTask.assignee_id : null, task);
  }
```

- [ ] **Step 6: Run the regression test — it must now PASS**

Run: `npx vitest run src/lib/__tests__/weekly-digest.test.ts -t "fall beyond the first 1,000 rows"`
Expected: PASS. `planning_tasks` now paginates via `fetchDigestRows`, so Harry's page-2 rows are fetched and his email contains "Harry task".

- [ ] **Step 7: Run the full digest suite — existing tests must stay green**

Run: `npx vitest run src/lib/__tests__/weekly-digest.test.ts`
Expected: PASS (the existing `sendMandatoryWeeklyUpdateEmail` test still sends Alice's 12 tasks; `setupMockDb` resolves `.range()` to the full dataset so pagination stops after one short page).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: clean. Confirm the renamed bindings (`userRows`, `assigneeRows`, `legacyTasks`) and removed `.error` guards produce no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/notifications.ts
git commit -m "fix: paginate weekly update digest queries past PostgREST 1000-row cap"
```

---

## Task 4: Add stable ordering to `sendWeeklyDigestEmail`'s paginated builders

**Files:**
- Modify: `src/lib/notifications.ts` (`sendWeeklyDigestEmail` builders, currently lines 2222-2267)
- Modify (Test): `src/lib/__tests__/weekly-digest.test.ts`

- [ ] **Step 1: Add `.order("id", { ascending: true })` to the `planning_task_assignees` builder** (after `.not("user_id", "is", null)`)

```ts
    fetchDigestRows<Record<string, unknown>>("planning task assignees", () =>
      db
        .from("planning_task_assignees")
        .select(`
          user_id,
          planning_task:planning_tasks!inner(
            id, title, due_date, assignee_id, status,
            planning_item:planning_items!inner(id, title, event:events(id, title, venue_id))
          )
        `)
        .not("user_id", "is", null)
        .order("id", { ascending: true })
    ),
```

- [ ] **Step 2: Add `.order("id", { ascending: true })` to the `planning_tasks` builder** (after `.not("assignee_id", "is", null)`)

```ts
    fetchDigestRows<Record<string, unknown>>("planning tasks", () =>
      db
        .from("planning_tasks")
        .select(`
          id, title, due_date, assignee_id, status,
          planning_item:planning_items!inner(id, title, event:events(id, title, venue_id))
        `)
        .eq("status", "open")
        .not("assignee_id", "is", null)
        .order("id", { ascending: true })
    ),
```

- [ ] **Step 3: Add an `id` tie-breaker to the upcoming-events builder** (it already orders by `start_at`; offset paging needs a unique tie-breaker)

```ts
    fetchDigestRows<Record<string, unknown>>("upcoming events", () =>
      db
        .from("events")
        .select("id, title, start_at, end_at, venue_id, venue:venues!events_venue_id_fkey(name, is_internal)")
        .gte("start_at", nowIso)
        .lt("start_at", fourDaysFromNow)
        .in("status", ["approved", "submitted"])
        .is("deleted_at", null)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true })
    ),
```

- [ ] **Step 4: Add `.order("id", { ascending: true })` to the `users` builder** (after `.is("deactivated_at", null)`)

```ts
    fetchDigestRows<{
      id: string;
      email: string;
      full_name: string | null;
      venue_id: string | null;
      todo_digest_frequency: string | null;
      todo_digest_last_sent_on: string | null;
    }>("users", () =>
      db
        .from("users")
        .select("id, email, full_name, venue_id, todo_digest_frequency, todo_digest_last_sent_on")
        .is("deactivated_at", null)
        .order("id", { ascending: true })
    )
```

- [ ] **Step 5: Add an ordering-assertion test** inside `describe("sendMandatoryWeeklyUpdateEmail", ...)`

```ts
  it("orders every paginated query by id so range paging is stable", async () => {
    vi.mocked(getTodayLondonIsoDate).mockReturnValue("2026-06-09");

    const { calls } = setupPagedMockDb({
      users: { rows: [{ ...makeUser({ id: "u1", email: "u1@example.com", venue_id: null }), weekly_digest_last_sent_on: null }] },
      planning_task_assignees: { rows: [] },
      planning_tasks: { rows: [] },
      audit_log: { rows: [] },
      debriefs: { rows: [] }
    });

    await sendMandatoryWeeklyUpdateEmail();

    const orderedById = (table: string) =>
      (calls[table] ?? []).some((c) => c.method === "order" && c.args[0] === "id");

    expect(orderedById("users")).toBe(true);
    expect(orderedById("planning_task_assignees")).toBe(true);
    expect(orderedById("planning_tasks")).toBe(true);
  });
```

- [ ] **Step 6: Run the digest suite**

Run: `npx vitest run src/lib/__tests__/weekly-digest.test.ts`
Expected: PASS (new ordering test green; existing `sendWeeklyDigestEmail` tests unaffected — `setupMockDb` ignores `.order`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifications.ts src/lib/__tests__/weekly-digest.test.ts
git commit -m "fix: add stable id ordering to all paginated digest queries"
```

---

## Task 5: Add the pagination-boundary test

**Files:**
- Modify (Test): `src/lib/__tests__/weekly-digest.test.ts`

- [ ] **Step 1: Add the boundary test** inside `describe("sendMandatoryWeeklyUpdateEmail", ...)`

```ts
  it("pages a second time when the result exactly fills the first page (1000 + 1)", async () => {
    vi.mocked(getTodayLondonIsoDate).mockReturnValue("2026-06-09");

    const planningTasks = [
      ...Array.from({ length: 1000 }, (_, i) =>
        makeTask({ id: `other-${i}`, title: `Other ${i}`, due_date: "2026-06-10", assignee_id: "user-other", planning_item: { id: "pi-o", title: "Other", event: null } })
      ),
      makeTask({ id: "harry-edge", title: "Edge task", due_date: "2026-06-10", assignee_id: "harry", planning_item: { id: "pi-h", title: "Harry", event: null } })
    ];

    const { calls } = setupPagedMockDb({
      users: {
        rows: [
          { ...makeUser({ id: "user-other", email: "other@example.com", venue_id: null }), weekly_digest_last_sent_on: null },
          { ...makeUser({ id: "harry", email: "harry@example.com", venue_id: null }), weekly_digest_last_sent_on: null }
        ]
      },
      planning_task_assignees: { rows: [] },
      planning_tasks: { rows: planningTasks },
      audit_log: { rows: [] },
      debriefs: { rows: [] }
    });

    await sendMandatoryWeeklyUpdateEmail();

    const rangeCalls = (calls["planning_tasks"] ?? []).filter((c) => c.method === "range");
    expect(rangeCalls.length).toBeGreaterThanOrEqual(2);

    const harryCall = mockEmailSend.mock.calls.find((c) => c[0].to[0] === "harry@example.com");
    expect(harryCall![0].html).toContain("Edge task");
  });
```

- [ ] **Step 2: Run the digest suite**

Run: `npx vitest run src/lib/__tests__/weekly-digest.test.ts`
Expected: PASS (boundary test green: the 1,001st row triggers a second `.range()` call and is included).

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/weekly-digest.test.ts
git commit -m "test: cover the 1000+1 pagination boundary for the weekly digest"
```

---

## Task 6: Full verification pipeline

**Files:** none (whole-repo checks)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: zero errors, zero warnings. If an unused-import warning appears for a removed guard, delete the dead reference and re-run.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Full test suite**

Run: `npm run test`
Expected: PASS, including `src/actions/__tests__/audit-coverage.test.ts` (no mutation added, so its allowlist needs no change).

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit any verification fixups (only if Steps 1-4 required edits)**

```bash
git add -A
git commit -m "chore: verification fixups for weekly digest pagination"
```

---

## Task 7 (OPTIONAL, DEFERRED): Embedded-resource SQL filter on the assignee-join query

> Do **not** apply this by default. The spec gates it behind a real PostgREST smoke check because a unit-test mock can only prove `.eq()`/`.lte()` were *called*, not that PostgREST applied them. Ship Changes 1-6 first (they fully fix the bug); add this only after the smoke check confirms it.

**Files:**
- Modify: `src/lib/notifications.ts` (the `sendMandatoryWeeklyUpdateEmail` assignee builder from Task 3 Step 2)

- [ ] **Step 1: Run a PostgREST smoke check against a real Supabase project** (staging or local). Confirm that adding the embedded filters reduces the returned `planning_task_assignees` rows to only open tasks due on/before the limit — i.e. compare the row count of the request below with and without the `planning_task.*` filters. Use a real REST call (not `execute_sql`, which bypasses PostgREST):

```
GET /rest/v1/planning_task_assignees?select=user_id,planning_task:planning_tasks!inner(id,status,due_date)&planning_task.status=eq.open&planning_task.due_date=lte.<today+14>
```

Proceed only if the filtered count is materially smaller than the unfiltered count (proving the embed filter is honoured).

- [ ] **Step 2: If confirmed, add the embedded filters** to the assignee builder (before `.order("id", ...)`)

```ts
        .not("user_id", "is", null)
        .eq("planning_task.status", "open")
        .lte("planning_task.due_date", todoDueLimit)
        .order("id", { ascending: true })
```

- [ ] **Step 3: Add call-shape coverage** (mock can only assert the calls were made) inside `describe("sendMandatoryWeeklyUpdateEmail", ...)`

```ts
  it("pushes status/due-date filters onto the assignee-join query", async () => {
    vi.mocked(getTodayLondonIsoDate).mockReturnValue("2026-06-09");
    const { calls } = setupPagedMockDb({
      users: { rows: [{ ...makeUser({ id: "u1", email: "u1@example.com", venue_id: null }), weekly_digest_last_sent_on: null }] },
      planning_task_assignees: { rows: [] },
      planning_tasks: { rows: [] },
      audit_log: { rows: [] },
      debriefs: { rows: [] }
    });
    await sendMandatoryWeeklyUpdateEmail();
    const pta = calls["planning_task_assignees"] ?? [];
    expect(pta.some((c) => c.method === "eq" && c.args[0] === "planning_task.status")).toBe(true);
    expect(pta.some((c) => c.method === "lte" && c.args[0] === "planning_task.due_date")).toBe(true);
  });
```

- [ ] **Step 4: Re-run suite + verification, then commit**

Run: `npm run test && npm run typecheck`
Expected: PASS.

```bash
git add src/lib/notifications.ts src/lib/__tests__/weekly-digest.test.ts
git commit -m "perf: push status/due-date filters into the weekly assignee-join query"
```

---

## Post-implementation notes

- **No re-send** of this week's emails (product owner declined 09 Jun). The corrected digest runs automatically on Tue 16 Jun.
- **Post-deploy check (no emails sent):** on the next live run confirm the `audit_log` digest `sent` count and spot-check that a heavy user (Harry, `b2d95e89-0473-4fcb-895a-85a21172b3db`) received a populated to-do list.
- **Out of scope (log only):** `users.role = "manager"` data drift; unused `weekly_digest_logs` table; misleading `sendWeeklyDigestEmail` name.

---

## Self-review (completed against the spec)

- **Spec §3 required items:** hoist helper → Task 1; order every `fetchDigestRows` caller → Tasks 3 (weekly) + 4 (daily); paginate the weekly recipient query → Task 3 Step 2; push `due_date` filter into SQL → Task 3 Step 2; regression test → Task 2/3. ✓
- **Spec §6 tests:** regression (Task 2/3), boundary (Task 5), ordering (Task 4), no-op guards already covered by existing tests; embedded-filter call-shape → Task 7. Cap simulation via `setupPagedMockDb` (not `setupMockDb`). Private helper not exported. ✓
- **Spec §4 Change 4 gating:** Task 7 is explicitly deferred behind a real PostgREST smoke check. ✓
- **Placeholder scan:** every code step contains complete code; every command has expected output. No TBD/TODO. ✓
- **Type consistency:** `fetchDigestRows<T>` signature identical across Task 1 definition and all call sites; bindings `userRows`/`assigneeRows`/`legacyTasks` consistent between Task 3 Steps 2, 4, 5; `setupPagedMockDb` return shape `{ db, calls }` used consistently in Tasks 2/4/5/7. ✓
