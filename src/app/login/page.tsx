import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AUTH_CARD_CLASS, AUTH_CARD_CONTENT_CLASS, AUTH_CARD_HEADER_CLASS } from "@/components/auth/styles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction } from "@/actions/auth";
import { getSession } from "@/lib/auth";
import { SubmitButton } from "@/components/ui/submit-button";

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
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  return path;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getSession();
  const query =
    (await searchParams?.catch(() => ({} as SearchParams))) ??
    ({} as SearchParams);
  const redirectTarget = sanitizeRedirect(query.redirectedFrom);
  const errorMessage = query.error === "auth"
    ? "Those details didn't match."
    : query.error === "invalid"
      ? "Please check your email and password."
      : null;

  if (session) {
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
          <form action={signInAction} className="space-y-6">
            <input type="hidden" name="redirectTo" value={redirectTarget} />
            <div className="space-y-2">
              <Label className="text-[var(--color-text-subtle)]" htmlFor="email">
                Email
              </Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label className="text-[var(--color-text-subtle)]" htmlFor="password">
                Password
              </Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {errorMessage ? <p className="text-sm text-[var(--color-danger)]">{errorMessage}</p> : null}
            <SubmitButton label="Sign in" />
          </form>
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
