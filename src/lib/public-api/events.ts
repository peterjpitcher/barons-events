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
  eventType: string;
  status: PublicEventStatus;
  startAt: string;
  endAt: string;
  venueSpaces: string[];
  description: string | null;
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

export function buildEventSlug(event: Pick<PublicEvent, "id" | "title">): string {
  const base = slugify(event.title) || "event";
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

  const title = row.title;
  const safeTitle = typeof title === "string" ? title.trim() : "";
  const description = normaliseOptionalText(row.notes);

  return {
    id: row.id,
    slug: buildEventSlug({ id: row.id, title: safeTitle }),
    title: safeTitle,
    eventType: row.event_type,
    status,
    startAt: row.start_at,
    endAt: row.end_at,
    venueSpaces: parseVenueSpaces(row.venue_space),
    description,
    wetPromo: normaliseOptionalText(row.wet_promo),
    foodPromo: normaliseOptionalText(row.food_promo),
    venue,
    updatedAt: row.updated_at
  };
}

export type { RawEventRow };
