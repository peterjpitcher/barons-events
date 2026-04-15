/**
 * Tests for src/lib/auth.ts — RBAC helpers and API route wrappers.
 *
 * Mock strategy:
 * - @/lib/supabase/server is mocked so no real Supabase client is created.
 * - next/navigation redirect is mocked to capture calls without throwing.
 * - All tests reset mock state in beforeEach.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock: next/navigation ────────────────────────────────────────────────────
// next/navigation's redirect() throws a special Next.js error in production so
// execution halts after the call — replicate that here so requireAdmin's guard
// clauses work correctly in tests.
vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  })
}));

// ─── Mock: @/lib/supabase/server ─────────────────────────────────────────────
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: vi.fn()
}));

import { redirect } from "next/navigation";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";

import {
  getCurrentUser,
  requireAdmin,
  requireAuth,
  withAdminAuth,
  withAdminAuthAndCSRF,
  withAuth,
  withAuthAndCSRF
} from "@/lib/auth";
import type { AppUser } from "@/lib/types";
import {
  canManageEvents,
  canReviewEvents,
  canSubmitDebriefs,
  canManageArtists,
  canManageVenues,
  canManageUsers,
  canManageSettings,
  canUsePlanning,
  canViewPlanning,
  canViewAllEvents,
  canManageLinks,
  canViewSopTemplate,
  canEditSopTemplate,
} from "@/lib/roles";

// ─── Typed mock helpers ───────────────────────────────────────────────────────

const mockCreateClient = createSupabaseReadonlyClient as ReturnType<typeof vi.fn>;
const mockRedirect = redirect as unknown as ReturnType<typeof vi.fn>;

/**
 * Build a minimal Supabase client double.
 * `authUser`  — the value returned by auth.getUser()  (null = no session)
 * `dbProfile` — the value returned by the users table query (null = no row)
 */
function makeSupabaseClient(
  authUser: { id: string } | null,
  dbProfile: {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    venue_id: string | null;
  } | null
) {
  // Chain: supabase.from('users').select(...).eq(...).maybeSingle()
  const maybeSingle = vi.fn().mockResolvedValue({ data: dbProfile });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: authUser } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } })
    },
    from
  };

  return client;
}

/** Convenience: a fully valid central_planner profile row. */
const validCentralPlannerProfile = {
  id: "user-1",
  email: "planner@example.com",
  full_name: "Test Planner",
  role: "central_planner",
  venue_id: null
};

/** Convenience: the expected AppUser produced from validCentralPlannerProfile. */
const validCentralPlannerUser: AppUser = {
  id: "user-1",
  email: "planner@example.com",
  fullName: "Test Planner",
  role: "central_planner",
  venueId: null
};

/** Build a valid CSRF request with matching cookie and header. */
function makeCSRFRequest(
  token: string,
  overrides?: { cookie?: string; header?: string | null }
): Request {
  const cookie =
    overrides?.cookie !== undefined
      ? overrides.cookie
      : `csrf-token=${token}`;
  const headers: Record<string, string> = {
    cookie,
    ...(overrides?.header !== undefined && overrides.header !== null
      ? { "x-csrf-token": overrides.header }
      : overrides?.header === null
        ? {}
        : { "x-csrf-token": token })
  };
  return new Request("http://localhost/test", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getCurrentUser ───────────────────────────────────────────────────────────

describe("getCurrentUser", () => {
  it("returns null when supabase auth returns no user", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient(null, null));

    const result = await getCurrentUser();

    expect(result).toBeNull();
  });

  it("returns null when the users table profile is not found", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, null)
    );

    const result = await getCurrentUser();

    expect(result).toBeNull();
  });

  it("returns null when the profile has an unrecognised role (fail-closed)", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-1" },
        {
          id: "user-1",
          email: "rogue@example.com",
          full_name: null,
          role: "super_admin", // not in the allowed set
          venue_id: null
        }
      )
    );

    const result = await getCurrentUser();

    expect(result).toBeNull();
  });

  it("returns a correctly shaped AppUser when role is valid", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const result = await getCurrentUser();

    expect(result).toEqual(validCentralPlannerUser);
  });
});

// ─── normalizeRole (exercised via getCurrentUser) ─────────────────────────────

describe("normalizeRole — all valid roles return an AppUser", () => {
  const validRoles = [
    "venue_manager",
    "reviewer",
    "central_planner",
    "administrator",
    "office_worker",
    "executive"
  ] as const;

  for (const role of validRoles) {
    it(`returns a user when role is "${role}"`, async () => {
      mockCreateClient.mockResolvedValue(
        makeSupabaseClient(
          { id: "user-2" },
          {
            id: "user-2",
            email: `${role}@example.com`,
            full_name: null,
            role,
            venue_id: null
          }
        )
      );

      const result = await getCurrentUser();

      expect(result).not.toBeNull();
      expect(result?.role).toBe(role);
    });
  }

  it("returns null for an unknown role", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-3" },
        {
          id: "user-3",
          email: "unknown@example.com",
          full_name: null,
          role: "unknown_role",
          venue_id: null
        }
      )
    );

    const result = await getCurrentUser();

    expect(result).toBeNull();
  });
});

// ─── requireAuth ──────────────────────────────────────────────────────────────

describe("requireAuth", () => {
  it("calls redirect('/login') when there is no authenticated user", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient(null, null));

    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("returns the AppUser when authenticated", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const result = await requireAuth();

    expect(result).toEqual(validCentralPlannerUser);
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

// ─── requireAdmin ─────────────────────────────────────────────────────────────

describe("requireAdmin", () => {
  it("calls redirect('/login') when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient(null, null));

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("calls redirect('/unauthorized') when authenticated but role is venue_manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-2" },
        {
          id: "user-2",
          email: "manager@example.com",
          full_name: "Venue Manager",
          role: "venue_manager",
          venue_id: "venue-1"
        }
      )
    );

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/unauthorized");
    expect(mockRedirect).toHaveBeenCalledWith("/unauthorized");
  });

  it("returns the AppUser when role is central_planner", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const result = await requireAdmin();

    expect(result).toEqual(validCentralPlannerUser);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("returns the AppUser when role is administrator", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-admin" },
        {
          id: "user-admin",
          email: "admin@example.com",
          full_name: "Admin User",
          role: "administrator",
          venue_id: null
        }
      )
    );

    const result = await requireAdmin();

    expect(result).toEqual({
      id: "user-admin",
      email: "admin@example.com",
      fullName: "Admin User",
      role: "administrator",
      venueId: null
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

// ─── withAuth ─────────────────────────────────────────────────────────────────

describe("withAuth", () => {
  it("returns 401 JSON when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient(null, null));

    const handler = vi.fn();
    const wrapped = withAuth(handler);
    const req = new Request("http://localhost/test");

    const response = await wrapped(req);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler with the request and user when authenticated", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAuth(handler);
    const req = new Request("http://localhost/test");

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, validCentralPlannerUser);
  });
});

// ─── withAdminAuth ────────────────────────────────────────────────────────────

describe("withAdminAuth", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient(null, null));

    const handler = vi.fn();
    const wrapped = withAdminAuth(handler);
    const req = new Request("http://localhost/test");

    const response = await wrapped(req);

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated but not central_planner", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-2" },
        {
          id: "user-2",
          email: "reviewer@example.com",
          full_name: "A Reviewer",
          role: "reviewer",
          venue_id: null
        }
      )
    );

    const handler = vi.fn();
    const wrapped = withAdminAuth(handler);
    const req = new Request("http://localhost/test");

    const response = await wrapped(req);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: "Forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler when role is central_planner", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAdminAuth(handler);
    const req = new Request("http://localhost/test");

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, validCentralPlannerUser);
  });

  it("calls the handler when role is administrator", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-admin" },
        {
          id: "user-admin",
          email: "admin@example.com",
          full_name: "Admin User",
          role: "administrator",
          venue_id: null
        }
      )
    );

    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAdminAuth(handler);
    const req = new Request("http://localhost/test");

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, {
      id: "user-admin",
      email: "admin@example.com",
      fullName: "Admin User",
      role: "administrator",
      venueId: null
    });
  });
});

// ─── withAuthAndCSRF ──────────────────────────────────────────────────────────

describe("withAuthAndCSRF", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient(null, null));

    const handler = vi.fn();
    const wrapped = withAuthAndCSRF(handler);
    const req = new Request("http://localhost/test");

    const response = await wrapped(req);

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when the CSRF cookie is missing", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const handler = vi.fn();
    const wrapped = withAuthAndCSRF(handler);
    // cookie header omitted entirely
    const req = new Request("http://localhost/test", {
      headers: { "x-csrf-token": "some-token" }
    });

    const response = await wrapped(req);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: "CSRF validation failed" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when the CSRF header does not match the cookie", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const handler = vi.fn();
    const wrapped = withAuthAndCSRF(handler);
    const req = new Request("http://localhost/test", {
      headers: {
        cookie: "csrf-token=correct-token",
        "x-csrf-token": "wrong-token"
      }
    });

    const response = await wrapped(req);

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler when auth and CSRF are both valid", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAuthAndCSRF(handler);
    const req = makeCSRFRequest("abc123");

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, validCentralPlannerUser);
  });
});

// ─── CSRF parsing — tokens containing "=" ────────────────────────────────────

describe("CSRF parsing — tokens with special characters", () => {
  it("should correctly parse CSRF tokens containing '=' characters (e.g. base64)", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const base64Token = "abc123def456==";
    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAuthAndCSRF(handler);
    const req = new Request("http://localhost/test", {
      headers: {
        cookie: `csrf-token=${base64Token}`,
        "x-csrf-token": base64Token
      }
    });

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, validCentralPlannerUser);
  });

  it("should correctly parse CSRF tokens without '=' characters (regression)", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const simpleToken = "abc123def456";
    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAuthAndCSRF(handler);
    const req = makeCSRFRequest(simpleToken);

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, validCentralPlannerUser);
  });
});

// ─── getCurrentUser — no header trust ────────────────────────────────────────

describe("getCurrentUser — no x-user-id header trust", () => {
  it("should return null when no session exists (verifies getUser is called, not header)", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient(null, null));

    const result = await getCurrentUser();

    expect(result).toBeNull();
    // Verify the supabase client was used (getUser called), not a header
    const client = await mockCreateClient.mock.results[0].value;
    expect(client.auth.getUser).toHaveBeenCalled();
  });
});

// ─── withAdminAuthAndCSRF ─────────────────────────────────────────────────────

describe("withAdminAuthAndCSRF", () => {
  it("returns 403 when authenticated but not central_planner", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-2" },
        {
          id: "user-2",
          email: "executive@example.com",
          full_name: "An Executive",
          role: "executive",
          venue_id: null
        }
      )
    );

    const handler = vi.fn();
    const wrapped = withAdminAuthAndCSRF(handler);
    const req = makeCSRFRequest("abc123");

    const response = await wrapped(req);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: "Forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when admin but CSRF token mismatches", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const handler = vi.fn();
    const wrapped = withAdminAuthAndCSRF(handler);
    const req = new Request("http://localhost/test", {
      headers: {
        cookie: "csrf-token=correct-token",
        "x-csrf-token": "tampered-token"
      }
    });

    const response = await wrapped(req);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: "CSRF validation failed" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler when admin role and CSRF are both valid", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validCentralPlannerProfile)
    );

    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAdminAuthAndCSRF(handler);
    const req = makeCSRFRequest("secret-csrf-token");

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, validCentralPlannerUser);
  });

  it("calls the handler when role is administrator and CSRF valid", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-admin" },
        {
          id: "user-admin",
          email: "admin@example.com",
          full_name: "Admin User",
          role: "administrator",
          venue_id: null
        }
      )
    );

    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAdminAuthAndCSRF(handler);
    const req = makeCSRFRequest("valid-csrf-token");

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, {
      id: "user-admin",
      email: "admin@example.com",
      fullName: "Admin User",
      role: "administrator",
      venueId: null
    });
  });
});

// ─── roles.ts — compatibility phase ──────────────────────────────────────────

describe("roles.ts — compatibility phase", () => {
  it("administrator has same capabilities as central_planner", () => {
    expect(canManageEvents("administrator")).toBe(true);
    expect(canReviewEvents("administrator")).toBe(true);
    expect(canSubmitDebriefs("administrator")).toBe(true);
    expect(canManageArtists("administrator")).toBe(true);
    expect(canManageVenues("administrator")).toBe(true);
    expect(canManageUsers("administrator")).toBe(true);
    expect(canManageSettings("administrator")).toBe(true);
    expect(canUsePlanning("administrator")).toBe(true);
    expect(canViewPlanning("administrator")).toBe(true);
    expect(canViewAllEvents("administrator")).toBe(true);
    expect(canManageLinks("administrator")).toBe(true);
    expect(canViewSopTemplate("administrator")).toBe(true);
    expect(canEditSopTemplate("administrator")).toBe(true);
  });

  it("office_worker has same capabilities as venue_manager", () => {
    expect(canManageEvents("office_worker")).toBe(true);
    expect(canSubmitDebriefs("office_worker")).toBe(true);
    expect(canManageArtists("office_worker")).toBe(true);
    // office_worker should NOT have planning access in compatibility phase
    expect(canViewPlanning("office_worker")).toBe(false);
  });

  it("legacy central_planner still works", () => {
    expect(canManageEvents("central_planner")).toBe(true);
    expect(canManageVenues("central_planner")).toBe(true);
    expect(canReviewEvents("central_planner")).toBe(true);
  });

  it("legacy venue_manager still works", () => {
    expect(canManageEvents("venue_manager")).toBe(true);
    expect(canSubmitDebriefs("venue_manager")).toBe(true);
    expect(canManageArtists("venue_manager")).toBe(true);
    expect(canManageVenues("venue_manager")).toBe(false);
  });

  it("legacy reviewer still works", () => {
    expect(canReviewEvents("reviewer")).toBe(true);
    expect(canViewAllEvents("reviewer")).toBe(true);
    expect(canManageEvents("reviewer")).toBe(false);
  });
});
