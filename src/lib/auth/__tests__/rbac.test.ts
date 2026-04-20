/**
 * Tests for src/lib/auth.ts — RBAC helpers and API route wrappers.
 * Tests for src/lib/roles.ts — capability functions.
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
  isAdministrator,
  canManageEvents,
  canProposeEvents,
  canViewEvents,
  canReviewEvents,
  canManageBookings,
  canManageCustomers,
  canManageArtists,
  canCreateDebriefs,
  canEditDebrief,
  canViewDebriefs,
  canCreatePlanningItems,
  canManageOwnPlanningItems,
  canManageAllPlanning,
  canViewPlanning,
  canManageVenues,
  canManageUsers,
  canManageSettings,
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
    deactivated_at: string | null;
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

/** Convenience: a fully valid administrator profile row. */
const validAdminProfile = {
  id: "user-1",
  email: "admin@example.com",
  full_name: "Test Admin",
  role: "administrator",
  venue_id: null,
  deactivated_at: null
};

/** Convenience: the expected AppUser produced from validAdminProfile. */
const validAdminUser: AppUser = {
  id: "user-1",
  email: "admin@example.com",
  fullName: "Test Admin",
  role: "administrator",
  venueId: null,
  deactivatedAt: null
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
          venue_id: null,
          deactivated_at: null
        }
      )
    );

    const result = await getCurrentUser();

    expect(result).toBeNull();
  });

  it("returns a correctly shaped AppUser when role is valid", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
    );

    const result = await getCurrentUser();

    expect(result).toEqual(validAdminUser);
  });
});

// ─── normalizeRole (exercised via getCurrentUser) ─────────────────────────────

describe("normalizeRole — final 3-role model", () => {
  const validRoles = [
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
            venue_id: null,
            deactivated_at: null
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
          venue_id: null,
          deactivated_at: null
        }
      )
    );

    const result = await getCurrentUser();

    expect(result).toBeNull();
  });

  it("rejects legacy 'central_planner' role", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-4" },
        {
          id: "user-4",
          email: "cp@example.com",
          full_name: null,
          role: "central_planner",
          venue_id: null,
          deactivated_at: null
        }
      )
    );

    const result = await getCurrentUser();

    expect(result).toBeNull();
  });

  it("rejects legacy 'venue_manager' role", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-5" },
        {
          id: "user-5",
          email: "vm@example.com",
          full_name: null,
          role: "venue_manager",
          venue_id: "v1",
          deactivated_at: null
        }
      )
    );

    const result = await getCurrentUser();

    expect(result).toBeNull();
  });

  it("rejects legacy 'reviewer' role", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-6" },
        {
          id: "user-6",
          email: "rev@example.com",
          full_name: null,
          role: "reviewer",
          venue_id: null,
          deactivated_at: null
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
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
    );

    const result = await requireAuth();

    expect(result).toEqual(validAdminUser);
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

  it("calls redirect('/unauthorized') when authenticated but role is office_worker", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-2" },
        {
          id: "user-2",
          email: "worker@example.com",
          full_name: "Office Worker",
          role: "office_worker",
          venue_id: "venue-1",
          deactivated_at: null
        }
      )
    );

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/unauthorized");
    expect(mockRedirect).toHaveBeenCalledWith("/unauthorized");
  });

  it("calls redirect('/unauthorized') when role is executive", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-3" },
        {
          id: "user-3",
          email: "exec@example.com",
          full_name: "Executive",
          role: "executive",
          venue_id: null,
          deactivated_at: null
        }
      )
    );

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/unauthorized");
    expect(mockRedirect).toHaveBeenCalledWith("/unauthorized");
  });

  it("returns the AppUser when role is administrator", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
    );

    const result = await requireAdmin();

    expect(result).toEqual(validAdminUser);
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
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
    );

    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAuth(handler);
    const req = new Request("http://localhost/test");

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, validAdminUser);
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

  it("returns 403 when authenticated but not administrator", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-2" },
        {
          id: "user-2",
          email: "worker@example.com",
          full_name: "A Worker",
          role: "office_worker",
          venue_id: null,
          deactivated_at: null
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

  it("calls the handler when role is administrator", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
    );

    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAdminAuth(handler);
    const req = new Request("http://localhost/test");

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, validAdminUser);
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
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
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
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
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
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
    );

    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAuthAndCSRF(handler);
    const req = makeCSRFRequest("abc123");

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, validAdminUser);
  });
});

// ─── CSRF parsing — tokens containing "=" ────────────────────────────────────

describe("CSRF parsing — tokens with special characters", () => {
  it("should correctly parse CSRF tokens containing '=' characters (e.g. base64)", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
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
    expect(handler).toHaveBeenCalledWith(req, validAdminUser);
  });

  it("should correctly parse CSRF tokens without '=' characters (regression)", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
    );

    const simpleToken = "abc123def456";
    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAuthAndCSRF(handler);
    const req = makeCSRFRequest(simpleToken);

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, validAdminUser);
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
  it("returns 403 when authenticated but not administrator", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient(
        { id: "user-2" },
        {
          id: "user-2",
          email: "executive@example.com",
          full_name: "An Executive",
          role: "executive",
          venue_id: null,
          deactivated_at: null
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
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
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
      makeSupabaseClient({ id: "user-1" }, validAdminProfile)
    );

    const handlerResponse = new Response("ok", { status: 200 });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withAdminAuthAndCSRF(handler);
    const req = makeCSRFRequest("secret-csrf-token");

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req, validAdminUser);
  });
});

// ─── roles.ts — final capability functions ───────────────────────────────────

describe("roles.ts — final capability functions", () => {
  describe("isAdministrator", () => {
    it("returns true for administrator", () => expect(isAdministrator("administrator")).toBe(true));
    it("returns false for office_worker", () => expect(isAdministrator("office_worker")).toBe(false));
    it("returns false for executive", () => expect(isAdministrator("executive")).toBe(false));
  });

  describe("canManageEvents (venue_id-dependent)", () => {
    it("administrator can manage events without venueId", () => expect(canManageEvents("administrator")).toBe(true));
    it("administrator can manage events with venueId", () => expect(canManageEvents("administrator", "v1")).toBe(true));
    it("office_worker WITH venueId can manage events", () => expect(canManageEvents("office_worker", "v1")).toBe(true));
    it("office_worker WITHOUT venueId cannot manage events", () => expect(canManageEvents("office_worker")).toBe(false));
    it("office_worker with null venueId cannot manage events", () => expect(canManageEvents("office_worker", null)).toBe(false));
    it("executive cannot manage events", () => expect(canManageEvents("executive")).toBe(false));
  });

  describe("canProposeEvents", () => {
    it("administrator can propose", () => expect(canProposeEvents("administrator")).toBe(true));
    it("office_worker can propose (no venueId required)", () => expect(canProposeEvents("office_worker")).toBe(true));
    it("executive cannot propose", () => expect(canProposeEvents("executive")).toBe(false));
  });

  describe("canViewEvents", () => {
    it("all roles can view events", () => {
      expect(canViewEvents("administrator")).toBe(true);
      expect(canViewEvents("office_worker")).toBe(true);
      expect(canViewEvents("executive")).toBe(true);
    });
  });

  describe("canReviewEvents", () => {
    it("administrator can review", () => expect(canReviewEvents("administrator")).toBe(true));
    it("office_worker cannot review", () => expect(canReviewEvents("office_worker")).toBe(false));
    it("executive cannot review", () => expect(canReviewEvents("executive")).toBe(false));
  });

  describe("canManageBookings (venue_id-dependent)", () => {
    it("administrator can manage bookings", () => expect(canManageBookings("administrator")).toBe(true));
    it("office_worker WITH venueId can manage bookings", () => expect(canManageBookings("office_worker", "v1")).toBe(true));
    it("office_worker WITHOUT venueId cannot manage bookings", () => expect(canManageBookings("office_worker")).toBe(false));
    it("executive cannot manage bookings", () => expect(canManageBookings("executive")).toBe(false));
  });

  describe("canManageCustomers (venue_id-dependent)", () => {
    it("administrator can manage customers", () => expect(canManageCustomers("administrator")).toBe(true));
    it("office_worker WITH venueId can manage customers", () => expect(canManageCustomers("office_worker", "v1")).toBe(true));
    it("office_worker WITHOUT venueId cannot manage customers", () => expect(canManageCustomers("office_worker")).toBe(false));
    it("executive cannot manage customers", () => expect(canManageCustomers("executive")).toBe(false));
  });

  describe("canManageArtists (venue_id-dependent)", () => {
    it("administrator can manage artists", () => expect(canManageArtists("administrator")).toBe(true));
    it("office_worker WITH venueId can manage artists", () => expect(canManageArtists("office_worker", "v1")).toBe(true));
    it("office_worker WITHOUT venueId cannot manage artists", () => expect(canManageArtists("office_worker")).toBe(false));
    it("executive cannot manage artists", () => expect(canManageArtists("executive")).toBe(false));
  });

  describe("canCreateDebriefs (venue_id-dependent)", () => {
    it("administrator can create debriefs", () => expect(canCreateDebriefs("administrator")).toBe(true));
    it("office_worker WITH venueId can create debriefs", () => expect(canCreateDebriefs("office_worker", "v1")).toBe(true));
    it("office_worker WITHOUT venueId cannot create debriefs", () => expect(canCreateDebriefs("office_worker")).toBe(false));
    it("office_worker with null venueId cannot create debriefs", () => expect(canCreateDebriefs("office_worker", null)).toBe(false));
    it("executive cannot create debriefs", () => expect(canCreateDebriefs("executive")).toBe(false));
  });

  describe("canEditDebrief (creator-dependent)", () => {
    it("administrator can edit any debrief", () => expect(canEditDebrief("administrator", false)).toBe(true));
    it("administrator can edit own debrief", () => expect(canEditDebrief("administrator", true)).toBe(true));
    it("office_worker can edit own debrief", () => expect(canEditDebrief("office_worker", true)).toBe(true));
    it("office_worker cannot edit others debrief", () => expect(canEditDebrief("office_worker", false)).toBe(false));
    it("executive cannot edit any debrief", () => expect(canEditDebrief("executive", true)).toBe(false));
    it("executive cannot edit even as creator", () => expect(canEditDebrief("executive", false)).toBe(false));
  });

  describe("canViewDebriefs", () => {
    it("all roles can view debriefs", () => {
      expect(canViewDebriefs("administrator")).toBe(true);
      expect(canViewDebriefs("office_worker")).toBe(true);
      expect(canViewDebriefs("executive")).toBe(true);
    });
  });

  describe("canCreatePlanningItems", () => {
    it("administrator can create", () => expect(canCreatePlanningItems("administrator")).toBe(true));
    it("office_worker can create", () => expect(canCreatePlanningItems("office_worker")).toBe(true));
    it("executive cannot create", () => expect(canCreatePlanningItems("executive")).toBe(false));
  });

  describe("canManageOwnPlanningItems", () => {
    it("administrator can manage own", () => expect(canManageOwnPlanningItems("administrator")).toBe(true));
    it("office_worker can manage own", () => expect(canManageOwnPlanningItems("office_worker")).toBe(true));
    it("executive cannot manage", () => expect(canManageOwnPlanningItems("executive")).toBe(false));
  });

  describe("canManageAllPlanning", () => {
    it("administrator can manage all", () => expect(canManageAllPlanning("administrator")).toBe(true));
    it("office_worker cannot manage all", () => expect(canManageAllPlanning("office_worker")).toBe(false));
    it("executive cannot manage all", () => expect(canManageAllPlanning("executive")).toBe(false));
  });

  describe("canViewPlanning", () => {
    it("all roles can view planning", () => {
      expect(canViewPlanning("administrator")).toBe(true);
      expect(canViewPlanning("office_worker")).toBe(true);
      expect(canViewPlanning("executive")).toBe(true);
    });
  });

  describe("admin-only capabilities", () => {
    const adminOnly = [canManageVenues, canManageUsers, canManageSettings, canManageLinks, canEditSopTemplate];
    for (const fn of adminOnly) {
      it(`${fn.name} returns true for administrator`, () => expect(fn("administrator")).toBe(true));
      it(`${fn.name} returns false for office_worker`, () => expect(fn("office_worker")).toBe(false));
      it(`${fn.name} returns false for executive`, () => expect(fn("executive")).toBe(false));
    }
  });

  describe("canViewSopTemplate", () => {
    it("administrator can view", () => expect(canViewSopTemplate("administrator")).toBe(true));
    it("executive can view", () => expect(canViewSopTemplate("executive")).toBe(true));
    it("office_worker cannot view", () => expect(canViewSopTemplate("office_worker")).toBe(false));
  });
});
