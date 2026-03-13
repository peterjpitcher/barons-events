import { redirect } from "next/navigation";
import { createSupabaseReadonlyClient } from "./supabase/server";
import type { AppUser, UserRole } from "./types";

/**
 * Constant-time string comparison to prevent timing attacks on CSRF token validation.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function normalizeRole(role: string | null | undefined): UserRole | null {
  switch (role) {
    case "venue_manager":
    case "reviewer":
    case "central_planner":
    case "executive":
      return role;
    default:
      return null;
  }
}

/**
 * Returns the current session from the local cookie/cache.
 *
 * WARNING: `getSession()` reads from the local cache and can return stale or revoked sessions.
 * It must NOT be used for authorization decisions. Use `getCurrentUser()` instead, which calls
 * `getUser()` and validates the session with the Supabase server on every request.
 *
 * Safe uses: checking whether any session cookie exists (e.g. to skip the login page).
 */
export async function getSession() {
  const supabase = await createSupabaseReadonlyClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  return session ?? null;
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createSupabaseReadonlyClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id,email,full_name,role,venue_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return null;
  }

  const role = normalizeRole(profile.role);
  if (!role) {
    return null;
  }

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role,
    venueId: profile.venue_id
  };
}

/**
 * Server Component helper: returns the current user or redirects to /login.
 * Use in layouts and pages that require authentication.
 */
export async function requireAuth(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/**
 * Server Component helper: returns the current user only if they are a central_planner.
 * Redirects to /login if unauthenticated, /unauthorized if insufficient role.
 */
export async function requireAdmin(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "central_planner") {
    redirect("/unauthorized");
  }
  return user;
}

/**
 * API Route Handler wrapper: returns 401 if not authenticated.
 * Usage: export const GET = withAuth(async (req, user) => { ... });
 */
export function withAuth(
  handler: (req: Request, user: AppUser) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    return handler(req, user);
  };
}

/**
 * API Route Handler wrapper: returns 403 if not central_planner.
 */
export function withAdminAuth(
  handler: (req: Request, user: AppUser) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (user.role !== "central_planner") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }
    return handler(req, user);
  };
}

/**
 * API Route Handler wrapper: auth + CSRF validation for mutation routes.
 */
export function withAuthAndCSRF(
  handler: (req: Request, user: AppUser) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const csrfCookie = req.headers.get("cookie")
      ?.split(";")
      .find((c) => c.trim().startsWith("csrf-token="))
      ?.split("=")[1]
      ?.trim();
    const csrfHeader = req.headers.get("x-csrf-token");

    if (!csrfCookie || !csrfHeader || !timingSafeEqual(csrfCookie, csrfHeader)) {
      return new Response(JSON.stringify({ error: "CSRF validation failed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    return handler(req, user);
  };
}

/**
 * API Route Handler wrapper: admin auth + CSRF validation.
 */
export function withAdminAuthAndCSRF(
  handler: (req: Request, user: AppUser) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (user.role !== "central_planner") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    const csrfCookie = req.headers.get("cookie")
      ?.split(";")
      .find((c) => c.trim().startsWith("csrf-token="))
      ?.split("=")[1]
      ?.trim();
    const csrfHeader = req.headers.get("x-csrf-token");

    if (!csrfCookie || !csrfHeader || !timingSafeEqual(csrfCookie, csrfHeader)) {
      return new Response(JSON.stringify({ error: "CSRF validation failed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    return handler(req, user);
  };
}
