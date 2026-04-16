import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MARKETING_CONSENT_WORDING } from "@/lib/booking-consent";
import type { AppUser, Customer, CustomerWithStats } from "@/lib/types";

function rowToCustomer(row: Record<string, unknown>): Customer {
  return {
    id:             row.id as string,
    firstName:      row.first_name as string,
    lastName:       (row.last_name as string | null) ?? null,
    mobile:         row.mobile as string,
    email:          (row.email as string | null) ?? null,
    marketingOptIn: row.marketing_opt_in as boolean,
    createdAt:      new Date(row.created_at as string),
    updatedAt:      new Date(row.updated_at as string),
  };
}

export interface ListCustomersOptions {
  searchTerm?: string;
  optInOnly?: boolean;
}

/**
 * List customers scoped by user role.
 * administrator: all customers
 * office_worker: customers with at least one booking at their venue (users.venue_id)
 * Returns CustomerWithStats (booking count, ticket count, first seen).
 * Calls the list_customers_with_stats RPC (defined in the migration).
 */
export async function listCustomersForUser(
  user: AppUser,
  options: ListCustomersOptions = {},
): Promise<CustomerWithStats[]> {
  const db = createSupabaseAdminClient();

  const { data, error } = await db.rpc("list_customers_with_stats", {
    p_venue_id:    user.role === "office_worker" ? (user.venueId ?? null) : null,
    p_search:      options.searchTerm ?? null,
    p_opt_in_only: options.optInOnly ?? false,
  });

  if (error) throw new Error(`listCustomersForUser failed: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...rowToCustomer(row),
    bookingCount: Number(row.booking_count ?? 0),
    ticketCount:  Number(row.ticket_count ?? 0),
    firstSeen:    row.first_seen ? new Date(row.first_seen as string) : new Date(row.created_at as string),
  }));
}

export interface CustomerBooking {
  id: string;
  ticketCount: number;
  status: "confirmed" | "cancelled";
  createdAt: Date;
  eventId: string;
  eventTitle: string;
  eventStartAt: Date;
  venueId: string | null;
  venueName: string | null;
}

/**
 * Get a single customer with their bookings.
 * Returns null if not found.
 * For office_worker: returns null if customer has no bookings at their venue.
 */
export async function getCustomerById(
  customerId: string,
  user: AppUser,
): Promise<(Customer & { bookings: CustomerBooking[] }) | null> {
  const db = createSupabaseAdminClient();

  const { data: customerRow, error: customerError } = await db
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) throw new Error(`getCustomerById failed: ${customerError.message}`);
  if (!customerRow) return null;

  const { data: bookingRows, error: bookingsError } = await db
    .from("event_bookings")
    .select(`
      id, ticket_count, status, created_at,
      events!inner (
        id, title, start_at, venue_id,
        venues ( id, name )
      )
    `)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (bookingsError) throw new Error(`getCustomerById bookings failed: ${bookingsError.message}`);

  let bookings = (bookingRows ?? []).map((row: Record<string, unknown>) => {
    // join path: event_bookings → events (event_id) → venues (venue_id)
    const event = (row.events as Record<string, unknown>) ?? {};
    const venue = (event.venues as Record<string, unknown>) ?? {};
    return {
      id:           row.id as string,
      ticketCount:  row.ticket_count as number,
      status:       row.status as "confirmed" | "cancelled",
      createdAt:    new Date(row.created_at as string),
      eventId:      event.id as string,
      eventTitle:   event.title as string,
      eventStartAt: new Date(event.start_at as string),
      venueId:      (event.venue_id as string | null) ?? null,
      venueName:    (venue.name as string | null) ?? null,
    };
  });

  // Scope for office_worker: only show bookings at their venue
  if (user.role === "office_worker" && user.venueId) {
    bookings = bookings.filter((b) => b.venueId === user.venueId);
    if (bookings.length === 0) return null;
  }

  return { ...rowToCustomer(customerRow as Record<string, unknown>), bookings };
}

/**
 * Look up a customer by E.164 mobile number.
 * Returns a camelCase Customer object or null if not found.
 */
export async function findCustomerByMobile(mobile: string): Promise<Customer | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("customers")
    .select("*")
    .eq("mobile", mobile)
    .maybeSingle();

  if (error) {
    console.error("findCustomerByMobile failed:", error);
    return null;
  }
  if (!data) return null;
  return rowToCustomer(data as Record<string, unknown>);
}

export interface UpsertCustomerForBookingParams {
  mobile: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  marketingOptIn?: boolean;
  bookingId?: string;
}

/**
 * Upsert a customer by mobile (natural key).
 * - Name is last-write-wins; email only set when provided (preserves existing).
 * - marketing_opt_in is upgrade-only: only set to true, never downgrade.
 * - Logs consent events when opt-in status genuinely changes.
 * Returns the customer ID or null on failure.
 */
export async function upsertCustomerForBooking(
  params: UpsertCustomerForBookingParams,
): Promise<string | null> {
  const { mobile, firstName, lastName, email, marketingOptIn = false, bookingId } = params;
  const db = createSupabaseAdminClient();

  // Step 1: Upsert core fields (not marketing_opt_in — that's upgrade-only)
  const upsertPayload: Record<string, unknown> = {
    mobile,
    first_name: firstName,
    last_name: lastName ?? null,
    updated_at: new Date().toISOString(),
  };
  if (email) upsertPayload.email = email;

  const { data: upserted, error: upsertError } = await db
    .from("customers")
    .upsert(upsertPayload, { onConflict: "mobile" })
    .select("id, marketing_opt_in")
    .single();

  if (upsertError) {
    console.error("Customer upsert failed:", upsertError);
    return null;
  }
  if (!upserted) return null;

  const customerId = upserted.id as string;
  const previousOptIn = upserted.marketing_opt_in as boolean;

  // Step 2: Upgrade-only opt-in — only write when new value is TRUE and old is FALSE
  if (marketingOptIn && !previousOptIn) {
    await db
      .from("customers")
      .update({ marketing_opt_in: true })
      .eq("id", customerId);
  }

  // Step 3: Log consent event only when value genuinely changes
  if (marketingOptIn !== previousOptIn) {
    const { error: consentError } = await db
      .from("customer_consent_events")
      .insert({
        customer_id: customerId,
        event_type: marketingOptIn ? "opt_in" : "opt_out",
        consent_wording: MARKETING_CONSENT_WORDING,
        booking_id: bookingId ?? null,
      });
    if (consentError) {
      console.error("Consent event insert failed:", consentError);
    }
  }

  return customerId;
}

/**
 * Link a booking to a customer by setting event_bookings.customer_id.
 */
export async function linkBookingToCustomer(
  bookingId: string,
  customerId: string,
): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("event_bookings")
    .update({ customer_id: customerId })
    .eq("id", bookingId);

  if (error) {
    console.error("linkBookingToCustomer failed:", error);
    return false;
  }
  return true;
}
