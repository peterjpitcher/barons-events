import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPostEventSms } from "@/lib/sms";
import { verifyCronSecret } from "@/lib/cron-auth";

/**
 * GET /api/cron/sms-post-event
 *
 * Sends post-event thank-you SMSes (with optional Google Review link) for all
 * confirmed bookings whose event ended yesterday (UK time). Called by Vercel
 * Cron at 10:00 UTC daily. Secured by CRON_SECRET bearer token.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(JSON.stringify({
    event: "cron.invoked",
    endpoint: "sms-post-event",
    ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown",
    timestamp: new Date().toISOString()
  }));

  const db = createSupabaseAdminClient();

  // Call the cron helper RPC (timezone-aware, returns bookings for events that ended yesterday)
  const { data: bookings, error } = await db.rpc("get_post_event_bookings");

  if (error) {
    console.error("sms-post-event cron: RPC error", error);
    return NextResponse.json({ error: "RPC failed" }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;

  for (const booking of bookings ?? []) {
    try {
      await sendPostEventSms({
        bookingId: booking.booking_id,
        firstName: booking.first_name,
        mobile: booking.mobile,
        eventTitle: booking.event_title,
        eventStart: new Date(booking.event_start),
        venueName: booking.venue_name,
        googleReviewUrl: booking.venue_google_review ?? null,
        eventSlug: booking.event_slug ?? "",
      });
      sent++;
    } catch (err) {
      console.error("sms-post-event: failed for booking", booking.booking_id, err);
      failed++;
    }
  }

  console.log(JSON.stringify({
    event: "cron.completed",
    endpoint: "sms-post-event",
    timestamp: new Date().toISOString()
  }));
  return NextResponse.json({ sent, failed });
}

// Also export POST for manual curl invocations during development
export const POST = GET;
