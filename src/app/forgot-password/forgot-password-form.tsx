"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/actions/auth";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { FieldError } from "@/components/ui/field-error";

const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, undefined);
  const emailError = state?.fieldErrors?.email;
  const formError = state?.fieldErrors ? null : state?.message;

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

