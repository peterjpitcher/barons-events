import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AUTH_CARD_CLASS, AUTH_CARD_CONTENT_CLASS, AUTH_CARD_HEADER_CLASS } from "@/components/auth/styles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ForgotPasswordForm } from "./forgot-password-form";

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
            <ForgotPasswordForm />
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
