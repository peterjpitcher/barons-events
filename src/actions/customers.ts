"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { recordAuditLogEntry } from "@/lib/audit-log";

export type DeleteCustomerResult = { success: boolean; error?: string };

/**
 * Soft-erase a customer (GDPR Article 17 right to erasure).
 * Replaces PII with anonymised placeholders. Consent events are RETAINED
 * (ON DELETE RESTRICT means hard deletion is blocked at DB level).
 *
 * mobile token = `DELETED-${customerId}` (~44 chars, unique per customer).
 * The mobile column uses text (not varchar) to accommodate this.
 *
 * Accessible to administrator only. No UI in v1.
 */
export async function deleteCustomerAction(
  customerId: string,
): Promise<DeleteCustomerResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Unauthorized" };
  // GDPR erasure — intentionally restricted to administrator only.
  // No venue scoping needed: this is a privileged administrative action.
  if (user.role !== "administrator") {
    return { success: false, error: "Only administrators can erase customer data." };
  }

  const db = createSupabaseAdminClient();

  // Anonymise the customer record
  const { error: customerError } = await db
    .from("customers")
    .update({
      first_name:       "Deleted",
      last_name:        null,
      email:            null,
      mobile:           `DELETED-${customerId}`,
      marketing_opt_in: false,
      updated_at:       new Date().toISOString(),
    })
    .eq("id", customerId);

  if (customerError) {
    console.error("deleteCustomerAction: customer update failed", customerError);
    return { success: false, error: "Failed to erase customer record." };
  }

  // Anonymise PII on linked booking rows
  const { error: bookingsError } = await db
    .from("event_bookings")
    .update({
      first_name: "Deleted",
      last_name:  null,
      email:      null,
      mobile:     `DELETED-${customerId}`,
    })
    .eq("customer_id", customerId);

  if (bookingsError) {
    // Non-fatal — customer record already anonymised
    console.error("deleteCustomerAction: bookings update failed", bookingsError);
  }

  await recordAuditLogEntry({
    entity:   "customer",
    entityId: customerId,
    action:   "customer.erased",
    meta:     {},
    actorId:  user.id,
  });

  return { success: true };
}
