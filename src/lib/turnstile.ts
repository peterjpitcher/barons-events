/**
 * Verifies a Cloudflare Turnstile token server-side.
 *
 * Modes:
 * - "lenient" (default): fails soft — returns true when token is missing,
 *   secret is absent, or the API is unreachable. Used by auth pages.
 * - "strict": fails closed — returns false in all degraded paths.
 *   Used by public booking flow. Secret-key bypass still allowed in dev.
 */
export async function verifyTurnstile(
  token: string | null,
  action: string,
  mode: "strict" | "lenient" = "lenient",
): Promise<boolean> {
  if (!token) {
    if (mode === "strict") {
      console.warn(`[turnstile] No token received for action="${action}" — rejecting (strict). Widget may not have loaded.`);
      return false;
    }
    console.warn("[turnstile] No token received — widget may not have loaded. Failing soft.");
    return true;
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // In strict mode, allow dev convenience only outside production
    if (mode === "strict" && process.env.NODE_ENV === "production") {
      console.error(`[turnstile] TURNSTILE_SECRET_KEY not set in production for action="${action}" — rejecting.`);
      return false;
    }
    console.warn("[turnstile] TURNSTILE_SECRET_KEY not set — skipping verification");
    return true;
  }

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });

    if (!res.ok) {
      if (mode === "strict") {
        console.error(`[turnstile] siteverify API returned ${res.status} for action="${action}" — rejecting (strict).`);
        return false;
      }
      console.warn("[turnstile] siteverify API unavailable — failing soft");
      return true;
    }

    const data = (await res.json()) as { success: boolean; action?: string; "error-codes"?: string[] };
    if (data.action && data.action !== action) {
      console.warn(`[turnstile] action mismatch: expected="${action}" got="${data.action}" — rejecting.`);
      return false; // action mismatch — always reject
    }
    if (!data.success) {
      console.warn(`[turnstile] verification failed for action="${action}" errors=${JSON.stringify(data["error-codes"] ?? [])}`);
    }
    return data.success === true;
  } catch (err) {
    if (mode === "strict") {
      console.error(`[turnstile] siteverify error for action="${action}" — rejecting (strict).`, err);
      return false;
    }
    console.warn("[turnstile] siteverify error — failing soft");
    return true;
  }
}
