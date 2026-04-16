import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/cron-auth";
import { getConfirmedTicketCount } from "@/lib/bookings";
import {
  getWaveDue,
  sendCampaignSms,
  type CampaignEvent,
  type BookingType,
} from "@/lib/sms-campaign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(JSON.stringify({
    event: "cron.invoked",
    endpoint: "sms-booking-driver",
    timestamp: new Date().toISOString(),
  }));

  const db = createSupabaseAdminClient();

  // Fetch eligible events
  const { data: events, error: eventsError } = await db
    .from("events")
    .select(`
      id, public_title, event_type, booking_type, venue_id, start_at,
      ticket_price, total_capacity, booking_url, seo_slug, max_tickets_per_booking,
      venues ( name )
    `)
    .in("status", ["approved", "completed"])
    .eq("sms_promo_enabled", true)
    .eq("booking_enabled", true)
    .gt("start_at", new Date().toISOString())
    .is("deleted_at", null);

  if (eventsError) {
    console.error("sms-booking-driver: events query failed", eventsError);
    return NextResponse.json({ error: "Events query failed" }, { status: 500 });
  }

  let totalSent = 0;
  let totalFailed = 0;

  for (const row of events ?? []) {
    const startAt = new Date(row.start_at as string);
    const wave = getWaveDue(startAt);
    if (!wave) continue;

    // Capacity pre-check — skip sold-out events
    const confirmedTickets = await getConfirmedTicketCount(row.id as string);
    const capacity = row.total_capacity as number | null;
    if (capacity !== null && confirmedTickets >= capacity) {
      console.log(JSON.stringify({
        event: "cron.skip_sold_out",
        eventId: row.id,
        wave,
      }));
      continue;
    }

    const venue = (row.venues as unknown as Record<string, unknown>) ?? {};
    const campaignEvent: CampaignEvent = {
      id: row.id as string,
      publicTitle: (row.public_title as string) || "Event",
      eventType: row.event_type as string,
      bookingType: (row.booking_type as BookingType) || "ticketed",
      venueId: row.venue_id as string,
      venueName: (venue.name as string) || "Venue",
      startAt,
      ticketPrice: row.ticket_price as number | null,
      totalCapacity: capacity,
      bookingUrl: row.booking_url as string | null,
      seoSlug: row.seo_slug as string | null,
      maxTicketsPerBooking: (row.max_tickets_per_booking as number) || 10,
    };

    // Get audience
    const { data: audience, error: audienceError } = await db.rpc("get_campaign_audience", {
      p_event_id: campaignEvent.id,
      p_event_type: campaignEvent.eventType,
      p_venue_id: campaignEvent.venueId,
      p_wave: wave,
    });

    if (audienceError) {
      console.error("sms-booking-driver: audience RPC failed", campaignEvent.id, audienceError);
      continue;
    }

    for (const member of audience ?? []) {
      const success = await sendCampaignSms({
        event: campaignEvent,
        customer: {
          customerId: member.customer_id as string,
          firstName: member.first_name as string,
          mobile: member.mobile as string,
        },
        wave,
        confirmedTickets,
      });

      if (success) totalSent++;
      else totalFailed++;
    }
  }

  console.log(JSON.stringify({
    event: "cron.completed",
    endpoint: "sms-booking-driver",
    sent: totalSent,
    failed: totalFailed,
    timestamp: new Date().toISOString(),
  }));

  return NextResponse.json({ sent: totalSent, failed: totalFailed });
}

// Also export POST for manual invocations
export const POST = GET;
