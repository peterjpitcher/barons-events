import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const SESSION_COOKIE_NAME = "app-session-id";
const MAX_SESSIONS_PER_USER = 5;
const STALE_SESSION_DAYS = 90;
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 3600; // 1 year
const SESSION_TOKEN_BYTES = 32;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_SESSION_SELECT = "session_id,user_id,created_at,last_activity_at,user_agent,ip_address,session_token_hash,previous_session_token_hash";

export type SessionRecord = {
  sessionId: string;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
  metadata: {
    userAgent?: string | null;
    ipAddress?: string | null;
  };
};

export type SessionValidationResult = {
  session: SessionRecord;
  rotatedToken?: string;
};

export function makeSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/"
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateSessionToken(): string {
  const bytes = new Uint8Array(SESSION_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function hashSessionToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`app-session:${token}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type SessionRow = {
  session_id: string;
  user_id: string;
  created_at: string;
  last_activity_at: string;
  user_agent: string | null;
  ip_address: string | null;
  session_token_hash?: string | null;
  previous_session_token_hash?: string | null;
};

function toSessionRecord(data: SessionRow): SessionRecord {
  return {
    sessionId: data.session_id,
    userId: data.user_id,
    createdAt: new Date(data.created_at),
    lastActivityAt: new Date(data.last_activity_at),
    metadata: {
      userAgent: data.user_agent,
      ipAddress: data.ip_address
    }
  };
}

async function touchSession(
  db: ReturnType<typeof createSupabaseAdminClient>,
  row: SessionRow,
  options?: { clearPreviousToken?: boolean }
): Promise<void> {
  const now = new Date();
  const lastActivity = new Date(row.last_activity_at);
  const idleMs = now.getTime() - lastActivity.getTime();
  const throttle = 15 * 60 * 1000; // 15 minutes

  const updatePayload: Record<string, string | null> = {};
  if (idleMs > throttle) {
    updatePayload.last_activity_at = now.toISOString();
  }
  if (options?.clearPreviousToken) {
    updatePayload.previous_session_token_hash = null;
  }

  if (Object.keys(updatePayload).length > 0) {
    await db.from("app_sessions").update(updatePayload).eq("session_id", row.session_id);
  }
}

/**
 * Creates a new app session record. Called immediately after successful sign-in.
 * Evicts the oldest session if the user already has MAX_SESSIONS_PER_USER active sessions.
 */
export async function createSession(
  userId: string,
  metadata?: { userAgent?: string | null; ipAddress?: string | null }
): Promise<string> {
  const db = createSupabaseAdminClient();
  const sessionId = crypto.randomUUID();
  const sessionToken = generateSessionToken();
  const sessionTokenHash = await hashSessionToken(sessionToken);
  const now = new Date();

  // Evict least-recently-active sessions if at limit
  const { data: existing } = await db
    .from("app_sessions")
    .select("session_id, last_activity_at")
    .eq("user_id", userId)
    .order("last_activity_at", { ascending: true });

  if (existing && existing.length >= MAX_SESSIONS_PER_USER) {
    const toEvict = existing.slice(0, existing.length - MAX_SESSIONS_PER_USER + 1);
    const ids = toEvict.map((s: { session_id: string }) => s.session_id);
    await db.from("app_sessions").delete().in("session_id", ids);
  }

  const { error } = await db.from("app_sessions").insert({
    session_id: sessionId,
    session_token_hash: sessionTokenHash,
    previous_session_token_hash: null,
    user_id: userId,
    created_at: now.toISOString(),
    last_activity_at: now.toISOString(),
    expires_at: null,
    user_agent: metadata?.userAgent ?? null,
    ip_address: metadata?.ipAddress ?? null
  });

  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }

  return sessionToken;
}

/**
 * Validates an app session. Returns the session record or null if invalid/expired.
 * Fail-closed: any DB error returns null (treated as invalid session).
 */
export async function validateSession(sessionToken: string): Promise<SessionRecord | null> {
  const result = await validateSessionToken(sessionToken, { rotateLegacy: false });
  return result?.session ?? null;
}

/**
 * Validates an app session and, when possible, silently upgrades a legacy UUID
 * cookie to a random opaque token. Callers that receive rotatedToken must write
 * it back to the app-session cookie on the same response.
 */
export async function validateSessionWithRotation(sessionToken: string): Promise<SessionValidationResult | null> {
  return validateSessionToken(sessionToken, { rotateLegacy: true });
}

async function validateSessionToken(
  sessionToken: string,
  options: { rotateLegacy: boolean }
): Promise<SessionValidationResult | null> {
  if (!sessionToken || typeof sessionToken !== "string") return null;

  try {
    const db = createSupabaseAdminClient();
    const tokenHash = await hashSessionToken(sessionToken);

    const { data: hashedRow, error: hashedError } = await db
      .from("app_sessions")
      .select(APP_SESSION_SELECT)
      .or(`session_token_hash.eq.${tokenHash},previous_session_token_hash.eq.${tokenHash}`)
      .maybeSingle();

    if (hashedError) return null;

    if (hashedRow) {
      const row = hashedRow as SessionRow;
      const matchedCurrent = row.session_token_hash === tokenHash;
      const matchedPrevious = row.previous_session_token_hash === tokenHash;

      if (!matchedCurrent && !matchedPrevious) return null;

      await touchSession(db, row, {
        clearPreviousToken: matchedCurrent && Boolean(row.previous_session_token_hash)
      });

      return { session: toSessionRecord(row) };
    }

    if (!UUID_PATTERN.test(sessionToken)) return null;

    const { data: legacyRow, error: legacyError } = await db
      .from("app_sessions")
      .select(APP_SESSION_SELECT)
      .eq("session_id", sessionToken)
      .maybeSingle();

    if (legacyError || !legacyRow) return null;

    const row = legacyRow as SessionRow;
    if (row.session_token_hash) {
      // The legacy UUID was already retired after a successful opaque-token use.
      return null;
    }

    let rotatedToken: string | undefined;
    if (options.rotateLegacy) {
      const nextToken = generateSessionToken();
      const nextTokenHash = await hashSessionToken(nextToken);
      const { error: rotateError } = await db
        .from("app_sessions")
        .update({
          session_token_hash: nextTokenHash,
          previous_session_token_hash: tokenHash,
          last_activity_at: new Date().toISOString()
        })
        .eq("session_id", row.session_id)
        .is("session_token_hash", null);

      if (!rotateError) {
        rotatedToken = nextToken;
      }
    } else {
      await touchSession(db, row);
    }

    return { session: toSessionRecord(row), rotatedToken };
  } catch (error) {
    console.error("Session validation error (fail-closed):", error);
    return null;
  }
}

/**
 * Destroys a single session. Called on sign-out.
 */
export async function destroySession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const db = createSupabaseAdminClient();
  const tokenHash = await hashSessionToken(sessionId);
  const filters = [
    `session_token_hash.eq.${tokenHash}`,
    `previous_session_token_hash.eq.${tokenHash}`,
  ];
  if (UUID_PATTERN.test(sessionId)) {
    filters.push(`session_id.eq.${sessionId}`);
  }
  await db.from("app_sessions").delete().or(filters.join(","));
}

/**
 * Destroys all sessions for a user. Called on password change and role demotion.
 * After calling this, immediately call createSession() for the requesting user.
 */
export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db.from("app_sessions").delete().eq("user_id", userId);
}

/**
 * Removes all expired sessions. For use in a periodic cron job.
 *
 * Uses separate cleanup windows for login attempts (30 min lockout duration)
 * and password reset attempts (60 min reset window) to avoid premature deletion
 * of reset-throttle rows.
 */
export async function cleanupExpiredSessions(): Promise<void> {
  const db = createSupabaseAdminClient();

  // Remove sessions with no activity in STALE_SESSION_DAYS
  const staleCutoff = new Date(Date.now() - STALE_SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  await db.from("app_sessions").delete().lt("last_activity_at", staleCutoff);

  // Login attempt cleanup — use lockout duration (30 min)
  const loginCutoff = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString();
  await db.from("login_attempts")
    .delete()
    .lt("attempted_at", loginCutoff)
    .neq("ip_address", "password_reset")
    .neq("ip_address", "password_reset_ip");

  // Password reset attempt cleanup — use reset window (60 min)
  const resetCutoff = new Date(Date.now() - RESET_WINDOW_MINUTES * 60 * 1000).toISOString();
  await db.from("login_attempts")
    .delete()
    .lt("attempted_at", resetCutoff)
    .in("ip_address", ["password_reset", "password_reset_ip"]);
}

// ─── Account lockout helpers ────────────────────────────────────────────────

const LOCKOUT_WINDOW_MINUTES = 15;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MINUTES = 30;

// Password reset rate limiting constants (also used by cleanupExpiredSessions)
const RESET_LIMIT_PER_HOUR = 3;
const RESET_WINDOW_MINUTES = 60;
const RESET_IP_LIMIT_PER_HOUR = 10;

/**
 * SHA-256 hashes an email for lockout/audit storage.
 */
async function hashEmail(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.toLowerCase());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Records a failed login attempt. Returns whether the account is now locked.
 */
export async function recordFailedLoginAttempt(
  email: string,
  ip: string
): Promise<{ isLocked: boolean }> {
  const db = createSupabaseAdminClient();
  const emailHash = await hashEmail(email);

  // Insert the attempt
  await db.from("login_attempts").insert({
    email_hash: emailHash,
    ip_address: ip,
    attempted_at: new Date().toISOString()
  });

  // Count recent attempts for this email+IP
  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count } = await db
    .from("login_attempts")
    .select("*", { count: "exact", head: true })
    .eq("email_hash", emailHash)
    .eq("ip_address", ip)
    .gte("attempted_at", windowStart);

  return { isLocked: (count ?? 0) >= LOCKOUT_THRESHOLD };
}

/**
 * Checks whether a given email+IP is currently locked out.
 */
export async function isLockedOut(email: string, ip: string): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const emailHash = await hashEmail(email);
  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count } = await db
    .from("login_attempts")
    .select("*", { count: "exact", head: true })
    .eq("email_hash", emailHash)
    .eq("ip_address", ip)
    .gte("attempted_at", windowStart);

  return (count ?? 0) >= LOCKOUT_THRESHOLD;
}

/**
 * Clears all lockout records for a specific email+IP after successful sign-in.
 */
export async function clearLockoutForIp(email: string, ip: string): Promise<void> {
  const db = createSupabaseAdminClient();
  const emailHash = await hashEmail(email);
  await db
    .from("login_attempts")
    .delete()
    .eq("email_hash", emailHash)
    .eq("ip_address", ip);
}

/**
 * Clears all lockout records for an email across all IPs. Called on successful password reset.
 * Excludes password_reset and password_reset_ip rows — those are rate-limit records, not lockout records.
 */
export async function clearLockoutForAllIps(email: string): Promise<void> {
  const db = createSupabaseAdminClient();
  const emailHash = await hashEmail(email);
  await db.from("login_attempts")
    .delete()
    .eq("email_hash", emailHash)
    .neq("ip_address", "password_reset")
    .neq("ip_address", "password_reset_ip");
}

// ─── Password reset rate limiting ─────────────────────────────────────────────

/**
 * Records a password reset request. Returns true if either the per-email or
 * per-IP limit has been exceeded (caller should silently succeed to prevent enumeration).
 *
 * Reuses the `login_attempts` table with `ip_address = "password_reset"` (per-email)
 * and `ip_address = "password_reset_ip"` (per-IP) as type discriminators so no
 * schema migration is needed. These rows are cleaned up automatically by
 * `cleanupExpiredSessions`.
 *
 * Per-email limit: 3/hour — prevents hammering a single target.
 * Per-IP limit: 10/hour — prevents spray attacks across many emails from one IP.
 */
export async function recordPasswordResetAttempt(
  email: string,
  ipAddress: string
): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const emailHash = await hashEmail(email);
  const ipHash = await hashEmail(`ip:${ipAddress}`); // namespace-prefix avoids collision with real email hashes

  const windowStart = new Date(Date.now() - RESET_WINDOW_MINUTES * 60 * 1000).toISOString();

  // Per-email limit: 3/hour
  const { count: emailCount } = await db
    .from("login_attempts")
    .select("*", { count: "exact", head: true })
    .eq("email_hash", emailHash)
    .eq("ip_address", "password_reset")
    .gte("attempted_at", windowStart);

  if ((emailCount ?? 0) >= RESET_LIMIT_PER_HOUR) return true;

  // Per-IP limit: 10/hour (prevents spray attacks)
  const { count: ipCount } = await db
    .from("login_attempts")
    .select("*", { count: "exact", head: true })
    .eq("email_hash", ipHash)
    .eq("ip_address", "password_reset_ip")
    .gte("attempted_at", windowStart);

  if ((ipCount ?? 0) >= RESET_IP_LIMIT_PER_HOUR) return true;

  // Record both rows
  const now = new Date().toISOString();
  await db.from("login_attempts").insert([
    { email_hash: emailHash, ip_address: "password_reset", attempted_at: now },
    { email_hash: ipHash, ip_address: "password_reset_ip", attempted_at: now }
  ]);

  return false;
}
