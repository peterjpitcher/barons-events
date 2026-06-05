import type { UserRole } from "./types";

/**
 * Role capability model — two-role model
 *
 * administrator — full platform write access
 * manager       — read-only access unless a non-admin workspace workflow explicitly allows writing
 */

/** Convenience: check if user is an administrator */
export function isAdministrator(role: UserRole): boolean {
  return role === "administrator";
}

/** Can propose or submit an event. Event creation is administrator-only. */
export function canProposeEvents(role: UserRole): boolean {
  return role === "administrator";
}

/** Context an edit check needs about the event being edited. */
export type EventEditContext = {
  venueId: string | null;
  venueIds?: string[];
  managerResponsibleId: string | null;
  createdBy: string | null;
  status: string | null;
  deletedAt: string | null;
};

/** Can edit a specific event. Defence-in-depth: also enforced at RLS + trigger. */
export function canEditEvent(
  role: UserRole,
  userId: string,
  userVenueId: string | null,
  event: EventEditContext,
): boolean {
  void userId;
  void userVenueId;
  void event;
  return role === "administrator";
}

/** Context a debrief submit/edit check needs about the parent event. */
export type EventDebriefContext = {
  venueId: string | null;
  venueIds?: string[];
  managerResponsibleId: string | null;
  createdBy: string | null;
  status: string | null;
  deletedAt?: string | null;
};

/** Can submit or edit the debrief for a specific event. */
export function canSubmitDebriefForEvent(
  role: UserRole,
  userId: string,
  userVenueId: string | null,
  event: EventDebriefContext,
): boolean {
  if (event.deletedAt) return false;
  if (event.status !== "approved" && event.status !== "completed") return false;

  if (role === "administrator") return true;
  if (!canCreateDebriefs(role, userVenueId)) return false;

  const linkedVenueIds = new Set<string>();
  if (event.venueId) linkedVenueIds.add(event.venueId);
  for (const venueId of event.venueIds ?? []) {
    if (venueId) linkedVenueIds.add(venueId);
  }
  if (linkedVenueIds.size > 0 && (!userVenueId || !linkedVenueIds.has(userVenueId))) {
    return false;
  }

  return event.managerResponsibleId === userId || (!event.managerResponsibleId && event.createdBy === userId);
}

/** Can view events (all roles) */
export function canViewEvents(role: UserRole): boolean {
  void role;
  return true;
}

/** Can make review/approval decisions on events */
export function canReviewEvents(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage bookings */
export function canManageBookings(role: UserRole, venueId?: string | null): boolean {
  void venueId;
  return role === "administrator";
}

/** Can manage customers */
export function canManageCustomers(role: UserRole, venueId?: string | null): boolean {
  void venueId;
  return role === "administrator";
}

/** Can manage artists */
export function canManageArtists(role: UserRole, venueId?: string | null): boolean {
  void venueId;
  return role === "administrator";
}

/** Can create debriefs (admin always; manager only with venueId) */
export function canCreateDebriefs(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "manager" && venueId) return true;
  return false;
}

/** Can edit a debrief. Admin always; manager only if they are the submitted_by user. */
export function canEditDebrief(role: UserRole, isCreator: boolean): boolean {
  if (role === "administrator") return true;
  if (role === "manager" && isCreator) return true;
  return false;
}

/** Can view/read debriefs (all roles) */
export function canViewDebriefs(role: UserRole): boolean {
  void role;
  return true;
}

/** Can view bookings list */
export function canViewBookings(role: UserRole): boolean {
  void role;
  return true;
}

/** Can view customers list */
export function canViewCustomers(role: UserRole): boolean {
  void role;
  return true;
}

/** Can view artists directory */
export function canViewArtists(role: UserRole): boolean {
  void role;
  return true;
}

/** Can view the review pipeline read-only */
export function canViewReviews(role: UserRole): boolean {
  void role;
  return true;
}

/** Can create new planning items */
export function canCreatePlanningItems(role: UserRole, venueId?: string | null): boolean {
  return role === "administrator" || (role === "manager" && Boolean(venueId));
}

/** Can edit/delete own planning items (admin can manage any) */
export function canManageOwnPlanningItems(role: UserRole): boolean {
  return role === "administrator" || role === "manager";
}

/** Can manage all planning items regardless of owner */
export function canManageAllPlanning(role: UserRole): boolean {
  return role === "administrator";
}

/** Can view the planning workspace */
export function canViewPlanning(role: UserRole): boolean {
  void role;
  return true;
}

/** Can manage venues */
export function canManageVenues(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage users (invite, update roles) */
export function canManageUsers(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage event types and system settings */
export function canManageSettings(role: UserRole): boolean {
  return role === "administrator";
}

/** Can create, edit, or delete short links and manage QR codes */
export function canManageLinks(role: UserRole): boolean {
  return role === "administrator";
}

/** Can view the SOP template configuration */
export function canViewSopTemplate(role: UserRole): boolean {
  void role;
  return true;
}

/** Can create, edit, or delete SOP template sections and tasks */
export function canEditSopTemplate(role: UserRole): boolean {
  return role === "administrator";
}
