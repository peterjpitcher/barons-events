import { NextResponse } from "next/server";
import { fetchPlanningAnalytics } from "@/lib/events/planning-analytics";
import { getCurrentUserProfile } from "@/lib/profile";

const formatIcsDate = (isoString: string): string => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (value: number) => value.toString().padStart(2, "0");

  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
};

const escapeText = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }

  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
};

export async function GET() {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "central_planner") {
    return NextResponse.json(
      {
        error: "Planning analytics are limited to Central planners.",
      },
      { status: 403 }
    );
  }

  const analytics = await fetchPlanningAnalytics();
  const stamp = formatIcsDate(new Date().toISOString());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EventHub by Barons//Planning Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  analytics.calendarEvents.forEach((event) => {
    const start = formatIcsDate(event.startAt);
    const end = formatIcsDate(event.endAt);

    if (!start || !end) {
      return;
    }

    const summaryPrefix = event.conflict ? "Conflict · " : "";
    const summary = `${summaryPrefix}${event.title}`;
    const locationParts = [event.venueName, event.venueSpace].filter(Boolean);
    const descriptionParts = [
      `Status: ${event.status}`,
      event.assignedReviewerName
        ? `Reviewer: ${event.assignedReviewerName}`
        : null,
      event.conflict
        ? "⚠️ Venue-space conflict detected – review before confirming."
        : null,
    ].filter(Boolean);

    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@barons-events`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(descriptionParts.join("\\n"))}`,
      `LOCATION:${escapeText(locationParts.join(" · "))}`,
      "END:VEVENT"
    );
  });

  lines.push("END:VCALENDAR", "");

  const body = lines.join("\r\n");

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="planning-feed.ics"',
    },
  });
}
