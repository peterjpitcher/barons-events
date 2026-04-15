import type { UserRole } from "./types";

/**
 * Role capability model — COMPATIBILITY PHASE
 *
 * Accepts both legacy role strings (central_planner, venue_manager, reviewer)
 * and new role strings (administrator, office_worker). This will be simplified
 * in Phase 2 once the DB migration has run.
 *
 * administrator = central_planner
 * office_worker = venue_manager (with venue_id) or reviewer (without venue_id)
 * executive = executive (unchanged)
 */

function isAdmin(role: UserRole): boolean {
  return role === "central_planner" || role === "administrator";
}

function isVenueWorker(role: UserRole): boolean {
  return role === "venue_manager" || role === "office_worker";
}

function isReviewerLegacy(role: UserRole): boolean {
  return role === "reviewer";
}

/** Can create or edit events */
export function canManageEvents(role: UserRole): boolean {
  return isAdmin(role) || isVenueWorker(role);
}

/** Can make review decisions on events */
export function canReviewEvents(role: UserRole): boolean {
  return isAdmin(role) || isReviewerLegacy(role);
}

/** Can submit post-event debriefs */
export function canSubmitDebriefs(role: UserRole): boolean {
  return isAdmin(role) || isVenueWorker(role);
}

/** Can manage artists (create, curate, archive) */
export function canManageArtists(role: UserRole): boolean {
  return isAdmin(role) || isVenueWorker(role);
}

/** Can manage venues */
export function canManageVenues(role: UserRole): boolean {
  return isAdmin(role);
}

/** Can manage users (invite, update roles) */
export function canManageUsers(role: UserRole): boolean {
  return isAdmin(role);
}

/** Can manage event types and system settings */
export function canManageSettings(role: UserRole): boolean {
  return isAdmin(role);
}

/** Can use the planning workspace (read and write) */
export function canUsePlanning(role: UserRole): boolean {
  return isAdmin(role);
}

/** Can view the planning workspace */
export function canViewPlanning(role: UserRole): boolean {
  return isAdmin(role) || role === "executive";
}

/** Can view all events regardless of venue or assignment */
export function canViewAllEvents(role: UserRole): boolean {
  return isAdmin(role) || isReviewerLegacy(role) || role === "executive";
}

/** Can create, edit, or delete short links and manage QR codes */
export function canManageLinks(role: UserRole): boolean {
  return isAdmin(role);
}

/** Can view the SOP template configuration */
export function canViewSopTemplate(role: UserRole): boolean {
  return isAdmin(role) || role === "executive";
}

/** Can create, edit, or delete SOP template sections and tasks */
export function canEditSopTemplate(role: UserRole): boolean {
  return isAdmin(role);
}
