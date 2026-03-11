import "server-only";

export type PasswordValidationResult = {
  valid: boolean;
  errors: string[];
};

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

/**
 * Validates a password against the workspace password policy.
 * Must be called server-side — never client-side only.
 *
 * Policy: minimum 12 characters, maximum 128, must contain uppercase,
 * lowercase, digit, and special character. Checked against HIBP breached
 * password database using k-anonymity (SHA-1, first 5 chars sent only).
 */
export async function validatePassword(password: string): Promise<PasswordValidationResult> {
  const errors: string[] = [];

  if (password.length < MIN_LENGTH) {
    errors.push(`Password must be at least ${MIN_LENGTH} characters long.`);
  }

  if (password.length > MAX_LENGTH) {
    errors.push(`Password must be no longer than ${MAX_LENGTH} characters.`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter.");
  }

  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter.");
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number.");
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("Password must contain at least one special character.");
  }

  // Only check HIBP if the password passes basic constraints (avoid wasted API calls)
  if (errors.length === 0) {
    const hibpResult = await checkHibp(password);
    if (hibpResult === "breached") {
      errors.push(
        "This password has appeared in a data breach. Please choose a different password."
      );
    }
    // If HIBP is unreachable, we permit the password (fail-open) and log the failure.
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Checks the password against the Have I Been Pwned Passwords API using k-anonymity.
 * Only the first 5 characters of the SHA-1 hash are sent to the API.
 * Returns "breached" | "safe" | "unavailable".
 */
async function checkHibp(password: string): Promise<"breached" | "safe" | "unavailable"> {
  try {
    // SHA-1 hash of the password (HIBP API requires SHA-1, not SHA-256)
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000)
    });

    if (!response.ok) {
      console.warn("HIBP API returned non-OK status:", response.status);
      return "unavailable";
    }

    const text = await response.text();
    const lines = text.split("\n");

    for (const line of lines) {
      const [hashSuffix, countStr] = line.trim().split(":");
      if (hashSuffix === suffix) {
        const count = parseInt(countStr, 10);
        return count > 0 ? "breached" : "safe";
      }
    }

    return "safe";
  } catch (error) {
    console.warn("HIBP check failed (fail-open):", error);
    return "unavailable";
  }
}
