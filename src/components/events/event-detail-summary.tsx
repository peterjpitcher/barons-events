import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseVenueSpaces } from "@/lib/venue-spaces";
import { EVENT_GOALS_BY_VALUE, humanizeGoalValue, parseGoalFocus } from "@/lib/event-goals";
import type { EventDetail } from "@/lib/events";
import { formatCurrency } from "@/lib/utils/format";

const formatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London"
});

const cutoffTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London"
});

const bookingTypeLabel: Record<string, string> = {
  ticketed: "Ticketed event",
  table_booking: "Table booking event",
  free_entry: "Free entry",
  mixed: "Mixed booking model"
};

function buildEventImageUrl(path: string | null | undefined): string | null {
  if (!path || !path.trim().length) return null;
  const base =
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string"
      ? process.env.NEXT_PUBLIC_SUPABASE_URL.trim().replace(/\/+$/g, "")
      : "";
  if (!base.length) return null;
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/storage/v1/object/public/event-images/${encodedPath}`;
}

function formatCheckInCutoffLabel(startAt: string, cutoffMinutes: number | null): string | null {
  if (cutoffMinutes === null || cutoffMinutes === undefined || cutoffMinutes < 0) return null;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) {
    return `${cutoffMinutes} minute${cutoffMinutes === 1 ? "" : "s"} before start`;
  }
  const cutoff = new Date(start.getTime() - cutoffMinutes * 60 * 1000);
  return `${cutoffMinutes} minute${cutoffMinutes === 1 ? "" : "s"} before start (${cutoffTimeFormatter.format(cutoff)})`;
}

type EventDetailSummaryProps = {
  event: EventDetail;
};

export function EventDetailSummary({ event }: EventDetailSummaryProps) {
  const venueSpaces = parseVenueSpaces(event.venue_space);
  const goalValues = parseGoalFocus(event.goal_focus);
  const goalDetails = Array.from(new Set(goalValues)).map((value) => {
    const config = EVENT_GOALS_BY_VALUE[value];
    return {
      value,
      label: config?.label ?? humanizeGoalValue(value),
      helper: config?.helper ?? null
    };
  });
  const hasGoalDetails = goalDetails.length > 0;
  const publicHighlights = Array.isArray(event.public_highlights)
    ? event.public_highlights
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/^\s*[-*•]\s*/, "").trim())
        .filter(Boolean)
    : [];
  const artistNames = (Array.isArray(event.artists) ? event.artists : [])
    .map((entry) => entry.artist?.name?.trim())
    .filter((name): name is string => Boolean(name && name.length));
  const eventImageUrl = buildEventImageUrl(event.event_image_path);
  const checkInCutoffLabel = formatCheckInCutoffLabel(event.start_at, event.check_in_cutoff_minutes);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event details</CardTitle>
        <CardDescription>Core context for planners, reviewers, and venue teams.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted">
        {eventImageUrl ? (
          <div className="space-y-2">
            <p className="font-semibold text-[var(--color-text)]">Event image</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- external event image URL, not suitable for next/image optimisation */}
            <img
              src={eventImageUrl}
              alt={`${event.title} event image`}
              className="max-h-80 w-full rounded-[var(--radius)] border border-[var(--color-border)] object-cover"
            />
          </div>
        ) : null}
        {event.notes ? (
          <div className="space-y-1 text-[var(--color-text)]">
            <p className="font-semibold">Notes</p>
            <p className="whitespace-pre-wrap text-sm text-subtle">{event.notes}</p>
          </div>
        ) : null}
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <p>
            <span className="font-semibold text-[var(--color-text)]">Type:</span> {event.event_type}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">
              {venueSpaces.length > 1 ? "Spaces" : "Space"}:
            </span>{" "}
            {venueSpaces.length ? venueSpaces.join(", ") : "Not specified"}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">Start:</span>{" "}
            {formatter.format(new Date(event.start_at))}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">End:</span>{" "}
            {formatter.format(new Date(event.end_at))}
          </p>
          {event.expected_headcount ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Headcount:</span>{" "}
              {event.expected_headcount}
            </p>
          ) : null}
          {event.wet_promo ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Wet promo:</span>{" "}
              {event.wet_promo}
            </p>
          ) : null}
          {event.food_promo ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Food promo:</span>{" "}
              {event.food_promo}
            </p>
          ) : null}
          {event.booking_type ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Booking format:</span>{" "}
              {bookingTypeLabel[event.booking_type] ?? event.booking_type}
            </p>
          ) : null}
          {event.ticket_price != null ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Ticket price:</span> £
              {event.ticket_price.toFixed(2)}
            </p>
          ) : null}
          {checkInCutoffLabel ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Last admission/check-in:</span>{" "}
              {checkInCutoffLabel}
            </p>
          ) : null}
          {event.cancellation_window_hours != null ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Cancellation/refund window:</span>{" "}
              {event.cancellation_window_hours} hour{event.cancellation_window_hours === 1 ? "" : "s"}
            </p>
          ) : null}
          {event.age_policy ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Age policy:</span>{" "}
              {event.age_policy}
            </p>
          ) : null}
          {artistNames.length ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">
                {artistNames.length > 1 ? "Artists / hosts" : "Artist / host"}:
              </span>{" "}
              {artistNames.join(", ")}
            </p>
          ) : null}
          {event.cost_total != null ? (
            <p>
              <span className="font-semibold text-[var(--color-text)]">Cost:</span>{" "}
              {formatCurrency(event.cost_total)}
              {event.cost_details ? (
                <span className="block text-xs text-subtle mt-1">{event.cost_details}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        {event.accessibility_notes ? (
          <div className="space-y-1 text-[var(--color-text)]">
            <p className="font-semibold">Accessibility notes</p>
            <p className="whitespace-pre-wrap text-sm text-subtle">{event.accessibility_notes}</p>
          </div>
        ) : null}
        {event.terms_and_conditions ? (
          <div className="space-y-1 text-[var(--color-text)]">
            <p className="font-semibold">Terms & conditions</p>
            <p className="whitespace-pre-wrap text-sm text-subtle">{event.terms_and_conditions}</p>
          </div>
        ) : null}
        {publicHighlights.length ? (
          <div className="space-y-2 text-[var(--color-text)]">
            <p className="font-semibold">Event highlights</p>
            <ul className="space-y-1 text-sm text-subtle">
              {publicHighlights.map((highlight, index) => (
                <li key={`${event.id}-highlight-${index}`} className="flex items-start gap-2">
                  <span
                    className="mt-[0.35rem] h-1.5 w-1.5 flex-none rounded-full bg-[var(--color-primary-400)]"
                    aria-hidden="true"
                  />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {hasGoalDetails ? (
          <div className="space-y-2">
            <p className="font-semibold text-[var(--color-text)]">Goals</p>
            <div className="space-y-2">
              {goalDetails.map((goal) => (
                <div key={goal.value}>
                  <p className="font-medium text-[var(--color-text)]">{goal.label}</p>
                  {goal.helper ? <p className="text-xs text-subtle">{goal.helper}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
