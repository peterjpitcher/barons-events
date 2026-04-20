"use client";

import { useActionState, useEffect, useState } from "react";
import { signInAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { FieldError } from "@/components/ui/field-error";
import { TurnstileWidget } from "@/components/turnstile-widget";

type LoginFormProps = {
  redirectTo: string;
  nonce?: string;
};

const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

export function LoginForm({ redirectTo, nonce }: LoginFormProps) {
  const [state, formAction] = useActionState(signInAction, undefined);
  const emailError = state?.fieldErrors?.email;
  const passwordError = state?.fieldErrors?.password;
  const formError = state?.fieldErrors ? null : state?.message;

  // Turnstile tokens are single-use — after a failed sign-in, the posted token has
  // been redeemed by siteverify and cannot be reused. Remount the widget on each
  // error so the next submit carries a fresh token and avoids timeout-or-duplicate.
  const [turnstileKey, setTurnstileKey] = useState(0);
  useEffect(() => {
    if (state) setTurnstileKey((k) => k + 1);
  }, [state]);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo} />
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
      <div className="space-y-2">
        <Label className="text-[var(--color-text-subtle)]" htmlFor="password">
          Password
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(passwordError)}
          aria-describedby={passwordError ? "password-error" : undefined}
          className={passwordError ? errorInputClass : undefined}
        />
        <FieldError id="password-error" message={passwordError} />
      </div>
      {formError ? <p className="text-sm text-[var(--color-danger)]">{formError}</p> : null}
      <TurnstileWidget key={turnstileKey} action="login" nonce={nonce} />
      <SubmitButton label="Sign in" />
    </form>
  );
}

