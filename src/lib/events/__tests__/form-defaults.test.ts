import { describe, expect, it } from "vitest";
import { deriveEventFormVenueDefaults } from "@/lib/events/form-defaults";

describe("deriveEventFormVenueDefaults", () => {
  const availableVenueIds = ["venue-a", "venue-b", "venue-c"];

  it("leaves direct create forms blank", () => {
    expect(
      deriveEventFormVenueDefaults({
        mode: "create",
        availableVenueIds
      })
    ).toEqual({ primaryVenueId: "", selectedVenueIds: [] });
  });

  it("preselects an explicit valid create venue", () => {
    expect(
      deriveEventFormVenueDefaults({
        mode: "create",
        initialVenueId: "venue-b",
        availableVenueIds
      })
    ).toEqual({ primaryVenueId: "venue-b", selectedVenueIds: ["venue-b"] });
  });

  it("ignores invalid explicit create venues", () => {
    expect(
      deriveEventFormVenueDefaults({
        mode: "create",
        initialVenueId: "missing-venue",
        availableVenueIds
      })
    ).toEqual({ primaryVenueId: "", selectedVenueIds: [] });
  });

  it("preserves every attached edit venue, primary first", () => {
    expect(
      deriveEventFormVenueDefaults({
        mode: "edit",
        eventVenueId: "venue-a",
        eventVenues: [{ id: "venue-a" }, { id: "venue-c" }, { id: "venue-b" }],
        availableVenueIds
      })
    ).toEqual({
      primaryVenueId: "venue-a",
      selectedVenueIds: ["venue-a", "venue-c", "venue-b"]
    });
  });

  it("falls back to the scalar edit venue when attachments are absent", () => {
    expect(
      deriveEventFormVenueDefaults({
        mode: "edit",
        eventVenueId: "venue-c",
        eventVenues: null,
        availableVenueIds
      })
    ).toEqual({ primaryVenueId: "venue-c", selectedVenueIds: ["venue-c"] });
  });
});
