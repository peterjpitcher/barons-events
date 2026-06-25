"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef, useCallback, useState } from "react";

type TurnstileWidgetProps = {
  action: string;
  /** CSP nonce — pass from server component to ensure the injected script is trusted */
  nonce?: string;
  onTokenChange?: (token: string) => void;
};

/**
 * React-aware Turnstile CAPTCHA widget.
 *
 * Uses @marsidev/react-turnstile to properly handle React re-renders,
 * token expiry (auto-refreshes via refreshExpired), and lifecycle cleanup.
 * The library injects a hidden input named "cf-turnstile-response" into the
 * DOM so the token is automatically included in FormData submissions.
 *
 * Pass the CSP nonce from the server page to ensure the Turnstile script
 * tag carries the nonce for belt-and-suspenders CSP compliance alongside
 * strict-dynamic trust propagation.
 */
export function TurnstileWidget({ action, nonce, onTokenChange }: TurnstileWidgetProps) {
  const ref = useRef<TurnstileInstance | null>(null);
  const [token, setToken] = useState("");
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const updateToken = useCallback((nextToken: string) => {
    setToken(nextToken);
    onTokenChange?.(nextToken);
  }, [onTokenChange]);

  const handleExpire = useCallback(() => {
    updateToken("");
    ref.current?.reset();
  }, [updateToken]);

  const handleError = useCallback(() => {
    updateToken("");
  }, [updateToken]);

  if (process.env.NODE_ENV !== "production" || !siteKey) {
    // Local dev fallback: no widget rendered, token will be null (handled by verifyTurnstile)
    return null;
  }

  return (
    <>
      <input type="hidden" name="cf-turnstile-response" value={token} readOnly />
      <div className="max-w-full overflow-hidden">
        <Turnstile
          ref={ref}
          siteKey={siteKey}
          options={{
            action,
            refreshExpired: "auto",
          }}
          injectScript
          scriptOptions={{
            appendTo: "body",
            nonce: nonce || "",
          }}
          onSuccess={updateToken}
          onExpire={handleExpire}
          onError={handleError}
        />
      </div>
    </>
  );
}
