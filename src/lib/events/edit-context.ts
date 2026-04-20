import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canEditEvent, type EventEditContext } from "@/lib/roles";
import type { UserRole } from "@/lib/types";

export type EventRowForEdit = {
  id: string;
  venue_id: string | null;
  manager_responsible_id: string | null;
  created_by: string | null;
  status: string | null;
  deleted_at: string | null;
};

/**
 * Load the minimum event projection required by canEditEvent.
 * Uses the admin client so permission decisions are made against the true row,
 * not an RLS-filtered view. Returns null when the event does not exist or
 * when the query errors (errors are logged).
 */
export async function loadEventEditContext(
  eventId: string,
): Promise<EventEditContext | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("events")
    .select("id, venue_id, manager_responsible_id, created_by, status, deleted_at")
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    console.error("loadEventEditContext: DB error", { eventId, error });
    return null;
  }
  if (!data) return null;

  return {
    venueId: data.venue_id,
    managerResponsibleId: data.manager_responsible_id,
    createdBy: data.created_by,
    status: data.status,
    deletedAt: data.deleted_at,
  };
}

/** Synchronous helper for UI/list gating when the row is already loaded. */
export function canEditEventFromRow(
  user: { id: string; role: UserRole; venueId: string | null },
  row: EventRowForEdit,
): boolean {
  return canEditEvent(user.role, user.id, user.venueId, {
    venueId: row.venue_id,
    managerResponsibleId: row.manager_responsible_id,
    createdBy: row.created_by,
    status: row.status,
    deletedAt: row.deleted_at,
  });
}
