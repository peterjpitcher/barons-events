"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, CheckCircle } from "lucide-react";
import { useActionState } from "react";
import { AUTH_CARD_CLASS, AUTH_CARD_CONTENT_CLASS, AUTH_CARD_HEADER_CLASS } from "@/components/auth/styles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { completePasswordResetAction, type ResetPasswordState } from "@/actions/auth";

const INITIAL_STATE: ResetPasswordState = { status: "idle" };
const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

export function ResetPasswordCard() {
  const [state, formAction] = useActionState(completePasswordResetAction, INITIAL_STATE);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [localFieldErrors, setLocalFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    setLocalFieldErrors({});
    const nextFieldErrors: Record<string, string> = {};

    if (password.trim().length < 12) {
      nextFieldErrors.password = "Password must be at least 12 characters long.";
    }
    if (confirmPassword.trim().length < 12) {
      nextFieldErrors.confirmPassword = "Confirm your password with at least 12 characters.";
    } else if (password !== confirmPassword) {
      nextFieldErrors.confirmPassword = "Passwords must match.";
    }

    if (Object.keys(nextFieldErrors).length) {
      event.preventDefault();
      setLocalFieldErrors(nextFieldErrors);
    }
  };

  if (state.status === "success") {
    return (
      <Card className={AUTH_CARD_CLASS}>
        <CardHeader className={AUTH_CARD_HEADER_CLASS}>
          <div className="flex items-center gap-3 text-[var(--sage-dark)]">
            <CheckCircle className="h-6 w-6" />
            <CardTitle className="text-2xl text-[var(--sage-dark)]">Password updated</CardTitle>
          </div>
          <CardDescription className="text-[var(--ink-muted)]">
            You&apos;re all set. Sign in with your new password to jump back into BaronsHub 1.1.
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

  const passwordError = localFieldErrors.password ?? state.fieldErrors?.password;
  const confirmPasswordError = localFieldErrors.confirmPassword ?? state.fieldErrors?.confirmPassword;
  const errorMessage = state.fieldErrors ? null : state.message;

  return (
    <Card className={AUTH_CARD_CLASS}>
      <CardHeader className={AUTH_CARD_HEADER_CLASS}>
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription className="text-[var(--ink-muted)]">
          Choose a new password for your BaronsHub 1.1 account.
        </CardDescription>
      </CardHeader>
      <CardContent className={AUTH_CARD_CONTENT_CLASS}>
        {errorMessage ? (
          <p className="rounded-[var(--radius)] border border-[var(--burgundy)] bg-[var(--burgundy-tint)] p-3 text-sm text-[var(--burgundy)]">
            {errorMessage}
          </p>
        ) : null}
        <form action={formAction} onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <Label className="text-[var(--ink-soft)]" htmlFor="password">
              New password
            </Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(passwordError)}
                aria-describedby={passwordError ? "password-error" : undefined}
                className={`${passwordError ? errorInputClass : ""} h-12 pr-12 text-[16px] md:h-10 md:text-sm`}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-3 flex min-w-11 items-center justify-center text-[var(--ink-soft)]"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <FieldError id="password-error" message={passwordError} />
            <p className="text-xs text-muted">At least 12 characters.</p>
          </div>

          <div className="space-y-2">
            <Label className="text-[var(--ink-soft)]" htmlFor="confirmPassword">
              Confirm password
            </Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={12}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                aria-invalid={Boolean(confirmPasswordError)}
                aria-describedby={confirmPasswordError ? "confirm-password-error" : undefined}
                className={`${confirmPasswordError ? errorInputClass : ""} h-12 pr-12 text-[16px] md:h-10 md:text-sm`}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-3 flex min-w-11 items-center justify-center text-[var(--ink-soft)]"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <FieldError id="confirm-password-error" message={confirmPasswordError} />
          </div>

          <SubmitButton label="Update password" pendingLabel="Updating..." className="h-12 w-full" />

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
