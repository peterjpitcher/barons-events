import { describe, it, expect, vi, beforeEach } from "vitest";

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

type ChainCall = { table: string; method: string; args: unknown[] };

/** Every builder method called on a stubbed query chain, in order. */
const chainCalls: ChainCall[] = [];

const EVENT_ROW = {
  id: "e-1",
  title: "Test event",
  venue_id: "v-1",
  venue_space: null,
  start_at: new Date(Date.now() + 86_400_000).toISOString(),
  end_at: new Date(Date.now() + 90_000_000).toISOString(),
  venue: { name: "Test Venue" },
  event_venues: [],
  creator: { id: "u-1", full_name: "Actor", email: "actor@barons.test" },
  assignee: null,
};

const USER_ROWS = [
  {
    id: "u-1",
    email: "actor@barons.test",
    full_name: "Actor",
    venue_id: null,
    is_central_events_lead: false,
    role: "administrator",
  },
  {
    id: "u-2",
    email: "other@barons.test",
    full_name: "Other",
    venue_id: "v-9",
    is_central_events_lead: false,
    role: "manager",
  },
];

/**
 * One chainable stub serving both reads. The event read finishes with
 * maybeSingle(); the user list is awaited directly, so the chain is thenable.
 */
function buildEventQueryStub(table: string): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not", "order", "in", "neq"]) {
    chain[method] = (...args: unknown[]) => {
      chainCalls.push({ table, method, args });
      return chain;
    };
  }
  chain.maybeSingle = async () => ({ data: EVENT_ROW, error: null });
  chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: USER_ROWS, error: null });
  return chain;
}

type ClaimStubOptions = {
  /** A 23505 error models a unique violation, so the claim is already held. */
  claimResult?: { data: unknown; error: { code?: string; message: string } | null };
  deleteSpy?: ReturnType<typeof vi.fn>;
};

function setupDb(options: ClaimStubOptions = {}): {
  del: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
} {
  const eqSecond = vi.fn().mockResolvedValue({ error: null });
  const eqFirst = vi.fn().mockReturnValue({ eq: eqSecond });
  const del = options.deleteSpy ?? vi.fn().mockReturnValue({ eq: eqFirst });
  const insert = vi.fn().mockReturnValue({
    select: () => ({
      maybeSingle: async () => options.claimResult ?? { data: { event_id: "e-1" }, error: null },
    }),
  });

  mocks.from.mockImplementation((table: string) => {
    if (table !== "event_notification_claims") return buildEventQueryStub(table);
    return { insert, delete: del };
  });

  return { del, insert };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("notifyNewEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chainCalls.length = 0;
    process.env.BARONSHUB_OPERATIONAL_EMAILS_ENABLED = "true";
    delete process.env.NOTIFICATIONS_DISABLED;
    process.env.RESEND_API_KEY = "test-key";
  });

  it("releases the claim when the batch send resolves with an error", async () => {
    // Resend RESOLVES on provider failure. This is the regression this test guards.
    mocks.batchSend.mockResolvedValue({ data: null, error: { message: "rate limited" } });

    const eqSecond = vi.fn().mockResolvedValue({ error: null });
    const eqFirst = vi.fn().mockReturnValue({ eq: eqSecond });
    const del = vi.fn().mockReturnValue({ eq: eqFirst });
    setupDb({ deleteSpy: del });

    await notifyNewEvent({
      eventId: "e-1",
      actorUserId: "u-1",
      transition: "admin_publish",
      isFirstPublish: true,
    });

    expect(del).toHaveBeenCalled();
    expect(eqFirst).toHaveBeenCalledWith("event_id", "e-1");
    expect(eqSecond).toHaveBeenCalledWith("transition_key", "new_event");
  });

  it("releases the claim when the batch send THROWS", async () => {
    // A thrown send (network, DNS, timeout) must not strand the claim. If it
    // does, that event's announcement can never be sent again by any retry.
    mocks.batchSend.mockRejectedValue(new Error("socket hang up"));

    const eqSecond = vi.fn().mockResolvedValue({ error: null });
    const eqFirst = vi.fn().mockReturnValue({ eq: eqSecond });
    const del = vi.fn().mockReturnValue({ eq: eqFirst });
    setupDb({ deleteSpy: del });

    await notifyNewEvent({
      eventId: "e-1",
      actorUserId: "u-1",
      transition: "admin_publish",
      isFirstPublish: true,
    });

    expect(del).toHaveBeenCalled();
    expect(eqFirst).toHaveBeenCalledWith("event_id", "e-1");
    expect(eqSecond).toHaveBeenCalledWith("transition_key", "new_event");
  });

  it("keeps the claim on partial success", async () => {
    mocks.batchSend.mockResolvedValue({ data: { data: [{ id: "m1" }] }, error: null });
    const { del } = setupDb();

    await notifyNewEvent({
      eventId: "e-1",
      actorUserId: "u-1",
      transition: "admin_publish",
      isFirstPublish: true,
    });

    expect(mocks.batchSend).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });

  it("takes no claim when operational email is disabled", async () => {
    process.env.BARONSHUB_OPERATIONAL_EMAILS_ENABLED = "false";
    setupDb();

    await notifyNewEvent({
      eventId: "e-1",
      actorUserId: "u-1",
      transition: "admin_publish",
      isFirstPublish: true,
    });

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.batchSend).not.toHaveBeenCalled();
  });

  it("takes no claim when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    setupDb();

    await notifyNewEvent({
      eventId: "e-1",
      actorUserId: "u-1",
      transition: "admin_publish",
      isFirstPublish: true,
    });

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.batchSend).not.toHaveBeenCalled();
  });

  it("sends one batch with a deterministic idempotency key", async () => {
    mocks.batchSend.mockResolvedValue({ data: { data: [{ id: "m1" }, { id: "m2" }] }, error: null });
    setupDb();

    await notifyNewEvent({
      eventId: "e-1",
      actorUserId: "u-1",
      transition: "admin_publish",
      isFirstPublish: true,
    });

    expect(mocks.batchSend).toHaveBeenCalledTimes(1);
    const [payload, options] = mocks.batchSend.mock.calls[0];
    // The key describes the PAYLOAD, not just the event. A later republish
    // carries a different message set and must not collide with this one's
    // cached provider response. Trailing 0 is the chunk offset.
    expect(options).toEqual({
      idempotencyKey: "new-event:e-1:admin_publish:2:announcement:0",
    });
    // The actor is also the creator, so their decision email is suppressed and
    // they receive only the announcement.
    expect(payload).toHaveLength(2);
    expect(payload.map((entry: { to: string[] }) => entry.to[0]).sort()).toEqual([
      "actor@barons.test",
      "other@barons.test",
    ]);
    expect(
      payload.every((entry: { subject: string }) => entry.subject.startsWith("New event coming soon:"))
    ).toBe(true);
  });

  it("still sends targeted mail when the announcement claim is already held", async () => {
    mocks.batchSend.mockResolvedValue({ data: { data: [{ id: "m1" }] }, error: null });
    setupDb({ claimResult: { data: null, error: { code: "23505", message: "duplicate key" } } });

    await notifyNewEvent({
      eventId: "e-1",
      actorUserId: "u-2",
      transition: "admin_publish",
      isFirstPublish: true,
    });

    expect(mocks.batchSend).toHaveBeenCalledTimes(1);
    const [payload] = mocks.batchSend.mock.calls[0];
    expect(payload).toHaveLength(1);
    expect(payload[0].to).toEqual(["actor@barons.test"]);
    expect(payload[0].subject).toBe("Update on your event: Test event");
  });

  it("lists active users with no venue filter", async () => {
    mocks.batchSend.mockResolvedValue({ data: { data: [{ id: "m1" }, { id: "m2" }] }, error: null });
    setupDb();

    await notifyNewEvent({
      eventId: "e-1",
      actorUserId: "u-1",
      transition: "admin_publish",
      isFirstPublish: true,
    });

    const userCalls = chainCalls.filter((call) => call.table === "users");
    expect(userCalls.map((call) => call.method)).toEqual(["select", "is", "not", "order"]);
    expect(userCalls[0].args[0]).toBe("id, email, full_name, venue_id, is_central_events_lead, role");
    expect(userCalls[1].args).toEqual(["deactivated_at", null]);
    expect(userCalls[2].args).toEqual(["email", "is", null]);
    expect(userCalls[3].args).toEqual(["full_name", { ascending: true }]);

    // u-2 sits at venue v-9, which is not the event venue, and must still be
    // included: the announcement goes to every application user.
    const [payload] = mocks.batchSend.mock.calls[0];
    expect(payload.map((entry: { to: string[] }) => entry.to[0])).toContain("other@barons.test");
  });

  it("plans no announcement and takes no claim when this is not the first publish", async () => {
    mocks.batchSend.mockResolvedValue({ data: { data: [{ id: "m1" }] }, error: null });
    const { insert } = setupDb();

    await notifyNewEvent({
      eventId: "e-1",
      actorUserId: "u-2",
      transition: "admin_publish",
      isFirstPublish: false,
    });

    expect(insert).not.toHaveBeenCalled();
    const [payload] = mocks.batchSend.mock.calls[0];
    expect(payload).toHaveLength(1);
    expect(payload[0].subject).toBe("Update on your event: Test event");
  });

  it("sends nothing when the batch would be empty", async () => {
    setupDb();

    await notifyNewEvent({
      eventId: "e-1",
      actorUserId: "u-1",
      transition: "admin_publish",
      isFirstPublish: false,
    });

    // The actor is the creator, so the only targeted message is suppressed and
    // there is no announcement on a republish.
    expect(mocks.batchSend).not.toHaveBeenCalled();
  });
});
