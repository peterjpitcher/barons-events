import { SHORT_LINK_BASE_URL } from "@/lib/short-link-config";
import { buildEventSlug } from "@/lib/event-slug";

/** Matches the `--<uuid>` tail of the id-suffixed URL form. */
const EVENT_ID_SUFFIX_PATTERN =
  /--([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export type EventUrlInput = {
  id: string;
  title: string;
  seoSlug: string | null;
};

/**
 * The BaronsHub landing page URL for an event. Always resolvable.
 *
 * Prefers the bare seo_slug so the URL stays stable for events that already had
 * one. Falls back to the `<slug>--<id>` form, which /l/[slug] resolves by id, so
 * every event has a working URL without writing a seo_slug to any existing row
 * (that would change PublicEvent.slug underneath the brand site).
 */
export function buildEventLandingUrl(event: EventUrlInput): string {
  const slug = event.seoSlug?.trim();
  const path = slug && slug.length ? slug : buildEventSlug({ id: event.id, title: event.title });
  return `${SHORT_LINK_BASE_URL}${encodeURIComponent(path).replace(/%2F/gi, "/")}`;
}

/**
 * Pull the event id out of a `<anything>--<uuid>` path segment.
 *
 * Returns null for an ordinary slug, so the caller tries the slug lookup first
 * and only falls through to an id lookup when this matches.
 */
export function parseEventIdFromSlug(slug: string): string | null {
  return slug.match(EVENT_ID_SUFFIX_PATTERN)?.[1] ?? null;
}
