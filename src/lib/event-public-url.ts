import { SHORT_LINK_BASE_URL, SHORT_LINK_HOST } from "@/lib/short-link-config";
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
 * When the event has no seo_slug we fall back to the id-suffixed form, which
 * the /l/[slug] route resolves by id. That is what lets us guarantee a URL for
 * every event without writing a seo_slug to any existing row: doing so would
 * change PublicEvent.slug underneath the external brand site.
 *
 * The fallback deliberately reuses buildEventSlug so this path is always
 * byte-identical to PublicEvent.slug.
 */
export function buildEventLandingUrl(event: EventUrlInput): string {
  const slug = event.seoSlug?.trim();
  const path = slug && slug.length ? slug : buildEventSlug({ id: event.id, title: event.title });
  return `${SHORT_LINK_BASE_URL}${encodeURIComponent(path).replace(/%2F/gi, "/")}`;
}

/**
 * The link to put in front of a customer: SMS, QR codes, campaign copy.
 *
 * Prefers the external booking URL because that value is already a tracked
 * short link carrying UTM attribution, and routing through our landing page
 * would add a redirect hop for no gain. Never returns null.
 */
export function resolveEventCtaUrl(event: EventUrlInput & { bookingUrl: string | null }): string {
  const bookingUrl = event.bookingUrl?.trim();
  if (bookingUrl) return bookingUrl;
  return buildEventLandingUrl(event);
}

/**
 * Pull the event id out of a `<anything>--<uuid>` path segment.
 *
 * Returns null for an ordinary slug, so the caller can try the slug lookup
 * first and only fall through to an id lookup when this matches.
 */
export function parseEventIdFromSlug(slug: string): string | null {
  return slug.match(EVENT_ID_SUFFIX_PATTERN)?.[1] ?? null;
}

/**
 * The canonical path for an event on the host the request arrived on.
 *
 * On the short link host, middleware rewrites `/<slug>` to `/l/<slug>`, so a
 * redirect to `/l/<slug>` from that host would be rewritten again to
 * `/l/l/<slug>` and 404. Deriving from the request host also keeps local dev on
 * localhost rather than bouncing to production, which building from
 * SHORT_LINK_HOST would do: it defaults to l.baronspubs.com and is unset in
 * .env.local.
 */
export function canonicalEventPath(slug: string, host: string | null): string {
  const normalisedHost = host?.toLowerCase().replace(/:\d+$/, "") ?? "";
  const encoded = encodeURIComponent(slug);
  return normalisedHost === SHORT_LINK_HOST.toLowerCase() ? `/${encoded}` : `/l/${encoded}`;
}
