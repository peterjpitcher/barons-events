import { describe, expect, it } from "vitest";
import {
  buildCalendarEvents,
  buildPlanningFeed,
  detectVenueConflicts,
  summariseReviewerSla,
  summariseStatusCounts,
  type EventSummary,
} from "./analytics";

const baseEvent = (overrides: Partial<EventSummary> = {}): EventSummary => ({
  id: "event-id",
  title: "Base Event",
  status: "draft",
  startAt: "2025-05-01T18:00:00Z",
  endAt: "2025-05-01T20:00:00Z",
  venueId: "venue-1",
  venueName: "Main Venue",
  venueSpace: "Main Bar",
  assignedReviewerId: null,
  ...overrides,
});

describe("summariseStatusCounts", () => {
  it("aggregates status counts across events", () => {
    const counts = summariseStatusCounts([
      baseEvent({ status: "draft" }),
      baseEvent({ id: "b", status: "draft" }),
      baseEvent({ id: "c", status: "submitted" }),
    ]);

    expect(counts).toEqual({
      draft: 2,
      submitted: 1,
    });
  });

  it("returns empty object when no events are supplied", () => {
    expect(summariseStatusCounts([])).toEqual({});
  });
});

describe("detectVenueConflicts", () => {
  it("identifies overlaps within the same venue space", () => {
    const conflicts = detectVenueConflicts([
      baseEvent({
        id: "one",
        startAt: "2025-05-10T18:00:00Z",
        endAt: "2025-05-10T20:00:00Z",
      }),
      baseEvent({
        id: "two",
        startAt: "2025-05-10T19:30:00Z",
        endAt: "2025-05-10T21:00:00Z",
      }),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      venueName: "Main Venue",
      venueSpace: "Main Bar",
      first: { id: "one" },
      second: { id: "two" },
    });
  });

  it("ignores events in different venue spaces", () => {
    const conflicts = detectVenueConflicts([
      baseEvent({
        id: "one",
        venueSpace: "Main Bar",
        startAt: "2025-05-10T18:00:00Z",
      }),
      baseEvent({
        id: "two",
        venueSpace: "Garden",
        startAt: "2025-05-10T18:30:00Z",
      }),
    ]);

    expect(conflicts).toHaveLength(0);
  });

  it("derives a default end time when missing", () => {
    const conflicts = detectVenueConflicts([
      baseEvent({
        id: "one",
        startAt: "2025-05-11T18:00:00Z",
        endAt: null,
      }),
      baseEvent({
        id: "two",
        startAt: "2025-05-11T19:30:00Z",
        endAt: "2025-05-11T21:00:00Z",
      }),
    ]);

    expect(conflicts).toHaveLength(1);
  });

  it("ignores overlapping events when they reserve different areas", () => {
    const conflicts = detectVenueConflicts([
      baseEvent({
        id: "one",
        startAt: "2025-06-01T18:00:00Z",
        endAt: "2025-06-01T19:30:00Z",
        venueSpace: null,
        areas: [{ id: "area-a", name: "Snug", capacity: 40 }],
      }),
      baseEvent({
        id: "two",
        startAt: "2025-06-01T18:30:00Z",
        endAt: "2025-06-01T20:00:00Z",
        venueSpace: null,
        areas: [{ id: "area-b", name: "Garden", capacity: 80 }],
      }),
    ]);

    expect(conflicts).toHaveLength(0);
  });

  it("flags conflicts when events share at least one reserved area", () => {
    const conflicts = detectVenueConflicts([
      baseEvent({
        id: "one",
        startAt: "2025-06-02T18:00:00Z",
        endAt: "2025-06-02T20:00:00Z",
        venueSpace: null,
        areas: [
          { id: "area-a", name: "Main Bar", capacity: 120 },
          { id: "area-b", name: "Garden", capacity: 80 },
        ],
      }),
      baseEvent({
        id: "two",
        startAt: "2025-06-02T19:00:00Z",
        endAt: "2025-06-02T21:00:00Z",
        venueSpace: null,
        areas: [{ id: "area-b", name: "Garden", capacity: 80 }],
      }),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      venueSpace: "Garden",
      first: expect.objectContaining({ id: "one" }),
      second: expect.objectContaining({ id: "two" }),
    });
  });
});

describe("buildPlanningFeed", () => {
  it("sorts by start time and limits results", () => {
    const feed = buildPlanningFeed(
      [
        baseEvent({
          id: "late",
          startAt: "2025-05-12T20:00:00Z",
        }),
        baseEvent({
          id: "early",
          startAt: "2025-05-10T18:00:00Z",
        }),
        baseEvent({
          id: "middle",
          startAt: "2025-05-11T18:00:00Z",
        }),
      ],
      2
    );

    expect(feed.map((event) => event.id)).toEqual(["early", "middle"]);
  });

  it("skips events without valid start timestamps", () => {
    const feed = buildPlanningFeed([
      baseEvent({
        id: "valid",
      }),
      baseEvent({
        id: "invalid",
        startAt: null,
      }),
      baseEvent({
        id: "broken",
        startAt: "not-a-date",
      }),
    ]);

    expect(feed.map((event) => event.id)).toEqual(["valid"]);
  });
});

describe("buildCalendarEvents", () => {
  it("produces calendar entries with conflict metadata", () => {
    const events = [
      baseEvent({
        id: "conflicted",
        startAt: "2025-05-12T18:00:00Z",
        endAt: null,
      }),
      baseEvent({
        id: "clean",
        startAt: "2025-05-13T18:00:00Z",
        endAt: "2025-05-13T20:00:00Z",
      }),
      baseEvent({
        id: "missing-start",
        startAt: null,
      }),
    ];

    const calendar = buildCalendarEvents(events, new Set(["conflicted"]));

    expect(calendar).toHaveLength(2);
    const conflictedEvent = calendar.find((item) => item.id === "conflicted");
    const cleanEvent = calendar.find((item) => item.id === "clean");

    expect(conflictedEvent).toBeDefined();
    expect(conflictedEvent?.conflict).toBe(true);
    expect(conflictedEvent?.endAt).toBe("2025-05-12T20:00:00.000Z"); // default duration applied

    expect(cleanEvent).toBeDefined();
    expect(cleanEvent?.conflict).toBe(false);
    expect(cleanEvent?.endAt).toBe("2025-05-13T20:00:00.000Z");
  });
});

describe("summariseReviewerSla", () => {
  it("groups submissions by reviewer and buckets urgency", () => {
    const now = new Date("2025-05-01T00:00:00.000Z");
    const events: EventSummary[] = [
      baseEvent({
        id: "on-track",
        status: "submitted",
        assignedReviewerId: "rev-1",
        assignedReviewerName: "Rita Reviewer",
        startAt: "2025-05-05T00:00:00.000Z",
      }),
      baseEvent({
        id: "warning",
        status: "submitted",
        assignedReviewerId: "rev-1",
        assignedReviewerName: "Rita Reviewer",
        startAt: "2025-05-02T00:00:00.000Z",
      }),
      baseEvent({
        id: "overdue",
        status: "submitted",
        assignedReviewerId: "rev-2",
        assignedReviewerName: "Oscar Overwatch",
        startAt: "2025-04-29T00:00:00.000Z",
      }),
      baseEvent({
        id: "ignored",
        status: "draft",
        assignedReviewerId: "rev-1",
        assignedReviewerName: "Rita Reviewer",
        startAt: "2025-05-01T12:00:00.000Z",
      }),
      baseEvent({
        id: "missing-date",
        status: "submitted",
        assignedReviewerId: "rev-1",
        assignedReviewerName: "Rita Reviewer",
        startAt: null,
      }),
    ];

    const snapshot = summariseReviewerSla(events, now);

    expect(snapshot).toHaveLength(2);

    const rita = snapshot.find((entry) => entry.reviewerId === "rev-1");
    const oscar = snapshot.find((entry) => entry.reviewerId === "rev-2");

    expect(rita).toMatchObject({
      reviewerName: "Rita Reviewer",
      totalAssigned: 2,
      onTrack: 1,
      warning: 1,
      overdue: 0,
      nextDueAt: "2025-05-02T00:00:00.000Z",
    });

    expect(oscar).toMatchObject({
      reviewerName: "Oscar Overwatch",
      totalAssigned: 1,
      onTrack: 0,
      warning: 0,
      overdue: 1,
    });
  });
});
