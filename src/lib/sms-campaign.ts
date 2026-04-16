import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTwilioSms } from "@/lib/twilio";
import { createSystemShortLink } from "@/lib/system-short-links";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

// ── Types ────────────────────────────────────────────────────────────────────

export type CtaMode = "link" | "reply";

export type BookingType = "ticketed" | "table_booking" | "free_entry" | "mixed";

export interface CampaignEvent {
  id: string;
  publicTitle: string;
  eventType: string;
  bookingType: BookingType;
  venueId: string;
  venueName: string;
  startAt: Date;
  ticketPrice: number | null;
  totalCapacity: number | null;
  bookingUrl: string | null;
  seoSlug: string | null;
  maxTicketsPerBooking: number;
}

interface CampaignAudienceMember {
  customerId: string;
  firstName: string;
  mobile: string;
}

export interface CampaignStats {
  wave: number;
  sent: number;
  failed: number;
  converted: number;
}

// ── CTA Resolution ──────────────────────────────────────────────────────────

export function resolveCtaMode(bookingType: BookingType): CtaMode {
  switch (bookingType) {
    case "ticketed":
    case "mixed":
      return "link";
    case "table_booking":
    case "free_entry":
      return "reply";
  }
}

// ── Capacity Hints ──────────────────────────────────────────────────────────

export function getCapacityHint(
  confirmedTickets: number,
  totalCapacity: number | null,
): string {
  if (totalCapacity === null || totalCapacity === 0) return "";
  const pct = confirmedTickets / totalCapacity;
  if (pct > 0.75) return "Nearly fully booked! ";
  if (pct > 0.5) return "Filling up fast! ";
  return "";
}

// ── Reply Code Generation ───────────────────────────────────────────────────

const REPLY_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // No I or O (avoidable confusion with 1/0)

export function generateReplyCode(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 3; i++) {
    code += REPLY_CODE_CHARS[bytes[i] % REPLY_CODE_CHARS.length];
  }
  return code;
}

// ── Wave Calculation ────────────────────────────────────────────────────────

/**
 * Returns which wave (1, 2, or 3) is due for an event, or null if no wave is due today.
 * Uses UK timezone calendar dates.
 * Wave 1 = 14 days before, Wave 2 = 7 days before, Wave 3 = 1 day before.
 * Returns null for same-day events (diffDays === 0).
 */
export function getWaveDue(eventStartAt: Date): 1 | 2 | 3 | null {
  const now = new Date();
  const londonNow = toZonedTime(now, "Europe/London");
  const londonEvent = toZonedTime(eventStartAt, "Europe/London");

  const todayStr = format(londonNow, "yyyy-MM-dd");
  const eventStr = format(londonEvent, "yyyy-MM-dd");

  // Calculate calendar day difference
  const todayDate = new Date(todayStr);
  const eventDate = new Date(eventStr);
  const diffDays = Math.round(
    (eventDate.getTime() - todayDate.getTime()) / 86400000,
  );

  if (diffDays === 14) return 1;
  if (diffDays === 7) return 2;
  if (diffDays === 1) return 3;
  return null;
}

// ── SMS Template Rendering ──────────────────────────────────────────────────

function formatShortDate(date: Date): string {
  const london = toZonedTime(date, "Europe/London");
  return format(london, "EEE d MMM"); // e.g. "Fri 30 Apr"
}

export function renderCampaignSms(params: {
  wave: 1 | 2 | 3;
  ctaMode: CtaMode;
  firstName: string;
  publicTitle: string;
  venueName: string;
  startAt: Date;
  ticketPrice: number | null;
  capacityHint: string;
  bookingLink: string | null;
  replyCode: string | null;
}): string {
  const {
    wave,
    ctaMode,
    firstName,
    publicTitle,
    venueName,
    startAt,
    ticketPrice,
    capacityHint,
    bookingLink,
    replyCode,
  } = params;
  const date = formatShortDate(startAt);
  const price = ticketPrice ? `Tickets from \u00a3${ticketPrice}. ` : "";
  const stop = " Reply STOP to opt out";

  if (ctaMode === "link") {
    switch (wave) {
      case 1:
        return `Hi ${firstName}! ${publicTitle} is coming to ${venueName} on ${date}. ${price}${capacityHint}Book here: ${bookingLink}${stop}`;
      case 2:
        return `Just a week until ${publicTitle} at ${venueName}! ${capacityHint}Don't miss out \u2014 book now: ${bookingLink}${stop}`;
      case 3:
        return `Tomorrow! ${publicTitle} at ${venueName}. Last chance to grab tickets: ${bookingLink}${stop}`;
    }
  } else {
    switch (wave) {
      case 1:
        return `Hi ${firstName}! ${publicTitle} is coming to ${venueName} on ${date}. ${capacityHint}Reply '${replyCode} 2' for 2 seats (or any number).${stop}`;
      case 2:
        return `Just a week until ${publicTitle} at ${venueName}! ${capacityHint}Reply '${replyCode} 2' to reserve your seats.${stop}`;
      case 3:
        return `Tomorrow! ${publicTitle} at ${venueName}. Reply '${replyCode} 2' \u2014 last chance!${stop}`;
    }
  }
}

// ── Campaign Send Lifecycle ─────────────────────────────────────────────────

/**
 * Claim a campaign send slot, send SMS, update status.
 * Returns true on success, false on failure (row left in 'failed' state for retry).
 */
export async function sendCampaignSms(params: {
  event: CampaignEvent;
  customer: CampaignAudienceMember;
  wave: 1 | 2 | 3;
  confirmedTickets: number;
}): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { event, customer, wave, confirmedTickets } = params;

  const ctaMode = resolveCtaMode(event.bookingType);
  const replyCode = ctaMode === "reply" ? generateReplyCode() : null;

  // Step 1: Claim — insert row with status 'claimed'
  const { error: claimError } = await db
    .from("sms_campaign_sends")
    .insert({
      event_id: event.id,
      customer_id: customer.customerId,
      wave,
      status: "claimed",
      reply_code: replyCode,
    });

  if (claimError) {
    // Likely unique constraint violation — already claimed
    console.warn("Campaign claim failed:", claimError.message);
    return false;
  }

  // Step 2: Compose message
  let bookingLink: string | null = null;
  if (ctaMode === "link") {
    const destination =
      event.bookingUrl ??
      (event.seoSlug
        ? `https://l.baronspubs.com/${event.seoSlug}`
        : null);

    if (destination) {
      const url = new URL(destination);
      url.searchParams.set("utm_source", "sms");
      url.searchParams.set("utm_campaign", "booking-driver");
      url.searchParams.set("utm_content", `wave-${wave}`);

      bookingLink = await createSystemShortLink({
        name: `Campaign w${wave} — ${event.publicTitle}`,
        destination: url.toString(),
        linkType: "booking",
      });
    }
    // Fallback if short link creation fails
    if (!bookingLink) bookingLink = destination;
  }

  const capacityHint = getCapacityHint(confirmedTickets, event.totalCapacity);

  const body = renderCampaignSms({
    wave,
    ctaMode,
    firstName: customer.firstName,
    publicTitle: event.publicTitle,
    venueName: event.venueName,
    startAt: event.startAt,
    ticketPrice:
      ctaMode === "link" && event.bookingType === "ticketed"
        ? event.ticketPrice
        : null,
    capacityHint,
    bookingLink,
    replyCode,
  });

  // Step 3: Send via Twilio
  try {
    const { sid } = await sendTwilioSms({ to: customer.mobile, body });

    // Success — update row
    await db
      .from("sms_campaign_sends")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        twilio_sid: sid,
        attempt_count: 1,
      })
      .eq("event_id", event.id)
      .eq("customer_id", customer.customerId)
      .eq("wave", wave);

    return true;
  } catch (sendError) {
    // Failure — mark for retry
    const errMsg =
      sendError instanceof Error ? sendError.message : "Unknown error";
    const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min backoff

    await db
      .from("sms_campaign_sends")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        attempt_count: 1,
        last_error: errMsg,
        next_retry_at: retryAt,
      })
      .eq("event_id", event.id)
      .eq("customer_id", customer.customerId)
      .eq("wave", wave);

    console.error(`Campaign SMS failed for ${customer.mobile}:`, errMsg);
    return false;
  }
}

// ── Campaign Stats ──────────────────────────────────────────────────────────

export async function getCampaignStatsForEvent(
  eventId: string,
): Promise<CampaignStats[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("sms_campaign_sends")
    .select("wave, status, converted_at")
    .eq("event_id", eventId);

  if (error || !data) return [];

  const statsMap = new Map<number, CampaignStats>();
  for (const row of data) {
    const w = row.wave as number;
    if (!statsMap.has(w)) {
      statsMap.set(w, { wave: w, sent: 0, failed: 0, converted: 0 });
    }
    const s = statsMap.get(w)!;
    if (row.status === "sent") s.sent++;
    if (row.status === "failed" || row.status === "permanent_failed") s.failed++;
    if (row.converted_at) s.converted++;
  }

  return Array.from(statsMap.values()).sort((a, b) => a.wave - b.wave);
}
