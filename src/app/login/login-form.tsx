"use client";

import { useActionState } from "react";
import { signInAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { FieldError } from "@/components/ui/field-error";

type LoginFormProps = {
  redirectTo: string;
};

const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

export function LoginForm({ redirectTo }: LoginFormProps) {
  const [state, formAction] = useActionState(signInAction, undefined);
  const emailError = state?.fieldErrors?.email;
  const passwordError = state?.fieldErrors?.password;
  const formError = state?.fieldErrors ? null : state?.message;

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
      <SubmitButton label="Sign in" />
    </form>
  );
}

