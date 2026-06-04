import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type InternalNoteParentType = "event" | "planning_item";

export type InternalNoteSummary = {
  id: string;
  parentType: InternalNoteParentType;
  parentId: string;
  body: string;
  createdAt: string;
  createdBy: string;
  creatorName: string | null;
  creatorEmail: string | null;
};

type InternalNoteRow = {
  id: string;
  parent_type: InternalNoteParentType;
  parent_id: string;
  body: string;
  created_at: string;
  created_by: string;
  creator: { full_name: string | null; email: string | null } | null;
};

function isMissingInternalNotesTable(error: { code?: string | null; message?: string | null }): boolean {
  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    message.includes("public.internal_notes") ||
    (message.includes("internal_notes") && (message.includes("schema cache") || message.includes("does not exist")))
  );
}

export async function listInternalNotes(
  parentType: InternalNoteParentType,
  parentId: string
): Promise<InternalNoteSummary[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await (db as any)
    .from("internal_notes")
    .select("id, parent_type, parent_id, body, created_at, created_by, creator:users!internal_notes_created_by_fkey(full_name,email)")
    .eq("parent_type", parentType)
    .eq("parent_id", parentId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingInternalNotesTable(error)) {
      return [];
    }
    throw new Error(`Could not load internal notes: ${error.message}`);
  }

  return ((data ?? []) as InternalNoteRow[]).map((row) => ({
    id: row.id,
    parentType: row.parent_type,
    parentId: row.parent_id,
    body: row.body,
    createdAt: row.created_at,
    createdBy: row.created_by,
    creatorName: row.creator?.full_name ?? null,
    creatorEmail: row.creator?.email ?? null,
  }));
}
