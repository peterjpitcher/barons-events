import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EventBooking, BookingRpcResult } from "@/lib/types";

/**
 * Convert a raw DB row (snake_case, ISO strings) to an EventBooking (camelCase, Dates).
 * Inline conversion — no shared fromDb utility exists in this project.
 */
function rowToEventBooking(row: Record<string, unknown>): EventBooking {
  return {
    id:                     row.id as string,
    eventId:                row.event_id as string,
    firstName:              row.first_name as string,
    lastName:               (row.last_name as string | null) ?? null,
    mobile:                 row.mobile as string,
    email:                  (row.email as string | null) ?? null,
    ticketCount:            row.ticket_count as number,
    status:                 row.status as EventBooking["status"],
    createdAt:              new Date(row.created_at as string),
    smsConfirmationSentAt:  row.sms_confirmation_sent_at
                              ? new Date(row.sms_confirmation_sent_at as string)
                              : null,
    smsReminderSentAt:      row.sms_reminder_sent_at
                              ? new Date(row.sms_reminder_sent_at as string)
                              : null,
    smsPostEventSentAt:     row.sms_post_event_sent_at
                              ? new Date(row.sms_post_event_sent_at as string)
                              : null,
  };
}

/**
 * Atomically check capacity and insert a booking via the create_booking RPC.
 * Uses the service-role client so the RPC can run with security definer privileges.
 */
export async function createBookingAtomic(params: {
  eventId: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  email: string | null;
  ticketCount: number;
}): Promise<BookingRpcResult> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("create_booking", {
    p_event_id:     params.eventId,
    p_first_name:   params.firstName,
    p_last_name:    params.lastName,
    p_mobile:       params.mobile,
    p_email:        params.email,
    p_ticket_count: params.ticketCount,
  });

  if (error) throw new Error(`create_booking RPC failed: ${error.message}`);

  const result = data as { ok: boolean; reason?: string; booking_id?: string };
  if (!result.ok) {
    return { ok: false, reason: result.reason as "not_found" | "sold_out" };
  }
  return { ok: true, bookingId: result.booking_id! };
}

/**
 * Fetch all bookings for an event.
 * Scoping (venue manager vs planner) enforced by the caller.
 */
export async function getBookingsForEvent(eventId: string): Promise<EventBooking[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("event_bookings")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch bookings: ${error.message}`);
  return (data ?? []).map((row) => rowToEventBooking(row as Record<string, unknown>));
}

/**
 * Cancel a booking by setting status = 'cancelled'.
 * Uses service-role client — permission check must be done by the caller.
 */
export async function cancelBooking(bookingId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("event_bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);

  if (error) throw new Error(`Failed to cancel booking: ${error.message}`);
}

/**
 * Get total confirmed ticket count for an event.
 */
export async function getConfirmedTicketCount(eventId: string): Promise<number> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("event_bookings")
    .select("ticket_count")
    .eq("event_id", eventId)
    .eq("status", "confirmed");

  if (error) throw new Error(`Failed to count tickets: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + (row.ticket_count as number), 0);
}
