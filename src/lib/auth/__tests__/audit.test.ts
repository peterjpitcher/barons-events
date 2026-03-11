import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mock state ─────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file by Vitest's transform,
// so any variables they reference must also be hoisted via vi.hoisted().

const { insertedRows, mockInsert, mockFrom } = vi.hoisted(() => {
  const insertedRows: unknown[] = [];
  const mockInsert = vi.fn().mockImplementation((row: unknown) => {
    insertedRows.push(row);
    return Promise.resolve({ data: null, error: null });
  });
  const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });
  return { insertedRows, mockInsert, mockFrom };
});

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn().mockReturnValue({
    from: mockFrom
  })
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import { logAuthEvent, hashEmailForAudit } from "@/lib/audit-log";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Returns the last captured insert payload (cast for convenience). */
function lastInserted(): Record<string, unknown> {
  return insertedRows[insertedRows.length - 1] as Record<string, unknown>;
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe("logAuthEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows.length = 0;
    // Re-apply the insert implementation after clearAllMocks wipes it
    mockInsert.mockImplementation((row: unknown) => {
      insertedRows.push(row);
      return Promise.resolve({ data: null, error: null });
    });
    mockFrom.mockReturnValue({ insert: mockInsert });
  });

  // 1. auth.login.success
  it("should insert with entity='auth' and action='auth.login.success'", async () => {
    await logAuthEvent({ event: "auth.login.success", userId: "user-1" });

    expect(mockFrom).toHaveBeenCalledWith("audit_log");
    expect(mockInsert).toHaveBeenCalledOnce();

    const row = lastInserted();
    expect(row).toMatchObject({
      entity: "auth",
      action: "auth.login.success",
      actor_id: "user-1",
      entity_id: "user-1"
    });
  });

  // 2. auth.login.failure — emailHash in meta, NOT plaintext email
  it("should include emailHash in meta for auth.login.failure (never plaintext email)", async () => {
    const emailHash = await hashEmailForAudit("fail@example.com");
    await logAuthEvent({
      event: "auth.login.failure",
      emailHash,
      ipAddress: "1.2.3.4"
    });

    const row = lastInserted();
    expect(row).toMatchObject({ entity: "auth", action: "auth.login.failure" });

    const meta = (row as { meta: Record<string, unknown> }).meta;
    expect(meta).not.toHaveProperty("email");
    expect(meta.email_hash).toBe(emailHash);
    expect(meta.ip_address).toBe("1.2.3.4");
  });

  // 3. auth.lockout — emailHash + ipAddress in meta
  it("should include emailHash and ipAddress in meta for auth.lockout", async () => {
    const emailHash = await hashEmailForAudit("locked@example.com");
    await logAuthEvent({
      event: "auth.lockout",
      emailHash,
      ipAddress: "10.0.0.1"
    });

    const row = lastInserted();
    expect(row).toMatchObject({ entity: "auth", action: "auth.lockout" });

    const meta = (row as { meta: Record<string, unknown> }).meta;
    expect(meta.email_hash).toBe(emailHash);
    expect(meta.ip_address).toBe("10.0.0.1");
  });

  // 4. auth.logout
  it("should insert correctly for auth.logout", async () => {
    await logAuthEvent({ event: "auth.logout", userId: "user-2" });

    const row = lastInserted();
    expect(row).toMatchObject({
      entity: "auth",
      action: "auth.logout",
      actor_id: "user-2"
    });
  });

  // 5. auth.password_reset.requested
  it("should insert correctly for auth.password_reset.requested", async () => {
    await logAuthEvent({
      event: "auth.password_reset.requested",
      ipAddress: "5.6.7.8"
    });

    const row = lastInserted();
    expect(row).toMatchObject({ entity: "auth", action: "auth.password_reset.requested" });

    const meta = (row as { meta: Record<string, unknown> }).meta;
    expect(meta.ip_address).toBe("5.6.7.8");
  });

  // 6. auth.password_updated
  it("should insert correctly for auth.password_updated", async () => {
    await logAuthEvent({ event: "auth.password_updated", userId: "user-3" });

    const row = lastInserted();
    expect(row).toMatchObject({
      entity: "auth",
      action: "auth.password_updated",
      actor_id: "user-3"
    });
  });

  // 7. auth.invite.sent — emailHash in meta
  it("should include emailHash in meta for auth.invite.sent", async () => {
    const emailHash = await hashEmailForAudit("invitee@example.com");
    await logAuthEvent({
      event: "auth.invite.sent",
      userId: "admin-1",
      emailHash,
      meta: { role: "reviewer" }
    });

    const row = lastInserted();
    expect(row).toMatchObject({ entity: "auth", action: "auth.invite.sent", actor_id: "admin-1" });

    const meta = (row as { meta: Record<string, unknown> }).meta;
    expect(meta.email_hash).toBe(emailHash);
    expect(meta.role).toBe("reviewer");
  });

  // 8. auth.invite.accepted
  it("should insert correctly for auth.invite.accepted", async () => {
    await logAuthEvent({ event: "auth.invite.accepted", userId: "new-user-1" });

    const row = lastInserted();
    expect(row).toMatchObject({
      entity: "auth",
      action: "auth.invite.accepted",
      actor_id: "new-user-1"
    });
  });

  // 9. auth.role.changed — oldRole + newRole in meta
  it("should include oldRole and newRole in meta for auth.role.changed", async () => {
    await logAuthEvent({
      event: "auth.role.changed",
      userId: "admin-1",
      meta: { oldRole: "viewer", newRole: "editor", targetUserId: "user-x" }
    });

    const row = lastInserted();
    const meta = (row as { meta: Record<string, unknown> }).meta;
    expect(meta.oldRole).toBe("viewer");
    expect(meta.newRole).toBe("editor");
    expect(meta.targetUserId).toBe("user-x");
  });

  // 10. auth.session.expired.idle
  it("should insert correctly for auth.session.expired.idle", async () => {
    await logAuthEvent({ event: "auth.session.expired.idle", userId: "user-4" });

    const row = lastInserted();
    expect(row).toMatchObject({ entity: "auth", action: "auth.session.expired.idle" });
  });

  // 11. auth.session.expired.absolute
  it("should insert correctly for auth.session.expired.absolute", async () => {
    await logAuthEvent({ event: "auth.session.expired.absolute", userId: "user-5" });

    const row = lastInserted();
    expect(row).toMatchObject({ entity: "auth", action: "auth.session.expired.absolute" });
  });

  // 12. hashEmailForAudit — consistent output; different inputs → different hashes
  it("should produce consistent SHA-256 output (same input → same hash, different inputs → different hashes)", async () => {
    const hash1 = await hashEmailForAudit("alice@example.com");
    const hash2 = await hashEmailForAudit("alice@example.com");
    const hash3 = await hashEmailForAudit("bob@example.com");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });

  // 13. hashEmailForAudit — normalises to lowercase before hashing
  it("should normalise email to lowercase before hashing (mixed-case same as lowercase)", async () => {
    const lower = await hashEmailForAudit("test@example.com");
    const mixed = await hashEmailForAudit("Test@Example.com");
    const upper = await hashEmailForAudit("TEST@EXAMPLE.COM");

    expect(lower).toBe(mixed);
    expect(lower).toBe(upper);
  });

  // 14. email_hash is a 64-char hex string (SHA-256 output)
  it("should return a 64-character lowercase hex string (SHA-256 output)", async () => {
    const emailHash = await hashEmailForAudit("check@example.com");

    expect(emailHash).toHaveLength(64);
    expect(emailHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // 15. logAuthEvent does NOT throw on DB error — fire-and-forget
  it("should not throw when the DB insert throws (errors are swallowed and logged to console.error)", async () => {
    mockInsert.mockRejectedValueOnce(new Error("DB connection lost"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      logAuthEvent({ event: "auth.login.success", userId: "user-safe" })
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Auth audit log failed:"),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});
