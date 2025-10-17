"use client";

import { useFormState } from "react-dom";
import { signInAction } from "@/actions/auth";

type SignInFormState = {
  error?: string;
};

const initialState: SignInFormState = {};

export function LoginForm() {
  const [state, dispatch] = useFormState(signInAction, initialState);

  return (
    <form
      action={dispatch}
      className="space-y-6 rounded-xl border border-black/[0.08] bg-white p-8 shadow-sm"
    >
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-black">Sign in</h2>
        <p className="text-sm text-black/70">
          Use your Barons Events credentials to access the workspace.
        </p>
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <label
            htmlFor="email"
            className="text-sm font-medium text-black/80"
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
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="password"
            className="text-sm font-medium text-black/80"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
          />
        </div>
      </div>

      {state?.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        className="inline-flex w-full items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
      >
        Sign in
      </button>
    </form>
  );
}
