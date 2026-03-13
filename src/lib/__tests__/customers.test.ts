import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the service-role DB client and server-only
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("server-only", () => ({}));

import { listCustomersForUser, getCustomerById } from "../customers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppUser } from "@/lib/types";

const mockAdminClient = createSupabaseAdminClient as ReturnType<typeof vi.fn>;

const centralPlanner: AppUser = {
  id: "user-1",
  email: "planner@example.com",
  fullName: "Central Planner",
  role: "central_planner",
  venueId: null,
};

const venueManager: AppUser = {
  id: "user-2",
  email: "manager@example.com",
  fullName: "Venue Manager",
  role: "venue_manager",
  venueId: "venue-abc",
};

const sampleCustomerRow = {
  id: "cust-1",
  first_name: "Alice",
  last_name: "Smith",
  mobile: "+447700900001",
  email: "alice@example.com",
  marketing_opt_in: true,
  created_at: "2025-01-01T10:00:00Z",
  updated_at: "2025-01-02T10:00:00Z",
};

describe("listCustomersForUser", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("passes null venue_id to RPC for central_planner", async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null });
    mockAdminClient.mockReturnValue({ rpc: rpcMock });

    await listCustomersForUser(centralPlanner);

    expect(rpcMock).toHaveBeenCalledWith("list_customers_with_stats", {
      p_venue_id: null,
      p_search: null,
      p_opt_in_only: false,
    });
  });

  it("passes venueId to RPC for venue_manager", async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null });
    mockAdminClient.mockReturnValue({ rpc: rpcMock });

    await listCustomersForUser(venueManager);

    expect(rpcMock).toHaveBeenCalledWith("list_customers_with_stats", {
      p_venue_id: "venue-abc",
      p_search: null,
      p_opt_in_only: false,
    });
  });

  it("passes searchTerm and optInOnly to RPC params", async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null });
    mockAdminClient.mockReturnValue({ rpc: rpcMock });

    await listCustomersForUser(centralPlanner, { searchTerm: "Alice", optInOnly: true });

    expect(rpcMock).toHaveBeenCalledWith("list_customers_with_stats", {
      p_venue_id: null,
      p_search: "Alice",
      p_opt_in_only: true,
    });
  });

  it("returns CustomerWithStats array mapped from RPC result", async () => {
    const rpcRow = {
      ...sampleCustomerRow,
      booking_count: "3",
      ticket_count: "7",
      first_seen: "2024-12-01T09:00:00Z",
    };
    const rpcMock = vi.fn().mockResolvedValue({ data: [rpcRow], error: null });
    mockAdminClient.mockReturnValue({ rpc: rpcMock });

    const result = await listCustomersForUser(centralPlanner);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cust-1");
    expect(result[0].firstName).toBe("Alice");
    expect(result[0].bookingCount).toBe(3);
    expect(result[0].ticketCount).toBe(7);
    expect(result[0].firstSeen).toEqual(new Date("2024-12-01T09:00:00Z"));
  });

  it("uses createdAt as firstSeen when first_seen is null", async () => {
    const rpcRow = {
      ...sampleCustomerRow,
      booking_count: "1",
      ticket_count: "2",
      first_seen: null,
    };
    const rpcMock = vi.fn().mockResolvedValue({ data: [rpcRow], error: null });
    mockAdminClient.mockReturnValue({ rpc: rpcMock });

    const result = await listCustomersForUser(centralPlanner);

    expect(result[0].firstSeen).toEqual(new Date(sampleCustomerRow.created_at));
  });

  it("throws when RPC returns an error", async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "RPC boom" },
    });
    mockAdminClient.mockReturnValue({ rpc: rpcMock });

    await expect(listCustomersForUser(centralPlanner)).rejects.toThrow("RPC boom");
  });
});

describe("getCustomerById", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns null when customer not found", async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mockAdminClient.mockReturnValue({ from: () => selectChain });

    const result = await getCustomerById("nonexistent", centralPlanner);
    expect(result).toBeNull();
  });

  it("throws when customer query returns an error", async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
    };
    mockAdminClient.mockReturnValue({ from: () => selectChain });

    await expect(getCustomerById("cust-1", centralPlanner)).rejects.toThrow("DB error");
  });

  it("returns customer with bookings for central_planner", async () => {
    let callCount = 0;
    mockAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "customers") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: sampleCustomerRow, error: null }),
          };
        }
        // event_bookings
        callCount++;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: "booking-1",
                ticket_count: 2,
                status: "confirmed",
                created_at: "2025-02-01T12:00:00Z",
                events: {
                  id: "event-1",
                  title: "Test Event",
                  start_at: "2025-03-01T19:00:00Z",
                  venue_id: "venue-xyz",
                  venues: { id: "venue-xyz", name: "The Venue" },
                },
              },
            ],
            error: null,
          }),
        };
      },
    });

    const result = await getCustomerById("cust-1", centralPlanner);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("cust-1");
    expect(result!.bookings).toHaveLength(1);
    expect(result!.bookings[0].eventTitle).toBe("Test Event");
    expect(result!.bookings[0].venueName).toBe("The Venue");
    expect(callCount).toBe(1);
  });

  it("venue_manager: returns null when customer has no bookings at their venue", async () => {
    mockAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "customers") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: sampleCustomerRow, error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: "booking-1",
                ticket_count: 2,
                status: "confirmed",
                created_at: "2025-02-01T12:00:00Z",
                events: {
                  id: "event-1",
                  title: "Other Event",
                  start_at: "2025-03-01T19:00:00Z",
                  venue_id: "venue-different",   // not the manager's venue
                  venues: { id: "venue-different", name: "Other Venue" },
                },
              },
            ],
            error: null,
          }),
        };
      },
    });

    const result = await getCustomerById("cust-1", venueManager);
    expect(result).toBeNull();
  });

  it("venue_manager: filters bookings to own venue only", async () => {
    mockAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "customers") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: sampleCustomerRow, error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: "booking-1",
                ticket_count: 2,
                status: "confirmed",
                created_at: "2025-02-01T12:00:00Z",
                events: {
                  id: "event-1",
                  title: "Manager Venue Event",
                  start_at: "2025-03-01T19:00:00Z",
                  venue_id: "venue-abc",          // matches venueManager.venueId
                  venues: { id: "venue-abc", name: "Manager's Venue" },
                },
              },
              {
                id: "booking-2",
                ticket_count: 1,
                status: "confirmed",
                created_at: "2025-01-15T10:00:00Z",
                events: {
                  id: "event-2",
                  title: "Other Venue Event",
                  start_at: "2025-02-10T19:00:00Z",
                  venue_id: "venue-different",    // should be filtered out
                  venues: { id: "venue-different", name: "Other Venue" },
                },
              },
            ],
            error: null,
          }),
        };
      },
    });

    const result = await getCustomerById("cust-1", venueManager);

    expect(result).not.toBeNull();
    expect(result!.bookings).toHaveLength(1);
    expect(result!.bookings[0].id).toBe("booking-1");
    expect(result!.bookings[0].venueName).toBe("Manager's Venue");
  });
});
