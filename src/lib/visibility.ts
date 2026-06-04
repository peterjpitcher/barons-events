import type { AppUser } from "@/lib/types";

export type VenueLink = {
  venue_id?: string | null;
  id?: string | null;
};

export type VenueLinkedResource = {
  venueId?: string | null;
  venue_id?: string | null;
  venues?: Array<{ id?: string | null; venue_id?: string | null }> | null;
  event_venues?: VenueLink[] | null;
  planning_item_venues?: VenueLink[] | null;
};

export function linkedVenueIds(resource: VenueLinkedResource): string[] {
  const ids = new Set<string>();
  const primary = resource.venueId ?? resource.venue_id ?? null;
  if (primary) ids.add(primary);

  const linkGroups = [resource.venues, resource.event_venues, resource.planning_item_venues];
  for (const links of linkGroups) {
    if (!Array.isArray(links)) continue;
    for (const link of links) {
      const id = link.id ?? link.venue_id ?? null;
      if (id) ids.add(id);
    }
  }

  return [...ids];
}

export function isLinkedToVenue(resource: VenueLinkedResource, venueId: string | null): boolean {
  if (!venueId) return false;
  return linkedVenueIds(resource).includes(venueId);
}

export function canViewVenueLinkedResource(user: AppUser, resource: VenueLinkedResource): boolean {
  void resource;
  return user.role === "administrator" || user.role === "office_worker" || user.role === "executive";
}

export function canOfficeWorkerUseVenueSelection(user: AppUser, venueIds: string[]): boolean {
  if (user.role === "administrator") return true;
  if (user.role !== "office_worker") return false;
  if (!user.venueId) return true;
  return venueIds.length > 0 && venueIds.every((venueId) => venueId === user.venueId);
}

export function canCreatePlanningForVenueSelection(user: AppUser, venueIds: string[]): boolean {
  if (user.role === "administrator") return true;
  if (user.role !== "office_worker") return false;
  if (!user.venueId) return false;
  return venueIds.length > 0 && venueIds.every((venueId) => venueId === user.venueId);
}

export function canEditVenueLinkedPlanning(user: AppUser, resource: VenueLinkedResource): boolean {
  if (user.role === "administrator") return true;
  if (user.role !== "office_worker") return false;
  if (!user.venueId) return false;
  return isLinkedToVenue(resource, user.venueId);
}
