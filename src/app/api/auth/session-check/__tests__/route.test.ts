import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mockCookieGet })),
}));

const mockGetUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

const mockValidateSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE_NAME: "app-session-id",
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

const mockAdminFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { GET } from "../route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupEnv(url = "https://test.supabase.co", key = "test-anon-key"): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/auth/session-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupEnv();
    // Default: user is active (not deactivated)
    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { deactivated_at: null }, error: null }),
        }),
      }),
    });
  });

  it("should return 200 when both Supabase user and app session are valid", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
    mockCookieGet.mockImplementation((name: string) =>
      name === "app-session-id" ? { value: "session-abc" } : undefined
    );
    mockValidateSession.mockResolvedValue({
      sessionId: "session-abc",
      userId: "user-123",
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: {},
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ valid: true });
  });

  it("should return 401 when Supabase user is not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ valid: false });
  });

  it("should return 401 when app-session-id cookie is missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
    mockCookieGet.mockReturnValue(undefined);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ valid: false });
  });

  it("should return 401 when app session is expired (validateSession returns null)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
    mockCookieGet.mockImplementation((name: string) =>
      name === "app-session-id" ? { value: "expired-session" } : undefined
    );
    mockValidateSession.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ valid: false });
  });

  it("should return 401 when session userId does not match Supabase user id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
    mockCookieGet.mockImplementation((name: string) =>
      name === "app-session-id" ? { value: "session-abc" } : undefined
    );
    mockValidateSession.mockResolvedValue({
      sessionId: "session-abc",
      userId: "different-user-456",
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: {},
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ valid: false });
  });

  it("should return 503 when environment variables are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ valid: false });
  });
});
