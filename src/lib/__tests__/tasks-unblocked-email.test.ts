import { describe, expect, it, vi, beforeEach } from "vitest";

const mockEmailSend = vi.fn().mockResolvedValue({ data: { id: "mock-email-id" }, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockEmailSend };
  }
}));

const mockAdminClient = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockAdminClient()
}));

// fetchUser reads through the readonly client, not the admin one.
const mockReadonlyClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: async () => mockReadonlyClient(),
  createSupabaseActionClient: async () => mockReadonlyClient()
}));

import { sendTasksUnblockedEmail } from "@/lib/notifications";

/**
 * Table-keyed stub. The function reads planning_tasks, planning_task_assignees
 * and users, so a sequential stub would be brittle if the order ever changes.
 */
function buildClient(tables: Record<string, { data: unknown; error: null | { message: string } }>) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      const result = tables[table] ?? { data: [], error: null };
      const node: Record<string, unknown> = {};
      node.then = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled, onRejected);
      const lazy = () => node;
      node.select = vi.fn().mockImplementation(lazy);
      node.eq = vi.fn().mockImplementation(lazy);
      node.in = vi.fn().mockImplementation(lazy);
      node.maybeSingle = vi.fn().mockResolvedValue(result);
      return node;
    })
  };
}

/** Both clients read from the same table map, so a test declares data once. */
function useTables(tables: Record<string, { data: unknown; error: null | { message: string } }>) {
  const client = buildClient(tables);
  mockAdminClient.mockReturnValue(client);
  mockReadonlyClient.mockReturnValue(client);
  return client;
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Allergens",
    due_date: "2026-09-01",
    assignee_id: null,
    status: "open",
    is_blocked: false,
    planning_item: { id: "item-1", title: "Autumn menu", event: { id: "event-1", title: "Autumn Menu Launch" } },
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BARONSHUB_OPERATIONAL_EMAILS_ENABLED = "true";
  delete process.env.NOTIFICATIONS_DISABLED;
  process.env.RESEND_API_KEY = "test-key";
});

describe("sendTasksUnblockedEmail", () => {
  it("sends nothing when no tasks were unblocked", async () => {
    await sendTasksUnblockedEmail([]);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("tells the assignee a task is ready to start", async () => {
    useTables({
        planning_tasks: { data: [task()], error: null },
        planning_task_assignees: { data: [{ task_id: "task-1", user_id: "user-1" }], error: null },
        users: { data: { id: "user-1", email: "georgia@example.com", full_name: "Georgia" }, error: null }
      });

    await sendTasksUnblockedEmail(["task-1"]);

    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    const sent = mockEmailSend.mock.calls[0][0];
    expect(sent.to).toBe("georgia@example.com");
    expect(sent.subject).toContain("Allergens");
    expect(sent.text).toContain("Allergens");
  });

  it("batches several released tasks into one email per person", async () => {
    // "Setup Event" releases eight tasks in production. One email, not eight.
    const tasks = Array.from({ length: 8 }, (_, index) =>
      task({ id: `task-${index}`, title: `Task ${index}` })
    );
    useTables({
        planning_tasks: { data: tasks, error: null },
        planning_task_assignees: {
          data: tasks.map((t) => ({ task_id: t.id, user_id: "user-1" })),
          error: null
        },
        users: { data: { id: "user-1", email: "georgia@example.com", full_name: "Georgia" }, error: null }
      });

    await sendTasksUnblockedEmail(tasks.map((t) => t.id));

    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    expect(mockEmailSend.mock.calls[0][0].subject).toContain("8 tasks");
  });

  it("does not tell anyone about a task that is still blocked", async () => {
    // Re-checked rather than trusted: a sweep may have re-blocked it between
    // the status write and this call.
    useTables({
        planning_tasks: { data: [task({ is_blocked: true })], error: null },
        planning_task_assignees: { data: [{ task_id: "task-1", user_id: "user-1" }], error: null },
        users: { data: { id: "user-1", email: "georgia@example.com", full_name: "Georgia" }, error: null }
      });

    await sendTasksUnblockedEmail(["task-1"]);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("falls back to the legacy single assignee when there is no junction row", async () => {
    useTables({
        planning_tasks: { data: [task({ assignee_id: "user-9" })], error: null },
        planning_task_assignees: { data: [], error: null },
        users: { data: { id: "user-9", email: "tom@example.com", full_name: "Tom" }, error: null }
      });

    await sendTasksUnblockedEmail(["task-1"]);
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    expect(mockEmailSend.mock.calls[0][0].to).toBe("tom@example.com");
  });

  it("sends nothing when the task has no owner at all", async () => {
    useTables({
        planning_tasks: { data: [task()], error: null },
        planning_task_assignees: { data: [], error: null }
      });

    await sendTasksUnblockedEmail(["task-1"]);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("stays silent when operational emails are switched off", async () => {
    process.env.BARONSHUB_OPERATIONAL_EMAILS_ENABLED = "false";
    await sendTasksUnblockedEmail(["task-1"]);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("never throws, so it cannot fail the task tick that triggered it", async () => {
    useTables({ planning_tasks: { data: null, error: { message: "connection lost" } } });

    await expect(sendTasksUnblockedEmail(["task-1"])).resolves.toBeUndefined();
    expect(mockEmailSend).not.toHaveBeenCalled();
  });
});
