import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppUser, BookingPaymentStatus, BookingStatus } from "@/lib/types";

export interface BookingRow {
  id: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  customerNotes: string | null;
  ticketCount: number;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  paymentAmountPence: number | null;
  paymentCurrency: string | null;
  paymentCompletedAt: Date | null;
  createdAt: Date;
}

export interface BookingGroup {
  eventId: string;
  eventTitle: string;
  eventStartAt: Date;
  venueName: string | null;
  bookings: BookingRow[];
  totalBookings: number;
  totalTickets: number;
}

export interface ListAllBookingsOptions {
  searchTerm?: string;
  statusFilter?: BookingStatus | "all";
  dateRange?: "all" | "this_month" | "next_30_days";
}

/**
 * Fetch all bookings grouped by event.
 * All authenticated users see all bookings; write operations are gated
 * by canManageBookings in server actions.
 */
export async function listAllBookingsForUser(
  user: AppUser,
  options: ListAllBookingsOptions = {},
): Promise<BookingGroup[]> {
  const db = createSupabaseAdminClient();

  // Build base query
  let query = db
    .from("event_bookings")
    .select(`
      id, first_name, last_name, mobile, customer_notes, ticket_count, status, payment_status, created_at,
      payment_transaction:payment_transactions!event_bookings_payment_transaction_id_fkey(amount_pence, currency),
      events!inner (
        id, title, start_at, venue_id,
        venues!events_venue_id_fkey ( id, name )
      )
    `)
    .order("created_at", { ascending: false });

  // All authenticated users see all bookings; write operations are gated
  // by canManageBookings in server actions.

  // Status filter
  if (options.statusFilter && options.statusFilter !== "all") {
    query = (query as typeof query).eq("status", options.statusFilter);
  }

  // Date range filter on events.start_at
  const now = new Date();
  if (options.dateRange === "this_month") {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
    query = (query as typeof query)
      .gte("events.start_at", startOfMonth)
      .lte("events.start_at", endOfMonth);
  } else if (options.dateRange === "next_30_days") {
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    query = (query as typeof query)
      .gte("events.start_at", now.toISOString())
      .lte("events.start_at", in30);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listAllBookingsForUser failed: ${error.message}`);

  const groupMap = new Map<string, BookingGroup>();

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const event  = (row.events as Record<string, unknown>) ?? {};
    const venue  = (event.venues as Record<string, unknown>) ?? {};
    const eventId = event.id as string;

    // Search filter (client-side on role-scoped data)
    if (options.searchTerm) {
      const term = options.searchTerm.toLowerCase();
      const fn  = ((row.first_name as string) ?? "").toLowerCase();
      const ln  = ((row.last_name  as string) ?? "").toLowerCase();
      const mob = ((row.mobile     as string) ?? "").toLowerCase();
      if (!fn.includes(term) && !ln.includes(term) && !mob.includes(term)) continue;
    }

    if (!groupMap.has(eventId)) {
      groupMap.set(eventId, {
        eventId,
        eventTitle:   event.title as string,
        eventStartAt: new Date(event.start_at as string),
        venueName:    (venue.name as string) ?? null,
        bookings:     [],
        totalBookings: 0,
        totalTickets:  0,
      });
    }

    const group   = groupMap.get(eventId)!;
    const tickets = row.ticket_count as number;

    const status = row.status as BookingStatus;
    const paymentRelation = row.payment_transaction;
    const paymentTransaction = Array.isArray(paymentRelation)
      ? (paymentRelation[0] as Record<string, unknown> | undefined) ?? null
      : (paymentRelation as Record<string, unknown> | null | undefined) ?? null;

    group.bookings.push({
      id:          row.id as string,
      firstName:   row.first_name as string,
      lastName:    (row.last_name as string | null) ?? null,
      mobile:      row.mobile as string,
      customerNotes: (row.customer_notes as string | null) ?? null,
      ticketCount: tickets,
      status,
      paymentStatus: ((row.payment_status as BookingPaymentStatus | null) ?? "not_required"),
      paymentAmountPence: typeof paymentTransaction?.amount_pence === "number" ? paymentTransaction.amount_pence : null,
      paymentCurrency: typeof paymentTransaction?.currency === "string" ? paymentTransaction.currency : null,
      paymentCompletedAt: row.payment_completed_at ? new Date(row.payment_completed_at as string) : null,
      createdAt:   new Date(row.created_at as string),
    });

    // Only count confirmed bookings in summary totals
    if (status === "confirmed") {
      group.totalBookings++;
      group.totalTickets += tickets;
    }
  }

  // Sort groups by event start_at descending
  return Array.from(groupMap.values()).sort(
    (a, b) => b.eventStartAt.getTime() - a.eventStartAt.getTime(),
  );
}
