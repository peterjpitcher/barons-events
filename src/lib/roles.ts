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

/**
 * Can raise an event proposal for an administrator to approve.
 *
 * Administrators and managers. This is the point of the manager account: they
 * propose, an administrator approves, and the administrator then completes the
 * details. Gates /events/propose and proposeEventAction only.
 */
export function canProposeEvents(role: UserRole): boolean {
  return role === "administrator" || role === "manager";
}

/**
 * Can create an event outright through the full form, skipping approval.
 *
 * Administrators only. Kept separate from canProposeEvents because the full
 * form writes through the user's own session and the events table has a
 * BEFORE trigger that rejects non-administrators. A manager reaching that form
 * would fill it in and then be told "Only administrators can create or edit
 * events" by the database.
 */
export function canCreateEventsDirectly(role: UserRole): boolean {
  return role === "administrator";
}

/**
 * Can call the LLM copy tools that take a form payload and no event.
 *
 * Administrators only. These cost money per call and have no event to scope
 * them, so they must not ride along with the widened propose capability.
 */
export function canUseEventAiTools(role: UserRole): boolean {
  return role === "administrator";
}

/** Minimal venue shape the proposal venue rules need. */
export type ProposableVenue = {
  id: string;
  isInternal?: boolean;
};

/**
 * Which venues this user may raise a proposal for. One source of truth for the
 * page's option list and the server action's guard, so the two cannot drift.
 *
 * - Administrator: every venue, including the internal one.
 * - Manager with a venue: exactly that venue.
 * - Manager without a venue: every venue except internal ones, which are
 *   head-office rows rather than pubs.
 */
export function proposableVenueIds(
  role: UserRole,
  userVenueId: string | null,
  venues: ProposableVenue[]
): string[] {
  if (role === "administrator") return venues.map((venue) => venue.id);
  if (role !== "manager") return [];
  if (userVenueId) {
    return venues.some((venue) => venue.id === userVenueId) ? [userVenueId] : [];
  }
  return venues.filter((venue) => !venue.isInternal).map((venue) => venue.id);
}

/**
 * Server-side guard for a submitted venue selection.
 *
 * Must be applied in the server action, not only by filtering the picker: the
 * live proposal path runs under the service-role key, which bypasses RLS and
 * the events write trigger, so nothing downstream re-checks the venue.
 */
export function canProposeForVenues(
  role: UserRole,
  userVenueId: string | null,
  requestedVenueIds: string[],
  venues: ProposableVenue[]
): boolean {
  if (requestedVenueIds.length === 0) return false;
  const allowed = new Set(proposableVenueIds(role, userVenueId, venues));
  return requestedVenueIds.every((id) => allowed.has(id));
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

/** Can create a calendar note for the target venue (admin anywhere; manager for own venue) */
export function canCreateCalendarNote(
  role: UserRole,
  userVenueId: string | null,
  targetVenueId: string,
): boolean {
  if (role === "administrator") return true;
  return role === "manager" && Boolean(userVenueId) && userVenueId === targetVenueId;
}

/** Can edit/delete the calendar note at noteVenueId (admin anywhere; manager for own venue) */
export function canManageCalendarNote(
  role: UserRole,
  userVenueId: string | null,
  noteVenueId: string,
): boolean {
  if (role === "administrator") return true;
  return role === "manager" && Boolean(userVenueId) && userVenueId === noteVenueId;
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
