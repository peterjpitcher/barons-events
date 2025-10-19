import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AUTH_CARD_CLASS, AUTH_CARD_CONTENT_CLASS, AUTH_CARD_HEADER_CLASS } from "@/components/auth/styles";
import { requestPasswordResetAction } from "@/actions/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Forgot password · Barons Events",
  description: "Request a password reset link for your Barons Events account."
};

type SearchParams = Record<string, string | undefined>;

type ForgotPasswordPageProps = {
  searchParams?: Promise<SearchParams>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const query =
    (await searchParams?.catch(() => ({} as SearchParams))) ??
    ({} as SearchParams);

  const status = query.status;
  const email = query.email;

  const isSuccess = status === "sent";
  const isInvalid = status === "invalid";

  return (
    <AuthLayout
      intro={
        isSuccess ? (
          <p>
            We&apos;ve emailed reset instructions to {email ?? "your inbox"}. Follow the link to set a new
            password and get back into EventHub.
          </p>
        ) : (
          <p>
            Enter your Barons email and we&apos;ll send a reset link. You can reset your password and be back
            planning events in minutes.
          </p>
        )
      }
    >
      <Card className={AUTH_CARD_CLASS}>
        <CardHeader className={AUTH_CARD_HEADER_CLASS}>
          <CardTitle className="text-2xl">
            {isSuccess ? "Check your email" : "Forgot password?"}
          </CardTitle>
          <CardDescription className="text-[var(--color-text-muted)]">
            {isSuccess
              ? "If an account exists for that email, you’ll find a secure reset link waiting for you."
              : "We’ll email you a secure link to choose a new password."}
          </CardDescription>
        </CardHeader>
        <CardContent className={AUTH_CARD_CONTENT_CLASS}>
          {isSuccess ? (
            <div className="space-y-6 text-sm text-muted">
              <p>
                Didn&apos;t receive anything? Check your spam folder, or wait a couple of minutes before trying
                again.
              </p>
              <Button asChild>
                <Link href="/login">Back to login</Link>
              </Button>
            </div>
          ) : (
            <form action={requestPasswordResetAction} className="space-y-6">
              <div className="space-y-2">
                <Label className="text-[var(--color-text-subtle)]" htmlFor="email">
                  Email
                </Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              {isInvalid ? (
                <p className="text-sm text-[var(--color-danger)]">
                  Please enter a valid Barons email address.
                </p>
              ) : null}
              <SubmitButton label="Send reset link" pendingLabel="Sending link..." />
              <p className="text-sm text-muted">
                Remembered it?{" "}
                <Link href="/login" className="underline">
                  Head back to sign in
                </Link>
                .
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
