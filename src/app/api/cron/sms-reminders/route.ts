import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendReminderSms } from "@/lib/sms";
import { verifyCronSecret } from "@/lib/cron-auth";

/**
 * GET /api/cron/sms-reminders
 *
 * Sends day-before reminder SMSes for all confirmed bookings whose event
 * starts tomorrow (UK time). Called by Vercel Cron at 09:00 UTC daily.
 * Secured by CRON_SECRET bearer token.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(JSON.stringify({
    event: "cron.invoked",
    endpoint: "sms-reminders",
    ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown",
    timestamp: new Date().toISOString()
  }));

  const db = createSupabaseAdminClient();

  // Call the cron helper RPC (timezone-aware, returns bookings for events tomorrow)
  const { data: bookings, error } = await db.rpc("get_reminder_bookings");

  if (error) {
    console.error("sms-reminders cron: RPC error", error);
    return NextResponse.json({ error: "RPC failed" }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;

  for (const booking of bookings ?? []) {
    try {
      await sendReminderSms({
        bookingId: booking.booking_id,
        firstName: booking.first_name,
        mobile: booking.mobile,
        eventTitle: booking.event_title,
        eventStart: new Date(booking.event_start),
        venueName: booking.venue_name,
      });
      sent++;
    } catch (err) {
      console.error("sms-reminders: failed for booking", booking.booking_id, err);
      failed++;
    }
  }

  console.log(JSON.stringify({
    event: "cron.completed",
    endpoint: "sms-reminders",
    timestamp: new Date().toISOString()
  }));
  return NextResponse.json({ sent, failed });
}

// Also export POST for manual curl invocations during development
export const POST = GET;
