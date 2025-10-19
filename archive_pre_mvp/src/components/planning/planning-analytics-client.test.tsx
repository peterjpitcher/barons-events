import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanningAnalyticsClient } from "@/components/planning/planning-analytics-client";

vi.mock("swr", () => ({
  __esModule: true,
  default: vi.fn(),
}));

const useSWR = vi.mocked((await import("swr")).default);

const buildInitialData = (
  overrides: Partial<Parameters<typeof PlanningAnalyticsClient>[0]["initialData"]> = {}
) => ({
  statusCounts: {},
  conflicts: [],
  upcoming: [],
  awaitingReviewer: [],
  totalEvents: 0,
  calendarEvents: [],
  reviewerSla: [],
  slaWarningQueued: 0,
  metadata: undefined,
  ...overrides,
});

describe.sequential("PlanningAnalyticsClient", () => {
  beforeEach(() => {
    useSWR.mockReset();
  });

  it("renders seeded dataset guidance when no events are present", () => {
    useSWR.mockReturnValue({
      data: undefined,
      error: null,
    });

    const markup = renderToStaticMarkup(
      <PlanningAnalyticsClient initialData={buildInitialData()} />
    );

    expect(markup).toContain("No events in the planning feed yet");
    expect(markup).toContain("The dashboard populates automatically as events start flowing in.");
  });

  it("shows response tiles and calendar download link when analytics data exists", () => {
    useSWR.mockReturnValue({
      data: undefined,
      error: null,
    });

    const markup = renderToStaticMarkup(
      <PlanningAnalyticsClient
        initialData={buildInitialData({
          statusCounts: { submitted: 2 },
          conflicts: [
            {
              key: "conflict-1",
              venueName: "Barons Wharf",
              venueSpace: "Main Hall",
              first: {
                id: "event-1",
                title: "Quiz Night",
                status: "submitted",
                startAt: "2025-05-01T18:00:00.000Z",
                venueName: "Barons Wharf",
                venueSpace: "Main Hall",
              },
              second: {
                id: "event-2",
                title: "Live Music",
                status: "submitted",
                startAt: "2025-05-01T19:00:00.000Z",
                venueName: "Barons Wharf",
                venueSpace: "Main Hall",
              },
            },
          ],
          upcoming: [
            {
              id: "event-3",
              title: "Tasting Evening",
              status: "approved",
              startAt: "2025-05-02T18:00:00.000Z",
              venueName: "Barons Wharf",
              venueSpace: "Cellar",
            },
          ],
          totalEvents: 3,
          calendarEvents: [
            {
              id: "event-1",
              title: "Quiz Night",
              status: "submitted",
              startAt: "2025-05-01T18:00:00.000Z",
              endAt: "2025-05-01T20:00:00.000Z",
              venueName: "Barons Wharf",
              venueSpace: "Main Hall",
              conflict: true,
              assignedReviewerId: "rev-1",
              assignedReviewerName: "Rita Reviewer",
            },
          ],
          reviewerSla: [
            {
              reviewerId: "rev-1",
              reviewerName: "Rita Reviewer",
              totalAssigned: 1,
              onTrack: 0,
              warning: 1,
              overdue: 0,
              nextDueAt: "2025-05-01T18:00:00.000Z",
            },
          ],
          slaWarningQueued: 2,
          metadata: {
            calendarFeedUrl: "/api/planning-feed/calendar",
            generatedAt: "2025-05-01T09:00:00.000Z",
          },
        })}
      />
    );

    expect(markup).toContain("Reviewer response trend");
    expect(markup).toContain("Download calendar file");
    expect(markup).toContain("Rita Reviewer");
    expect(markup).toContain("Snapshot generated");
    expect(markup).toContain("Reminder emails queued");
    expect(markup).toContain("View event detail");
    expect(markup).toContain("Open timeline");
    expect(markup).toContain('href="/events/event-1?source=conflict#timeline"');
    expect(markup).toContain('href="/events/event-1?source=planning"');
    expect(markup).toContain('href="/events/event-3?source=planning"');
  });

  it("surfaces cached data warning when refresh fails", () => {
    useSWR.mockReturnValue({
      data: undefined,
      error: new Error("boom"),
    });

    const markup = renderToStaticMarkup(
      <PlanningAnalyticsClient
        initialData={buildInitialData({
          totalEvents: 1,
          statusCounts: { submitted: 1 },
          upcoming: [
            {
              id: "event-1",
              title: "Quiz Night",
              status: "submitted",
              startAt: "2025-05-01T18:00:00.000Z",
              venueName: "Barons Wharf",
              venueSpace: "Main Hall",
            },
          ],
        })}
      />
    );

    expect(markup).toContain("Unable to refresh analytics from the API");
  });
});
