import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuthEvent } from "@/lib/audit-log";

export const SESSION_COOKIE_NAME = "app-session-id";
const ABSOLUTE_TIMEOUT_HOURS = 24;
const MAX_SESSIONS_PER_USER = 5;
const REFRESH_THRESHOLD_HOURS = ABSOLUTE_TIMEOUT_HOURS / 2; // 12 hours
const MAX_SESSION_LIFETIME_HOURS = 48; // hard cap
const IDLE_TIMEOUT_MINUTES = 30;
const ACTIVITY_UPDATE_THROTTLE_MINUTES = 5;

export type SessionRecord = {
  sessionId: string;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  metadata: {
    userAgent?: string | null;
    ipAddress?: string | null;
  };
  /** True if the DB expiry was extended during this validation request */
  refreshed: boolean;
  /** The new expiry time, if refreshed */
  newExpiresAt?: Date;
};

export function makeSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: ABSOLUTE_TIMEOUT_HOURS * 3600,
    path: "/"
  };
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
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_HOURS * 3600 * 1000);

  // Evict oldest sessions if at limit
  const { data: existing } = await db
    .from("app_sessions")
    .select("session_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (existing && existing.length >= MAX_SESSIONS_PER_USER) {
    const toEvict = existing.slice(0, existing.length - MAX_SESSIONS_PER_USER + 1);
    const ids = toEvict.map((s: { session_id: string }) => s.session_id);
    await db.from("app_sessions").delete().in("session_id", ids);
  }

  const { error } = await db.from("app_sessions").insert({
    session_id: sessionId,
    user_id: userId,
    created_at: now.toISOString(),
    last_activity_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    user_agent: metadata?.userAgent ?? null,
    ip_address: metadata?.ipAddress ?? null
  });

  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }

  return sessionId;
}

/**
 * Validates an app session. Returns the session record or null if invalid/expired.
 * Fail-closed: any DB error returns null (treated as invalid session).
 */
export async function validateSession(sessionId: string): Promise<SessionRecord | null> {
  if (!sessionId) return null;

  try {
    const db = createSupabaseAdminClient();
    const { data, error } = await db
      .from("app_sessions")
      .select("*")
      .eq("session_id", sessionId)
      .single();

    if (error || !data) return null;

    const now = new Date();
    const expiresAt = new Date(data.expires_at);

    if (now > expiresAt) {
      // Session expired — destroy it asynchronously (don't block the response)
      db.from("app_sessions").delete().eq("session_id", sessionId).then(() => {});

      logAuthEvent({
        event: "auth.session.expired.absolute",
        userId: data.user_id
      }).catch(() => {});

      return null;
    }

    // Idle timeout: reject if no activity in IDLE_TIMEOUT_MINUTES
    const lastActivity = new Date(data.last_activity_at);
    const idleMs = now.getTime() - lastActivity.getTime();
    const idleLimit = IDLE_TIMEOUT_MINUTES * 60 * 1000;

    if (idleMs > idleLimit) {
      // Session idle — destroy and log
      db.from("app_sessions").delete().eq("session_id", sessionId).then(() => {});
      logAuthEvent({
        event: "auth.session.expired.idle",
        userId: data.user_id
      }).catch(() => {});
      return null;
    }

    // Throttled activity update: only update if >5 min since last update
    const throttle = ACTIVITY_UPDATE_THROTTLE_MINUTES * 60 * 1000;
    if (idleMs > throttle) {
      db.from("app_sessions")
        .update({ last_activity_at: now.toISOString() })
        .eq("session_id", sessionId)
        .then(() => {});
    }

    // Sliding window refresh: extend session if >50% elapsed
    const sessionAge = now.getTime() - new Date(data.created_at).getTime();
    const refreshThreshold = REFRESH_THRESHOLD_HOURS * 3600 * 1000;
    const maxLifetime = MAX_SESSION_LIFETIME_HOURS * 3600 * 1000;
    const createdAt = new Date(data.created_at).getTime();

    let refreshed = false;
    let newExpiresAt: Date | undefined;

    if (sessionAge > refreshThreshold) {
      const computedExpiry = new Date(Math.min(
        now.getTime() + ABSOLUTE_TIMEOUT_HOURS * 3600 * 1000,
        createdAt + maxLifetime
      ));
      refreshed = true;
      newExpiresAt = computedExpiry;
      // Fire-and-forget — don't block the response
      db.from("app_sessions")
        .update({ expires_at: computedExpiry.toISOString() })
        .eq("session_id", sessionId)
        .then(() => {});
    }

    return {
      sessionId: data.session_id,
      userId: data.user_id,
      createdAt: new Date(data.created_at),
      lastActivityAt: new Date(data.last_activity_at),
      expiresAt,
      metadata: {
        userAgent: data.user_agent,
        ipAddress: data.ip_address
      },
      refreshed,
      newExpiresAt
    };
  } catch (error) {
    console.error("Session validation error (fail-closed):", error);
    return null;
  }
}

/**
 * Destroys a single session. Called on sign-out.
 */
export async function destroySession(sessionId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db.from("app_sessions").delete().eq("session_id", sessionId);
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
  const now = new Date().toISOString();

  await db.from("app_sessions").delete().lt("expires_at", now);

  // Also clean up idle sessions
  const idleCutoff = new Date(Date.now() - IDLE_TIMEOUT_MINUTES * 60 * 1000).toISOString();
  await db.from("app_sessions").delete().lt("last_activity_at", idleCutoff);

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
