import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the service-role DB client
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("server-only", () => ({}));

import { getConfirmedTicketCount } from "../bookings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

describe("getConfirmedTicketCount", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 0 when no bookings", async () => {
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    });
    const count = await getConfirmedTicketCount("event-1");
    expect(count).toBe(0);
  });

  it("sums ticket counts from confirmed bookings", async () => {
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({
              data: [{ ticket_count: 3 }, { ticket_count: 5 }],
              error: null,
            }),
          }),
        }),
      }),
    });
    const count = await getConfirmedTicketCount("event-1");
    expect(count).toBe(8);
  });

  it("throws on DB error", async () => {
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: { message: "DB error" } }),
          }),
        }),
      }),
    });
    await expect(getConfirmedTicketCount("event-1")).rejects.toThrow("DB error");
  });
});
