import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { validateSession, SESSION_COOKIE_NAME, makeSessionCookieOptions } from "@/lib/auth/session";

// ─── Configuration ────────────────────────────────────────────────────────────

import { SHORT_LINK_HOST } from "@/lib/short-link-config";

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
  "/deactivated",     // Shown to deactivated users after redirect
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
    if (prefix === "/l") {
      // Match exact "/l" or segment boundary "/l/" to avoid matching "/links", "/logout", etc.
      if (pathname === "/l" || pathname.startsWith("/l/")) return true;
    } else {
      if (pathname.startsWith(prefix)) return true;
    }
  }
  return false;
}

// ─── Security headers ─────────────────────────────────────────────────────────

function applySecurityHeaders(response: NextResponse, nonce: string): void {
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
      // 'nonce-…' allows Next.js hydration inline scripts and any <Script nonce={nonce}> tags.
      // https://challenges.cloudflare.com is required for the Turnstile widget JS.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com`,
      // 'unsafe-inline' on style-src is needed for Turnstile's injected inline styles.
      "style-src 'self' 'unsafe-inline'",
      `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} https://api.pwnedpasswords.com https://challenges.cloudflare.com`,
      `img-src 'self' data: blob: ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}`,
      "font-src 'self' https://fonts.gstatic.com",
      // frame-src is required for the Turnstile challenge iframe.
      "frame-src https://challenges.cloudflare.com",
      "frame-ancestors 'none'",
    ].join("; ")
  );
}

// ─── Nonce / CSRF helpers ──────────────────────────────────────────────────────

const CSRF_COOKIE_NAME = "csrf-token";

/**
 * Generates a random base64-encoded nonce for CSP.
 * 16 bytes = 128 bits of entropy, base64-encoded to ~22 chars.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Domain rewrite for l.baronspubs.com (event landing pages + short links)
  // Must run before the public path check and auth gate.
  const host = req.headers.get("host");
  if (host === SHORT_LINK_HOST) {
    // Root path — redirect to main site
    if (pathname === "/") {
      const redirectNonce = generateNonce();
      const redirectRes = NextResponse.redirect("https://baronspubs.com");
      applySecurityHeaders(redirectRes, redirectNonce);
      return redirectRes;
    }
    // 8-hex-char paths are existing short links — let them fall through to [code] handler
    const isShortLink = /^\/[0-9a-f]{8}$/.test(pathname);
    // Static assets (_next, images, fonts, etc.) must not be rewritten
    const isStaticAsset = pathname.startsWith("/_next") || STATIC_ASSET_PATTERN.test(pathname);
    if (!isShortLink && !isStaticAsset) {
      // Rewrite slug-style paths (e.g. /jazz-night-20-mar-2026) to /l/[path]
      const rewriteNonce = generateNonce();
      const rewriteUrl = req.nextUrl.clone();
      rewriteUrl.pathname = `/l${pathname}`;
      const rewriteHeaders = new Headers(req.headers);
      rewriteHeaders.set("x-nonce", rewriteNonce);
      const rewriteRes = NextResponse.rewrite(rewriteUrl, {
        request: { headers: rewriteHeaders }
      });
      applySecurityHeaders(rewriteRes, rewriteNonce);
      return rewriteRes;
    }
    if (isShortLink) {
      // Short links are public — skip auth gate entirely and let [code]/route.ts handle the redirect.
      const nonce = generateNonce();
      const shortLinkRes = NextResponse.next({
        request: { headers: new Headers(req.headers) }
      });
      applySecurityHeaders(shortLinkRes, nonce);
      return shortLinkRes;
    }
    // Static assets continue through middleware normally
  }

  // Generate a per-request CSP nonce and forward it to the app via a request header.
  // Next.js App Router reads x-nonce and applies it to its own generated inline scripts.
  const nonce = generateNonce();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  // Regression hardening: strip any spoofed x-user-id from incoming requests.
  // getCurrentUser() no longer reads this header, but delete it to prevent future re-introduction.
  requestHeaders.delete("x-user-id");

  // Forward the current pathname so server components (e.g. layout.tsx) can detect auth pages
  // without duplicating the public-path logic.
  requestHeaders.set("x-pathname", pathname);

  const res = NextResponse.next({
    request: { headers: requestHeaders }
  });

  // Step 3: Security headers — applied to every response regardless of auth state
  applySecurityHeaders(res, nonce);

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
    applySecurityHeaders(redirectRes, nonce);
    return redirectRes;
  }

  // Step 5: Custom session validation (app-session-id layer)
  // Fail-closed: any session store error redirects to login.
  const appSessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!appSessionId) {
    // No app-session-id cookie but user has a valid Supabase JWT.
    // The migration window for pre-session-layer logins is over.
    // Sign out the stale Supabase session to prevent redirect loops.
    await supabase.auth.signOut({ scope: "local" });
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("reason", "session_missing");
    const originalPath = `${pathname}${req.nextUrl.search ?? ""}`;
    redirectUrl.searchParams.set("redirectedFrom", originalPath);
    const redirectRes = NextResponse.redirect(redirectUrl);
    // Transfer Supabase cookie clears from res (where signOut wrote them) to redirectRes
    for (const cookie of res.headers.getSetCookie()) {
      redirectRes.headers.append("set-cookie", cookie);
    }
    applySecurityHeaders(redirectRes, nonce);
    return redirectRes;
  }

  const session = await validateSession(appSessionId);

  if (!session) {
    // Session is expired, invalid, or DB unavailable. Fail closed.
    // Sign out the stale Supabase session to prevent redirect loops.
    await supabase.auth.signOut({ scope: "local" });
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("reason", "session_expired");
    const originalPath = `${pathname}${req.nextUrl.search ?? ""}`;
    redirectUrl.searchParams.set("redirectedFrom", originalPath);
    const redirectRes = NextResponse.redirect(redirectUrl);
    redirectRes.cookies.set(SESSION_COOKIE_NAME, "", {
      ...makeSessionCookieOptions(),
      maxAge: 0
    });
    // Transfer Supabase cookie clears from res (where signOut wrote them) to redirectRes
    for (const cookie of res.headers.getSetCookie()) {
      redirectRes.headers.append("set-cookie", cookie);
    }
    applySecurityHeaders(redirectRes, nonce);
    return redirectRes;
  }

  // Verify the app session belongs to the same user as the Supabase JWT.
  // Prevents session fixation where a stolen session cookie is used by a different account.
  if (session.userId !== user.id) {
    // Session belongs to a different user — sign out to prevent redirect loops.
    await supabase.auth.signOut({ scope: "local" });
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("reason", "session_mismatch");
    const originalPath = `${pathname}${req.nextUrl.search ?? ""}`;
    redirectUrl.searchParams.set("redirectedFrom", originalPath);
    const redirectRes = NextResponse.redirect(redirectUrl);
    redirectRes.cookies.set(SESSION_COOKIE_NAME, "", {
      ...makeSessionCookieOptions(),
      maxAge: 0
    });
    // Transfer Supabase cookie clears from res (where signOut wrote them) to redirectRes
    for (const cookie of res.headers.getSetCookie()) {
      redirectRes.headers.append("set-cookie", cookie);
    }
    applySecurityHeaders(redirectRes, nonce);
    return redirectRes;
  }

  // Step 6: Deactivation check — block deactivated users from accessing protected routes
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseServiceKey) {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: userStatus } = await supabaseAdmin
      .from("users")
      .select("deactivated_at")
      .eq("id", user.id)
      .single();

    if (userStatus?.deactivated_at) {
      // Destroy the session cookie and redirect to deactivated page
      await supabase.auth.signOut({ scope: "local" });
      const deactivatedUrl = req.nextUrl.clone();
      deactivatedUrl.pathname = "/deactivated";
      deactivatedUrl.search = "";
      const deactivatedRes = NextResponse.redirect(deactivatedUrl);
      deactivatedRes.cookies.set(SESSION_COOKIE_NAME, "", {
        ...makeSessionCookieOptions(),
        maxAge: 0
      });
      for (const cookie of res.headers.getSetCookie()) {
        deactivatedRes.headers.append("set-cookie", cookie);
      }
      applySecurityHeaders(deactivatedRes, nonce);
      return deactivatedRes;
    }
  }

  // Step 7: CSRF token — generate if absent
  const existingCsrf = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (!existingCsrf) {
    res.cookies.set(CSRF_COOKIE_NAME, generateCsrfToken(), {
      httpOnly: false, // Must be JS-readable for client to send in header
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    });
  }

  // NOTE: /api/* routes are excluded from middleware by the matcher config below.
  // API routes handle their own auth via withAuth()/withAdminAuth() wrappers.

  return res;
}

export const config = {
  // NOTE: /api/* routes excluded — they use bearer-token auth via requireWebsiteApiKey().
  // Any new /api/* route requiring session auth must implement its own auth check.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]
};
