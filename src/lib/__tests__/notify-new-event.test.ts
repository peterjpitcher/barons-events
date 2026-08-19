import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks: must be declared before the SUT import
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  batchSend: vi.fn(),
  emailSend: vi.fn(),
  from: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class MockResend {
    batch = { send: mocks.batchSend };
    emails = { send: mocks.emailSend };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/planning/sop", () => ({
  markPastEventOpenTodosNotRequired: vi.fn(),
}));

import { notifyNewEvent } from "../notifications";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every table `.from()` was called with, so we can prove what is NOT read. */
const tablesRead: string[] = [];

const EVENT_ROW = {
  id: "e-1",
  title: "Test event",
  venue_id: "v-1",
  venue_space: null,
  start_at: new Date(Date.now() + 86_400_000).toISOString(),
  end_at: new Date(Date.now() + 90_000_000).toISOString(),
  venue: { name: "Test Venue" },
  creator: { id: "u-1", full_name: "Casey Creator", email: "creator@barons.test" },
  assignee: { id: "u-2", full_name: "Ari Assignee", email: "assignee@barons.test" },
};

function setupDb(eventRow: unknown = EVENT_ROW): void {
  mocks.from.mockImplementation((table: string) => {
    tablesRead.push(table);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "not", "order", "in", "neq"]) {
      chain[method] = () => chain;
    }
    chain.maybeSingle = async () => ({ data: eventRow, error: null });
    return chain;
  });
}

const BASE_PARAMS = {
  eventId: "e-1",
  transition: "admin_publish" as const,
  operationId: "op-aaaa-1111",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("notifyNewEvent", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    tablesRead.length = 0;
    process.env.RESEND_API_KEY = "re_test";
    process.env.BARONSHUB_OPERATIONAL_EMAILS_ENABLED = "true";
    delete process.env.NOTIFICATIONS_DISABLED;
    mocks.emailSend.mockResolvedValue({ data: { id: "msg-1" }, error: null });
    setupDb();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("sends one email to the creator when an administrator publishes", async () => {
    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin" });

    expect(mocks.emailSend).toHaveBeenCalledTimes(1);
    const [payload] = mocks.emailSend.mock.calls[0];
    expect(payload.to).toEqual(["creator@barons.test"]);
    expect(payload.subject).toContain("Update on your event");
  });

  it("sends one email to the assignee when a manager submits", async () => {
    await notifyNewEvent({ ...BASE_PARAMS, transition: "manager_submit", actorUserId: "u-1" });

    expect(mocks.emailSend).toHaveBeenCalledTimes(1);
    const [payload] = mocks.emailSend.mock.calls[0];
    expect(payload.to).toEqual(["assignee@barons.test"]);
    expect(payload.subject).toContain("ready for review");
  });

  it("sends nothing when the publisher is the creator", async () => {
    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-1" });

    expect(mocks.emailSend).not.toHaveBeenCalled();
  });

  it("never broadcasts: it does not read the user list or touch the claims table", async () => {
    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin" });

    expect(tablesRead).toEqual(["events"]);
    expect(tablesRead).not.toContain("users");
    expect(tablesRead).not.toContain("event_notification_claims");
    expect(mocks.batchSend).not.toHaveBeenCalled();
  });

  it("keys idempotency on the operation id so a republish is not treated as a replay", async () => {
    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin" });
    const firstKey = mocks.emailSend.mock.calls[0][1].idempotencyKey;

    mocks.emailSend.mockClear();
    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin", operationId: "op-bbbb-2222" });
    const secondKey = mocks.emailSend.mock.calls[0][1].idempotencyKey;

    expect(firstKey).toBe("new-event:e-1:admin_publish:op-aaaa-1111");
    expect(secondKey).toBe("new-event:e-1:admin_publish:op-bbbb-2222");
    expect(firstKey).not.toBe(secondKey);
  });

  it("reuses the same key for a retry of the same operation", async () => {
    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin" });
    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin" });

    expect(mocks.emailSend.mock.calls[0][1].idempotencyKey).toBe(
      mocks.emailSend.mock.calls[1][1].idempotencyKey
    );
  });

  it("treats a resolved provider error as a failure rather than a send", async () => {
    mocks.emailSend.mockResolvedValue({ data: null, error: { message: "domain not verified" } });

    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin" });

    const logged = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(([line]) => String(line))
      .find((line) => line.includes("notify_new_event"));
    expect(logged).toBeDefined();
    expect(JSON.parse(logged as string)).toMatchObject({
      sent: false,
      error: "domain not verified",
    });
  });

  it("treats an accepted response with no message id as a failure", async () => {
    mocks.emailSend.mockResolvedValue({ data: {}, error: null });

    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin" });

    const logged = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(([line]) => String(line))
      .find((line) => line.includes("notify_new_event"));
    expect(JSON.parse(logged as string).sent).toBe(false);
  });

  it("swallows a thrown send without throwing out of after()", async () => {
    mocks.emailSend.mockRejectedValue(new Error("network down"));

    await expect(notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin" })).resolves.toBeUndefined();
  });

  it("sends nothing when operational emails are disabled", async () => {
    process.env.BARONSHUB_OPERATIONAL_EMAILS_ENABLED = "false";

    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin" });

    expect(mocks.emailSend).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("sends nothing when the event has gone", async () => {
    setupDb(null);

    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin" });

    expect(mocks.emailSend).not.toHaveBeenCalled();
  });

  it("sends nothing when the creator record has no email", async () => {
    setupDb({ ...EVENT_ROW, creator: { id: "u-1", full_name: "Casey Creator", email: null } });

    await notifyNewEvent({ ...BASE_PARAMS, actorUserId: "u-admin" });

    expect(mocks.emailSend).not.toHaveBeenCalled();
  });
});
