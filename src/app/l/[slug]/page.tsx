import { notFound } from "next/navigation";
import type { Metadata } from "next";
import dayjs from "dayjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getConfirmedTicketCount } from "@/lib/bookings";
import { BookingForm } from "./BookingForm";

export const revalidate = 60; // ISR — refresh every minute

interface PageProps {
  params: Promise<{ slug: string }>;
}

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
  seo_slug: string | null;
  booking_enabled: boolean;
  total_capacity: number | null;
  max_tickets_per_booking: number;
  venue: {
    id: string;
    name: string;
  } | null;
};

/**
 * Fetch an event by its seo_slug using the service-role client.
 * Uses admin client so we can see all events (RLS bypassed) and return 404
 * ourselves based on booking_enabled flag.
 */
async function getEventBySlug(slug: string): Promise<EventRow | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("events")
    .select(
      "id, title, public_title, public_teaser, public_description, public_highlights, event_image_path, start_at, seo_slug, booking_enabled, total_capacity, max_tickets_per_booking, venue:venues(id, name)"
    )
    .eq("seo_slug", slug)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("getEventBySlug error:", error);
    return null;
  }

  if (!data) return null;

  // Normalise the venue join (Supabase may return as array or object)
  const raw = data as Record<string, unknown>;
  const venueRaw = raw.venue;
  const venue = Array.isArray(venueRaw)
    ? (venueRaw[0] as { id: string; name: string } | undefined) ?? null
    : (venueRaw as { id: string; name: string } | null) ?? null;

  return {
    id: raw.id as string,
    title: raw.title as string,
    public_title: (raw.public_title as string | null) ?? null,
    public_teaser: (raw.public_teaser as string | null) ?? null,
    public_description: (raw.public_description as string | null) ?? null,
    public_highlights: Array.isArray(raw.public_highlights)
      ? (raw.public_highlights as string[])
      : null,
    event_image_path: (raw.event_image_path as string | null) ?? null,
    start_at: raw.start_at as string,
    seo_slug: (raw.seo_slug as string | null) ?? null,
    booking_enabled: raw.booking_enabled as boolean,
    total_capacity: (raw.total_capacity as number | null) ?? null,
    max_tickets_per_booking: (raw.max_tickets_per_booking as number) ?? 10,
    venue,
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return {};

  const title = event.public_title || event.title;
  const imageUrl = buildImageUrl(event.event_image_path);

  return {
    title: `${title} — Barons Pubs`,
    description: event.public_teaser ?? undefined,
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

  if (!event || !event.booking_enabled) {
    notFound();
  }

  // Count confirmed tickets for sold-out detection
  const confirmedCount = await getConfirmedTicketCount(event.id);
  const isSoldOut =
    event.total_capacity != null && confirmedCount >= event.total_capacity;

  const startDate = dayjs(event.start_at);
  const dateStr = startDate.format("ddd D MMM");
  const timeStr = startDate.format("h:mma");

  const highlights: string[] =
    Array.isArray(event.public_highlights) && event.public_highlights.length > 0
      ? event.public_highlights
      : [];

  const hasHighlights = highlights.length > 0;
  const imageUrl = buildImageUrl(event.event_image_path);
  const displayTitle = event.public_title || event.title;

  return (
    <div className="min-h-screen bg-[#273640] sm:flex sm:items-start sm:justify-center sm:py-8 sm:px-4">
      {/* Card wrapper — full screen on mobile, centred narrow card on desktop */}
      <div className="w-full sm:max-w-[900px] sm:rounded-xl sm:overflow-hidden sm:shadow-2xl sm:flex">

        {/* ── LEFT COLUMN (desktop only) ── */}
        <div className="hidden sm:flex sm:flex-col sm:w-[420px] sm:flex-shrink-0 bg-[#637c8c]">
          {/* Square event image */}
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={displayTitle}
              className="w-full aspect-square object-cover"
            />
          ) : (
            <div className="w-full aspect-square bg-[#637c8c] flex items-center justify-center">
              <span className="text-white/60 text-sm">No image</span>
            </div>
          )}

          {/* USPs on desktop — hidden if no highlights */}
          {hasHighlights && (
            <div className="p-6">
              <ul className="space-y-3">
                {highlights.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-white">
                    <span className="text-[#781f25] mt-0.5 flex-shrink-0">✓</span>
                    <span className="text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN / MOBILE MAIN ── */}
        <div className="flex-1 bg-white flex flex-col">
          {/* Top bar */}
          <div className="bg-[#cbd5db] px-4 py-3 flex items-center gap-3 border-b border-[#93ab97]/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Barons Pubs" className="h-8 w-auto flex-shrink-0" />
          </div>

          {/* Event image — mobile only */}
          <div className="sm:hidden">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={displayTitle}
                className="w-full aspect-square object-cover"
              />
            ) : (
              <div className="w-full aspect-square bg-[#637c8c] flex items-center justify-center">
                <span className="text-white/60 text-sm">No image</span>
              </div>
            )}
          </div>

          {/* Event details */}
          <div className="px-6 pt-5 pb-4">
            <h1 className="font-serif text-2xl font-bold text-[#273640] leading-tight mb-3">
              {displayTitle}
            </h1>

            {/* Date/time/venue chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="bg-[#cbd5db] text-[#273640] text-xs font-semibold px-2.5 py-1 rounded">
                {dateStr}
              </span>
              <span className="bg-[#cbd5db] text-[#273640] text-xs font-semibold px-2.5 py-1 rounded">
                {timeStr}
              </span>
              {event.venue?.name && (
                <span className="bg-[#cbd5db] text-[#273640] text-xs font-semibold px-2.5 py-1 rounded">
                  {event.venue.name}
                </span>
              )}
            </div>

            {/* Description */}
            {event.public_teaser && (
              <p className="text-[#637c8c] italic text-sm mb-3 leading-relaxed">
                {event.public_teaser}
              </p>
            )}
            {event.public_description && (
              <p className="text-[#273640] text-sm leading-relaxed mb-4">
                {event.public_description}
              </p>
            )}
          </div>

          {/* USPs — mobile only, hidden if no highlights */}
          {hasHighlights && (
            <div className="sm:hidden bg-[#93ab97] px-6 py-5">
              <ul className="space-y-3">
                {highlights.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-white">
                    <span className="text-[#781f25] mt-0.5 flex-shrink-0">✓</span>
                    <span className="text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Booking form */}
          <div className="mt-auto">
            <BookingForm
              eventId={event.id}
              maxTickets={event.max_tickets_per_booking}
              isSoldOut={isSoldOut}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
