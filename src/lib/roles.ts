import type { UserRole } from "./types";

/**
 * Role capability model — FINAL (3-role)
 *
 * administrator — full platform access
 * office_worker — venue-scoped write (if venueId set) or global read-only (if no venueId)
 * executive     — read-only observer
 *
 * Functions accepting venueId use it as a capability switch:
 * office_worker + venueId = venue-scoped write access
 * office_worker + no venueId = read-only access
 */

/** Convenience: check if user is an administrator */
export function isAdministrator(role: UserRole): boolean {
  return role === "administrator";
}

/** Can propose or submit an event (any venue; admin triages). */
export function canProposeEvents(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Context an edit check needs about the event being edited. */
export type EventEditContext = {
  venueId: string | null;
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
  if (event.deletedAt !== null) {
    return role === "administrator";
  }

  if (role === "administrator") return true;
  if (role !== "office_worker") return false;

  if (
    event.createdBy === userId &&
    (event.status === "draft" || event.status === "needs_revisions")
  ) {
    return true;
  }

  if (!userVenueId) return false;
  if (event.venueId !== userVenueId) return false;
  if (event.managerResponsibleId !== userId) return false;
  if (event.status !== "approved" && event.status !== "cancelled") return false;
  return true;
}

/** Can view events (all roles) */
export function canViewEvents(role: UserRole): boolean {
  return true;
}

/** Can make review/approval decisions on events */
export function canReviewEvents(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage bookings (admin always; office_worker only with venueId) */
export function canManageBookings(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can manage customers (admin always; office_worker only with venueId) */
export function canManageCustomers(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can manage artists (admin always; office_worker only with venueId) */
export function canManageArtists(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can create debriefs (admin always; office_worker only with venueId) */
export function canCreateDebriefs(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can edit a debrief. Admin always; office_worker only if they are the submitted_by user. */
export function canEditDebrief(role: UserRole, isCreator: boolean): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && isCreator) return true;
  return false;
}

/** Can view/read debriefs (all roles) */
export function canViewDebriefs(role: UserRole): boolean {
  return true;
}

/** Can view bookings list (admin + office_worker; not executive) */
export function canViewBookings(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can view customers list (admin + office_worker; not executive) */
export function canViewCustomers(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can view artists directory (admin + office_worker; not executive) */
export function canViewArtists(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can view the review pipeline read-only (admin + office_worker; not executive) */
export function canViewReviews(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can create new planning items */
export function canCreatePlanningItems(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can edit/delete own planning items (admin can manage any) */
export function canManageOwnPlanningItems(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can manage all planning items regardless of owner */
export function canManageAllPlanning(role: UserRole): boolean {
  return role === "administrator";
}

/** Can view the planning workspace */
export function canViewPlanning(role: UserRole): boolean {
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
  return role === "administrator" || role === "executive";
}

/** Can create, edit, or delete SOP template sections and tasks */
export function canEditSopTemplate(role: UserRole): boolean {
  return role === "administrator";
}
