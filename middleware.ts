import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const authRoutes = ["/login", "/forgot-password", "/reset-password"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const res = NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Authentication service is not configured — deny all traffic rather than pass it through unprotected.
    return new NextResponse("Service unavailable: authentication service is not configured.", { status: 503 });
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

  const {
    data: { session }
  } = await supabase.auth.getSession();

  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));
  const staticAssetPattern = /\.(?:css|js|json|svg|png|jpg|jpeg|gif|webp|ico|txt|map)$/i;
  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/public") ||
    pathname === "/favicon.ico" ||
    staticAssetPattern.test(pathname);

  if (isPublicAsset) {
    return res;
  }

  if (!session && !isAuthRoute) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/login";
    const originalPath = `${pathname}${req.nextUrl.search ?? ""}`;
    redirectUrl.searchParams.set("redirectedFrom", originalPath);
    return NextResponse.redirect(redirectUrl);
  }

  if (session && isAuthRoute) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/";
    return NextResponse.redirect(redirectUrl);
  }

  return res;
}

export const config = {
  // NOTE: /api/* routes are intentionally excluded from this session-based middleware.
  // They use their own bearer-token authentication via requireWebsiteApiKey().
  // Any new /api/* route that requires session auth must implement its own auth check.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]
};
