import "server-only";
import { timingSafeEqual } from "crypto";

/**
 * Verify the CRON_SECRET bearer token using constant-time comparison
 * to prevent timing attacks on the secret value.
 */
export function verifyCronSecret(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) return false;

  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;

  const token = authHeader.slice(prefix.length);
  if (token.length !== secret.length) return false;

  return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}
