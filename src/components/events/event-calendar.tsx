"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import type { EventSummary } from "@/lib/events";
import { ApproveEventButton } from "@/components/events/approve-event-button";
import { Button } from "@/components/ui/button";
import { startOfIsoWeek, endOfIsoWeek, endsInEarlyHoursNextDay } from "@/lib/utils/date";

type StatusAccent = {
  badge: string;
  dot: string;
};

export type CalendarEvent = EventSummary & {
  start: dayjs.Dayjs;
  end: dayjs.Dayjs;
};

type EventCalendarProps = {
  events: CalendarEvent[];
  monthCursor: dayjs.Dayjs;
  onChangeMonth: (cursor: dayjs.Dayjs) => void;
  canCreate: boolean;
  createVenueId?: string;
  getStatusLabel: (status: EventSummary["status"]) => string;
  getStatusAccent: (status: EventSummary["status"]) => StatusAccent;
  canApproveEvent?: (event: CalendarEvent) => boolean;
};

function EventListItem({
  event,
  getStatusLabel,
  getStatusAccent,
  canApproveEvent
}: {
  event: CalendarEvent;
  getStatusLabel: EventCalendarProps["getStatusLabel"];
  getStatusAccent: EventCalendarProps["getStatusAccent"];
  canApproveEvent?: (event: CalendarEvent) => boolean;
}) {
  const statusLabel = getStatusLabel(event.status);
  const accent = getStatusAccent(event.status);
  const showApprove = canApproveEvent ? canApproveEvent(event) : false;
  const venueName = event.venue?.name ?? "Unknown venue";
  const spacesLabel = event.venue_space?.trim().length ? event.venue_space : "Space to be confirmed";
  const timeRange = `${event.start.format("HH:mm")} → ${event.end.format("HH:mm")}`;
  const hoverDetails = [
    `Venue: ${venueName}`,
    `Spaces: ${spacesLabel}`,
    `Starts: ${event.start.format("dddd D MMMM, HH:mm")}`,
    `Ends: ${event.end.format("dddd D MMMM, HH:mm")}`
  ].join("\n");

  const hasWebCopy = Boolean(event.public_title);

  const imageUrl = (() => {
    const path = event.event_image_path;
    if (!path) return null;
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
    if (!base) {
      console.warn("[event-calendar] NEXT_PUBLIC_SUPABASE_URL is not set — event images will not load");
      return null;
    }
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `${base}/storage/v1/object/public/event-images/${encoded}`;
  })();

  return (
    <li
      title={hoverDetails}
      className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[rgba(39,54,64,0.12)] bg-white overflow-hidden text-xs text-[var(--color-text)] shadow-soft"
    >
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="w-full aspect-square object-cover"
          aria-hidden="true"
        />
      )}
      <div className="flex flex-col gap-1.5 p-2">
      <Link
        href={`/events/${event.id}`}
        className="truncate text-sm font-semibold text-[var(--color-text)] transition-colors hover:text-[var(--color-primary-700)]"
      >
        {event.public_title ?? event.title}
      </Link>
      {event.public_teaser && (
        <p className="line-clamp-2 text-[0.68rem] text-subtle">{event.public_teaser}</p>
      )}
      <div className="flex flex-col gap-0.5 text-[0.7rem] text-subtle">
        <span className="truncate">{venueName}</span>
        <span className="truncate">{spacesLabel}</span>
        <span>{timeRange}</span>
      </div>
      <div className="mt-auto border-t border-[rgba(39,54,64,0.12)] pt-2 flex items-center justify-between gap-1 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {/* Intentional departure from Badge component: includes dot indicator for compact calendar cells */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.08em] ${accent.badge}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} aria-hidden="true" />
            {statusLabel}
          </span>
          {/* Intentional departure from Badge component: conditional web-copy indicator with custom colours */}
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.08em] ${
              hasWebCopy
                ? "border border-[#355849] bg-[var(--color-success)] text-white"
                : "border border-[rgba(39,54,64,0.2)] bg-[rgba(39,54,64,0.06)] text-subtle"
            }`}
          >
            {hasWebCopy ? "Webpage ready" : "No web copy"}
          </span>
        </div>
        {showApprove ? <ApproveEventButton eventId={event.id} size="sm" className="h-auto px-2 py-0.5 text-[0.64rem]" hasWebCopy={hasWebCopy} /> : null}
      </div>
      </div>
    </li>
  );
}

function OverflowList({
  events,
  getStatusLabel,
  getStatusAccent,
  canApproveEvent
}: {
  events: CalendarEvent[];
  getStatusLabel: EventCalendarProps["getStatusLabel"];
  getStatusAccent: EventCalendarProps["getStatusAccent"];
  canApproveEvent?: (event: CalendarEvent) => boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (events.length === 0) {
    return null;
  }

  return (
    <li className="space-y-1">
      {!expanded ? (
        <Button
          type="button"
          variant="subtle"
          size="sm"
          className="h-7 w-full text-xs"
          onClick={() => setExpanded(true)}
        >
          Show {events.length} more
        </Button>
      ) : null}
      {expanded ?
        events.map((event) => (
          <EventListItem
            key={event.id}
            event={event}
            getStatusLabel={getStatusLabel}
            getStatusAccent={getStatusAccent}
            canApproveEvent={canApproveEvent}
          />
        ))
      : null}
    </li>
  );
}

export function EventCalendar({
  events,
  monthCursor,
  onChangeMonth,
  canCreate,
  createVenueId,
  getStatusLabel,
  getStatusAccent,
  canApproveEvent
}: EventCalendarProps) {
  const start = useMemo(() => startOfIsoWeek(monthCursor.startOf("month")), [monthCursor]);
  const end = useMemo(() => endOfIsoWeek(monthCursor.endOf("month")), [monthCursor]);

  const days = useMemo(() => {
    const totalDays = end.diff(start, "day") + 1;
    return Array.from({ length: totalDays }, (_, index) => start.add(index, "day"));
  }, [start, end]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();

    events.forEach((event) => {
      const cursor = event.start.startOf("day");
      const endsEarlyNextDay = endsInEarlyHoursNextDay(event);
      const lastDay = endsEarlyNextDay ? cursor : event.end.startOf("day");
      const length = lastDay.diff(cursor, "day");

      for (let i = 0; i <= length; i += 1) {
        const dayKey = cursor.add(i, "day").format("YYYY-MM-DD");
        const bucket = map.get(dayKey) ?? [];
        bucket.push(event);
        map.set(dayKey, bucket);
      }
    });

    map.forEach((bucket) => {
      bucket.sort((left, right) => left.start.valueOf() - right.start.valueOf());
    });

    return map;
  }, [events]);

  const todayKey = dayjs().format("YYYY-MM-DD");

  useEffect(() => {
    if (!monthCursor.isValid()) {
      onChangeMonth(dayjs().startOf("month"));
    }
  }, [monthCursor, onChangeMonth]);

  return (
    <div className="overflow-x-auto">
    <div className="min-w-[560px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-soft">
      <div className="grid grid-cols-7 border-b border-[var(--color-border)] bg-[var(--color-muted-surface)] text-center text-xs font-semibold uppercase tracking-[0.12em] text-subtle">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <div key={label} className="px-3 py-2">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-[var(--color-border)]">
        {days.map((day) => {
          const key = day.format("YYYY-MM-DD");
          const isCurrentMonth = day.month() === monthCursor.month();
          const isToday = key === todayKey;
          const dayEvents = eventsByDate.get(key) ?? [];

          const quickCreateHref = (() => {
            if (!canCreate) {
              return null;
            }

            const startAt = day.hour(19).minute(0).second(0).millisecond(0);
            const endAt = startAt.add(3, "hour");
            const params = new URLSearchParams();
            params.set("startAt", startAt.format("YYYY-MM-DDTHH:mm"));
            params.set("endAt", endAt.format("YYYY-MM-DDTHH:mm"));
            if (createVenueId) {
              params.set("venueId", createVenueId);
            }

            return `/events/new?${params.toString()}`;
          })();

          return (
            <div
              key={key}
              className="min-h-[7.5rem] bg-white p-2"
              aria-label={`${day.format("dddd D MMMM")}, ${dayEvents.length} events`}
            >
              <div className="flex items-center justify-between">
                {quickCreateHref ? (
                  <Link
                    href={quickCreateHref}
                    className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full px-2 py-1 text-sm font-semibold transition ${
                      isCurrentMonth ? "text-[var(--color-text)] hover:bg-[var(--color-muted-surface)]" : "text-subtle"
                    } ${isToday ? "bg-[var(--color-primary-700)] text-white hover:bg-[var(--color-primary-800)]" : ""}`}
                  >
                    {day.format("D")}
                  </Link>
                ) : (
                  <span
                    className={`text-sm font-semibold ${
                      isCurrentMonth ? "text-[var(--color-text)]" : "text-subtle"
                    } ${isToday ? "rounded-full bg-[var(--color-primary-700)] px-2 py-1 text-white" : ""}`}
                  >
                    {day.format("D")}
                  </span>
                )}
                {quickCreateHref ? (
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-[var(--color-primary-700)]"
                  >
                    <Link href={quickCreateHref}>Add event</Link>
                  </Button>
                ) : null}
              </div>
              <ul className="mt-2 space-y-1 md:space-y-0 md:divide-y md:divide-[var(--color-border)]">
                {dayEvents.slice(0, 3).map((event) => (
                  <EventListItem
                    key={event.id}
                    event={event}
                    getStatusLabel={getStatusLabel}
                    getStatusAccent={getStatusAccent}
                    canApproveEvent={canApproveEvent}
                  />
                ))}
                {dayEvents.length > 3 ? (
                  <OverflowList
                    events={dayEvents.slice(3)}
                    getStatusLabel={getStatusLabel}
                    getStatusAccent={getStatusAccent}
                    canApproveEvent={canApproveEvent}
                  />
                ) : null}
              </ul>
              {dayEvents.length === 0 ? <p className="mt-2 text-xs text-subtle">No events</p> : null}
            </div>
          );
        })}
      </div>
    </div>
    </div>
  );
}
