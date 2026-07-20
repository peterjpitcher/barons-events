import { describe, it, expect, vi, beforeEach } from "vitest";

const actionFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn(async () => ({ from: actionFrom })),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ recordAuditLogEntry: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getCurrentUser } from "@/lib/auth";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { createCalendarNote, updateCalendarNote, deleteCalendarNote } from "@/actions/calendar-notes";

const mockUser = vi.mocked(getCurrentUser);
const mockAudit = vi.mocked(recordAuditLogEntry);

const admin = { id: "u1", email: "a@b.c", fullName: "A", role: "administrator" as const, venueId: null, deactivatedAt: null };
const mgrA = { ...admin, id: "u2", role: "manager" as const, venueId: "v-a" };
const VENUE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENUE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOTE_ID = "11111111-1111-4111-8111-111111111111";
const valid = { venueId: VENUE_A, title: "Wedding", startDate: "2026-08-01" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockUser.mockResolvedValue(admin);
});

describe("createCalendarNote", () => {
  it("creates and audits", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: NOTE_ID, venue_id: VENUE_A, updated_at: "t" }, error: null });
    actionFrom.mockReturnValue({ insert: () => ({ select: () => ({ single }) }) });
    const result = await createCalendarNote(valid);
    expect(result.success).toBe(true);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ entity: "calendar_note", action: "calendar_note.created" }));
  });

  it("denies a manager creating for another venue", async () => {
    mockUser.mockResolvedValue(mgrA);
    const result = await createCalendarNote({ ...valid, venueId: VENUE_B });
    expect(result.success).toBe(false);
    expect(actionFrom).not.toHaveBeenCalled();
  });

  it("rejects invalid input with field errors", async () => {
    const result = await createCalendarNote({ ...valid, title: "  " });
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.title).toBeTruthy();
  });
});

describe("updateCalendarNote", () => {
  const patch = { id: NOTE_ID, venueId: VENUE_A, title: "New", startDate: "2026-08-01", expectedUpdatedAt: "t0" };

  function mockLoad(row: unknown) {
    // first from(): load existing row
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    actionFrom.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle }) }) });
  }

  it("updates when the concurrency token matches", async () => {
    mockLoad({ id: NOTE_ID, venue_id: VENUE_A, deleted_at: null, updated_at: "t0" });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: NOTE_ID, venue_id: VENUE_A, updated_at: "t1" }, error: null });
    actionFrom.mockReturnValueOnce({ update: () => ({ eq: () => ({ is: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }) }) }) });
    const result = await updateCalendarNote(patch);
    expect(result.success).toBe(true);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "calendar_note.updated" }));
  });

  it("returns a conflict when the token is stale", async () => {
    mockLoad({ id: NOTE_ID, venue_id: VENUE_A, deleted_at: null, updated_at: "t0" });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null }); // predicate matched nothing
    actionFrom.mockReturnValueOnce({ update: () => ({ eq: () => ({ is: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }) }) }) });
    // re-read shows the row still exists
    const reread = vi.fn().mockResolvedValue({ data: { id: NOTE_ID, deleted_at: null }, error: null });
    actionFrom.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: reread }) }) });
    const result = await updateCalendarNote(patch);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/changed/i);
  });

  it("denies a manager updating another venue's note", async () => {
    mockUser.mockResolvedValue(mgrA);
    mockLoad({ id: NOTE_ID, venue_id: VENUE_B, deleted_at: null, updated_at: "t0" });
    const result = await updateCalendarNote({ ...patch, venueId: VENUE_B });
    expect(result.success).toBe(false);
  });

  it("reports not found when the row is missing", async () => {
    mockLoad(null);
    const result = await updateCalendarNote(patch);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });
});

describe("deleteCalendarNote", () => {
  it("soft-deletes and audits", async () => {
    const maybeSingleLoad = vi.fn().mockResolvedValue({ data: { id: NOTE_ID, venue_id: VENUE_A, deleted_at: null, updated_at: "t0" }, error: null });
    actionFrom.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: maybeSingleLoad }) }) });
    const maybeSingleDel = vi.fn().mockResolvedValue({ data: { id: NOTE_ID }, error: null });
    actionFrom.mockReturnValueOnce({ update: () => ({ eq: () => ({ is: () => ({ eq: () => ({ select: () => ({ maybeSingle: maybeSingleDel }) }) }) }) }) });
    const result = await deleteCalendarNote({ id: NOTE_ID, expectedUpdatedAt: "t0" });
    expect(result.success).toBe(true);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "calendar_note.deleted" }));
  });
});
