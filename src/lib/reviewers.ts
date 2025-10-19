import { createSupabaseReadonlyClient } from "@/lib/supabase/server";

export interface ReviewerOption {
  id: string;
  name: string;
  email: string;
}

export async function listReviewers(): Promise<ReviewerOption[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email")
    .eq("role", "reviewer")
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Could not load reviewers: ${error.message}`);
  }

  const rows = (data ?? []) as any[];

  return rows.map((row) => ({
    id: row.id,
    name: row.full_name ?? row.email,
    email: row.email
  }));
}
