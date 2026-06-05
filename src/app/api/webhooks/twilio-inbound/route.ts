import "server-only";
import { NextResponse } from "next/server";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validateTwilioRequest } from "@/lib/twilio";
import { findCustomerByMobile } from "@/lib/customers";
import { recordSystemAuditLogEntry } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STOP_KEYWORDS = /^(STOP|UNSUBSCRIBE|END|QUIT|CANCEL|OPTOUT)$/i;
const REPLY_CODE_PATTERN = /^([A-Z]{3})\s+([1-9]|10)$/i;
const NUMBER_ONLY_PATTERN = /^([1-9]|10)$/;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(message: string): NextResponse {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function emptyTwiml(): NextResponse {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { status: 200, headers: { "Content-Type": "text/xml" } },
  );
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://baronspubs.com";

function campaignEventVenueIsInternal(campaign: { events?: unknown }): boolean {
  const event = campaign.events && typeof campaign.events === "object"
    ? campaign.events as { venues?: unknown }
    : null;
  const rawVenue = event?.venues;
  const venue = Array.isArray(rawVenue) ? rawVenue[0] : rawVenue;
  return Boolean(venue && typeof venue === "object" && (venue as { is_internal?: unknown }).is_internal === true);
}

async function updateInboundResult(
  db: ReturnType<typeof createSupabaseAdminClient>,
  messageSid: string,
  result: string,
  extras?: Record<string, unknown>
) {
  await db
    .from("sms_inbound_messages")
    .update({ result, ...(extras ?? {}) })
    .eq("twilio_message_sid", messageSid);
}

export async function POST(request: Request): Promise<NextResponse> {
  // Parse form data
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => { params[key] = value.toString(); });

  // Validate Twilio signature
  const signature = request.headers.get("X-Twilio-Signature");
  if (!validateTwilioRequest(signature, params)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const rawFrom = params.From ?? "";
  const body = (params.Body ?? "").trim();
  const messageSid = params.MessageSid ?? "";

  // Normalise From to E.164
  const parsed = parsePhoneNumberFromString(rawFrom, "GB");
  const from = parsed?.format("E.164") ?? rawFrom;

  const db = createSupabaseAdminClient();

  // Deduplication check
  const { data: existing } = await db
    .from("sms_inbound_messages")
    .select("id")
    .eq("twilio_message_sid", messageSid)
    .maybeSingle();

  if (existing) return emptyTwiml();

  // Insert inbound message record
  await db.from("sms_inbound_messages").insert({
    twilio_message_sid: messageSid,
    from_number: from,
    body,
    result: "processing",
  });

  // STOP handling — before anything else
  if (STOP_KEYWORDS.test(body)) {
    const customer = await findCustomerByMobile(from);
    if (customer) {
      await db.from("customers").update({ marketing_opt_in: false }).eq("id", customer.id);
      await db.from("customer_consent_events").insert({
        customer_id: customer.id,
        event_type: "opt_out",
        consent_wording: "Customer replied STOP to SMS campaign.",
        booking_id: null,
      });
      // Suppress all open campaigns for this customer
      await db
        .from("sms_campaign_sends")
        .update({ converted_at: new Date().toISOString() })
        .eq("customer_id", customer.id)
        .is("converted_at", null)
        .eq("status", "sent");
    }
    await updateInboundResult(db, messageSid, "opted_out");
    return twiml("You've been unsubscribed from promotional messages. You'll still receive booking confirmations.");
  }

  // Look up customer
  const customer = await findCustomerByMobile(from);
  if (!customer) {
    await updateInboundResult(db, messageSid, "error");
    return twiml(`Sorry, we couldn't find your details. Please book online at ${APP_URL}`);
  }

  // Parse reply: code + number, or number only
  let replyCode: string | null = null;
  let ticketCount: number;

  const codeMatch = body.match(REPLY_CODE_PATTERN);
  const numberMatch = body.match(NUMBER_ONLY_PATTERN);

  if (codeMatch) {
    replyCode = codeMatch[1].toUpperCase();
    ticketCount = parseInt(codeMatch[2], 10);
  } else if (numberMatch) {
    ticketCount = parseInt(numberMatch[0], 10);
  } else {
    await updateInboundResult(db, messageSid, "error");
    return twiml("Please reply with your code and number of seats (e.g., 'ABC 2'). Or reply STOP to opt out.");
  }

  // Find the active campaign send
  let campaignQuery = db
    .from("sms_campaign_sends")
    .select("id, event_id, reply_code, converted_at, events (public_title, start_at, venues (name, is_internal), max_tickets_per_booking)")
    .eq("customer_id", customer.id)
    .eq("status", "sent")
    .is("converted_at", null)
    .order("sent_at", { ascending: false });

  if (replyCode) {
    campaignQuery = campaignQuery.eq("reply_code", replyCode);
  }

  const { data: campaigns } = await campaignQuery.limit(5);

  const publicCampaigns = (campaigns ?? []).filter((campaign) => !campaignEventVenueIsInternal(campaign));

  if (publicCampaigns.length === 0) {
    await updateInboundResult(db, messageSid, "error");
    return twiml(`We're not sure which event you're replying about. Book online at ${APP_URL}`);
  }

  // Disambiguation: multiple events without reply code
  if (!replyCode && publicCampaigns.length > 1) {
    const lines = publicCampaigns.slice(0, 5).map((c) => {
      const evt = c.events as unknown as Record<string, unknown>;
      return `- Reply '${c.reply_code ?? "???"} ${ticketCount}' for ${evt.public_title}`;
    });
    await updateInboundResult(db, messageSid, "needs_disambiguation");
    return twiml(`Which event?\n${lines.join("\n")}`);
  }

  const campaignSend = publicCampaigns[0];

  // Create booking via RPC
  const { data: result, error: rpcError } = await db.rpc("create_booking_from_campaign", {
    p_campaign_send_id: campaignSend.id,
    p_ticket_count: ticketCount,
  });

  if (rpcError) {
    console.error("create_booking_from_campaign failed:", rpcError);
    await updateInboundResult(db, messageSid, "error");
    return twiml("Sorry, something went wrong. Please try again or book online.");
  }

  const rpcResult = result as { ok: boolean; reason?: string; booking_id?: string; max?: number };

  if (!rpcResult.ok) {
    const reason = rpcResult.reason;
    if (reason === "already_converted") {
      await updateInboundResult(db, messageSid, "duplicate");
      const evt = campaignSend.events as unknown as Record<string, unknown>;
      return twiml(`You're already booked for ${evt.public_title}! See you there.`);
    }
    if (reason === "sold_out") {
      await updateInboundResult(db, messageSid, "error");
      const evt = campaignSend.events as unknown as Record<string, unknown>;
      return twiml(`Sorry, ${evt.public_title} is fully booked. We'll let you know if spots open up!`);
    }
    if (reason === "too_many_tickets") {
      await updateInboundResult(db, messageSid, "too_many_tickets");
      return twiml(`Sorry, the maximum tickets per booking is ${rpcResult.max ?? 10}. Please try a smaller number.`);
    }
    await updateInboundResult(db, messageSid, "booking_failed");
    return twiml("Sorry, something went wrong. Please try again.");
  }

  // Success
  const evt = campaignSend.events as unknown as Record<string, unknown>;
  const venue = (evt.venues as unknown as Record<string, unknown>) ?? {};
  await updateInboundResult(db, messageSid, "booked", { booking_id: rpcResult.booking_id });
  if (rpcResult.booking_id) {
    await recordSystemAuditLogEntry({
      entity: "event",
      entityId: campaignSend.event_id,
      action: "booking.created",
      meta: {
        booking_id: rpcResult.booking_id,
        ticket_count: ticketCount,
        source: "sms_campaign",
        campaign_send_id: campaignSend.id
      },
      actorId: null,
    });
  }

  return twiml(`Booked! ${ticketCount} seat(s) for ${evt.public_title} at ${venue.name}. See you there!`);
}
