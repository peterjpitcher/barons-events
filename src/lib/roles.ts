import type { UserRole } from "./types";

/**
 * Role capability model
 *
 * venue_manager   — creates and manages their own events; submits debriefs; manages their artists
 * reviewer        — reviews and makes decisions on events assigned to them
 * central_planner — full access: all of the above plus user/venue/event-type management, planning workspace
 * executive       — read-only observer: can view all data but cannot create, modify, or delete anything
 *
 * Write actions use these helpers instead of inline role string comparisons so that adding a new
 * capability to a role (or adding a new role) only requires a change in this file.
 */

/** Can create or edit events */
export function canManageEvents(role: UserRole): boolean {
  return role === "central_planner" || role === "venue_manager";
}

/** Can make review decisions on events */
export function canReviewEvents(role: UserRole): boolean {
  return role === "central_planner" || role === "reviewer";
}

/** Can submit post-event debriefs */
export function canSubmitDebriefs(role: UserRole): boolean {
  return role === "central_planner" || role === "venue_manager";
}

/** Can manage artists (create, curate, archive) */
export function canManageArtists(role: UserRole): boolean {
  return role === "central_planner" || role === "venue_manager";
}

/** Can manage venues */
export function canManageVenues(role: UserRole): boolean {
  return role === "central_planner";
}

/** Can manage users (invite, update roles) */
export function canManageUsers(role: UserRole): boolean {
  return role === "central_planner";
}

/** Can manage event types and system settings */
export function canManageSettings(role: UserRole): boolean {
  return role === "central_planner";
}

/** Can use the planning workspace (read and write) */
export function canUsePlanning(role: UserRole): boolean {
  return role === "central_planner";
}

/** Can view all events regardless of venue or assignment */
export function canViewAllEvents(role: UserRole): boolean {
  return role === "central_planner" || role === "reviewer" || role === "executive";
}
