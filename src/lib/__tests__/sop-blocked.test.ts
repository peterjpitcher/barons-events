import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Mock server-only before any imports that use it
vi.mock("server-only", () => ({}));

// Mock the admin client
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { updateBlockedStatus } from "@/lib/planning/sop";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type DbResult = { data: unknown; error: null | { message: string } };

/**
 * Creates a thenable chain node that resolves to `result` when awaited, and
 * whose every chain method (select, eq, in, update) returns another such node
 * with the same `result` — lazily, via `mockImplementation`.
 *
 * This avoids the infinite-recursion problem from eager construction while
 * still supporting arbitrary-length chains like `.select().eq().eq()`.
 */
function makeChainNode(result: DbResult): Record<string, unknown> {
  const node: Record<string, unknown> = {};

  // Make `await node` resolve with `result`
  node.then = (
    onFulfilled: (v: DbResult) => unknown,
    onRejected: (e: unknown) => unknown
  ) => Promise.resolve(result).then(onFulfilled, onRejected);

  // Each chain method lazily returns a new node with the same result
  const lazy = () => makeChainNode(result);
  node.select = vi.fn().mockImplementation(lazy);
  node.eq     = vi.fn().mockImplementation(lazy);
  node.in     = vi.fn().mockImplementation(lazy);
  node.update = vi.fn().mockImplementation(lazy);

  return node;
}

/**
 * Creates a Supabase client where each successive `from()` call resolves with
 * the next entry in `results`. Any extra `from()` calls beyond the array fall
 * back to `{ data: [], error: null }`.
 */
function buildClient(results: DbResult[]) {
  let idx = 0;
  const from = vi.fn().mockImplementation(() => {
    const result = results[idx++] ?? { data: [], error: null };
    return makeChainNode(result);
  });
  return { from };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("updateBlockedStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── done / not_required paths ─────────────────────────────────────────────

  it("unblocks a dependent task when ALL its dependencies are resolved (done)", async () => {
    // DB call sequence for done path (one dependent task):
    // 1. find dependents of completedTaskId  → [{ task_id: "dep-task-1" }]
    // 2. find all deps of dep-task-1         → [{ depends_on_task_id: "completed-task" }]
    // 3. fetch status of those dep tasks     → [{ id: "completed-task", status: "done" }]
    // 4. update is_blocked on dep-task-1     → success
    const client = buildClient([
      { data: [{ task_id: "dep-task-1" }], error: null },
      { data: [{ depends_on_task_id: "completed-task" }], error: null },
      { data: [{ id: "completed-task", status: "done" }], error: null },
      { data: null, error: null },
    ]);
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    await expect(updateBlockedStatus("completed-task", "done")).resolves.toBeUndefined();
  });

  it("behaves identically for not_required status — unblocks resolved dependents", async () => {
    const client = buildClient([
      { data: [{ task_id: "dep-task-1" }], error: null },
      { data: [{ depends_on_task_id: "completed-task" }], error: null },
      { data: [{ id: "completed-task", status: "not_required" }], error: null },
      { data: null, error: null },
    ]);
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    await expect(updateBlockedStatus("completed-task", "not_required")).resolves.toBeUndefined();
  });

  it("keeps dependent task blocked when NOT all of its dependencies are resolved", async () => {
    // dep-task-1 depends on "completed-task" (done) AND "other-task" (open)
    // → allResolved is false → update sets is_blocked: true
    const client = buildClient([
      { data: [{ task_id: "dep-task-1" }], error: null },
      {
        data: [
          { depends_on_task_id: "completed-task" },
          { depends_on_task_id: "other-task" },
        ],
        error: null,
      },
      {
        data: [
          { id: "completed-task", status: "done" },
          { id: "other-task", status: "open" },
        ],
        error: null,
      },
      { data: null, error: null },
    ]);
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    await expect(updateBlockedStatus("completed-task", "done")).resolves.toBeUndefined();
  });

  // ── open (reopen) path ────────────────────────────────────────────────────

  it("sets is_blocked=true on all dependents when a task is reopened (open)", async () => {
    const client = buildClient([
      { data: [{ task_id: "dep-task-1" }, { task_id: "dep-task-2" }], error: null },
      { data: null, error: null }, // bulk update
    ]);
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    await expect(updateBlockedStatus("completed-task", "open")).resolves.toBeUndefined();
  });

  // ── no-op paths ───────────────────────────────────────────────────────────

  it("is a no-op when there are no dependent tasks (done)", async () => {
    const client = buildClient([{ data: [], error: null }]);
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    await expect(updateBlockedStatus("lonely-task", "done")).resolves.toBeUndefined();
    // Only 1 from() call — early return after finding no dependents
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when there are no dependent tasks (open)", async () => {
    const client = buildClient([{ data: [], error: null }]);
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    await expect(updateBlockedStatus("lonely-task", "open")).resolves.toBeUndefined();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when dependents query returns null (treated as empty)", async () => {
    const client = buildClient([{ data: null, error: null }]);
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    await expect(updateBlockedStatus("lonely-task", "done")).resolves.toBeUndefined();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  // ── error paths ───────────────────────────────────────────────────────────

  it("throws when the dependents query fails (done)", async () => {
    const client = buildClient([
      { data: null, error: { message: "permission denied" } },
    ]);
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    await expect(updateBlockedStatus("task-id", "done")).rejects.toThrow("permission denied");
  });

  it("throws when the dependents query fails (open)", async () => {
    const client = buildClient([
      { data: null, error: { message: "connection timeout" } },
    ]);
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    await expect(updateBlockedStatus("task-id", "open")).rejects.toThrow("connection timeout");
  });

  it("throws when the all-deps query fails for a dependent task", async () => {
    const client = buildClient([
      { data: [{ task_id: "dep-task-1" }], error: null },
      { data: null, error: { message: "foreign key violation" } },
    ]);
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    await expect(updateBlockedStatus("task-id", "done")).rejects.toThrow("foreign key violation");
  });

  it("throws when the status-fetch query fails for dependency tasks", async () => {
    const client = buildClient([
      { data: [{ task_id: "dep-task-1" }], error: null },
      { data: [{ depends_on_task_id: "completed-task" }], error: null },
      { data: null, error: { message: "row not found" } },
    ]);
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    await expect(updateBlockedStatus("task-id", "done")).rejects.toThrow("row not found");
  });
});
