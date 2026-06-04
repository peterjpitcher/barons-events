import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type CentralEventsLeadRecipient = {
  id: string;
  email: string;
  fullName: string | null;
};

function normaliseRecipients(rows: Array<{ id: string; email: string | null; full_name: string | null }> | null | undefined): CentralEventsLeadRecipient[] {
  return (rows ?? [])
    .filter((row): row is { id: string; email: string; full_name: string | null } => Boolean(row.email))
    .map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
    }));
}

export async function resolveCentralEventsLeadRecipients(): Promise<CentralEventsLeadRecipient[]> {
  const db = createSupabaseAdminClient();
  const { data: leadRows, error: leadError } = await db
    .from("users")
    .select("id, email, full_name")
    .eq("is_central_events_lead", true)
    .is("deactivated_at", null)
    .limit(1);

  if (leadError) {
    throw new Error(`Could not load central events lead: ${leadError.message}`);
  }

  const leads = normaliseRecipients(leadRows);
  if (leads.length > 0) {
    return leads;
  }

  const { data: adminRows, error: adminError } = await db
    .from("users")
    .select("id, email, full_name")
    .eq("role", "administrator")
    .is("deactivated_at", null)
    .order("full_name", { ascending: true });

  if (adminError) {
    throw new Error(`Could not load administrator fallback recipients: ${adminError.message}`);
  }

  return normaliseRecipients(adminRows);
}
