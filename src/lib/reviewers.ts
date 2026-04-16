import { createSupabaseReadonlyClient } from "@/lib/supabase/server";

export interface ApproverOption {
  id: string;
  name: string;
  email: string;
}

/** @deprecated Use ApproverOption instead */
export type ReviewerOption = ApproverOption;

/**
 * List users who can approve events (administrators).
 * Formerly listed users with the "reviewer" role; that role no longer exists.
 */
export async function listApprovers(): Promise<ApproverOption[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email")
    .eq("role", "administrator")
    .is("deactivated_at", null)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Could not load approvers: ${error.message}`);
  }

  const rows = (data ?? []) as any[];

  return rows.map((row) => ({
    id: row.id,
    name: row.full_name ?? row.email,
    email: row.email
  }));
}

/** @deprecated Use listApprovers instead */
export { listApprovers as listReviewers };
