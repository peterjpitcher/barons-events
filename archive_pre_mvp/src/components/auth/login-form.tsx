"use client";

import { useActionState } from "react";
import { signInAction } from "@/actions/auth";

type SignInFormState = {
  error?: string;
};

const initialState: SignInFormState = {};

export function LoginForm() {
  const [state, dispatch] = useActionState(signInAction, initialState);

  return (
    <form
      action={dispatch}
      className="space-y-6 rounded-xl border border-[var(--color-border)] bg-white/95 p-8 shadow-soft"
    >
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-[var(--color-primary-900)]">Sign in</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Use your EventHub credentials to access the workspace.
        </p>
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <label
            htmlFor="email"
            className="text-sm font-medium text-[var(--color-text)]"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            required
            autoComplete="email"
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="password"
            className="text-sm font-medium text-[var(--color-text)]"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
          />
        </div>
      </div>

      {state?.error ? (
        <p className="rounded-lg bg-[rgba(239,68,68,0.12)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        className="inline-flex w-full items-center justify-center rounded-full bg-[var(--color-primary-700)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-primary-800)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
      >
        Sign in
      </button>
    </form>
  );
}
