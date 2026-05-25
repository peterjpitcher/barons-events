import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn(),
  createSupabaseReadonlyClient: vi.fn()
}));

import { createSupabaseActionClient } from "@/lib/supabase/server";
import { upsertVenueOpeningHours, type UpsertHoursInput } from "@/lib/opening-hours";

const mockCreateSupabaseActionClient = vi.mocked(createSupabaseActionClient);

function makeRows(): UpsertHoursInput[] {
  return [
    {
      service_type_id: "pizza-service",
      day_of_week: 0,
      open_time: "12:00",
      close_time: "21:00",
      availability: "open",
      has_service: true
    },
    {
      service_type_id: "carvery-service",
      day_of_week: 0,
      open_time: "12:00",
      close_time: "16:00",
      availability: "open",
      has_service: true
    }
  ];
}

function setupDb() {
  const builders: Record<string, any[]> = {};

  function makeBuilder(table: string) {
    const builder: any = {
      delete: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      insert: vi.fn().mockResolvedValue({ error: null }),
      then: (resolve: (value: { error: null }) => void) => resolve({ error: null })
    };
    builders[table] = builders[table] ?? [];
    builders[table].push(builder);
    return builder;
  }

  const db = {
    from: vi.fn((table: string) => makeBuilder(table))
  };

  mockCreateSupabaseActionClient.mockResolvedValue(db as any);
  return { db, builders };
}

describe("upsertVenueOpeningHours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes destructive replacement to selected service types", async () => {
    const { builders } = setupDb();

    await upsertVenueOpeningHours("venue-1", makeRows(), {
      serviceTypeIds: ["pizza-service"]
    });

    expect(builders.venue_opening_hours[0].in).toHaveBeenCalledWith("service_type_id", ["pizza-service"]);
    expect(builders.venue_services[0].in).toHaveBeenCalledWith("service_type_id", ["pizza-service"]);
    expect(builders.venue_services[1].insert).toHaveBeenCalledWith([
      { venue_id: "venue-1", service_type_id: "pizza-service" }
    ]);
    expect(builders.venue_opening_hours[1].insert).toHaveBeenCalledWith([
      expect.objectContaining({
        venue_id: "venue-1",
        service_type_id: "pizza-service",
        open_time: "12:00",
        close_time: "21:00"
      })
    ]);
  });

  it("preserves full replacement when no service type scope is supplied", async () => {
    const { builders } = setupDb();

    await upsertVenueOpeningHours("venue-1", makeRows());

    expect(builders.venue_opening_hours[0].in).not.toHaveBeenCalled();
    expect(builders.venue_services[0].in).not.toHaveBeenCalled();
    expect(builders.venue_services[1].insert).toHaveBeenCalledWith([
      { venue_id: "venue-1", service_type_id: "pizza-service" },
      { venue_id: "venue-1", service_type_id: "carvery-service" }
    ]);
  });
});
