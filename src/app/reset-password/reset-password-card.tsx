"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, CheckCircle } from "lucide-react";
import { useFormState } from "react-dom";
import { AUTH_CARD_CLASS, AUTH_CARD_CONTENT_CLASS, AUTH_CARD_HEADER_CLASS } from "@/components/auth/styles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { completePasswordResetAction, type ResetPasswordState } from "@/actions/auth";

type ResetPasswordCardProps = {
  initialQuery: Record<string, string | undefined>;
};

const INITIAL_STATE: ResetPasswordState = { status: "idle" };

export function ResetPasswordCard({ initialQuery }: ResetPasswordCardProps) {
  const [state, formAction] = useFormState(completePasswordResetAction, INITIAL_STATE);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [token, setToken] = useState(initialQuery.token ?? initialQuery.code ?? "");
  const [accessToken, setAccessToken] = useState(initialQuery.access_token ?? "");
  const [refreshToken, setRefreshToken] = useState(initialQuery.refresh_token ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const hasResetToken = useMemo(
    () => Boolean(token) || (Boolean(accessToken) && Boolean(refreshToken)),
    [token, accessToken, refreshToken]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash;
    if (!hash) return;

    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const access = params.get("access_token");
    const refresh = params.get("refresh_token");
    const code = params.get("code") ?? params.get("token") ?? params.get("recovery_token");

    if (access) {
      setAccessToken(access);
    }
    if (refresh) {
      setRefreshToken(refresh);
    }
    if (!token && code) {
      setToken(code);
    }
  }, [token]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    setLocalError(null);

    if (!hasResetToken) {
      event.preventDefault();
      setLocalError("We couldn’t detect a valid reset token. Open the latest reset link from your email and try again.");
      return;
    }

    if (password.length < 8) {
      event.preventDefault();
      setLocalError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      event.preventDefault();
      setLocalError("Passwords must match.");
    }
  };

  if (state.status === "success") {
    return (
      <Card className={AUTH_CARD_CLASS}>
        <CardHeader className={AUTH_CARD_HEADER_CLASS}>
          <div className="flex items-center gap-3 text-[var(--color-success)]">
            <CheckCircle className="h-6 w-6" />
            <CardTitle className="text-2xl text-[var(--color-success)]">Password updated</CardTitle>
          </div>
          <CardDescription className="text-[var(--color-text-muted)]">
            You&apos;re all set. Sign in with your new password to jump back into EventHub.
          </CardDescription>
        </CardHeader>
        <CardContent className={AUTH_CARD_CONTENT_CLASS}>
          <Button asChild>
            <Link href="/login">Go to login</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const errorMessage = localError ?? state.message;

  return (
    <Card className={AUTH_CARD_CLASS}>
      <CardHeader className={AUTH_CARD_HEADER_CLASS}>
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription className="text-[var(--color-text-muted)]">
          Choose a new password for your EventHub account.
        </CardDescription>
      </CardHeader>
      <CardContent className={AUTH_CARD_CONTENT_CLASS}>
        {errorMessage ? (
          <p className="rounded-[var(--radius)] border border-[rgba(139,34,44,0.25)] bg-[rgba(139,34,44,0.08)] p-3 text-sm text-[var(--color-danger)]">
            {errorMessage}
          </p>
        ) : null}
        {!hasResetToken ? (
          <p className="rounded-[var(--radius)] border border-white/20 bg-white/30 p-3 text-sm text-[var(--color-primary-700)]">
            We&apos;re waiting for the secure token that comes with your reset link. If you reached this page
            manually, open the password reset email again and use the latest link.
          </p>
        ) : null}
        <form action={formAction} onSubmit={handleSubmit} className="space-y-6">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="accessToken" value={accessToken} />
          <input type="hidden" name="refreshToken" value={refreshToken} />

          <div className="space-y-2">
            <Label className="text-[var(--color-text-subtle)]" htmlFor="password">
              New password
            </Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-3 flex items-center text-[var(--color-text-subtle)]"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted">Must be at least 8 characters long.</p>
          </div>

          <div className="space-y-2">
            <Label className="text-[var(--color-text-subtle)]" htmlFor="confirmPassword">
              Confirm password
            </Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-3 flex items-center text-[var(--color-text-subtle)]"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <SubmitButton
            label="Update password"
            pendingLabel="Updating..."
            disabled={!hasResetToken}
            className="w-full"
          />

          <p className="text-sm text-muted">
            Need a fresh link?{" "}
            <Link href="/forgot-password" className="underline">
              Request another reset email
            </Link>
            .
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
