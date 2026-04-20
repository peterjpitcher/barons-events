"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/actions/auth";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { FieldError } from "@/components/ui/field-error";
import { TurnstileWidget } from "@/components/turnstile-widget";

const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

export function ForgotPasswordForm({ nonce }: { nonce?: string }) {
  const [state, formAction] = useActionState(requestPasswordResetAction, undefined);
  const emailError = state?.fieldErrors?.email;
  const formError = state?.fieldErrors ? null : state?.message;

  // Remount Turnstile on each action result so a failed submit doesn't
  // replay the now-redeemed token on the retry (timeout-or-duplicate).
  const [turnstileKey, setTurnstileKey] = useState(0);
  useEffect(() => {
    if (state) setTurnstileKey((k) => k + 1);
  }, [state]);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <div className="space-y-2">
        <Label className="text-[var(--color-text-subtle)]" htmlFor="email">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? "email-error" : undefined}
          className={emailError ? errorInputClass : undefined}
        />
        <FieldError id="email-error" message={emailError} />
      </div>
      {formError ? <p className="text-sm text-[var(--color-danger)]">{formError}</p> : null}
      <TurnstileWidget key={turnstileKey} action="password_reset" nonce={nonce} />
      <SubmitButton label="Send reset link" pendingLabel="Sending link..." />
      <p className="text-sm text-muted">
        Remembered it?{" "}
        <Link href="/login" className="underline">
          Head back to sign in
        </Link>
        .
      </p>
    </form>
  );
}

