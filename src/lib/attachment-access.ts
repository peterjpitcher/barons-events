import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadEventEditContext } from "@/lib/events/edit-context";
import { canEditEvent } from "@/lib/roles";
import type { AppUser } from "@/lib/types";
import { canEditVenueLinkedPlanning, canViewVenueLinkedResource } from "@/lib/visibility";

export type AttachmentParentType = "event" | "planning_item" | "planning_task";

export type AttachmentAccessRow = {
  uploaded_by: string | null;
  event_id: string | null;
  planning_item_id: string | null;
  planning_task_id: string | null;
};

type PlanningAccessRow = {
  id: string;
  venue_id: string | null;
  planning_item_venues?: Array<{ venue_id: string | null }> | null;
};

type EventAccessRow = {
  id: string;
  venue_id: string | null;
  event_venues?: Array<{ venue_id: string | null }> | null;
};

async function loadEventAccessRow(eventId: string): Promise<EventAccessRow | null> {
  const db = createSupabaseAdminClient();
  const { data } = await (db as any)
    .from("events")
    .select("id, venue_id, event_venues(venue_id)")
    .eq("id", eventId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as EventAccessRow | null) ?? null;
}

async function loadPlanningAccessRow(planningItemId: string): Promise<PlanningAccessRow | null> {
  const db = createSupabaseAdminClient();
  const { data } = await (db as any)
    .from("planning_items")
    .select("id, venue_id, planning_item_venues(venue_id)")
    .eq("id", planningItemId)
    .maybeSingle();
  return (data as PlanningAccessRow | null) ?? null;
}

async function loadPlanningAccessRowForTask(taskId: string): Promise<PlanningAccessRow | null> {
  const db = createSupabaseAdminClient();
  const { data: task } = await (db as any)
    .from("planning_tasks")
    .select("planning_item_id")
    .eq("id", taskId)
    .maybeSingle();
  const planningItemId = (task as { planning_item_id?: string } | null)?.planning_item_id;
  return planningItemId ? loadPlanningAccessRow(planningItemId) : null;
}

async function canViewPlanningParent(user: AppUser, parentType: AttachmentParentType, parentId: string): Promise<boolean> {
  const planningItem =
    parentType === "planning_item"
      ? await loadPlanningAccessRow(parentId)
      : parentType === "planning_task"
        ? await loadPlanningAccessRowForTask(parentId)
        : null;
  if (!planningItem) return false;
  return canViewVenueLinkedResource(user, {
    venue_id: planningItem.venue_id,
    planning_item_venues: planningItem.planning_item_venues ?? []
  });
}

async function canEditPlanningParent(user: AppUser, parentType: AttachmentParentType, parentId: string): Promise<boolean> {
  const planningItem =
    parentType === "planning_item"
      ? await loadPlanningAccessRow(parentId)
      : parentType === "planning_task"
        ? await loadPlanningAccessRowForTask(parentId)
        : null;
  if (!planningItem) return false;
  return canEditVenueLinkedPlanning(user, {
    venue_id: planningItem.venue_id,
    planning_item_venues: planningItem.planning_item_venues ?? []
  });
}

export async function canUploadToAttachmentParent(
  user: AppUser,
  parentType: AttachmentParentType,
  parentId: string
): Promise<boolean> {
  if (parentType === "event") {
    const ctx = await loadEventEditContext(parentId);
    return Boolean(ctx && canEditEvent(user.role, user.id, user.venueId, ctx));
  }
  return canEditPlanningParent(user, parentType, parentId);
}

export async function canViewAttachment(user: AppUser, attachment: AttachmentAccessRow): Promise<boolean> {
  if (attachment.event_id) {
    const event = await loadEventAccessRow(attachment.event_id);
    return Boolean(
      event &&
        canViewVenueLinkedResource(user, {
          venue_id: event.venue_id,
          event_venues: event.event_venues ?? []
        })
    );
  }
  if (attachment.planning_item_id) {
    return canViewPlanningParent(user, "planning_item", attachment.planning_item_id);
  }
  if (attachment.planning_task_id) {
    return canViewPlanningParent(user, "planning_task", attachment.planning_task_id);
  }
  return false;
}

export async function canEditAttachment(user: AppUser, attachment: AttachmentAccessRow): Promise<boolean> {
  if (attachment.event_id) {
    const ctx = await loadEventEditContext(attachment.event_id);
    return Boolean(ctx && canEditEvent(user.role, user.id, user.venueId, ctx));
  }
  if (attachment.planning_item_id) {
    return canEditPlanningParent(user, "planning_item", attachment.planning_item_id);
  }
  if (attachment.planning_task_id) {
    return canEditPlanningParent(user, "planning_task", attachment.planning_task_id);
  }
  return false;
}
