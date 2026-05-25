import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canEditEvent, type EventEditContext } from "@/lib/roles";
import type { UserRole } from "@/lib/types";

export type EventRowForEdit = {
  id: string;
  venue_id: string | null;
  event_venues?: Array<{ venue_id: string | null }> | null;
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
    .select("id, venue_id, manager_responsible_id, created_by, status, deleted_at, event_venues(venue_id)")
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    console.error("loadEventEditContext: DB error", { eventId, error });
    return null;
  }
  if (!data) return null;

  return {
    venueId: data.venue_id,
    venueIds: [
      ...new Set(
        [data.venue_id, ...((data as EventRowForEdit).event_venues ?? []).map((link) => link.venue_id)]
          .filter((venueId): venueId is string => typeof venueId === "string" && venueId.length > 0)
      )
    ],
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
    venueIds: [
      ...new Set(
        [row.venue_id, ...(row.event_venues ?? []).map((link) => link.venue_id)]
          .filter((venueId): venueId is string => typeof venueId === "string" && venueId.length > 0)
      )
    ],
    managerResponsibleId: row.manager_responsible_id,
    createdBy: row.created_by,
    status: row.status,
    deletedAt: row.deleted_at,
  });
}
