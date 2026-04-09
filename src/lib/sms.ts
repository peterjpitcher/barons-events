import "server-only";
import twilio from "twilio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { SHORT_LINK_BASE_URL, type LinkType } from "@/lib/links";

// ── Twilio helpers ────────────────────────────────────────────────────────────

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured");
  }
  return twilio(accountSid, authToken);
}

function getFromNumber(): string {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new Error("TWILIO_FROM_NUMBER not configured");
  return from;
}

async function sendSms(to: string, body: string): Promise<void> {
  const client = getTwilioClient();
  await client.messages.create({ to, from: getFromNumber(), body });
}

// ── Date formatting ───────────────────────────────────────────────────────────

/**
 * Formats an event start date/time for UK display.
 * e.g. "Friday 20 March at 7:00pm"
 */
function formatEventDateTime(startAt: Date): { dayDate: string; time: string } {
  const london = toZonedTime(startAt, "Europe/London");
  const dayDate = format(london, "EEEE d MMMM");
  const time = format(london, "h:mmaaa");
  return { dayDate, time };
}

// ── Short link creation (system/service-role) ─────────────────────────────────

/**
 * Creates a short link using the admin client (no auth context required).
 * Used for system-generated links in cron routes where there is no request
 * cookie context.
 * Returns the full short URL or null if creation fails.
 */
async function createSystemShortLink(params: {
  name: string;
  destination: string;
}): Promise<string | null> {
  const db = createSupabaseAdminClient();

  // Generate a unique 8-char hex code (same algorithm as links-server.ts)
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const candidate = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { data: existing } = await db
      .from("short_links")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!existing) {
      code = candidate;
      break;
    }
  }
  if (!code) {
    console.warn("createSystemShortLink: could not generate unique code");
    return null;
  }

  // "other" is the closest LinkType for external review links
  const linkType: LinkType = "other";
  const { data, error } = await db
    .from("short_links")
    .insert({
      code,
      name: params.name,
      destination: params.destination,
      link_type: linkType,
      expires_at: null,
      created_by: null,
    })
    .select("code")
    .single();

  if (error || !data) {
    console.warn("createSystemShortLink: insert failed", error);
    return null;
  }

  return SHORT_LINK_BASE_URL + (data as { code: string }).code;
}

// ── Public SMS functions ──────────────────────────────────────────────────────

/**
 * Sends a booking confirmation SMS immediately after booking.
 * Fetches booking + event + venue from DB, then sends.
 */
export async function sendBookingConfirmationSms(bookingId: string): Promise<void> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db
    .from("event_bookings")
    .select(`
      id, first_name, mobile,
      events (
        title, start_at,
        venues ( name )
      )
    `)
    .eq("id", bookingId)
    .single();

  if (error || !data) {
    console.error("sendBookingConfirmationSms: booking not found", bookingId, error);
    return;
  }

  const event = (data.events as unknown) as { title: string; start_at: string; venues: { name: string } };
  const { dayDate, time } = formatEventDateTime(new Date(event.start_at));

  const body =
    `Hi ${data.first_name}! You're booked in for ${event.title} at ${event.venues.name} ` +
    `on ${dayDate} at ${time}. See you there! — Barons Pubs`;

  await sendSms(data.mobile, body);

  // Mark confirmation sent
  await db
    .from("event_bookings")
    .update({ sms_confirmation_sent_at: new Date().toISOString() })
    .eq("id", bookingId);
}

/**
 * Sends day-before reminder SMS. Called by the sms-reminders cron.
 *
 * Uses claim-before-send pattern: marks the row as sent BEFORE calling Twilio
 * to prevent concurrent cron runs from double-sending. If the Twilio call
 * fails, the timestamp is reset to null so the next cron run retries.
 */
export async function sendReminderSms(params: {
  bookingId: string;
  firstName: string;
  mobile: string;
  eventTitle: string;
  eventStart: Date;
  venueName: string;
}): Promise<void> {
  const db = createSupabaseAdminClient();

  // Claim: mark as sent BEFORE calling Twilio to prevent concurrent double-send.
  // The .is("sms_reminder_sent_at", null) filter ensures only one caller can claim
  // a given row — concurrent runs get back zero rows from .select().
  const claimTimestamp = new Date().toISOString();
  const { data: claimed, error: claimError } = await db
    .from("event_bookings")
    .update({ sms_reminder_sent_at: claimTimestamp })
    .eq("id", params.bookingId)
    .is("sms_reminder_sent_at", null)
    .select("id");

  if (claimError) {
    console.error("sendReminderSms: failed to claim booking", params.bookingId, claimError);
    throw new Error(`Failed to claim booking ${params.bookingId}: ${claimError.message}`);
  }

  if (!claimed || claimed.length === 0) {
    // Another process already claimed this booking — skip to prevent double-send
    console.info("sendReminderSms: booking already claimed, skipping", params.bookingId);
    return;
  }

  // Send the SMS
  try {
    const { time } = formatEventDateTime(params.eventStart);
    const body =
      `Just a reminder — ${params.eventTitle} is tomorrow at ${time} at ${params.venueName}. ` +
      `Looking forward to seeing you! — Barons Pubs`;
    await sendSms(params.mobile, body);
  } catch (sendError) {
    // Twilio failed — reset claim so the next cron run retries
    const { error: resetError } = await db
      .from("event_bookings")
      .update({ sms_reminder_sent_at: null })
      .eq("id", params.bookingId);
    if (resetError) {
      console.error("sendReminderSms: failed to reset claim after send failure", params.bookingId, resetError);
    }
    throw sendError;
  }
}

/**
 * Sends post-event thank-you SMS with optional Google Review tracked link.
 * Called by the sms-post-event cron.
 *
 * Uses claim-before-send pattern: marks the row as sent BEFORE calling Twilio
 * to prevent concurrent cron runs from double-sending. If the Twilio call
 * fails, the timestamp is reset to null so the next cron run retries.
 */
export async function sendPostEventSms(params: {
  bookingId: string;
  firstName: string;
  mobile: string;
  eventTitle: string;
  eventStart: Date;
  venueName: string;
  googleReviewUrl: string | null;
  eventSlug: string;
}): Promise<void> {
  const db = createSupabaseAdminClient();

  // Claim: mark as sent BEFORE calling Twilio to prevent concurrent double-send.
  // The .is("sms_post_event_sent_at", null) filter ensures only one caller can claim
  // a given row — concurrent runs get back zero rows from .select().
  const claimTimestamp = new Date().toISOString();
  const { data: claimed, error: claimError } = await db
    .from("event_bookings")
    .update({ sms_post_event_sent_at: claimTimestamp })
    .eq("id", params.bookingId)
    .is("sms_post_event_sent_at", null)
    .select("id");

  if (claimError) {
    console.error("sendPostEventSms: failed to claim booking", params.bookingId, claimError);
    throw new Error(`Failed to claim booking ${params.bookingId}: ${claimError.message}`);
  }

  if (!claimed || claimed.length === 0) {
    // Another process already claimed this booking — skip to prevent double-send
    console.info("sendPostEventSms: booking already claimed, skipping", params.bookingId);
    return;
  }

  // Build the message and send
  try {
    let reviewPart = "";

    if (params.googleReviewUrl) {
      try {
        // Append UTM params to the review URL
        const url = new URL(params.googleReviewUrl);
        url.searchParams.set("utm_source", "sms");
        url.searchParams.set("utm_medium", "text");
        url.searchParams.set("utm_campaign", "post-event-review");
        url.searchParams.set("utm_content", params.eventSlug);

        // Create a tracked short link via admin client (no auth cookie required in cron context)
        const shortUrl = await createSystemShortLink({
          name: `Post-event review — ${params.eventTitle}`,
          destination: url.toString(),
        });

        if (shortUrl) {
          reviewPart = ` We'd love to hear what you thought — leave us a Google review: ${shortUrl}`;
        }
      } catch (err) {
        console.warn("sendPostEventSms: failed to create review short link", err);
      }
    }

    const body =
      `Thanks for coming to ${params.eventTitle} yesterday! We hope you had a great time.` +
      reviewPart +
      ` — Barons Pubs`;

    await sendSms(params.mobile, body);
  } catch (sendError) {
    // Twilio failed — reset claim so the next cron run retries
    const { error: resetError } = await db
      .from("event_bookings")
      .update({ sms_post_event_sent_at: null })
      .eq("id", params.bookingId);
    if (resetError) {
      console.error("sendPostEventSms: failed to reset claim after send failure", params.bookingId, resetError);
    }
    throw sendError;
  }
}
