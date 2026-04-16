import "server-only";
import { sendTwilioSms } from "@/lib/twilio";
import { createSystemShortLink } from "@/lib/system-short-links";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

// ── Date formatting ───────────────────────────────────────────────────────────

/**
 * Formats an event start date/time for UK display.
 * e.g. "Friday 20 March at 7:00pm"
 */
export function formatEventDateTime(startAt: Date): { dayDate: string; time: string } {
  const london = toZonedTime(startAt, "Europe/London");
  const dayDate = format(london, "EEEE d MMMM");
  const time = format(london, "h:mmaaa");
  return { dayDate, time };
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

  await sendTwilioSms({ to: data.mobile, body });

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
    await sendTwilioSms({ to: params.mobile, body });
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

    await sendTwilioSms({ to: params.mobile, body });
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
