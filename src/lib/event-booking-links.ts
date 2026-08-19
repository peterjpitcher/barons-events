import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { slugifyForUtm, type ShortLink } from "@/lib/links";
import { SHORT_LINK_BASE_URL, SHORT_LINK_HOST } from "@/lib/short-link-config";
import { insertShortLinkWithUniqueCode } from "@/lib/short-link-codes";
import { recordSystemAuditLogEntry } from "@/lib/audit-log";

const SHORT_LINK_CODE_PATTERN = /^[0-9a-f]{8}$/;
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const SHORT_LINK_NAME_MAX = 120;

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Which landing-page button a tracked link belongs to. The variants differ only
 * in how the resulting short link is labelled and tagged, so the two buttons
 * stay tellable apart in Links & QR Codes and in campaign reporting.
 */
export type TrackedEventLinkVariant = "booking" | "extra_cta";

type VariantConfig = {
  linkType: "booking" | "event";
  utmMedium: string;
  utmContent: string;
  nameSuffix: string;
  label: string;
  auditSource: string;
};

const VARIANTS: Record<TrackedEventLinkVariant, VariantConfig> = {
  booking: {
    linkType: "booking",
    utmMedium: "booking_link",
    utmContent: "event_booking",
    nameSuffix: "Booking link",
    label: "Booking link",
    auditSource: "event_booking"
  },
  extra_cta: {
    linkType: "event",
    utmMedium: "event_cta",
    utmContent: "event_extra_button",
    nameSuffix: "Extra button",
    label: "Extra button link",
    auditSource: "event_extra_cta"
  }
};

/**
 * A problem the administrator can fix by editing the field, as opposed to an
 * infrastructure failure. The caller surfaces `message` verbatim.
 */
export class TrackedLinkInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackedLinkInputError";
  }
}

export type TrackedBookingUrlStatus = "empty" | "already-shortened" | "reused" | "created";

export type TrackedBookingUrlResult = {
  url: string | null;
  status: TrackedBookingUrlStatus;
};

function normaliseHost(value: string): string {
  return value.toLowerCase().replace(/:\d+$/, "");
}

export function parseExistingShortLinkCode(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (normaliseHost(url.hostname) !== normaliseHost(SHORT_LINK_HOST)) {
    return null;
  }

  const match = url.pathname.match(/^\/([0-9a-f]{8})\/?$/);
  const code = match?.[1] ?? "";
  return SHORT_LINK_CODE_PATTERN.test(code) ? code : null;
}

function buildShortUrl(code: string): string {
  return SHORT_LINK_BASE_URL + code;
}

function normaliseExistingShortUrl(originalUrl: string, code: string): string {
  const url = new URL(buildShortUrl(code));
  const original = new URL(originalUrl);
  for (const [key, value] of original.searchParams) {
    if (key.startsWith("utm_")) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function buildTrackedEventDestination(
  value: string,
  campaignName: string,
  eventId: string,
  variant: TrackedEventLinkVariant = "booking"
): string {
  const config = VARIANTS[variant];
  const destination = new URL(value);
  destination.searchParams.set("utm_source", "baronshub");
  destination.searchParams.set("utm_medium", config.utmMedium);
  destination.searchParams.set("utm_campaign", slugifyForUtm(campaignName) || eventId.slice(0, 8));
  destination.searchParams.set("utm_content", config.utmContent);
  return destination.toString();
}

/** Kept for the booking-link call sites and their tests. */
export function buildTrackedBookingDestination(value: string, campaignName: string, eventId: string): string {
  return buildTrackedEventDestination(value, campaignName, eventId, "booking");
}

function buildShortLinkName(
  eventTitle: string,
  eventStartAt: string | null | undefined,
  suffix: string
): string {
  const title = eventTitle.trim() || "Event";
  const date = eventStartAt
    ? new Date(eventStartAt).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Europe/London"
      })
    : null;
  const name = `${title}${date ? ` (${date})` : ""} - ${suffix}`;
  return name.length > SHORT_LINK_NAME_MAX
    ? name.slice(0, SHORT_LINK_NAME_MAX).replace(/\s+\S*$/, "").trim()
    : name;
}

async function findShortLinkCodeByDestination(
  db: SupabaseAdminClient,
  destination: string
): Promise<string | null> {
  const { data, error } = await db
    .from("short_links")
    .select("code")
    .eq("destination", destination)
    .limit(1);

  if (error) {
    throw new Error(`Could not check existing short links: ${error.message}`);
  }

  const first = data?.[0] as Pick<ShortLink, "code"> | undefined;
  return first?.code ?? null;
}

async function shortLinkCodeExists(db: SupabaseAdminClient, code: string): Promise<boolean> {
  const { data, error } = await db
    .from("short_links")
    .select("code")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not verify short link: ${error.message}`);
  }

  return Boolean(data);
}

async function createTrackedShortLink(params: {
  db: SupabaseAdminClient;
  name: string;
  destination: string;
  createdBy: string;
  config: VariantConfig;
}): Promise<string> {
  // Shared insert-first generator: retries code collisions, propagates real errors.
  let link: ShortLink;
  try {
    link = await insertShortLinkWithUniqueCode(params.db, {
      name: params.name,
      destination: params.destination,
      link_type: params.config.linkType,
      expires_at: null,
      created_by: params.createdBy
    });
  } catch (error) {
    throw new Error(`Could not create short link: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  // Admin-client mutation, audited with the service-role logger and attributed
  // to the acting user.
  await recordSystemAuditLogEntry({
    entity: "link",
    entityId: link.id,
    action: "link.created",
    actorId: params.createdBy,
    meta: { name: params.name, linkType: params.config.linkType, source: params.config.auditSource }
  });

  return link.code;
}

/**
 * Turn an event's outbound link into a tracked short link, reusing an existing
 * one where the destination already matches. Both landing-page buttons go
 * through this, so every outbound click is counted in Links & QR Codes.
 */
export async function getOrCreateTrackedEventLinkUrl(params: {
  url: string | null | undefined;
  eventId: string;
  eventTitle: string;
  eventStartAt?: string | null;
  eventCampaignName?: string | null;
  createdBy: string;
  variant?: TrackedEventLinkVariant;
}): Promise<TrackedBookingUrlResult> {
  const config = VARIANTS[params.variant ?? "booking"];
  const trimmedUrl = params.url?.trim() ?? "";
  if (!trimmedUrl) {
    return { url: null, status: "empty" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new TrackedLinkInputError(`${config.label} must be a full URL.`);
  }

  if (!HTTP_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new TrackedLinkInputError(`${config.label} must start with http:// or https://.`);
  }

  const db = createSupabaseAdminClient();
  const existingShortCode = parseExistingShortLinkCode(trimmedUrl);
  if (existingShortCode) {
    const exists = await shortLinkCodeExists(db, existingShortCode);
    if (!exists) {
      throw new TrackedLinkInputError("That short link was not found in Links & QR Codes.");
    }
    return { url: normaliseExistingShortUrl(trimmedUrl, existingShortCode), status: "already-shortened" };
  }

  const campaignName = params.eventCampaignName?.trim() || params.eventTitle;
  const trackedDestination = buildTrackedEventDestination(
    trimmedUrl,
    campaignName,
    params.eventId,
    params.variant ?? "booking"
  );
  const reusableCode = await findShortLinkCodeByDestination(db, trackedDestination);
  if (reusableCode) {
    return { url: buildShortUrl(reusableCode), status: "reused" };
  }

  const newCode = await createTrackedShortLink({
    db,
    name: buildShortLinkName(params.eventTitle, params.eventStartAt, config.nameSuffix),
    destination: trackedDestination,
    createdBy: params.createdBy,
    config
  });

  return { url: buildShortUrl(newCode), status: "created" };
}
