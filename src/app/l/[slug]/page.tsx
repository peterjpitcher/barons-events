import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { formatInLondon, normaliseWebsiteTimeText } from "@/lib/datetime";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getConfirmedTicketCount } from "@/lib/bookings";
import { resolveEventBookingState, shouldNoIndex } from "@/lib/event-booking-state";
import { buildEventLandingUrl, canonicalEventPath, parseEventIdFromSlug } from "@/lib/event-public-url";
import { BookingForm } from "./BookingForm";
import { BookingUnavailableNotice } from "./BookingUnavailableNotice";

export const revalidate = 60; // ISR — refresh every minute

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Customer-facing copy per non-bookable state. "misconfigured" reads exactly
 * like "closed" on purpose: an event with booking switched on but no format
 * set is our data problem, not something to explain to a customer.
 */
const BOOKING_STATE_MESSAGES: Record<"finished" | "closed" | "misconfigured" | "sold_out", string> = {
  finished: "This event has finished.",
  closed: "No booking needed, just come along.",
  misconfigured: "No booking needed, just come along.",
  sold_out: "Sorry, this event is fully booked."
};

/**
 * Build the public image URL from an event_image_path stored in Supabase Storage.
 * Mirrors the buildEventImageUrl helper in src/lib/public-api/events.ts.
 */
function buildImageUrl(imagePath: string | null): string | null {
  if (!imagePath || !imagePath.trim()) return null;
  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) return null;
  const encodedPath = imagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${baseUrl}/storage/v1/object/public/event-images/${encodedPath}`;
}

type EventRow = {
  id: string;
  title: string;
  public_title: string | null;
  public_teaser: string | null;
  public_description: string | null;
  public_highlights: string[] | null;
  event_image_path: string | null;
  start_at: string;
  end_at: string;
  seo_slug: string | null;
  booking_enabled: boolean;
  booking_notes_enabled: boolean;
  booking_type: string | null;
  booking_url: string | null;
  ticket_price: number | null;
  total_capacity: number | null;
  max_tickets_per_booking: number;
  status: string;
  venue: {
    id: string;
    name: string;
    is_internal?: boolean;
  } | null;
};

const EVENT_SELECT =
  "id, title, public_title, public_teaser, public_description, public_highlights, event_image_path, start_at, end_at, seo_slug, booking_enabled, booking_notes_enabled, booking_type, booking_url, ticket_price, total_capacity, max_tickets_per_booking, status, venue:venues!events_venue_id_fkey(id, name, is_internal)";

/** Shape the raw Supabase row into EventRow, or null if it is not publicly visible. */
function mapEventRow(data: unknown): EventRow | null {
  if (!data) return null;
  const raw = data as Record<string, unknown>;
  const venueRaw = raw.venue;
  const venue = Array.isArray(venueRaw)
    ? (venueRaw[0] as { id: string; name: string; is_internal?: boolean } | undefined) ?? null
    : (venueRaw as { id: string; name: string; is_internal?: boolean } | null) ?? null;

  if (venue?.is_internal) return null;

  return {
    id: raw.id as string,
    title: raw.title as string,
    public_title: typeof raw.public_title === "string" ? normaliseWebsiteTimeText(raw.public_title) : null,
    public_teaser: typeof raw.public_teaser === "string" ? normaliseWebsiteTimeText(raw.public_teaser) : null,
    public_description:
      typeof raw.public_description === "string" ? normaliseWebsiteTimeText(raw.public_description) : null,
    public_highlights: Array.isArray(raw.public_highlights)
      ? (raw.public_highlights as string[]).map(normaliseWebsiteTimeText)
      : null,
    event_image_path: (raw.event_image_path as string | null) ?? null,
    start_at: raw.start_at as string,
    end_at: raw.end_at as string,
    seo_slug: (raw.seo_slug as string | null) ?? null,
    booking_enabled: raw.booking_enabled as boolean,
    booking_notes_enabled: raw.booking_notes_enabled as boolean,
    booking_type: (raw.booking_type as string | null) ?? null,
    booking_url: (raw.booking_url as string | null) ?? null,
    ticket_price: (raw.ticket_price as number | null) ?? null,
    total_capacity: (raw.total_capacity as number | null) ?? null,
    max_tickets_per_booking: (raw.max_tickets_per_booking as number) ?? 10,
    status: raw.status as string,
    venue,
  };
}

/**
 * Resolve a public event from a URL path segment.
 *
 * Tries the seo_slug first, then the id-suffixed form (`anything--<uuid>`)
 * that PublicEvent.slug already publishes. The id form is what guarantees a
 * working URL for events that have no slug, and keeps old links alive when
 * somebody edits a slug.
 *
 * Uses the service-role client so we control visibility here rather than
 * through RLS: not deleted, approved or completed, venue not internal.
 */
async function getEventBySlug(slug: string): Promise<EventRow | null> {
  const db = createSupabaseAdminClient();

  const bySlug = await db
    .from("events")
    .select(EVENT_SELECT)
    .eq("seo_slug", slug)
    .is("deleted_at", null)
    .in("status", ["approved", "completed"])
    .maybeSingle();

  if (bySlug.error) {
    console.error("getEventBySlug error:", bySlug.error);
    return null;
  }
  if (bySlug.data) return mapEventRow(bySlug.data);

  const eventId = parseEventIdFromSlug(slug);
  if (!eventId) return null;

  const byId = await db
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", eventId)
    .is("deleted_at", null)
    .in("status", ["approved", "completed"])
    .maybeSingle();

  if (byId.error) {
    console.error("getEventById error:", byId.error);
    return null;
  }
  return mapEventRow(byId.data);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return {};

  const title = event.public_title || event.title;
  const imageUrl = buildImageUrl(event.event_image_path);

  // Non-bookable pages duplicate the main Barons website's own event pages,
  // so keep them out of the index while still following their links.
  // Capacity is passed as null on purpose: a sold-out event stays indexable,
  // and generateMetadata should not pay for a ticket-count query.
  const state = resolveEventBookingState({
    bookingUrl: event.booking_url,
    bookingEnabled: event.booking_enabled,
    bookingType: event.booking_type,
    endAt: event.end_at,
    totalCapacity: null,
    confirmedTickets: 0
  });

  return {
    title: `${title} — Barons Pub Company`,
    description: event.public_teaser ?? undefined,
    robots: shouldNoIndex(state) ? { index: false, follow: true } : undefined,
    alternates: {
      // Self-referencing canonical so the id-suffixed form never competes with
      // the slug form in search results. Built from the public base URL, not
      // the request host: a canonical must be the one true public address,
      // whereas a redirect must stay on the host the request arrived on.
      canonical: buildEventLandingUrl({ id: event.id, title: event.title, seoSlug: event.seo_slug })
    },
    openGraph: {
      title,
      description: event.public_teaser ?? undefined,
      images: imageUrl ? [{ url: imageUrl }] : [],
    },
  };
}

export default async function EventLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);

  if (!event) {
    notFound();
  }

  const headersList = await headers();
  const host = headersList.get("host");
  const nonce = headersList.get("x-nonce") ?? undefined;

  // Reached via the id-suffixed form but the event has a real slug: send the
  // customer to the pretty URL and let search engines follow the equity.
  if (event.seo_slug && event.seo_slug !== slug) {
    permanentRedirect(canonicalEventPath(event.seo_slug, host));
  }

  const confirmedCount = await getConfirmedTicketCount(event.id);
  const bookingState = resolveEventBookingState({
    bookingUrl: event.booking_url,
    bookingEnabled: event.booking_enabled,
    bookingType: event.booking_type,
    endAt: event.end_at,
    totalCapacity: event.total_capacity,
    confirmedTickets: confirmedCount
  });

  // An external booking link short-circuits the local flow.
  // permanentRedirect issues an HTTP 308: search engines forward link equity
  // to the destination, browsers preserve method, and the slug remains a
  // shareable handle should the URL ever be cleared.
  if (bookingState.kind === "external") {
    permanentRedirect(bookingState.url);
  }

  const { date: dateStr, time: timeStr } = formatInLondon(event.start_at);

  const highlights: string[] =
    Array.isArray(event.public_highlights) && event.public_highlights.length > 0
      ? event.public_highlights
      : [];

  const hasHighlights = highlights.length > 0;
  const imageUrl = buildImageUrl(event.event_image_path);
  const displayTitle = event.public_title || event.title;

  return (
    <div className="min-h-screen bg-[var(--navy)] sm:flex sm:items-start sm:justify-center sm:py-8 sm:px-4">
      {/* Card wrapper — full screen on mobile, centred narrow card on desktop */}
      <div className="w-full sm:max-w-[900px] sm:overflow-hidden sm:rounded-[8px] sm:shadow-card sm:flex">

        {/* ── LEFT COLUMN (desktop only) ── */}
        <div className="hidden sm:flex sm:flex-col sm:w-[420px] sm:flex-shrink-0 bg-[var(--slate)]">
          {/* Square event image */}
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={displayTitle}
              className="w-full aspect-square object-cover"
            />
          ) : (
            <div className="w-full aspect-square bg-[var(--slate)] flex items-center justify-center">
              <span className="text-white/60 text-sm">No image</span>
            </div>
          )}

          {/* USPs on desktop — hidden if no highlights */}
          {hasHighlights && (
            <div className="p-6">
              <ul className="space-y-3">
                {highlights.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-white">
                    <span className="text-[var(--burgundy)] mt-0.5 flex-shrink-0">✓</span>
                    <span className="text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN / MOBILE MAIN ── */}
        <div className="flex-1 bg-[var(--paper)] flex flex-col">
          {/* Top bar */}
          <div className="bg-[var(--navy)] px-4 py-3 flex items-center gap-3 border-b border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Barons Pub Company" className="h-8 w-auto flex-shrink-0" />
          </div>

          {/* Event image — mobile only */}
          <div className="sm:hidden">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={displayTitle}
                className="h-[200px] w-full object-cover"
              />
            ) : (
              <div className="flex h-[200px] w-full items-center justify-center bg-[var(--slate)]">
                <span className="text-white/60 text-sm">No image</span>
              </div>
            )}
          </div>

          {/* Event details */}
          <div className="px-6 pt-5 pb-4">
            <h1 className="font-serif text-2xl font-bold text-[var(--navy)] leading-tight mb-3">
              {displayTitle}
            </h1>

            {/* Date/time/venue chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="bg-[var(--slate-50)] text-[var(--navy)] text-xs font-semibold px-2.5 py-1 rounded">
                {dateStr}
              </span>
              <span className="bg-[var(--slate-50)] text-[var(--navy)] text-xs font-semibold px-2.5 py-1 rounded">
                {timeStr}
              </span>
              {event.venue?.name && (
                <span className="bg-[var(--slate-50)] text-[var(--navy)] text-xs font-semibold px-2.5 py-1 rounded">
                  {event.venue.name}
                </span>
              )}
            </div>

            {/* Description */}
            {event.public_teaser && (
              <p className="text-[var(--slate)] italic text-sm mb-3 leading-relaxed">
                {event.public_teaser}
              </p>
            )}
            {event.public_description && (
              <div className="text-[var(--navy)] text-sm leading-relaxed mb-4 space-y-3">
                {event.public_description.split(/\n{2,}/).map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            )}
          </div>

          {/* USPs — mobile only, hidden if no highlights */}
          {hasHighlights && (
            <div className="sm:hidden bg-[var(--sage)] px-6 py-5">
              <ul className="space-y-3">
                {highlights.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-white">
                    <span className="text-[var(--burgundy)] mt-0.5 flex-shrink-0">✓</span>
                    <span className="text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Booking area: what shows here is decided by the event's own rules */}
          <div className="mt-auto">
            {bookingState.kind === "open" ? (
              <BookingForm
                eventId={event.id}
                maxTickets={event.max_tickets_per_booking}
                isSoldOut={false}
                bookingType={bookingState.format}
                isPaidBooking={bookingState.isPaid}
                ticketPrice={event.ticket_price}
                bookingNotesEnabled={event.booking_notes_enabled}
                nonce={nonce}
              />
            ) : (
              <BookingUnavailableNotice message={BOOKING_STATE_MESSAGES[bookingState.kind]} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
