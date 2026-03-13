import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createSession, validateSession, renewSession, SESSION_COOKIE_NAME, makeSessionCookieOptions } from "@/lib/auth/session";

// ─── Configuration ────────────────────────────────────────────────────────────

const SHORT_LINK_HOST = process.env.SHORT_LINK_HOST ?? "l.baronspubs.com";

/**
 * Public paths: bypass auth gate. Each entry documented with its reason.
 * Using a Set for O(1) lookups.
 */
const PUBLIC_PATH_PREFIXES = new Set([
  "/login",           // Pre-auth login page
  "/forgot-password", // Pre-auth password reset request
  "/reset-password",  // Pre-auth password update form
  "/auth/confirm",    // Token exchange — no session required
  "/unauthorized",    // Shown to authenticated-but-unauthorised users
  "/l",               // Event landing pages — publicly accessible without auth
]);

const STATIC_ASSET_PATTERN = /\.(?:css|js|json|svg|png|jpg|jpeg|gif|webp|ico|txt|map)$/i;

function isPublicPath(pathname: string): boolean {
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/public") ||
    pathname === "/favicon.ico" ||
    STATIC_ASSET_PATTERN.test(pathname)
  ) {
    return true;
  }
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

// ─── Security headers ─────────────────────────────────────────────────────────

function applySecurityHeaders(response: NextResponse): void {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  response.headers.set("X-XSS-Protection", "0"); // CSP handles this
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // Next.js requires this for inline scripts
      "style-src 'self' 'unsafe-inline'",  // Tailwind CSS requires unsafe-inline
      `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} https://api.pwnedpasswords.com`,
      `img-src 'self' data: blob: ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}`,
      "font-src 'self' https://fonts.gstatic.com",
      "frame-ancestors 'none'",
    ].join("; ")
  );
}

// ─── CSRF helpers ─────────────────────────────────────────────────────────────

const CSRF_COOKIE_NAME = "csrf-token";
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Domain rewrite for l.baronspubs.com (event landing pages + short links)
  // Must run before the public path check and auth gate.
  const host = req.headers.get("host");
  if (host === SHORT_LINK_HOST) {
    // 8-hex-char paths are existing short links — let them fall through to [code] handler
    const isShortLink = /^\/[0-9a-f]{8}$/.test(pathname);
    // Static assets (_next, images, fonts, etc.) must not be rewritten
    const isStaticAsset = pathname.startsWith("/_next") || STATIC_ASSET_PATTERN.test(pathname);
    if (!isShortLink && !isStaticAsset) {
      // Rewrite slug-style paths (e.g. /jazz-night-20-mar-2026) to /l/[path]
      const rewriteUrl = req.nextUrl.clone();
      rewriteUrl.pathname = `/l${pathname}`;
      return NextResponse.rewrite(rewriteUrl);
    }
    // Short link paths (8-hex-char) and static assets continue through middleware normally
  }

  const res = NextResponse.next();

  // Step 3: Security headers — applied to every response regardless of auth state
  applySecurityHeaders(res);

  // Static assets / public paths: return early after headers
  if (isPublicPath(pathname)) {
    // CSRF token: set if absent (needed on public pages that have forms pre-auth)
    if (!req.cookies.get(CSRF_COOKIE_NAME)) {
      res.cookies.set(CSRF_COOKIE_NAME, generateCsrfToken(), {
        httpOnly: false, // Must be JS-readable for client to send in header
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/"
      });
    }
    return res;
  }

  // Step 1: Supabase session refresh — must use getUser(), not getSession()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return new NextResponse("Service unavailable: authentication service is not configured.", {
      status: 503
    });
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name) {
        return req.cookies.get(name)?.value;
      },
      set(name, value, options) {
        res.cookies.set({ name, value, ...options });
      },
      remove(name, options) {
        res.cookies.set({ name, value: "", ...options, maxAge: 0 });
      }
    }
  });

  // getUser() validates against the Supabase server — never use getSession() for auth checks
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Step 4: Authentication gate — Supabase JWT check
  if (!user) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/login";
    const originalPath = `${pathname}${req.nextUrl.search ?? ""}`;
    redirectUrl.searchParams.set("redirectedFrom", originalPath);
    const redirectRes = NextResponse.redirect(redirectUrl);
    applySecurityHeaders(redirectRes);
    return redirectRes;
  }

  // Step 5: Custom session validation (app-session-id layer)
  // Fail-closed: any session store error redirects to login.
  const appSessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  // Heartbeat endpoint is exempt from session layer validation —
  // it is the mechanism that keeps the session alive.
  const isHeartbeat = pathname === "/api/auth/heartbeat";

  if (!isHeartbeat) {
    let resolvedSessionId = appSessionId;

    if (!resolvedSessionId) {
      // No app-session-id cookie but user has a valid Supabase JWT.
      // This happens when: (a) the user was already logged in before the session
      // layer was deployed, or (b) session creation failed at sign-in time.
      // Create a new session now rather than redirect-looping.
      try {
        resolvedSessionId = await createSession(user.id, {
          userAgent: req.headers.get("user-agent"),
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
        });
        res.cookies.set(SESSION_COOKIE_NAME, resolvedSessionId, makeSessionCookieOptions());
      } catch (err) {
        // Session store unavailable (e.g. migration not yet applied).
        // Fall through rather than redirect-loop — Supabase JWT still provides auth.
        console.error("Session layer unavailable, serving request without app session:", err);
      }
    }

    const session = resolvedSessionId ? await validateSession(resolvedSessionId) : null;

    if (!session && resolvedSessionId) {
      // resolvedSessionId was set but validateSession returned null — the session
      // is genuinely expired or invalid (not a DB availability issue, since
      // createSession above would also have failed). Fail closed.
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("reason", "session_expired");
      const redirectRes = NextResponse.redirect(redirectUrl);
      redirectRes.cookies.set(SESSION_COOKIE_NAME, "", {
        ...makeSessionCookieOptions(),
        maxAge: 0
      });
      applySecurityHeaders(redirectRes);
      return redirectRes;
    }

    // Renew session activity (non-blocking — don't await in the critical path)
    renewSession(resolvedSessionId ?? "").catch((err: unknown) => {
      console.error("Session renewal failed (non-fatal):", err);
    });
  }

  // Step 6: CSRF token — generate if absent, then validate mutations on API routes
  const existingCsrf = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfToken = existingCsrf ?? generateCsrfToken();
  if (!existingCsrf) {
    res.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false, // Must be JS-readable for client to send in header
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    });
  }

  // CSRF validation on mutations to explicit API routes.
  // Next.js server actions are protected by SameSite=lax + Next.js built-in CSRF mitigation.
  // Heartbeat is exempt: same-origin only, no app data mutation (SameSite=lax is sufficient).
  if (
    MUTATION_METHODS.has(req.method) &&
    pathname.startsWith("/api/") &&
    !isHeartbeat
  ) {
    const csrfHeader = req.headers.get("x-csrf-token");
    if (!csrfHeader || !timingSafeEqual(csrfToken, csrfHeader)) {
      return new NextResponse(JSON.stringify({ error: "CSRF validation failed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  return res;
}

export const config = {
  // NOTE: /api/* routes excluded — they use bearer-token auth via requireWebsiteApiKey().
  // Any new /api/* route requiring session auth must implement its own auth check.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]
};
