import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: vi.fn(),
  createSupabaseActionClient: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listUsersWithAuthData } from "@/lib/users";

const readonlyClientMock = createSupabaseReadonlyClient as ReturnType<typeof vi.fn>;
const adminClientMock = createSupabaseAdminClient as ReturnType<typeof vi.fn>;

function makePublicUser(overrides: Record<string, unknown>) {
  return {
    id: "user-1",
    email: "user@example.com",
    full_name: "User One",
    role: "office_worker",
    venue_id: null,
    is_central_events_lead: false,
    todo_digest_frequency: "weekly",
    todo_digest_last_sent_on: null,
    sop_drawer_pinned: false,
    debrief_pinned: false,
    deactivated_at: null,
    deactivated_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("listUsersWithAuthData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses latest app session activity as lastActiveAt and keeps auth sign-in as fallback metadata", async () => {
    const publicUsers = [
      makePublicUser({ id: "user-1", email: "active@example.com" }),
      makePublicUser({ id: "user-2", email: "signed-in@example.com" }),
    ];
    const userOrder = vi.fn().mockResolvedValue({ data: publicUsers, error: null });
    readonlyClientMock.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ order: userOrder }),
      }),
    });

    const listUsers = vi.fn().mockResolvedValue({
      data: {
        users: [
          {
            id: "user-1",
            email_confirmed_at: "2026-01-01T00:00:00.000Z",
            last_sign_in_at: "2026-01-02T00:00:00.000Z",
          },
          {
            id: "user-2",
            email_confirmed_at: "2026-01-01T00:00:00.000Z",
            last_sign_in_at: "2026-01-03T00:00:00.000Z",
          },
        ],
        nextPage: null,
      },
      error: null,
    });
    const sessionIn = vi.fn().mockResolvedValue({
      data: [
        { user_id: "user-1", last_activity_at: "2026-01-04T10:00:00.000Z" },
        { user_id: "user-1", last_activity_at: "2026-01-04T10:30:00.000Z" },
      ],
      error: null,
    });
    adminClientMock.mockReturnValue({
      auth: { admin: { listUsers } },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ in: sessionIn }),
      }),
    });

    const users = await listUsersWithAuthData();

    expect(sessionIn).toHaveBeenCalledWith("user_id", ["user-1", "user-2"]);
    expect(users[0].lastActiveAt).toEqual(new Date("2026-01-04T10:30:00.000Z"));
    expect(users[0].lastSignInAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    expect(users[1].lastActiveAt).toBeNull();
    expect(users[1].lastSignInAt).toEqual(new Date("2026-01-03T00:00:00.000Z"));
  });
});
