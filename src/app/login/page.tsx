import { redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AUTH_CARD_CLASS, AUTH_CARD_CONTENT_CLASS, AUTH_CARD_HEADER_CLASS } from "@/components/auth/styles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in · Barons Events",
  description: "Enter your Barons workspace details to continue."
};

type SearchParams = Record<string, string | undefined>;

type LoginPageProps = {
  searchParams?: Promise<SearchParams>;
};

function sanitizeRedirect(path?: string | null) {
  if (!path) return "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  return path;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query =
    (await searchParams?.catch(() => ({} as SearchParams))) ??
    ({} as SearchParams);
  const redirectTarget = sanitizeRedirect(query.redirectedFrom);
  const reason = query.reason;

  // Use getCurrentUser() (which calls getUser()) rather than getSession().
  // getSession() trusts the local cookie and can return a stale session even
  // when the refresh token is no longer valid — causing a redirect loop with
  // the middleware, which also uses getUser() and rejects the same stale token.
  const headersList = await headers();
  const nonce = headersList.get("x-nonce") ?? undefined;

  const user = await getCurrentUser();
  if (user) {
    redirect(redirectTarget);
  }

  return (
    <AuthLayout
      intro={
        <p>
          Sign in to keep your venue plans aligned with the Central Planning Team.
        </p>
      }
    >
      <Card className={AUTH_CARD_CLASS}>
        <CardHeader className={AUTH_CARD_HEADER_CLASS}>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription className="text-[var(--color-text-muted)]">
            Use your Barons email and password. If you&apos;re not sure, speak with the central planning team.
          </CardDescription>
        </CardHeader>
        <CardContent className={AUTH_CARD_CONTENT_CLASS}>
          {reason === "session_expired" || reason === "session_missing" || reason === "session_mismatch" ? (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Your session has expired. Please sign in again.
            </p>
          ) : null}
          <LoginForm redirectTo={redirectTarget} nonce={nonce} />
          <div className="space-y-3 text-sm text-muted">
            <Link href="/forgot-password" className="font-medium text-[var(--color-primary-700)] underline">
              Reset your password
            </Link>
            <p>
              Need support?{" "}
              <Link href="mailto:peter@orangejelly.co.uk" className="underline">
                Contact peter@orangejelly.co.uk
              </Link>
              .
            </p>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
