import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const SESSION_COOKIE_NAME = "app-session-id";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const ABSOLUTE_TIMEOUT_HOURS = 24;
const MAX_SESSIONS_PER_USER = 5;

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
    const lastActivityAt = new Date(data.last_activity_at);
    const idleDeadline = new Date(lastActivityAt.getTime() + IDLE_TIMEOUT_MS);

    // Check absolute and idle timeouts
    if (now > expiresAt || now > idleDeadline) {
      // Session expired — destroy it asynchronously (don't block the response)
      db.from("app_sessions").delete().eq("session_id", sessionId).then(() => {});
      return null;
    }

    return {
      sessionId: data.session_id,
      userId: data.user_id,
      createdAt: new Date(data.created_at),
      lastActivityAt,
      expiresAt,
      metadata: {
        userAgent: data.user_agent,
        ipAddress: data.ip_address
      }
    };
  } catch (error) {
    console.error("Session validation error (fail-closed):", error);
    return null;
  }
}

/**
 * Updates lastActivityAt for a session (heartbeat/renewal).
 * Also renews expiresAt if within the renewal threshold (5 min before absolute expiry).
 */
export async function renewSession(sessionId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  const now = new Date();

  const { data } = await db
    .from("app_sessions")
    .select("expires_at")
    .eq("session_id", sessionId)
    .single();

  const updates: Record<string, string> = {
    last_activity_at: now.toISOString()
  };

  // Renew absolute expiry if within 5 minutes of expiry
  if (data) {
    const expiresAt = new Date(data.expires_at);
    const renewalThreshold = 5 * 60 * 1000;
    if (expiresAt.getTime() - now.getTime() < renewalThreshold) {
      updates.expires_at = new Date(now.getTime() + ABSOLUTE_TIMEOUT_HOURS * 3600 * 1000).toISOString();
    }
  }

  await db.from("app_sessions").update(updates).eq("session_id", sessionId);
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
 */
export async function cleanupExpiredSessions(): Promise<void> {
  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const idleCutoff = new Date(Date.now() - IDLE_TIMEOUT_MS).toISOString();

  await db.from("app_sessions").delete().lt("expires_at", now);
  await db.from("app_sessions").delete().lt("last_activity_at", idleCutoff);
}

// ─── Account lockout helpers ────────────────────────────────────────────────

const LOCKOUT_WINDOW_MINUTES = 15;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MINUTES = 30;

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
  const windowStart = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString();

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
 */
export async function clearLockoutForAllIps(email: string): Promise<void> {
  const db = createSupabaseAdminClient();
  const emailHash = await hashEmail(email);
  await db.from("login_attempts").delete().eq("email_hash", emailHash);
}
