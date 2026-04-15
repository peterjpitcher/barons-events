/**
 * Tests for account lockout rate limiting in src/lib/auth/session.ts.
 *
 * The lockout mechanism tracks failed login attempts per email+IP and
 * locks the account after 5 failures within a 15-minute window. This
 * also guards password reset flows since the same lockout check is used.
 *
 * These tests cover gap 5.4 from the auth audit spec — auth failure paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock admin client ────────────────────────────────────────────────────────

let mockFromImpl: (table: string) => Record<string, unknown>;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => mockFromImpl(table)
  })
}));

vi.mock("@/lib/audit-log", () => ({
  logAuthEvent: vi.fn().mockResolvedValue(undefined)
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  recordFailedLoginAttempt,
  isLockedOut,
  clearLockoutForIp,
  clearLockoutForAllIps,
  recordPasswordResetAttempt
} from "../session";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── recordFailedLoginAttempt — rate limit threshold ─────────────────────────

describe("recordFailedLoginAttempt — lockout threshold", () => {
  it("should return isLocked:false when attempt count is below threshold (< 5)", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const gteFn = vi.fn(() => Promise.resolve({ count: 3, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectFn = vi.fn(() => ({ eq: eq1Fn }));

    mockFromImpl = () => ({
      insert: insertFn,
      select: selectFn
    });

    const { isLocked } = await recordFailedLoginAttempt("user@example.com", "1.2.3.4");

    expect(isLocked).toBe(false);
  });

  it("should return isLocked:true when attempt count reaches threshold (= 5)", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const gteFn = vi.fn(() => Promise.resolve({ count: 5, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectFn = vi.fn(() => ({ eq: eq1Fn }));

    mockFromImpl = () => ({
      insert: insertFn,
      select: selectFn
    });

    const { isLocked } = await recordFailedLoginAttempt("user@example.com", "1.2.3.4");

    expect(isLocked).toBe(true);
  });

  it("should return isLocked:true when attempt count exceeds threshold (> 5)", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const gteFn = vi.fn(() => Promise.resolve({ count: 10, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectFn = vi.fn(() => ({ eq: eq1Fn }));

    mockFromImpl = () => ({
      insert: insertFn,
      select: selectFn
    });

    const { isLocked } = await recordFailedLoginAttempt("user@example.com", "1.2.3.4");

    expect(isLocked).toBe(true);
  });

  it("should treat null count as zero (not locked)", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const gteFn = vi.fn(() => Promise.resolve({ count: null, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectFn = vi.fn(() => ({ eq: eq1Fn }));

    mockFromImpl = () => ({
      insert: insertFn,
      select: selectFn
    });

    const { isLocked } = await recordFailedLoginAttempt("user@example.com", "1.2.3.4");

    expect(isLocked).toBe(false);
  });

  it("should insert a login_attempts record with hashed email", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const gteFn = vi.fn(() => Promise.resolve({ count: 1, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectFn = vi.fn(() => ({ eq: eq1Fn }));

    mockFromImpl = () => ({
      insert: insertFn,
      select: selectFn
    });

    await recordFailedLoginAttempt("User@Example.COM", "1.2.3.4");

    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        email_hash: expect.any(String),
        ip_address: "1.2.3.4",
        attempted_at: expect.any(String)
      })
    );

    // Email hash should be consistent (lowercased before hashing)
    const firstCallHash = (insertFn.mock.calls as unknown[][])[0]?.[0] as { email_hash: string } | undefined;
    const emailHash = firstCallHash?.email_hash ?? "";
    expect(emailHash).toBeTruthy();
    expect(emailHash.length).toBe(64); // SHA-256 hex = 64 chars
  });
});

// ─── isLockedOut — standalone check ─────────────────────────────────────────

describe("isLockedOut — standalone lockout check", () => {
  it("should return false when recent attempt count is below threshold", async () => {
    const gteFn = vi.fn(() => Promise.resolve({ count: 2, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectFn = vi.fn(() => ({ eq: eq1Fn }));

    mockFromImpl = () => ({ select: selectFn });

    expect(await isLockedOut("user@example.com", "1.2.3.4")).toBe(false);
  });

  it("should return true when recent attempt count meets threshold", async () => {
    const gteFn = vi.fn(() => Promise.resolve({ count: 5, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectFn = vi.fn(() => ({ eq: eq1Fn }));

    mockFromImpl = () => ({ select: selectFn });

    expect(await isLockedOut("user@example.com", "1.2.3.4")).toBe(true);
  });

  it("should return false when count is null (DB returned no count)", async () => {
    const gteFn = vi.fn(() => Promise.resolve({ count: null, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectFn = vi.fn(() => ({ eq: eq1Fn }));

    mockFromImpl = () => ({ select: selectFn });

    expect(await isLockedOut("user@example.com", "1.2.3.4")).toBe(false);
  });
});

// ─── clearLockoutForIp — lockout reset after successful login ───────────────

describe("clearLockoutForIp — targeted lockout reset", () => {
  it("should delete attempts matching hashed email and IP", async () => {
    const eq2Fn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const deleteFn = vi.fn(() => ({ eq: eq1Fn }));

    mockFromImpl = () => ({ delete: deleteFn });

    await clearLockoutForIp("user@example.com", "9.8.7.6");

    expect(deleteFn).toHaveBeenCalled();
    expect(eq1Fn).toHaveBeenCalledWith("email_hash", expect.any(String));
    expect(eq2Fn).toHaveBeenCalledWith("ip_address", "9.8.7.6");
  });
});

// ─── clearLockoutForAllIps — full lockout reset after password change ───────

describe("clearLockoutForAllIps — global lockout reset", () => {
  it("should delete login lockout records but exclude password_reset and password_reset_ip rows", async () => {
    const neq2Fn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const neq1Fn = vi.fn(() => ({ neq: neq2Fn }));
    const eqFn = vi.fn(() => ({ neq: neq1Fn }));
    const deleteFn = vi.fn(() => ({ eq: eqFn }));

    mockFromImpl = () => ({ delete: deleteFn });

    await clearLockoutForAllIps("user@example.com");

    expect(deleteFn).toHaveBeenCalled();
    expect(eqFn).toHaveBeenCalledWith("email_hash", expect.any(String));
    expect(neq1Fn).toHaveBeenCalledWith("ip_address", "password_reset");
    expect(neq2Fn).toHaveBeenCalledWith("ip_address", "password_reset_ip");
  });

  it("should produce the same hash regardless of email case", async () => {
    const hashes: string[] = [];

    const neq2Fn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const neq1Fn = vi.fn(() => ({ neq: neq2Fn }));
    const eqFn = vi.fn((field: string, value: string) => {
      if (field === "email_hash") hashes.push(value);
      return { neq: neq1Fn };
    });
    const deleteFn = vi.fn(() => ({ eq: eqFn }));

    mockFromImpl = () => ({ delete: deleteFn });

    await clearLockoutForAllIps("User@Example.COM");
    await clearLockoutForAllIps("user@example.com");

    expect(hashes.length).toBe(2);
    expect(hashes[0]).toBe(hashes[1]);
  });
});

// ─── recordPasswordResetAttempt — per-email and per-IP rate limiting ────────

describe("recordPasswordResetAttempt — per-email and per-IP rate limiting", () => {
  it("should return false when under per-email limit", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    // Per-email count: 1 (under 3)
    const emailGteFn = vi.fn(() => Promise.resolve({ count: 1, error: null }));
    const emailEq2Fn = vi.fn(() => ({ gte: emailGteFn }));
    const emailEq1Fn = vi.fn(() => ({ eq: emailEq2Fn }));
    // Per-IP count: 2 (under 10)
    const ipGteFn = vi.fn(() => Promise.resolve({ count: 2, error: null }));
    const ipEq2Fn = vi.fn(() => ({ gte: ipGteFn }));
    const ipEq1Fn = vi.fn(() => ({ eq: ipEq2Fn }));

    let selectCallCount = 0;
    const selectFn = vi.fn(() => {
      selectCallCount++;
      if (selectCallCount === 1) return { eq: emailEq1Fn };
      return { eq: ipEq1Fn };
    });

    mockFromImpl = () => ({
      select: selectFn,
      insert: insertFn
    });

    const result = await recordPasswordResetAttempt("user@example.com", "1.2.3.4");

    expect(result).toBe(false);
    // Should have inserted both per-email and per-IP rows
    expect(insertFn).toHaveBeenCalled();
  });

  it("should return true when per-email limit exceeded (3/hour)", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    // Per-email count: 3 (at limit)
    const emailGteFn = vi.fn(() => Promise.resolve({ count: 3, error: null }));
    const emailEq2Fn = vi.fn(() => ({ gte: emailGteFn }));
    const emailEq1Fn = vi.fn(() => ({ eq: emailEq2Fn }));
    const selectFn = vi.fn(() => ({ eq: emailEq1Fn }));

    mockFromImpl = () => ({
      select: selectFn,
      insert: insertFn
    });

    const result = await recordPasswordResetAttempt("user@example.com", "1.2.3.4");

    expect(result).toBe(true);
    // Should NOT insert — rate limited before insertion
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("should return true when per-IP limit exceeded (10/hour)", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    // Per-email count: 1 (under limit)
    const emailGteFn = vi.fn(() => Promise.resolve({ count: 1, error: null }));
    const emailEq2Fn = vi.fn(() => ({ gte: emailGteFn }));
    const emailEq1Fn = vi.fn(() => ({ eq: emailEq2Fn }));
    // Per-IP count: 10 (at limit)
    const ipGteFn = vi.fn(() => Promise.resolve({ count: 10, error: null }));
    const ipEq2Fn = vi.fn(() => ({ gte: ipGteFn }));
    const ipEq1Fn = vi.fn(() => ({ eq: ipEq2Fn }));

    let selectCallCount = 0;
    const selectFn = vi.fn(() => {
      selectCallCount++;
      if (selectCallCount === 1) return { eq: emailEq1Fn };
      return { eq: ipEq1Fn };
    });

    mockFromImpl = () => ({
      select: selectFn,
      insert: insertFn
    });

    const result = await recordPasswordResetAttempt("user@example.com", "1.2.3.4");

    expect(result).toBe(true);
    // Should NOT insert — rate limited before insertion
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("should insert both per-email and per-IP rows when not rate limited", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const emailGteFn = vi.fn(() => Promise.resolve({ count: 0, error: null }));
    const emailEq2Fn = vi.fn(() => ({ gte: emailGteFn }));
    const emailEq1Fn = vi.fn(() => ({ eq: emailEq2Fn }));
    const ipGteFn = vi.fn(() => Promise.resolve({ count: 0, error: null }));
    const ipEq2Fn = vi.fn(() => ({ gte: ipGteFn }));
    const ipEq1Fn = vi.fn(() => ({ eq: ipEq2Fn }));

    let selectCallCount = 0;
    const selectFn = vi.fn(() => {
      selectCallCount++;
      if (selectCallCount === 1) return { eq: emailEq1Fn };
      return { eq: ipEq1Fn };
    });

    mockFromImpl = () => ({
      select: selectFn,
      insert: insertFn
    });

    await recordPasswordResetAttempt("user@example.com", "1.2.3.4");

    // Should insert an array with both rows
    expect(insertFn).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ ip_address: "password_reset" }),
        expect.objectContaining({ ip_address: "password_reset_ip" })
      ])
    );
  });
});
