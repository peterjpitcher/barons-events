import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before the SUT import
// ---------------------------------------------------------------------------

const mockEmailSend = vi.fn().mockResolvedValue({ id: "mock-email-id" });

vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      emails = { send: mockEmailSend };
    }
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: vi.fn()
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/datetime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/datetime")>();
  return {
    ...actual,
    getTodayLondonIsoDate: vi.fn().mockReturnValue("2026-04-23"),
    formatInLondon: vi.fn().mockReturnValue({ date: "Wed 23 Apr", time: "12:00am" })
  };
});

import { sendWeeklyDigestEmail } from "../notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const mockAdmin = createSupabaseAdminClient as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a planning task row as returned by the Supabase query. */
function makeTask(overrides: {
  id?: string;
  title?: string;
  due_date?: string;
  assignee_id?: string;
  planning_item?: {
    id?: string;
    title?: string;
    event?: { id: string; title: string; venue_id: string | null } | null;
  };
} = {}) {
  return {
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "Order supplies",
    due_date: overrides.due_date ?? "2026-04-22",
    assignee_id: overrides.assignee_id ?? "user-1",
    planning_item: {
      id: overrides.planning_item?.id ?? "pi-1",
      title: overrides.planning_item?.title ?? "Easter Prep",
      event: overrides.planning_item?.event !== undefined
        ? overrides.planning_item.event
        : { id: "evt-1", title: "Easter Sunday", venue_id: "venue-1" }
    }
  };
}

function makeEvent(overrides: Partial<{
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  venue_id: string;
  venue: { name: string } | null;
  status: string;
  deleted_at: string | null;
}> = {}) {
  return {
    id: overrides.id ?? "evt-1",
    title: overrides.title ?? "Easter Sunday",
    start_at: overrides.start_at ?? "2026-04-25T18:00:00Z",
    end_at: overrides.end_at ?? "2026-04-25T21:00:00Z",
    venue_id: overrides.venue_id ?? "venue-1",
    venue: overrides.venue !== undefined ? overrides.venue : { name: "The Star" },
    status: overrides.status ?? "approved",
    deleted_at: overrides.deleted_at ?? null
  };
}

function makeUser(overrides: Partial<{
  id: string;
  email: string;
  full_name: string;
  venue_id: string | null;
  deactivated_at: string | null;
}> = {}) {
  return {
    id: overrides.id ?? "user-1",
    email: overrides.email ?? "alice@example.com",
    full_name: overrides.full_name ?? "Alice Smith",
    venue_id: overrides.venue_id !== undefined ? overrides.venue_id : "venue-1",
    deactivated_at: overrides.deactivated_at ?? null
  };
}

/**
 * Creates a mock Supabase admin client whose `.from()` returns different
 * query chains depending on the table name.
 *
 * `tableResults` maps table name → { data, error }.
 */
function setupMockDb(tableResults: Record<string, { data: unknown; error: unknown }>) {
  // Build a flexible chain that supports any combination of .select/.eq/.lte/.not/.gte/.lt/.in/.is/.order/.limit
  function buildChain(result: { data: unknown; error: unknown }) {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        // When awaited or .then called, resolve with result
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(result);
        }
        // Any chained method returns another proxy
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      }
    };
    return new Proxy({}, handler);
  }

  const from = vi.fn().mockImplementation((table: string) => {
    const result = tableResults[table];
    if (result) {
      return buildChain(result);
    }
    // Default: empty success
    return buildChain({ data: [], error: null });
  });

  // Also support insert for audit_log
  const insertProxy: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      }
      return vi.fn().mockReturnValue(new Proxy({}, insertProxy));
    }
  };

  const fromWithInsert = vi.fn().mockImplementation((table: string) => {
    const chain = from(table);
    // Add insert method to the chain
    if (table === "audit_log") {
      return {
        ...chain,
        select: chain.select,
        insert: vi.fn().mockResolvedValue({ data: null, error: null })
      };
    }
    return chain;
  });

  // We need a smarter approach: use Proxy all the way
  const dbProxy = {
    from: vi.fn().mockImplementation((table: string) => {
      const result = tableResults[table] ?? { data: [], error: null };

      const handler: ProxyHandler<object> = {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(result);
          }
          if (prop === "insert") {
            return vi.fn().mockResolvedValue({ data: null, error: null });
          }
          return vi.fn().mockReturnValue(new Proxy({}, handler));
        }
      };
      return new Proxy({}, handler);
    })
  };

  mockAdmin.mockReturnValue(dbProxy);
  return dbProxy;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sendWeeklyDigestEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Enable notifications and provide Resend key
    delete process.env.NOTIFICATIONS_DISABLED;
    process.env.RESEND_API_KEY = "re_test_key";
  });

  // 1. Happy path
  it("should send an email with tasks and upcoming events when user has open tasks", async () => {
    const tasks = [
      makeTask({ id: "t1", title: "Book DJ", due_date: "2026-04-22", assignee_id: "user-1" }),
      makeTask({ id: "t2", title: "Order flowers", due_date: "2026-04-23", assignee_id: "user-1" }),
      makeTask({
        id: "t3", title: "Confirm catering", due_date: "2026-04-21", assignee_id: "user-1",
        planning_item: { id: "pi-2", title: "Food Prep", event: { id: "evt-2", title: "Birthday Bash", venue_id: "venue-1" } }
      })
    ];
    const events = [makeEvent()];
    const users = [makeUser()];

    setupMockDb({
      audit_log: { data: [], error: null },       // idempotency: no prior run
      planning_tasks: { data: tasks, error: null },
      events: { data: events, error: null },
      users: { data: users, error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skippedAssignees).toBe(0);
    expect(mockEmailSend).toHaveBeenCalledTimes(1);

    const call = mockEmailSend.mock.calls[0][0];
    expect(call.to).toEqual(["alice@example.com"]);
    expect(call.subject).toContain("3 open tasks");
    expect(call.html).toBeDefined();
  });

  // 2. Venue-scoped user
  it("should only show events at the user's venue when venue_id is set", async () => {
    const tasks = [makeTask({ assignee_id: "user-1" })];
    const events = [
      makeEvent({ id: "evt-1", venue_id: "venue-1" }),
      makeEvent({ id: "evt-2", title: "Other Venue Event", venue_id: "venue-2" })
    ];
    const users = [makeUser({ venue_id: "venue-1" })];

    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: tasks, error: null },
      events: { data: events, error: null },
      users: { data: users, error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result.sent).toBe(1);
    const call = mockEmailSend.mock.calls[0][0];
    // The email should mention "The Star" (venue-1) but NOT "Other Venue Event"
    expect(call.html).toContain("Easter Sunday");
    // venue-2 event should be filtered out — not in the body
    expect(call.text).not.toContain("Other Venue Event");
  });

  // 3. Unscoped user
  it("should show all events across all venues when user has no venue_id", async () => {
    const tasks = [makeTask({ assignee_id: "user-2" })];
    const events = [
      makeEvent({ id: "evt-1", venue_id: "venue-1" }),
      makeEvent({ id: "evt-2", title: "Second Venue Event", venue_id: "venue-2", venue: { name: "The Duke" } })
    ];
    const users = [makeUser({ id: "user-2", email: "bob@example.com", full_name: "Bob Jones", venue_id: null })];

    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: tasks, error: null },
      events: { data: events, error: null },
      users: { data: users, error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result.sent).toBe(1);
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.text).toContain("Easter Sunday");
    expect(call.text).toContain("Second Venue Event");
  });

  // 4. No upcoming events for recipient
  it("should omit events section when there are no upcoming events", async () => {
    const tasks = [makeTask({ assignee_id: "user-1" })];
    const users = [makeUser()];

    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: tasks, error: null },
      events: { data: [], error: null },
      users: { data: users, error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result.sent).toBe(1);
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.text).not.toContain("Coming up in the next 4 days");
  });

  // 5. No qualifying tasks
  it("should return sent: 0 with no Resend calls when there are no open tasks", async () => {
    const users = [makeUser()];

    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: [], error: null },
      events: { data: [makeEvent()], error: null },
      users: { data: users, error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  // 6. Deactivated assignee
  it("should skip tasks assigned to deactivated users and count them in skippedAssignees", async () => {
    // Task assigned to user-99 who is NOT in the active users list
    const tasks = [
      makeTask({ assignee_id: "user-99", id: "t-deactivated" }),
      makeTask({ assignee_id: "user-1", id: "t-active" })
    ];
    const users = [makeUser({ id: "user-1" })];

    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: tasks, error: null },
      events: { data: [], error: null },
      users: { data: users, error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result.skippedAssignees).toBe(1);
    expect(result.sent).toBe(1);
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
  });

  // 7. Overdue tasks sorted first
  it("should sort overdue tasks before today's tasks with an overdue marker", async () => {
    const tasks = [
      makeTask({ id: "t-today", title: "Today task", due_date: "2026-04-23", assignee_id: "user-1" }),
      makeTask({ id: "t-overdue", title: "Overdue task", due_date: "2026-04-20", assignee_id: "user-1" })
    ];
    const users = [makeUser()];

    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: tasks, error: null },
      events: { data: [], error: null },
      users: { data: users, error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result.sent).toBe(1);
    const call = mockEmailSend.mock.calls[0][0];
    // Overdue task should appear with overdue marker in text
    expect(call.text).toContain("overdue");
    // Check ordering: "Overdue task" should come before "Today task" in the text
    const overdueIdx = (call.text as string).indexOf("Overdue task");
    const todayIdx = (call.text as string).indexOf("Today task");
    expect(overdueIdx).toBeLessThan(todayIdx);
  });

  // 8. Tasks grouped by planning item
  it("should group tasks by planning item with different items as separate groups", async () => {
    const tasks = [
      makeTask({
        id: "t1", title: "Task A", due_date: "2026-04-22", assignee_id: "user-1",
        planning_item: { id: "pi-1", title: "Easter Prep", event: null }
      }),
      makeTask({
        id: "t2", title: "Task B", due_date: "2026-04-22", assignee_id: "user-1",
        planning_item: { id: "pi-1", title: "Easter Prep", event: null }
      }),
      makeTask({
        id: "t3", title: "Task C", due_date: "2026-04-22", assignee_id: "user-1",
        planning_item: { id: "pi-2", title: "Spring Launch", event: null }
      })
    ];
    const users = [makeUser()];

    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: tasks, error: null },
      events: { data: [], error: null },
      users: { data: users, error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result.sent).toBe(1);
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.text).toContain("Easter Prep");
    expect(call.text).toContain("Spring Launch");
    expect(call.text).toContain("Task A");
    expect(call.text).toContain("Task B");
    expect(call.text).toContain("Task C");
  });

  // 9. Event-linked planning item
  it("should include event title in group heading when planning item is linked to an event", async () => {
    const tasks = [
      makeTask({
        id: "t1", title: "Set up stage", due_date: "2026-04-22", assignee_id: "user-1",
        planning_item: { id: "pi-1", title: "Stage Setup", event: { id: "evt-1", title: "Summer Festival", venue_id: "venue-1" } }
      })
    ];
    const users = [makeUser()];

    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: tasks, error: null },
      events: { data: [], error: null },
      users: { data: users, error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result.sent).toBe(1);
    const call = mockEmailSend.mock.calls[0][0];
    // The heading should contain "Stage Setup" and "Summer Festival" connected by an em dash
    expect(call.text).toContain("Stage Setup");
    expect(call.text).toContain("Summer Festival");
  });

  // 10. 50-task cap
  it("should cap tasks at 50 and show an overflow message when user has more than 50 tasks", async () => {
    const tasks = Array.from({ length: 60 }, (_, i) =>
      makeTask({
        id: `t-${i}`,
        title: `Task number ${i + 1}`,
        due_date: "2026-04-22",
        assignee_id: "user-1"
      })
    );
    const users = [makeUser()];

    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: tasks, error: null },
      events: { data: [], error: null },
      users: { data: users, error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result.sent).toBe(1);
    const call = mockEmailSend.mock.calls[0][0];
    // Should show overflow message
    expect(call.text).toContain("10 more");
    // Subject should reflect total count (60), not capped count
    expect(call.subject).toContain("60 open tasks");
  });

  // 11. Idempotency
  it("should return early with no emails sent when a digest was already sent today", async () => {
    setupMockDb({
      audit_log: { data: [{ id: "existing-audit" }], error: null },
      planning_tasks: { data: [], error: null },
      events: { data: [], error: null },
      users: { data: [], error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result).toEqual({ sent: 0, failed: 0, skippedAssignees: 0 });
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  // 12. Preflight query failure
  it("should throw an error when the tasks query fails", async () => {
    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: null, error: { message: "connection refused" } },
      events: { data: [], error: null },
      users: { data: [], error: null }
    });

    await expect(sendWeeklyDigestEmail()).rejects.toThrow("Failed to fetch planning tasks");
  });

  // 13. Per-recipient failure
  it("should continue sending to other users when Resend fails for one user", async () => {
    const tasks = [
      makeTask({ id: "t1", assignee_id: "user-1" }),
      makeTask({ id: "t2", assignee_id: "user-2" })
    ];
    const users = [
      makeUser({ id: "user-1", email: "alice@example.com" }),
      makeUser({ id: "user-2", email: "bob@example.com", venue_id: null })
    ];

    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: tasks, error: null },
      events: { data: [], error: null },
      users: { data: users, error: null }
    });

    // First call fails, second succeeds
    mockEmailSend
      .mockRejectedValueOnce(new Error("Resend API error"))
      .mockResolvedValueOnce({ id: "mock-id-2" });

    const result = await sendWeeklyDigestEmail();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(mockEmailSend).toHaveBeenCalledTimes(2);
  });

  // 14. Subject line
  it("should include the task count in the email subject line", async () => {
    const tasks = [
      makeTask({ id: "t1", assignee_id: "user-1" }),
      makeTask({ id: "t2", assignee_id: "user-1" }),
      makeTask({ id: "t3", assignee_id: "user-1" })
    ];
    const users = [makeUser()];

    setupMockDb({
      audit_log: { data: [], error: null },
      planning_tasks: { data: tasks, error: null },
      events: { data: [], error: null },
      users: { data: users, error: null }
    });

    const result = await sendWeeklyDigestEmail();

    expect(result.sent).toBe(1);
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.subject).toBe("Your BaronsHub digest \u2014 3 open tasks");
  });
});
