import "server-only";

import { parseVenueSpaces } from "@/lib/venue-spaces";

export const PUBLIC_EVENT_STATUSES = ["approved", "completed"] as const;
export type PublicEventStatus = (typeof PUBLIC_EVENT_STATUSES)[number];

export type PublicVenue = {
  id: string;
  name: string;
  address: string | null;
  capacity: number | null;
};

export type PublicEvent = {
  id: string;
  slug: string;
  title: string;
  teaser: string | null;
  highlights: string[];
  eventType: string;
  status: PublicEventStatus;
  startAt: string;
  endAt: string;
  venueSpaces: string[];
  description: string | null;
  bookingType: "ticketed" | "table_booking" | "free_entry" | "mixed" | null;
  ticketPrice: number | null;
  checkInCutoffMinutes: number | null;
  agePolicy: string | null;
  accessibilityNotes: string | null;
  cancellationWindowHours: number | null;
  termsAndConditions: string | null;
  bookingUrl: string | null;
  eventImageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoSlug: string | null;
  wetPromo: string | null;
  foodPromo: string | null;
  venue: PublicVenue;
  updatedAt: string;
};

type RawVenue = {
  id: string;
  name: string;
  address: string | null;
  capacity: number | null;
};

type RawEventRow = {
  id: string;
  title: string;
  public_title: string | null;
  public_teaser: string | null;
  public_description: string | null;
  public_highlights: string[] | null;
  booking_type: string | null;
  ticket_price: number | null;
  check_in_cutoff_minutes: number | null;
  age_policy: string | null;
  accessibility_notes: string | null;
  cancellation_window_hours: number | null;
  terms_and_conditions: string | null;
  booking_url: string | null;
  event_image_path: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_slug: string | null;
  event_type: string;
  status: string;
  start_at: string;
  end_at: string;
  venue_space: string;
  notes: string | null;
  wet_promo: string | null;
  food_promo: string | null;
  updated_at: string;
  venue: RawVenue | RawVenue[] | null;
};

export type PublicEventsCursor = { startAt: string; id: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normaliseHighlights(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
}

function normaliseOptionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) ? value : null;
}

function buildEventImageUrl(path: unknown): string | null {
  const cleanedPath = normaliseOptionalText(path);
  if (!cleanedPath) return null;
  const baseUrl =
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string"
      ? process.env.NEXT_PUBLIC_SUPABASE_URL.trim().replace(/\/+$/g, "")
      : "";
  if (!baseUrl.length) return null;
  const encodedPath = cleanedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${baseUrl}/storage/v1/object/public/event-images/${encodedPath}`;
}

export function isValidIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function buildEventSlug(event: { id: string; title: string; seoSlug?: string | null }): string {
  const slugBase = typeof event.seoSlug === "string" && event.seoSlug.trim().length ? event.seoSlug : event.title;
  const base = slugify(slugBase) || "event";
  return `${base}--${event.id}`;
}

export function encodeCursor(cursor: PublicEventsCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(value: string): PublicEventsCursor | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    if (!isPlainObject(parsed)) return null;
    const startAt = parsed.startAt;
    const id = parsed.id;
    if (typeof startAt !== "string" || !isValidIsoDate(startAt)) return null;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return null;
    }
    return { startAt, id };
  } catch {
    return null;
  }
}

function normaliseVenue(value: unknown): RawVenue | null {
  if (Array.isArray(value)) {
    return normaliseVenue(value[0]);
  }
  if (!isPlainObject(value)) return null;
  const id = value.id;
  const name = value.name;
  if (typeof id !== "string" || typeof name !== "string") return null;
  return {
    id,
    name,
    address: typeof value.address === "string" ? value.address : null,
    capacity: typeof value.capacity === "number" && Number.isFinite(value.capacity) ? value.capacity : null
  };
}

function normaliseStatus(value: unknown): PublicEventStatus | null {
  if (value === "approved" || value === "completed") return value;
  return null;
}

export function toPublicEvent(row: RawEventRow): PublicEvent {
  const venue = normaliseVenue(row.venue);
  if (!venue) {
    throw new Error(`Missing venue data for event ${row.id}`);
  }

  const status = normaliseStatus(row.status);
  if (!status) {
    throw new Error(`Event ${row.id} is not public`);
  }

  const internalTitle = typeof row.title === "string" ? row.title.trim() : "";
  const title = normaliseOptionalText(row.public_title) ?? internalTitle;
  const teaser = normaliseOptionalText(row.public_teaser);
  const description = normaliseOptionalText(row.public_description) ?? normaliseOptionalText(row.notes);
  const highlights = normaliseHighlights(row.public_highlights);
  const bookingUrl = normaliseOptionalText(row.booking_url);
  const bookingType =
    row.booking_type === "ticketed" ||
    row.booking_type === "table_booking" ||
    row.booking_type === "free_entry" ||
    row.booking_type === "mixed"
      ? row.booking_type
      : null;
  const ticketPrice = typeof row.ticket_price === "number" && Number.isFinite(row.ticket_price) ? row.ticket_price : null;
  const checkInCutoffMinutes = normaliseOptionalInteger(row.check_in_cutoff_minutes);
  const agePolicy = normaliseOptionalText(row.age_policy);
  const accessibilityNotes = normaliseOptionalText(row.accessibility_notes);
  const cancellationWindowHours = normaliseOptionalInteger(row.cancellation_window_hours);
  const termsAndConditions = normaliseOptionalText(row.terms_and_conditions);
  const seoTitle = normaliseOptionalText(row.seo_title);
  const seoDescription = normaliseOptionalText(row.seo_description);
  const seoSlug = normaliseOptionalText(row.seo_slug);

  return {
    id: row.id,
    slug: buildEventSlug({ id: row.id, title, seoSlug }),
    title,
    teaser,
    highlights,
    eventType: row.event_type,
    status,
    startAt: row.start_at,
    endAt: row.end_at,
    venueSpaces: parseVenueSpaces(row.venue_space),
    description,
    bookingType,
    ticketPrice,
    checkInCutoffMinutes,
    agePolicy,
    accessibilityNotes,
    cancellationWindowHours,
    termsAndConditions,
    bookingUrl,
    eventImageUrl: buildEventImageUrl(row.event_image_path),
    seoTitle,
    seoDescription,
    seoSlug,
    wetPromo: normaliseOptionalText(row.wet_promo),
    foodPromo: normaliseOptionalText(row.food_promo),
    venue,
    updatedAt: row.updated_at
  };
}

export type { RawEventRow };
