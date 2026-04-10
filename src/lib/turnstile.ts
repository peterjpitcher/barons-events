/**
 * Verifies a Cloudflare Turnstile token server-side.
 * Fails soft (returns true) when the secret key is absent or the Turnstile API is unreachable,
 * per auth standard §6 fail-soft behaviour.
 */
export async function verifyTurnstile(token: string | null, action: string): Promise<boolean> {
  if (!token) {
    // Widget failed to generate a token (script not yet loaded, invalid site key, or network issue).
    // Fail-soft per auth standard §6 — treat as degraded mode rather than blocking the user.
    console.warn("[turnstile] No token received — widget may not have loaded. Failing soft.");
    return true;
  }
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // In development without key configured, fail-soft
    console.warn("[turnstile] TURNSTILE_SECRET_KEY not set — skipping verification");
    return true;
  }
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token })
    });
    if (!res.ok) {
      console.warn("[turnstile] siteverify API unavailable — failing soft");
      return true; // fail-soft per auth standard §6
    }
    const data = (await res.json()) as { success: boolean; action?: string };
    if (data.action && data.action !== action) {
      return false; // action mismatch
    }
    return data.success === true;
  } catch {
    console.warn("[turnstile] siteverify error — failing soft");
    return true; // fail-soft
  }
}
